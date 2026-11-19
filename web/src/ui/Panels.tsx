import type { DeviceView, LogKind } from '../data/view';
import type { CropStage } from '../logic/cropSchedule';
import type { Mode } from '../logic/types';
import { fmtDate, fmtDur, fmtShortDateTime, ZONE_TEXT } from './format';
import { Icon } from './Icon';

const MODE_TEXT: Record<Mode, { icon: 'drop' | 'flood' | 'off'; label: string; hint: string }> = {
  AWD: { icon: 'drop', label: 'AWD', hint: 'Alternate wetting & drying' },
  FLOOD: { icon: 'flood', label: 'FLOOD', hint: 'Keep the field flooded' },
  OFF: { icon: 'off', label: 'OFF', hint: 'No automatic pumping' },
};

// ---------------- status strip ----------------
export function StatusStrip({ v }: { v: DeviceView }) {
  const m = MODE_TEXT[v.mode];
  const health = v.fault
    ? { cls: 'fault', icon: 'alert' as const, label: 'FAULT', sub: v.fault }
    : v.warnings.length
      ? { cls: 'warn', icon: 'warn' as const, label: 'WARNING', sub: v.warnings.join(', ') }
      : { cls: 'ok', icon: 'check' as const, label: 'OK', sub: 'All checks passing' };
  const online = v.link.wifi && v.link.mqtt;
  return (
    <section className="strip" aria-label="System status">
      <div className="tile mode">
        <div className="tile-k">Mode</div>
        <div className="tile-v">
          <Icon name={m.icon} /> {m.label}
        </div>
        <div className="tile-s">{m.hint}</div>
      </div>
      <div className={v.pump ? 'tile pump on' : 'tile pump'}>
        <div className="tile-k">Pump</div>
        <div className="tile-v">
          <Icon name="pump" /> {v.pump ? 'ON' : 'OFF'}
        </div>
        <div className="tile-s">{v.pump ? `Running ${fmtDur(v.pumpRunS)}${v.manual ? ' · manual' : ''}` : v.filling ? 'Waiting' : 'Idle'}</div>
      </div>
      <div className="tile zone">
        <div className="tile-k">Water</div>
        <div className="tile-v">
          <Icon name="drop" /> {ZONE_TEXT[v.zone].short}
        </div>
        <div className="tile-s">{v.mode === 'AWD' && v.zone === 'BETWEEN' ? (v.filling ? 'Filling up to +5 cm' : 'Drying down to −15 cm') : ZONE_TEXT[v.zone].long}</div>
      </div>
      <div className={`tile health ${health.cls}`}>
        <div className="tile-k">Health</div>
        <div className="tile-v">
          <Icon name={health.icon} /> {health.label}
        </div>
        <div className="tile-s">{health.sub}</div>
      </div>
      <div className={online ? 'tile link' : 'tile link down'}>
        <div className="tile-k">Network{v.source === 'sim' ? ' (simulated)' : ''}</div>
        <div className="tile-v">
          <Icon name={online ? 'wifi' : 'wifiOff'} /> {online ? 'Online' : 'Offline'}
        </div>
        <div className="tile-s">{online ? 'Wi-Fi + MQTT connected' : 'Still irrigating on the device'}</div>
      </div>
    </section>
  );
}

// ---------------- logic panel (the 4-row state table) ----------------
export function LogicPanel({ v }: { v: DeviceView }) {
  const row = v.zone === 'BELOW' ? 0 : v.zone === 'BETWEEN' ? 1 : v.zone === 'ABOVE' ? 2 : v.zone === 'INVALID' ? 3 : -1;
  const rows = [
    { low: 'DRY', high: 'DRY', meaning: 'Below −15 cm', pump: 'ON: start filling', cls: 'r-on' },
    {
      low: 'WET',
      high: 'DRY',
      meaning: 'Between the floats',
      pump: `KEEP: ${v.filling ? 'still filling' : 'still drying'}`,
      cls: 'r-keep',
    },
    { low: 'WET', high: 'WET', meaning: 'Reached +5 cm', pump: 'OFF: stop', cls: 'r-off' },
    { low: 'DRY', high: 'WET', meaning: 'Impossible (stuck float)', pump: 'OFF + FAULT', cls: 'r-fault' },
  ];
  return (
    <section className="panel logic" aria-label="Control logic">
      <h2>
        How the controller decides <span className="h-note">{v.mode === 'AWD' ? 'AWD mode' : `${v.mode} mode: ${v.mode === 'FLOOD' ? 'uses the +5 cm float only' : 'pump never starts'}`}</span>
      </h2>
      <table className={v.mode === 'AWD' ? '' : 'dim'}>
        <thead>
          <tr>
            <th>Float −15</th>
            <th>Float +5</th>
            <th>Meaning</th>
            <th>Pump</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`${r.cls}${i === row ? ' current' : ''}`} aria-current={i === row ? 'true' : undefined}>
              <td>
                <span className={`chip ${r.low.toLowerCase()}`}>{r.low}</span>
              </td>
              <td>
                <span className={`chip ${r.high.toLowerCase()}`}>{r.high}</span>
              </td>
              <td>{r.meaning}</td>
              <td className="pump-cell">
                {i === row && <Icon name="play" />} {r.pump}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="logic-note">
        Row 2 is the key: the floats read the same while filling and while drying, so the controller remembers which one it is doing.
      </p>
    </section>
  );
}

