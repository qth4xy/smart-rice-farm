import { describe, expect, it } from 'vitest';

import { LiveModel } from './liveModel';

const STATE = {
  ts: 1795103730,
  mode: 'AWD',
  pump: true,
  pumpRunS: 42,
  manual: false,
  filling: true,
  floatLow: 'WET',
  floatHigh: 'DRY',
  zone: 'BETWEEN',
  fault: null,
  warnings: [],
  soilPct: 63,
  soilRaw: 2100,
  airTempC: 31.2,
  airRh: 71,
  nextIrrigationEta: null,
  avgDryingS: 640000,
  avgFillS: 180,
  cycles: 12,
  stage: 'VEGETATIVE',
  muted: false,
  rssi: -58,
  dhtFails: 0,
  uptimeS: 3600,
  fw: '0.4.1',
};

describe('LiveModel', () => {
  it('has no view until a state arrives', () => {
    const m = new LiveModel('srf-cc2468');
    expect(m.view(0)).toBeNull();
  });

  it('maps a state message without inventing a water level', () => {
    const m = new LiveModel('srf-cc2468');
    m.brokerConnected = true;
    m.onMessage('status', 'online', 0);
    m.onMessage('state', JSON.stringify(STATE), 0);
    const v = m.view(5)!;
    expect(v.source).toBe('live');
    expect(v.zone).toBe('BETWEEN');
    expect(v.pump).toBe(true);
    expect(v.levelCm).toBeNull();
    expect(v.history).toEqual([{ t: 1795103730000, level: null, zone: 'BETWEEN', pump: true }]);
    expect(v.link).toEqual({ wifi: true, mqtt: true });
    expect(v.waterPumpedL).toBeNull();
  });

  it('builds crop dates from config and logs events', () => {
    const m = new LiveModel('srf-cc2468');
    m.onMessage('config', JSON.stringify({ transplantDate: '2026-12-01', floweringDate: '2027-02-15' }), 0);
    m.onMessage('state', JSON.stringify(STATE), 0);
    m.onMessage('event', JSON.stringify({ event: 'pump_off', runS: 120, ts: 1795103800 }), 0);
    m.onMessage('event', JSON.stringify({ event: 'ack', cmd: 'pump', ok: false, error: 'rejected: a fault is active' }), 0);
    const v = m.view(0)!;
    expect(new Date(v.crop!.transplant).toISOString()).toBe('2026-11-30T17:00:00.000Z'); // Bangkok midnight
    expect(v.totalPumpS).toBe(120);
    expect(v.log.map((l) => l.kind)).toEqual(['pump', 'fault']);
    expect(v.log[1].text).toContain('refused');
  });

  it('shows the device offline from the last will, and ignores junk and cleared topics', () => {
    const m = new LiveModel('srf-cc2468');
    m.brokerConnected = true;
    m.onMessage('state', JSON.stringify(STATE), 0);
    m.onMessage('status', 'online', 0);
    m.onMessage('status', 'offline', 1);
    m.onMessage('state', 'not json', 2);
    m.onMessage('state', '', 3);
    const v = m.view(4)!;
    expect(v.link.wifi).toBe(false);
    expect(v.log.at(-1)!.kind).toBe('net');
    expect(v.history.length).toBe(1);
  });
});
