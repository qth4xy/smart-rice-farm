import { useCallback, useEffect, useRef, useState } from 'react';

import type { DeviceView } from '../data/view';
import type { Mode } from '../logic/types';
import { SCENARIOS } from './scenarios';
import { DEFAULT_SIM_SETTINGS, type SimSettings, type Simulation } from './simulation';

export const SPEEDS = [1, 60, 600, 3600] as const;
const VIEW_EVERY_MS = 66; // ~15 UI updates per second is plenty for a projector

export function useSimulation() {
  const [scenario, setScenario] = useState(0);
  const [speed, setSpeed] = useState<number>(SCENARIOS[0].speed);
  const [playing, setPlaying] = useState(true);
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SIM_SETTINGS);
  const [generation, setGeneration] = useState(0); // bump to rebuild the current scenario
  const simRef = useRef<Simulation | null>(null);
  const startRef = useRef(0);
  const [view, setView] = useState<DeviceView | null>(null);

  // Build the scenario.
  useEffect(() => {
    const sim = SCENARIOS[scenario].build(settings);
    simRef.current = sim;
    startRef.current = sim.t;
    setView(sim.view());
  }, [scenario, settings, generation]);

  // Real-time loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastView = 0;
    const frame = (now: number) => {
      const sim = simRef.current;
      const dt = Math.min(100, now - last); // a hidden tab must not jump hours at once
      last = now;
      if (sim) {
        sim.advance(dt * speed, 1000);
        SCENARIOS[scenario].script?.(sim, startRef.current);
        if (now - lastView >= VIEW_EVERY_MS) {
          lastView = now;
          setView(sim.view());
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, scenario]);

  const refresh = () => simRef.current && setView(simRef.current.view());

  const selectScenario = useCallback((i: number) => {
    const n = (i + SCENARIOS.length) % SCENARIOS.length;
    setScenario(n);
    setSpeed(SCENARIOS[n].speed);
    setGeneration((g) => g + 1);
    setPlaying(true);
  }, []);

  return {
    view,
    scenario,
    selectScenario,
    speed,
    setSpeed,
    playing,
    setPlaying,
    settings,
    setSettings,
    reset: () => setGeneration((g) => g + 1),
    setMode: (m: Mode) => {
      simRef.current?.setMode(m, 'operator');
      refresh();
    },
    pump: (on: boolean, seconds: number) => {
      simRef.current?.manualPump(on, seconds);
      refresh();
    },
    clearFault: () => {
      simRef.current?.clearFault();
      refresh();
    },
  };
}