// ---------------- sensors ----------------
export function SensorCards({ v }: { v: DeviceView }) {
  const sim = v.source === 'sim';
  const cards = [
    { k: 'Soil moisture', val: v.soilPct === null ? '--' : `${v.soilPct}`, unit: '%', alert: v.soilPct !== null && v.soilPct < 30 },
    { k: 'Air temperature', val: v.airTempC === null ? '--' : v.airTempC.toFixed(1), unit: '°C', alert: false },
    { k: 'Humidity', val: v.airRh === null ? '--' : `${Math.round(v.airRh)}`, unit: '%', alert: false },
  ];
  return (
    <section className="sensors" aria-label="Sensors">
      {cards.map((c) => (
        <div key={c.k} className={c.alert ? 'sensor alert' : 'sensor'}>
          <div className="sensor-k">{c.k}</div>
          <div className="sensor-v">
            {c.val}
            <span className="unit">{c.unit}</span>
          </div>
          {sim && <div className="sim-tag">simulated</div>}
          {c.alert && (
            <div className="sensor-alert">
              <Icon name="warn" /> dry
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------- crop timeline ----------------
const STAGES: { id: CropStage; label: string; mode: string }[] = [
  { id: 'ESTABLISHMENT', label: 'Establish', mode: 'FLOOD' },
  { id: 'VEGETATIVE', label: 'Growing', mode: 'AWD' },
  { id: 'FLOWERING', label: 'Flowering', mode: 'FLOOD' },
  { id: 'RIPENING', label: 'Ripening', mode: 'AWD' },
];

export function CropTimeline({ v }: { v: DeviceView }) {
  if (!v.crop) {
    return (
      <section className="panel crop">
        <h2>Crop schedule</h2>
        <p className="muted">No schedule set: the mode set by the operator is kept.</p>
      </section>
    );
  }
  const { transplant, flowering, harvest } = v.crop;
  const day = 86_400_000;
  const span = harvest - transplant;
  const segs = [
    [transplant, transplant + 14 * day],
    [transplant + 14 * day, flowering - 7 * day],
    [flowering - 7 * day, flowering + 8 * day],
    [flowering + 8 * day, harvest],
  ];
  const pos = Math.min(1, Math.max(0, (v.now - transplant) / span));
  const dayNo = Math.floor((v.now - transplant) / day);
  return (
    <section className="panel crop" aria-label="Crop timeline">
      <h2>
        Crop schedule <span className="h-note">day {dayNo} after transplanting</span>
      </h2>
      <div className="timeline">
        {STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`seg ${s.mode.toLowerCase()}${v.stage === s.id ? ' current' : ''}`}
            style={{ flexGrow: (segs[i][1] - segs[i][0]) / span }}
          >
            <span className="seg-label">{s.label}</span>
            <span className="seg-mode">{s.mode}</span>
          </div>
        ))}
        <div className="today" style={{ left: `${pos * 100}%` }} aria-label="today" />
      </div>
      <div className="timeline-dates">
        <span>Transplant {fmtDate(transplant)}</span>
        <span>Flowering {fmtDate(flowering)}</span>
        <span>Harvest {fmtDate(harvest)}</span>
      </div>
    </section>
  );
}

// ---------------- analytics ----------------
export function AnalyticsPanel({ v }: { v: DeviceView }) {
  const eta = v.nextIrrigationAt;
  const items = [
    { k: 'Cycles', val: `${v.cycles}` },
    { k: 'Avg drying', val: v.cycles ? fmtDur(v.avgDryingS) : '--' },
    { k: 'Avg fill', val: v.cycles ? fmtDur(v.avgFillS) : '--' },
    { k: 'Pump time', val: fmtDur(v.totalPumpS) },
    { k: 'Water used*', val: v.waterPumpedL === null ? '--' : `${Math.round(v.waterPumpedL)} L` },
  ];
  return (
    <section className="panel analytics" aria-label="Cycle analytics">
      <h2>Cycle analytics</h2>
      <div className="eta">
        <Icon name="clock" />
        <div>
          <div className="eta-k">Next irrigation (estimate)</div>
          <div className="eta-v">
            {eta !== null
              ? `in ${fmtDur((eta - v.now) / 1000)}`
              : v.fault
                ? 'Paused: fault'
                : v.mode !== 'AWD'
                  ? 'Only in AWD mode'
                  : v.pump
                    ? 'Filling now'
                    : 'Needs one full cycle'}
          </div>
        </div>
      </div>
      <dl className="stats">
        {items.map((i) => (
          <div key={i.k}>
            <dt>{i.k}</dt>
            <dd>{i.val}</dd>
          </div>
        ))}
      </dl>
      <p className="footnote">* estimated from pump time × pump flow setting</p>
    </section>
  );
}

// ---------------- event log ----------------
const KIND_ICON: Record<LogKind, 'pump' | 'alert' | 'warn' | 'wifi' | 'info'> = {
  pump: 'pump',
  fault: 'alert',
  warn: 'warn',
  net: 'wifi',
  info: 'info',
};

export function EventLog({ v }: { v: DeviceView }) {
  const items = [...v.log].reverse();
  return (
    <section className="panel log" aria-label="Event log">
      <h2>Event log</h2>
      {items.length === 0 ? (
        <p className="muted">No events yet.</p>
      ) : (
        <ol>
          {items.map((e) => (
            <li key={e.id} className={`ev ${e.kind}`}>
              <Icon name={KIND_ICON[e.kind]} />
              <time>{fmtShortDateTime(e.t)}</time>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
