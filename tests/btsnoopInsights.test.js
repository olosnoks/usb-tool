import { describe, it, expect } from 'vitest';
import { parseCapture, analyzeCapture, buildBtsnoopFile, makeExampleCapture } from '../src/utils/btsnoop.js';
import { pairCommands, findIssues, connectionTraffic, filterDirection, packetsToBtsnoop, deltaMs } from '../src/utils/btsnoopInsights.js';

const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const cmd = (op, params = []) => [0x01, ...le16(op), params.length, ...params];
const evt = (code, params) => [0x04, code, params.length, ...params];
const cc = (op, status) => evt(0x0e, [1, ...le16(op), status]);
const cs = (op, status) => evt(0x0f, [status, 1, ...le16(op)]);
const BASE = 1704067200000000n;

function analyse(list) {
  const file = buildBtsnoopFile(list.map((p, i) => ({ direction: p.dir, h4: p.h4, unixUs: BASE + BigInt(p.t ?? i * 1000) })));
  return analyzeCapture(parseCapture(file));
}

describe('btsnoop insights', () => {
  const an = analyse([
    { dir: 'sent', h4: cmd(0x0c03), t: 0 },
    { dir: 'received', h4: cc(0x0c03, 0), t: 2000 },
    { dir: 'sent', h4: cmd(0x200d), t: 3000 },
    { dir: 'received', h4: cs(0x200d, 0x0c), t: 4000 },
    { dir: 'sent', h4: cmd(0x1009), t: 5000 },
    { dir: 'sent', h4: cmd(0x2006), t: 6000 },
    { dir: 'received', h4: cc(0x2006, 0), t: 900000 },
  ]);

  it('pairs commands with their responses and measures latency', () => {
    const pairs = pairCommands(an.packets);
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toMatchObject({ no: 1, responseNo: 2, kind: 'complete', status: 0, latencyMs: 2 });
    expect(pairs[1]).toMatchObject({ kind: 'status', status: 0x0c });
    expect(pairs[2].responseNo).toBeNull();
    expect(pairs[3].latencyMs).toBeCloseTo(894);
  });

  it('flags failures, missing responses and slow commands', () => {
    const issues = findIssues(an);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('failed'))).toBe(true);
    expect(issues.some((i) => i.category === 'Command' && i.message.includes('no Command Complete'))).toBe(true);
    expect(issues.some((i) => i.category === 'Slow command')).toBe(true);
    const nos = issues.map((i) => i.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
  });

  it('flags abnormal disconnects but not normal ones', () => {
    const leConn = (handle) => evt(0x3e, [0x01, 0, ...le16(handle), 0, 0, 1, 2, 3, 4, 5, 6, 24, 0, 0, 0, 72, 0, 0]);
    const disc = (handle, reason) => evt(0x05, [0, ...le16(handle), reason]);
    const a = analyse([
      { dir: 'received', h4: leConn(0x40) },
      { dir: 'received', h4: disc(0x40, 0x08) },
      { dir: 'received', h4: leConn(0x41) },
      { dir: 'received', h4: disc(0x41, 0x13) },
    ]);
    const d = findIssues(a).filter((i) => i.category === 'Disconnect');
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain('Connection Timeout');
  });

  it('reports no hardware errors for clean traffic and detects them otherwise', () => {
    expect(findIssues(an).some((i) => i.category === 'Hardware')).toBe(false);
    const a = analyse([{ dir: 'received', h4: evt(0x10, [0x42]) }]);
    expect(findIssues(a).some((i) => i.category === 'Hardware')).toBe(true);
  });

  it('computes deltas and direction filters', () => {
    const d = deltaMs(an.packets);
    expect(d.get(1)).toBe(0);
    expect(d.get(2)).toBeCloseTo(2);
    expect(filterDirection(an.packets, 'sent')).toHaveLength(4);
    expect(filterDirection(an.packets, 'all')).toHaveLength(7);
  });

  it('round-trips a filtered selection to a btsnoop file', () => {
    const sent = filterDirection(an.packets, 'sent');
    const re = analyzeCapture(parseCapture(packetsToBtsnoop(sent)));
    expect(re.packets).toHaveLength(4);
    expect(re.packets.every((p) => p.direction === 'sent' && p.type === 'cmd')).toBe(true);
    expect(re.packets[1].relUs).toBe(3000);
  });

  it('counts ACL payload bytes per connection on the example capture', () => {
    const ex = analyzeCapture(parseCapture(makeExampleCapture()));
    const rows = connectionTraffic(ex);
    expect(rows.length).toBe(ex.connections.length);
    expect(rows.reduce((n, r) => n + r.txBytes + r.rxBytes, 0)).toBeGreaterThan(0);
    expect(findIssues(ex).every((i) => ['error', 'warn', 'info'].includes(i.severity))).toBe(true);
  });
});
