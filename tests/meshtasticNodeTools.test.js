import { describe, it, expect } from 'vitest';
import {
  haversineKm, bearingDeg, compassPoint, formatDistance, signalQuality, annotateNodes, filterNodes,
  sortNodes, nodesToCsv, filterMessages, messagesToCsv, cliCommands,
} from '../src/utils/meshtastic/nodeTools.js';

const rows = [
  { num: 1, id: '!00000001', longName: 'Home', shortName: 'HOME', hwName: 'TBEAM', role: 'CLIENT', isMe: true, position: { lat: 0, lon: 0 }, snr: null, lastHeard: 100, hopsAway: null, battery: 90 },
  { num: 2, id: '!00000002', longName: 'East, "far"', shortName: 'EAST', hwName: 'HELTEC_V3', role: 'ROUTER', isMe: false, position: { lat: 0, lon: 1 }, snr: -12, lastHeard: 200, hopsAway: 0, battery: null },
  { num: 3, id: '!00000003', longName: '', shortName: '', hwName: '', role: '', isMe: false, position: null, snr: 5, lastHeard: 50, hopsAway: 2, battery: 50 },
];

describe('geo helpers', () => {
  it('computes distance and bearing', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 5);
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(90)).toBe('E');
  });
  it('formats distance', () => {
    expect(formatDistance(0.25)).toBe('250 m');
    expect(formatDistance(12.34)).toBe('12.3 km');
    expect(formatDistance(null)).toBe('—');
  });
  it('rates signal', () => {
    expect(signalQuality(null)).toBeNull();
    expect(signalQuality(3)).toBe('good');
    expect(signalQuality(-5)).toBe('fair');
    expect(signalQuality(-15)).toBe('weak');
  });
});

describe('node table helpers', () => {
  it('annotates distance from my node only for peers with a position', () => {
    const a = annotateNodes(rows);
    expect(a[0].distanceKm).toBeNull();
    expect(a[1].distanceKm).toBeCloseTo(111.19, 1);
    expect(a[1].compass).toBe('E');
    expect(a[2].distanceKm).toBeNull();
    expect(a[1].signal).toBe('weak');
  });
  it('filters', () => {
    expect(filterNodes(rows, { query: 'router' }).map((r) => r.num)).toEqual([2]);
    expect(filterNodes(rows, { onlyPositioned: true }).length).toBe(2);
    expect(filterNodes(rows, { onlyDirect: true }).map((r) => r.num)).toEqual([2]);
    expect(filterNodes(rows, { hideMe: true }).length).toBe(2);
  });
  it('sorts with missing values last', () => {
    const a = annotateNodes(rows);
    expect(sortNodes(a, 'distance', 'asc').map((r) => r.num)).toEqual([2, 1, 3]);
    expect(sortNodes(a, 'distance', 'desc').map((r) => r.num)).toEqual([2, 1, 3]);
    expect(sortNodes(a, 'lastHeard', 'desc').map((r) => r.num)).toEqual([2, 1, 3]);
    expect(sortNodes(a, 'snr', 'asc').map((r) => r.num)).toEqual([2, 3, 1]);
  });
  it('writes CSV with quoting', () => {
    const csv = nodesToCsv(annotateNodes(rows));
    const lines = csv.split('\n');
    expect(lines[0].startsWith('id,long_name')).toBe(true);
    expect(lines[2]).toContain('"East, ""far"""');
    expect(lines[2]).toContain('111.');
  });
});

describe('messages and CLI text', () => {
  const msgs = [
    { id: 1, from: 2, direct: false, channel: 0, direction: 'in', status: 'received', snr: 1, text: 'hi, all', time: 0 },
    { id: 2, from: 2, direct: true, channel: 0, direction: 'in', status: 'received', snr: null, text: 'dm', time: 1000 },
    { id: 3, from: 1, direct: false, channel: 1, direction: 'out', status: 'sent', snr: null, text: 'x', time: 2000 },
  ];
  it('filters by scope', () => {
    expect(filterMessages(msgs, 'direct').length).toBe(1);
    expect(filterMessages(msgs, 'channel:0').map((m) => m.id)).toEqual([1]);
    expect(filterMessages(msgs, 'channel:1').map((m) => m.id)).toEqual([3]);
    expect(filterMessages(msgs, 'all').length).toBe(3);
  });
  it('exports CSV', () => {
    const csv = messagesToCsv(msgs, (n) => `n${n}`);
    expect(csv.split('\n')[1]).toBe('1970-01-01T00:00:00.000Z,in,n2,no,0,received,1,"hi, all"');
  });
  it('builds CLI commands and strips odd characters', () => {
    expect(cliCommands("!ba4bf9d0'; rm").traceroute).toBe("meshtastic --traceroute '!ba4bf9d0'");
    expect(cliCommands('!ba4bf9d0').sendDirect).toContain("--dest '!ba4bf9d0'");
  });
});
