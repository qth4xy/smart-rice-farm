// Live data from the real device over MQTT/WebSockets (mqtt.js).
// Settings live in localStorage; the password only when the user ticks "remember".
import mqtt, { type MqttClient } from 'mqtt';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DeviceView } from '../data/view';
import { LiveModel } from './liveModel';

export interface LiveSettings {
  url: string;
  root: string;
  deviceId: string;
  username: string;
  password: string;
  remember: boolean;
}

export const DEFAULT_LIVE: LiveSettings = {
  url: 'wss://broker.hivemq.com:8884/mqtt',
  root: '',
  deviceId: 'srf-cc2468',
  username: '',
  password: '',
  remember: false,
};

const KEY = 'srf.live';

export function loadLiveSettings(): LiveSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LiveSettings>;
    return { ...DEFAULT_LIVE, ...s, password: s.remember ? (s.password ?? '') : '' };
  } catch {
    return { ...DEFAULT_LIVE };
  }
}

function saveLiveSettings(s: LiveSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, password: s.remember ? s.password : '' }));
  } catch {
    /* storage unavailable: settings just aren't remembered */
  }
}

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface Ack {
  cmd: string;
  ok: boolean;
  error?: string;
  at: number;
}

export function useLive(enabled: boolean, settings: LiveSettings) {
  const [conn, setConn] = useState<ConnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DeviceView | null>(null);
  const [lastAck, setLastAck] = useState<Ack | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const modelRef = useRef<LiveModel | null>(null);

  useEffect(() => {
    if (!enabled || !settings.root) {
      setConn('idle');
      setView(null);
      return;
    }
    saveLiveSettings(settings);
    const base = `${settings.root}/${settings.deviceId}/`;
    const model = new LiveModel(settings.deviceId);
    modelRef.current = model;
    setView(null);
    setError(null);
    setConn('connecting');

    const client = mqtt.connect(settings.url, {
      clientId: `srf-web-${Math.random().toString(16).slice(2, 10)}`,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 3_000,
      protocolVersion: 4,
      username: settings.username || undefined,
      password: settings.username ? settings.password : undefined,
    });
    clientRef.current = client;

    const publishView = () => setView(model.view(Date.now()));
    client.on('connect', () => {
      model.brokerConnected = true;
      setConn('connected');
      setError(null);
      client.subscribe(`${base}#`, { qos: 1 });
      publishView();
    });
    client.on('reconnect', () => setConn('reconnecting'));
    client.on('close', () => {
      model.brokerConnected = false;
      publishView();
    });
    client.on('offline', () => setConn('reconnecting'));
    client.on('error', (e) => {
      setError(e.message);
      setConn('error');
    });
    client.on('message', (topic, payload) => {
      if (!topic.startsWith(base)) return;
      const leaf = topic.slice(base.length);
      const text = payload.toString();
      model.onMessage(leaf, text, Date.now());
      if (leaf === 'event') {
        try {
          const e = JSON.parse(text);
          if (e.event === 'ack') setLastAck({ cmd: String(e.cmd), ok: !!e.ok, error: e.error, at: Date.now() });
        } catch {
          /* ignored */
        }
      }
      publishView();
    });
    // Keep "pump running for Xs" and the clock moving between messages.
    const tick = window.setInterval(publishView, 1000);

    return () => {
      window.clearInterval(tick);
      client.end(true);
      clientRef.current = null;
      modelRef.current = null;
    };
  }, [enabled, settings]);

  const send = useCallback(
    (cmd: Record<string, unknown>) => {
      const c = clientRef.current;
      if (!c || !c.connected) return false;
      c.publish(`${settings.root}/${settings.deviceId}/cmd`, JSON.stringify(cmd), { qos: 1 });
      return true;
    },
    [settings.root, settings.deviceId],
  );

  return { conn, error, view, lastAck, send };
}
