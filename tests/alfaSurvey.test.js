import { describe, it, expect } from 'vitest';
import {
  mergeFix,
  buildSurveyExport,
  parseSurveyExport,
  mergeSurveyInto,
  countWithoutFix,
  createPacketRing,
  isValidFix,
  SURVEY_MAX_APS
} from '../src/utils/alfaSurvey';

const fixA = { latitude: 10, longitude: 20, accuracy: 5, altitude: 1 };
const fixB = { latitude: 11, longitude: 21, accuracy: 4, altitude: 2 };

describe('mergeFix', () => {
  it('takes the first valid fix when nothing is stored', () => {
    const r = mergeFix(null, { rssi: -70, fix: fixA });
    expect(r).toMatchObject({ latitude: 10, longitude: 20, bestRssi: -70 });
  });
  it('moves the pin only for a stronger signal (>= 3 dB)', () => {
    const first = mergeFix(null, { rssi: -70, fix: fixA });
    expect(mergeFix(first, { rssi: -69, fix: fixB }).latitude).toBe(10);
    expect(mergeFix(first, { rssi: -50, fix: fixB })).toMatchObject({ latitude: 11, bestRssi: -50, accuracy: 4 });
    expect(mergeFix(first, { rssi: -67, fix: fixB }).latitude).toBe(11);
  });
  it('moving away and back keeps the strongest position', () => {
    let s = mergeFix(null, { rssi: -40, fix: fixA });
    s = mergeFix(s, { rssi: -80, fix: fixB });
    s = mergeFix(s, { rssi: -45, fix: fixB });
    expect(s.latitude).toBe(10);
  });
  it('ignores invalid fixes', () => {
    const first = mergeFix(null, { rssi: -70, fix: fixA });
    expect(mergeFix(first, { rssi: -30, fix: { latitude: null, longitude: null } })).toEqual(first);
    expect(mergeFix(first, { rssi: -30, fix: { latitude: 0, longitude: 0 } })).toEqual(first);
    expect(mergeFix(null, { rssi: -30, fix: { latitude: 99, longitude: 0 } }).latitude).toBeNull();
    expect(isValidFix({ latitude: 1, longitude: 1, accuracy: -1 })).toBe(false);
  });
});

describe('survey export/import', () => {
  const devices = {
    'AA:BB:CC:00:11:22': { bssid: 'AA:BB:CC:00:11:22', ssid: 'Home', rssi: -50, channel: 6, latitude: 10, longitude: 20, bestRssi: -50 },
    'AA:BB:CC:00:11:33': { bssid: 'AA:BB:CC:00:11:33', ssid: 'NoFix', rssi: -80, channel: 11 }
  };
  const clients = { '11:22:33:44:55:66': { clientMac: '11:22:33:44:55:66', rssi: -60 } };

  it('round trips', () => {
    const exp = buildSurveyExport(devices, clients, { monitorChannel: 6 });
    expect(exp.schemaVersion).toBe(1);
    const res = parseSurveyExport(JSON.stringify(exp));
    expect(res.ok).toBe(true);
    expect(res.devices).toEqual(devices);
    expect(res.clients).toEqual(clients);
  });
  it('counts APs without a fix', () => {
    expect(countWithoutFix(devices)).toBe(1);
  });
  it('rejects malformed input', () => {
    expect(parseSurveyExport('{nope').ok).toBe(false);
    expect(parseSurveyExport('[]').ok).toBe(false);
    expect(parseSurveyExport({ schemaVersion: 99, accessPoints: {} }).ok).toBe(false);
    expect(parseSurveyExport({ schemaVersion: 1 }).ok).toBe(false);
    expect(parseSurveyExport({ schemaVersion: 1, accessPoints: { 'not-a-mac': {} } }).ok).toBe(false);
    expect(parseSurveyExport({ schemaVersion: 1, accessPoints: { 'AA:BB:CC:00:11:22': { rssi: 500 } } }).ok).toBe(false);
    expect(parseSurveyExport({ schemaVersion: 1, accessPoints: { 'AA:BB:CC:00:11:22': { latitude: 200 } } }).ok).toBe(false);
  });
  it('caps size', () => {
    const aps = {};
    for (let i = 0; i <= SURVEY_MAX_APS; i += 1) {
      const hi = ((i >> 8) & 255).toString(16).padStart(2, '0');
      const lo = (i & 255).toString(16).padStart(2, '0');
      aps[`AA:BB:CC:${hi}:${lo}:00`.toUpperCase()] = {};
    }
    expect(parseSurveyExport({ schemaVersion: 1, accessPoints: aps }).ok).toBe(false);
  });
  it('accepts pre-versioned exports and strips prototype keys', () => {
    const res = parseSurveyExport('{"accessPoints":{"AA:BB:CC:00:11:22":{"ssid":"x","__proto__":{"evil":1}}}}');
    expect(res.ok).toBe(true);
    expect({}.evil).toBeUndefined();
    expect(res.devices['AA:BB:CC:00:11:22'].evil).toBeUndefined();
  });
  it('merge keeps live data and improves position', () => {
    const live = { 'AA:BB:CC:00:11:22': { bssid: 'AA:BB:CC:00:11:22', latitude: 1, longitude: 1, bestRssi: -80, packetCount: 9 } };
    const { merged, added, updated } = mergeSurveyInto(live, {
      'AA:BB:CC:00:11:22': { latitude: 10, longitude: 20, bestRssi: -50 },
      'AA:BB:CC:00:11:99': { bssid: 'AA:BB:CC:00:11:99' }
    });
    expect(added).toBe(1);
    expect(updated).toBe(1);
    expect(merged['AA:BB:CC:00:11:22']).toMatchObject({ latitude: 10, packetCount: 9, bestRssi: -50 });
  });
});

describe('createPacketRing', () => {
  it('overwrites oldest in order', () => {
    const r = createPacketRing(3);
    expect(r.push(1)).toBe(false);
    r.push(2);
    r.push(3);
    expect(r.push(4)).toBe(true);
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([2, 3, 4]);
    r.clear();
    expect(r.length).toBe(0);
    expect(r.toArray()).toEqual([]);
  });
});
