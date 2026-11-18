import { describe, it, expect } from 'vitest';
import { compileFilter, tryCompileFilter, protocolStats, accessPoints, findHandshakes, hexDump } from '../src/utils/packetAnalysis';

const F = (o) => ({ id: 1, origin: 'pcap', protocol: '802.11 Beacon', type: 'Management', subtype: 'Beacon', source: 'AA:00:00:00:00:01', dest: 'FF:FF:FF:FF:FF:FF', bssid: 'AA:00:00:00:00:01', ssid: 'Cafe', channel: 6, rssi: -50, length: 100, timeMs: 1000, ...o });

describe('compileFilter', () => {
  it('matches empty, free text, fields and numeric comparisons', () => {
    expect(compileFilter('')(F())).toBe(true);
    expect(compileFilter('cafe')(F())).toBe(true);
    expect(compileFilter('ssid==cafe')(F())).toBe(true);
    expect(compileFilter('ssid~af')(F())).toBe(true);
    expect(compileFilter('rssi>-60')(F())).toBe(true);
    expect(compileFilter('rssi<-60')(F())).toBe(false);
    expect(compileFilter('ch==6 && type==Data')(F())).toBe(false);
  });
  it('supports || and negation', () => {
    expect(compileFilter('type==Data || ch==6')(F())).toBe(true);
    expect(compileFilter('!type==Data')(F())).toBe(true);
    expect(compileFilter('ssid!=cafe')(F())).toBe(false);
  });
  it('reports bad input', () => {
    expect(() => compileFilter('foo==1')).toThrow(/Unknown field/);
    expect(() => compileFilter('rssi==abc')).toThrow(/number/);
    expect(() => compileFilter('ssid<3')).toThrow(/numeric/);
    expect(tryCompileFilter('rssi==abc').error).toMatch(/number/);
    expect(tryCompileFilter('ch==6').error).toBeNull();
  });
});

describe('statistics', () => {
  const frames = [F({ id: 1 }), F({ id: 2, timeMs: 3000 }), F({ id: 3, protocol: 'EAPOL 4-Way #1', type: 'Data', subtype: 'EAPOL Key' })];
  it('counts protocols and span', () => {
    const s = protocolStats(frames);
    expect(s.total).toBe(3);
    expect(s.durationMs).toBe(2000);
    expect(s.rows[0]).toMatchObject({ protocol: '802.11 Beacon', count: 2 });
  });
  it('lists access points from beacons', () => {
    const aps = accessPoints(frames);
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ ssid: 'Cafe', beacons: 2, channel: 6, bestRssi: -50 });
  });
});

describe('findHandshakes', () => {
  const ap = 'AA:00:00:00:00:01';
  const sta = 'BB:00:00:00:00:02';
  const eap = (id, n, from, to) => F({ id, protocol: `EAPOL 4-Way #${n}`, type: 'Data', subtype: 'EAPOL Key', source: from, dest: to, bssid: ap });
  it('tracks messages per AP/station pair', () => {
    const hs = findHandshakes([F(), eap(2, 1, ap, sta), eap(3, 2, sta, ap)]);
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({ bssid: ap, station: sta, ssid: 'Cafe', messages: [1, 2], complete: false, pairable: true });
  });
  it('flags a complete handshake', () => {
    const hs = findHandshakes([eap(1, 1, ap, sta), eap(2, 2, sta, ap), eap(3, 3, ap, sta), eap(4, 4, sta, ap)]);
    expect(hs[0].complete).toBe(true);
  });
  it('treats a lone M1 as not pairable', () => {
    expect(findHandshakes([eap(1, 1, ap, sta)])[0].pairable).toBe(false);
  });
});

describe('hexDump', () => {
  it('formats offset, hex and ascii', () => {
    expect(hexDump('48 69 00 ff')).toBe(`00000000  48 69 00 ff${' '.repeat(47 - 11)}  |Hi..|`);
  });
  it('wraps at 16 bytes', () => {
    expect(hexDump(new Uint8Array(17)).split('\n')).toHaveLength(2);
  });
});
