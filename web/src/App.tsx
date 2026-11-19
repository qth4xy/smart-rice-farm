import { useEffect, useRef, useState } from 'react';

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

export function App() {
  const sim = useSimulation();
  const [theme, setTheme] = useState(() => loadPref('srf.theme', 'dark'));
  const [present, setPresent] = useState(false);
  const [tour, setTour] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const simRef = useRef(sim);
  simRef.current = sim;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePref('srf.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('present', present);
  }, [present]);

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

  // Keyboard: F fullscreen, P presentation, Space play/pause, arrows scenario, 1-4 speed, T tour.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea, dialog')) return;
      const s = simRef.current;
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'p' || e.key === 'P') setPresent((p) => !p);
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
      else return;
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const startTour = () => {
    setTour(true);
    simRef.current.selectScenario(0);
  };

  const v = sim.view;
  if (!v) return null;
  const sc = SCENARIOS[sim.scenario];

  return (
    <div className={`app${idle ? ' idle' : ''}`}>
      <header className="top">
        <div className="brand">
          <Icon name="leaf" size="1.6em" />
          <div>
            <h1>Smart Rice Farm</h1>
            <p className="tagline">
              <b>Safe AWD:</b> let the field dry to 15 cm below the soil, then refill to 5 cm above. Saves water with no yield loss (IRRI).
            </p>
          </div>
        </div>
        <div className="top-right">
          <div className="clock" title="Simulation clock (Asia/Bangkok)">
            <Icon name="clock" /> {fmtDateTime(v.now)}
            <span className="speed-tag">{sim.playing ? `${sim.speed}×` : 'paused'}</span>
          </div>
          <div className={`badge ${v.source}`} role="status">
            {v.source === 'sim' ? 'SIMULATION' : `LIVE · ${v.deviceId}`}
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

      <StatusStrip v={v} />

      <main className="grid">
        <section className="panel hero" aria-label="Paddy cross-section">
          <h2>
            Paddy &amp; observation pipe <span className="h-note">pipe level = field water level</span>
          </h2>
          <CrossSection v={v} />
        </section>
        <section className="panel chart" aria-label="Water level chart">
          <h2>
            Water level over time{' '}
            <span className="legend">
              <span className="lg lg-line" /> level <span className="lg lg-pump" /> pump on
            </span>
          </h2>
          <LevelChart history={v.history} live={v.source === 'live'} theme={theme} />
        </section>
        <LogicPanel v={v} />
        <div className="side">
          <SensorCards v={v} />
          <AnalyticsPanel v={v} />
          <CropTimeline v={v} />
          <EventLog v={v} />
        </div>
      </main>

      <section className="caption" aria-live="polite">
        <div className="cap-title">
          {tour && (
            <span className="tour-tag">
              Tour {sim.scenario + 1}/{SCENARIOS.length}
            </span>
          )}
          {sim.scenario + 1}. {sc.title}
        </div>
        <div className="cap-text">{sc.caption}</div>
      </section>

      <footer className="controls" aria-label="Controls">
        <div className="group">
          <span className="g-label">Mode</span>
          {(['AWD', 'FLOOD', 'OFF'] as Mode[]).map((m) => (
            <button key={m} className={v.mode === m ? 'btn active' : 'btn'} onClick={() => sim.setMode(m)} aria-pressed={v.mode === m}>
              {m}
            </button>
          ))}
        </div>
        <div className="group">
          <span className="g-label">Pump</span>
          {v.manual ? (
            <button className="btn" onClick={() => sim.pump(false, 0)}>
              Stop manual run
            </button>
          ) : (
            <button className="btn" onClick={() => sim.pump(true, 120)} disabled={!!v.fault}>
              Run 2 min
            </button>
          )}
          <button className="btn danger" onClick={sim.clearFault} disabled={!v.fault}>
            Clear fault
          </button>
        </div>
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
      </footer>

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
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

function SettingsDialog({ value, onApply, onClose }: { value: SimSettings; onApply: (s: SimSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<SimSettings>(structuredClone(value));
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
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
