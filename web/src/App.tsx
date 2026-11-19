import { useEffect, useRef, useState } from 'react';

import type { DeviceView } from './data/view';
import { loadLiveSettings, useLive, type LiveSettings } from './live/useLive';
import type { Mode } from './logic/types';
import { SCENARIOS } from './sim/scenarios';
import { DEFAULT_SIM_SETTINGS, type SimSettings } from './sim/simulation';
import { SPEEDS, useSimulation } from './sim/useSimulation';
import { CrossSection } from './ui/CrossSection';
import { fmtDateTime } from './ui/format';
import { Icon } from './ui/Icon';
import { LevelChart } from './ui/LevelChart';
import { AnalyticsPanel, CropTimeline, EventLog, LogicPanel, SensorCards, StatusStrip } from './ui/Panels';

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or file:// without storage: fine */
  }
}

interface Confirm {
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  run: () => void;
}

export function App() {
  const sim = useSimulation();
  const [source, setSource] = useState<'sim' | 'live'>('sim');
  const [liveSettings, setLiveSettings] = useState<LiveSettings>(loadLiveSettings);
  const live = useLive(source === 'live', liveSettings);
  const [theme, setTheme] = useState(() => loadPref('srf.theme', 'dark'));
  const [present, setPresent] = useState(false);
  const [tour, setTour] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [idle, setIdle] = useState(false);
  const simRef = useRef(sim);
  simRef.current = sim;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePref('srf.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('present', present);
  }, [present]);

  // Device replies (ack events) appear as a short notice.
  useEffect(() => {
    if (!live.lastAck) return;
    const a = live.lastAck;
    setToast({ ok: a.ok, text: a.ok ? `Device: ${a.cmd} done` : `Device refused ${a.cmd}: ${a.error}` });
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [live.lastAck]);

  // Hide the cursor after 3 s without movement.
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), 3000);
    const move = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 3000);
    };
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      clearTimeout(t);
    };
  }, []);

  // Guided tour: each scenario for its tourSeconds, then the next; stops after the last one.
  useEffect(() => {
    if (!tour) return;
    const sc = SCENARIOS[sim.scenario];
    const t = window.setTimeout(() => {
      if (sim.scenario === SCENARIOS.length - 1) setTour(false);
      else sim.selectScenario(sim.scenario + 1);
    }, sc.tourSeconds * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, sim.scenario]);

  // Keyboard: F fullscreen, P presentation, T tour, Space play/pause, arrows scenario, 1-4 speed.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea, dialog')) return;
      const s = simRef.current;
      const isSim = sourceRef.current === 'sim';
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'p' || e.key === 'P') setPresent((p) => !p);
      else if (!isSim) return;
      else if (e.key === 't' || e.key === 'T') startTour();
      else if (e.key === ' ') {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === 'ArrowRight') {
        setTour(false);
        s.selectScenario(s.scenario + 1);
      } else if (e.key === 'ArrowLeft') {
        setTour(false);
        s.selectScenario(s.scenario - 1);
      } else if (e.key >= '1' && e.key <= '4') s.setSpeed(SPEEDS[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const startTour = () => {
    setSource('sim');
    setTour(true);
    simRef.current.selectScenario(0);
  };

  const switchSource = (s: 'sim' | 'live') => {
    setTour(false);
    setSource(s);
    if (s === 'live' && !liveSettings.root) setLiveOpen(true);
  };

  // ---- commands: the simulator acts at once; the real device needs a confirmation ----
  const isLive = source === 'live';
  const doMode = (m: Mode) => {
    if (!isLive) return sim.setMode(m);
    setConfirm({
      title: `Switch the real device to ${m}?`,
      body: m === 'OFF' ? 'Automatic pumping stops until another mode is chosen.' : `The device starts controlling the pump in ${m} mode right away.`,
      action: `Set ${m}`,
      run: () => live.send({ cmd: 'setMode', mode: m }),
    });
  };
  const doPump = (on: boolean) => {
    if (!isLive) return sim.pump(on, 120);
    setConfirm({
      title: on ? 'Run the real pump for 30 seconds?' : 'Stop the pump?',
      body: on ? 'The pump runs for 30 s (capped by the device safety limit), then the current mode takes over.' : 'Stops a manual run and any automatic fill.',
      action: on ? 'Run pump' : 'Stop pump',
      danger: on,
      run: () => live.send(on ? { cmd: 'pump', on: true, seconds: 30 } : { cmd: 'pump', on: false }),
    });
  };
  const doFill = () => {
    if (!isLive) return sim.fill();
    setConfirm({
      title: 'Fill the real field to +5 cm?',
      body: 'The pump runs until FLOAT_HIGH reads WET. The device safety limit (pumpMaxRunS) still stops it if the water never gets there.',
      action: 'Start fill',
      danger: true,
      run: () => live.send({ cmd: 'fill' }),
    });
  };
  const doClear = () => {
    if (!isLive) return sim.clearFault();
    setConfirm({
      title: 'Clear the fault on the real device?',
      body: 'Only clear it after checking the floats and the water source. If the cause is still there, the fault comes straight back.',
      action: 'Clear fault',
      run: () => live.send({ cmd: 'clearFault' }),
    });
  };

  const v: DeviceView | null = isLive ? live.view : sim.view;
  const sc = SCENARIOS[sim.scenario];

  return (
    <div className={`app${idle ? ' idle' : ''}`}>
      <header className="top">
        <div className="brand">
          <Icon name="leaf" size="1.6em" />
          <div>
            <h1>Smart Rice Farm</h1>
            <p className="tagline">
              <b>Safe AWD:</b> let the field dry to −15 cm, refill to +5 cm. Saves water with no yield loss (IRRI).
            </p>
          </div>
        </div>
        <div className="top-right">
          {v && (
            <div className="clock" title={isLive ? 'Local time (Asia/Bangkok)' : 'Simulation clock (Asia/Bangkok)'}>
              <Icon name="clock" /> {fmtDateTime(v.now)}
              {!isLive && <span className="speed-tag">{sim.playing ? `${sim.speed}×` : 'paused'}</span>}
            </div>
          )}
          <div className="seg-switch" role="group" aria-label="Data source">
            <button className={!isLive ? 'on' : ''} onClick={() => switchSource('sim')} aria-pressed={!isLive}>
              Simulation
            </button>
            <button className={isLive ? 'on' : ''} onClick={() => switchSource('live')} aria-pressed={isLive}>
              Live
            </button>
          </div>
          <div className={`badge ${isLive ? 'live' : 'sim'}`} role="status">
            {isLive ? `LIVE · ${liveSettings.deviceId}` : 'SIMULATION'}
          </div>
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Light / dark theme" aria-label="Toggle theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="icon-btn" onClick={() => setPresent((p) => !p)} title="Presentation mode (P)" aria-label="Presentation mode">
            <Icon name="screen" />
          </button>
          <button className="icon-btn" onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Fullscreen">
            <Icon name="expand" />
          </button>
        </div>
      </header>

      {v ? (
        <>
          <StatusStrip v={v} />
          <main className="grid">
            <section className="panel hero" aria-label="Paddy cross-section">
              <h2>
                Paddy &amp; observation pipe <span className="h-note">{isLive ? 'floats give a zone, not a level' : 'pipe level = field water level'}</span>
              </h2>
              <CrossSection v={v} />
            </section>
            <section className="panel chart" aria-label="Water level chart">
              <h2>
                {isLive ? 'Water zone over time' : 'Water level over time'}
                {isLive && <span className="h-note">since this page opened</span>}
                <span className="legend">
                  {isLive ? <span className="lg lg-band" /> : <span className="lg lg-line" />} {isLive ? 'zone' : 'level'} <span className="lg lg-pump" /> pump on
                </span>
              </h2>
              <LevelChart history={v.history} live={isLive} theme={theme} />
            </section>
            <LogicPanel v={v} />
            <div className="side">
              <SensorCards v={v} />
              <AnalyticsPanel v={v} />
              <CropTimeline v={v} />
              <EventLog v={v} />
            </div>
          </main>
        </>
      ) : (
        <LiveWaiting conn={live.conn} error={live.error} settings={liveSettings} onSettings={() => setLiveOpen(true)} />
      )}

      <section className="caption" aria-live="polite">
        {isLive ? (
          <>
            <div className="cap-title">
              <span className={`conn-dot ${live.conn}`} /> Live from the scale model
            </div>
            <div className="cap-text">
              {connText(live.conn)} · {new URL(liveSettings.url).host} · device {liveSettings.deviceId}
            </div>
          </>
        ) : (
          <>
            <div className="cap-title">
              {tour && (
                <span className="tour-tag">
                  Tour {sim.scenario + 1}/{SCENARIOS.length}
                </span>
              )}
              {sim.scenario + 1}. {sc.title}
            </div>
            <div className="cap-text">{sc.caption}</div>
          </>
        )}
      </section>

      <footer className="controls" aria-label="Controls">
        <div className="group">
          <span className="g-label">Mode</span>
          {(['AWD', 'FLOOD', 'OFF'] as Mode[]).map((m) => (
            <button key={m} className={v?.mode === m ? 'btn active' : 'btn'} onClick={() => doMode(m)} aria-pressed={v?.mode === m} disabled={!v}>
              {m}
            </button>
          ))}
        </div>
        <div className="group">
          <span className="g-label">Pump</span>
          {v?.manual ? (
            <button className="btn" onClick={() => doPump(false)}>
              Stop manual run
            </button>
          ) : (
            <button className="btn" onClick={() => doPump(true)} disabled={!v || !!v.fault}>
              {isLive ? 'Run 30 s' : 'Run 2 min'}
            </button>
          )}
          {v?.pump && v.filling && !v.manual ? (
            <button className="btn" onClick={() => doPump(false)} title="Stop the fill now">
              Stop fill
            </button>
          ) : (
            <button
              className="btn"
              onClick={doFill}
              disabled={!v || !!v.fault || v.mode === 'OFF' || v.floatHigh !== 'DRY'}
              title={v?.mode === 'OFF' ? 'Choose AWD or FLOOD first' : v?.floatHigh === 'WET' ? 'Already at +5 cm' : 'Pump until FLOAT_HIGH reads WET (+5 cm)'}
            >
              <Icon name="pump" /> Fill to +5 cm
            </button>
          )}
          <button className="btn danger" onClick={doClear} disabled={!v?.fault}>
            Clear fault
          </button>
        </div>
        {isLive ? (
          <div className="group">
            <span className="g-label">Connection</span>
            <button className="btn" onClick={() => setLiveOpen(true)}>
              <Icon name="gear" /> Broker settings
            </button>
          </div>
        ) : (
          <>
            <div className="group">
              <span className="g-label">Scenario</span>
              <select
                value={sim.scenario}
                onChange={(e) => {
                  setTour(false);
                  sim.selectScenario(Number(e.target.value));
                }}
                aria-label="Scenario"
              >
                {SCENARIOS.map((s, i) => (
                  <option key={s.id} value={i}>
                    {i + 1}. {s.title}
                  </option>
                ))}
              </select>
              <button className={tour ? 'btn active' : 'btn'} onClick={() => (tour ? setTour(false) : startTour())} title="Guided tour (T)">
                <Icon name="tour" /> {tour ? 'Stop tour' : 'Guided tour'}
              </button>
            </div>
            <div className="group">
              <span className="g-label">Speed</span>
              <button className="btn icon" onClick={() => sim.setPlaying(!sim.playing)} title="Play / pause (Space)" aria-label={sim.playing ? 'Pause' : 'Play'}>
                <Icon name={sim.playing ? 'pause' : 'play'} />
              </button>
              {SPEEDS.map((s, i) => (
                <button key={s} className={sim.speed === s ? 'btn active' : 'btn'} onClick={() => sim.setSpeed(s)} title={`Key ${i + 1}`} aria-pressed={sim.speed === s}>
                  {s}×
                </button>
              ))}
              <button className="btn icon" onClick={sim.reset} title="Restart scenario" aria-label="Restart scenario">
                <Icon name="reset" />
              </button>
              <button className="btn icon" onClick={() => setSettingsOpen(true)} title="Simulation settings" aria-label="Simulation settings">
                <Icon name="gear" />
              </button>
            </div>
          </>
        )}
      </footer>

      {toast && (
        <div className={`toast ${toast.ok ? 'ok' : 'bad'}`} role="status">
          <Icon name={toast.ok ? 'check' : 'alert'} /> {toast.text}
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          value={sim.settings}
          onClose={() => setSettingsOpen(false)}
          onApply={(s) => {
            sim.setSettings(s);
            setSettingsOpen(false);
          }}
        />
      )}
      {liveOpen && (
        <LiveDialog
          value={liveSettings}
          onClose={() => setLiveOpen(false)}
          onApply={(s) => {
            setLiveSettings(s);
            setLiveOpen(false);
            setSource('live');
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          c={confirm}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (isLive && live.conn !== 'connected') setToast({ ok: false, text: 'Not connected to the broker: command not sent' });
            else confirm.run();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function connText(c: string): string {
  return { idle: 'Not connected', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', error: 'Connection error' }[c] ?? c;
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

function LiveWaiting({ conn, error, settings, onSettings }: { conn: string; error: string | null; settings: LiveSettings; onSettings: () => void }) {
  return (
    <main className="waiting">
      <div className="panel waiting-card">
        <h2>
          <span className={`conn-dot ${conn}`} /> {settings.root ? 'Waiting for the device…' : 'Live mode needs the broker settings'}
        </h2>
        {settings.root ? (
          <p>
            {connText(conn)} to <b>{settings.url}</b>, listening on <code>{settings.root}/{settings.deviceId}/#</code>. The device publishes its state at least every 10 s;
            if nothing arrives, check that it is powered and its OLED network page says <b>MQTT connected</b>.
          </p>
        ) : (
          <p>Enter the topic root shown on the device's OLED network page (Root …).</p>
        )}
        {error && <p className="err">{error}</p>}
        <button className="btn active" onClick={onSettings}>
          <Icon name="gear" /> Broker settings
        </button>
      </div>
    </main>
  );
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

function ConfirmDialog({ c, onClose, onConfirm }: { c: Confirm; onClose: () => void; onConfirm: () => void }) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="settings confirm" onClose={onClose}>
      <h2>
        <Icon name="alert" /> {c.title}
      </h2>
      <p>{c.body}</p>
      <div className="dialog-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button className={c.danger ? 'btn danger-fill' : 'btn active'} onClick={onConfirm}>
          {c.action}
        </button>
      </div>
    </dialog>
  );
}

function LiveDialog({ value, onApply, onClose }: { value: LiveSettings; onApply: (s: LiveSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<LiveSettings>({ ...value });
  const ref = useModal();
  const insecureOnHttps = location.protocol === 'https:' && s.url.startsWith('ws://');
  const text = (label: string, key: keyof LiveSettings, type = 'text', placeholder = '') => (
    <label className="field">
      <span>{label}</span>
      <input
        className="wide"
        type={type}
        value={s[key] as string}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'current-password' : 'off'}
        onChange={(e) => setS({ ...s, [key]: e.target.value.trim() })}
      />
    </label>
  );
  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <h2>Live connection</h2>
      <p className="muted">MQTT over WebSockets. A page served over https can only use wss:// brokers.</p>
      {text('Broker URL', 'url', 'text', 'wss://broker.hivemq.com:8884/mqtt')}
      {text('Topic root (OLED network page)', 'root', 'text', 'srf-xxxxxxxx')}
      {text('Device ID', 'deviceId', 'text', 'srf-cc2468')}
      {text('Username (private broker only)', 'username')}
      {text('Password', 'password', 'password')}
      <label className="field check">
        <span>Remember the password on this computer</span>
        <input type="checkbox" checked={s.remember} onChange={(e) => setS({ ...s, remember: e.target.checked })} />
      </label>
      {insecureOnHttps && <p className="err">This page is on https, so the browser will block a ws:// broker. Use wss://.</p>}
      <div className="dialog-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn active" disabled={!s.url || !/^[a-z0-9_-]{3,23}$/.test(s.root) || !s.deviceId} onClick={() => onApply(s)}>
          Connect
        </button>
      </div>
    </dialog>
  );
}

function SettingsDialog({ value, onApply, onClose }: { value: SimSettings; onApply: (s: SimSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<SimSettings>(structuredClone(value));
  const ref = useModal();
  const num = (label: string, unit: string, get: number, set: (n: number) => void, step = 0.5) => (
    <label className="field">
      <span>{label}</span>
      <span className="field-in">
        <input type="number" step={step} min={0} value={get} onChange={(e) => set(Math.max(0, Number(e.target.value)))} />
        <span className="muted">{unit}</span>
      </span>
    </label>
  );
  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <h2>Simulation assumptions</h2>
      <p className="muted">These drive the water model only. The controller logic is the same as on the device.</p>
      {num('Water drop above the soil', 'cm/day', s.dropAboveCmPerDay, (n) => setS({ ...s, dropAboveCmPerDay: n }))}
      {num('Water drop below the soil', 'cm/day', s.dropBelowCmPerDay, (n) => setS({ ...s, dropBelowCmPerDay: n }))}
      {num('Pump fill rate', 'cm/min', s.fillCmPerMin, (n) => setS({ ...s, fillCmPerMin: n }))}
      {num('Pump flow (for water used)', 'L/min', s.pumpFlowLpm, (n) => setS({ ...s, pumpFlowLpm: n }))}
      {num('Pump safety limit', 's', s.awd.pumpMaxRunS, (n) => setS({ ...s, awd: { ...s.awd, pumpMaxRunS: Math.round(n) } }), 10)}
      {num('Float debounce', 's', s.awd.debounceS, (n) => setS({ ...s, awd: { ...s.awd, debounceS: Math.round(n) } }), 1)}
      <div className="dialog-actions">
        <button className="btn" onClick={() => setS(structuredClone(DEFAULT_SIM_SETTINGS))}>
          Defaults
        </button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn active" onClick={() => onApply(s)}>
          Apply &amp; restart
        </button>
      </div>
    </dialog>
  );
}
