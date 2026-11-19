#!/usr/bin/env python3
"""Smart Rice Farm MQTT logger.

Subscribes to <root>/<device>/state, event and status and appends them to CSV files for later
analysis (and future ML). One row per message; nothing is invented or interpolated.

    pip install paho-mqtt==2.1.0
    # HiveMQ public broker (default host), TLS on 8883, no login. The root is shown on the OLED.
    python tools/mqtt_logger.py --root srf-xxxxxxxx
    # HiveMQ Cloud / private broker:
    python tools/mqtt_logger.py --host <cluster>.hivemq.cloud --user <user> --root srf
    (password from --password or the SRF_MQTT_PASS environment variable)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt

STATE_FIELDS = [
    "ts", "mode", "pump", "pumpRunS", "manual", "filling", "floatLow", "floatHigh", "zone",
    "fault", "warnings", "soilPct", "soilRaw", "airTempC", "airRh", "nextIrrigationEta",
    "avgDryingS", "avgFillS", "cycles", "stage", "muted", "rssi", "dhtFails", "uptimeS", "fw",
]


class CsvSink:
    def __init__(self, path: Path, fields: list[str]):
        self.fields = ["received_utc", "device"] + fields
        new = not path.exists()
        self.f = path.open("a", newline="", encoding="utf-8")
        self.w = csv.DictWriter(self.f, fieldnames=self.fields, extrasaction="ignore")
        if new:
            self.w.writeheader()

    def write(self, row: dict) -> None:
        self.w.writerow(row)
        self.f.flush()


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=os.environ.get("SRF_MQTT_HOST", "broker.hivemq.com"))
    ap.add_argument("--root", default=os.environ.get("SRF_MQTT_ROOT", "srf"),
                    help="topic root shown on the device OLED, e.g. srf-xxxxxxxx")
    ap.add_argument("--port", type=int, default=None, help="default 8883 with TLS, 1883 without")
    ap.add_argument("--user", default=os.environ.get("SRF_MQTT_USER"))
    ap.add_argument("--password", default=os.environ.get("SRF_MQTT_PASS"))
    ap.add_argument("--no-tls", action="store_true", help="plain MQTT (local Mosquitto)")
    ap.add_argument("--device", default="+", help="device id, or + for all devices")
    ap.add_argument("--out", default="logs", help="output folder (default: logs/)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    states = CsvSink(out / "state.csv", STATE_FIELDS)
    events = CsvSink(out / "events.csv", ["ts", "event", "json"])

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"srf-logger-{os.getpid()}")
    if args.user:
        client.username_pw_set(args.user, args.password)
    if not args.no_tls:
        client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    port = args.port or (1883 if args.no_tls else 8883)

    def on_connect(c, _userdata, _flags, reason, _props):
        if reason.is_failure:
            print(f"connect failed: {reason}", file=sys.stderr)
            return
        for leaf in ("state", "event", "status"):
            c.subscribe(f"{args.root}/{args.device}/{leaf}", qos=1)
        print(f"connected to {args.host}:{port}, logging to {out.resolve()}")

    def on_message(_c, _userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) != 3:
            return
        _, device, leaf = parts
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        text = msg.payload.decode("utf-8", "replace")
        if leaf == "status":
            print(f"{now} {device} status={text}")
            events.write({"received_utc": now, "device": device, "event": f"status:{text}", "json": ""})
            return
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            print(f"{now} {device} bad JSON on {leaf}: {text[:80]}", file=sys.stderr)
            return
        if leaf == "state":
            row = {k: data.get(k) for k in STATE_FIELDS}
            row["warnings"] = "|".join(data.get("warnings") or [])
            states.write({"received_utc": now, "device": device, **row})
        elif leaf == "event":
            events.write({"received_utc": now, "device": device, "ts": data.get("ts"),
                          "event": data.get("event"), "json": text})
            print(f"{now} {device} {data.get('event')} {text}")

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.host, port, keepalive=30)
    try:
        client.loop_forever(retry_first_connection=True)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
