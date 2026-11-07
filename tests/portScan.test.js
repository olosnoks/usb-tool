import { describe, it, expect } from 'vitest';
import { parsePorts, buildPortSpec, guessService, isBrowserBlockedPort, PORT_PROFILES, TIMINGS } from '../src/utils/portScan.js';

describe('parsePorts', () => {
  it('parses lists and ranges, dedupes and bounds', () => {
    expect(parsePorts('80,443,443,8080')).toEqual([80, 443, 8080]);
    expect(parsePorts('20-22')).toEqual([20, 21, 22]);
    expect(parsePorts('22-20')).toEqual([20, 21, 22]); // reversed range ok
    expect(parsePorts('0,70000,443')).toEqual([443]);  // out of range dropped
    expect(parsePorts('')).toEqual([]);
  });
});

describe('buildPortSpec', () => {
  it('unions selected profiles with custom ports', () => {
    const spec = buildPortSpec(['top20'], '9000,9001');
    const ports = parsePorts(spec);
    expect(ports).toContain(80);
    expect(ports).toContain(3389);
    expect(ports).toContain(9000);
    expect(ports).toContain(9001);
  });
  it('handles custom only and profile only', () => {
    expect(parsePorts(buildPortSpec([], '1-3'))).toEqual([1, 2, 3]);
    expect(parsePorts(buildPortSpec(['web'], '')).includes(443)).toBe(true);
  });
  it('well-known profile expands to 1024 ports', () => {
    expect(parsePorts(buildPortSpec(['wellknown'], '')).length).toBe(1024);
  });
});

describe('profiles & services', () => {
  it('every profile spec parses to >0 ports', () => {
    for (const p of PORT_PROFILES) expect(parsePorts(p.spec).length).toBeGreaterThan(0);
  });
  it('maps common services', () => {
    expect(guessService(22)).toBe('ssh');
    expect(guessService(5432)).toBe('postgres');
    expect(guessService(12345)).toBe('');
  });
  it('flags browser-blocked ports', () => {
    expect(isBrowserBlockedPort(22)).toBe(true);
    expect(isBrowserBlockedPort(8080)).toBe(false);
  });
  it('timing templates are well-formed', () => {
    for (const t of Object.values(TIMINGS)) {
      expect(t.timeoutMs).toBeGreaterThan(0);
      expect(t.concurrency).toBeGreaterThan(0);
      expect(t.closedThresholdMs).toBeLessThanOrEqual(t.timeoutMs);
    }
  });
});
