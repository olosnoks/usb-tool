import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import StreamConsole from '../src/components/StreamConsole';
import {
  computeDeltas, formatDelta, assembleLines, buildMatcher, textMatches, splitByMatches,
  matchHighlightRule, createDiskLogger, sendPaced
} from '../src/utils/consoleTools';

const enc = new TextEncoder();
const dec = new TextDecoder();

function fakeWritable() {
  const writes = [];
  return { writes, closed: false, async write(d) { writes.push(d); }, async close() { this.closed = true; } };
}
const joinBytes = (writes) => {
  const parts = writes.map((w) => (typeof w === 'string' ? enc.encode(w) : w));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe('computeDeltas (B5)', () => {
  it('uses real arrival differences from the injected clock', () => {
    const rows = computeDeltas([
      { id: 'a', rawTime: 1000 }, { id: 'b', rawTime: 1012.5 }, { id: 'c', rawTime: 1012.5 }, { id: 'd', rawTime: 1100 },
    ]);
    expect(rows.map((r) => r.deltaMs)).toEqual([null, 12.5, 0, 87.5]);
  });
  it('shows unknown, never an invented value, when rawTime is missing', () => {
    const rows = computeDeltas([{ id: 'a' }, { id: 'b' }, { id: 'c', rawTime: 5 }]);
    expect(rows.every((r) => r.deltaMs === null)).toBe(true);
    expect(formatDelta(null)).toBe('\u2014');
    expect(formatDelta(3)).toBe('+3 ms');
  });
  it('renders real deltas in the timeline table', () => {
    const entries = [
      { id: 'a', type: 'rx', text: 'one', timestamp: '10:00:00.000', rawTime: 100 },
      { id: 'b', type: 'rx', text: 'two', timestamp: '10:00:00.250', rawTime: 350.25 },
    ];
    const html = renderToString(<StreamConsole entries={entries} isConnected={false} initialViewMode="delta" onSend={() => {}} />);
    expect(html).toContain('+250.25 ms');
  });
});

describe('line view', () => {
  const e = (id, text, rawTime, type = 'rx') => ({ id, type, text, rawTime, timestamp: `t${rawTime}`, wallTime: rawTime });
  it('assembles chunks into lines, timestamp = first byte', () => {
    const lines = assembleLines([e('1', 'hel', 10), e('2', 'lo\nwor', 20), e('3', 'ld\r\nx', 30)]);
    expect(lines.map((l) => l.text)).toEqual(['hello', 'world', 'x']);
    expect(lines.map((l) => l.rawTime)).toEqual([10, 20, 30]);
    expect(lines[2].partial).toBe(true);
    expect(lines[0].partial).toBe(false);
  });
  it('treats CRLF split across chunks as one terminator', () => {
    const lines = assembleLines([e('1', 'a\r', 1), e('2', '\nb\n', 2)]);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b']);
  });
  it('honours the RX line-ending map', () => {
    const lines = assembleLines([e('1', 'a\rb\nc\n', 1)], 'lf');
    expect(lines.map((l) => l.text)).toEqual(['a\rb', 'c']);
  });
  it('flushes a partial RX line before TX/SYS rows', () => {
    const lines = assembleLines([e('1', 'prompt> ', 1), e('2', 'ls\r\n', 2, 'tx')]);
    expect(lines.map((l) => [l.type, l.text])).toEqual([['rx', 'prompt> '], ['tx', 'ls']]);
  });
  it('renders in the component', () => {
    const entries = [{ id: 'a', type: 'rx', text: 'par', timestamp: 't', rawTime: 1 }, { id: 'b', type: 'rx', text: 'tial\n', timestamp: 't', rawTime: 2 }];
    const html = renderToString(<StreamConsole entries={entries} isConnected={false} initialViewMode="lines" onSend={() => {}} />);
    expect(html).toContain('partial');
  });
});

describe('search', () => {
  it('plain search escapes regex characters', () => {
    const { re } = buildMatcher('a.b(', { regex: false });
    expect(textMatches(re, 'xa.b(y')).toBe(true);
    expect(textMatches(re, 'aXb(')).toBe(false);
  });
  it('regex search, case-insensitive, with invalid pattern reported', () => {
    const { re } = buildMatcher('err(or)?\\d+', { regex: true });
    expect(textMatches(re, 'ERROR42')).toBe(true);
    expect(buildMatcher('(', { regex: true }).error).toBeTruthy();
    expect(buildMatcher('(', { regex: true }).re).toBeNull();
  });
  it('splits into highlight segments and applies highlight rules', () => {
    const { re } = buildMatcher('o+', { regex: true });
    expect(splitByMatches('foo bar', re)).toEqual([
      { text: 'f', match: false }, { text: 'oo', match: true }, { text: ' bar', match: false }]);
    expect(matchHighlightRule([{ pattern: 'panic|oops', color: 'x' }], 'Kernel PANIC')?.color).toBe('x');
    expect(matchHighlightRule([{ pattern: '(', color: 'x' }], 'a')).toBeNull();
  });
});

describe('disk logger (B6, B7)', () => {
  it('writes 200 chunks emitted in one tick, in order, once each', async () => {
    const w = fakeWritable();
    const logger = createDiskLogger(w, { mode: 'raw' });
    const expected = [];
    for (let i = 0; i < 200; i++) {
      const chunk = Uint8Array.of(i & 0xff, (i * 3) & 0xff);
      expected.push(...chunk);
      logger.write(chunk);
    }
    await logger.close();
    expect(w.writes).toHaveLength(200);
    expect(Array.from(joinBytes(w.writes))).toEqual(expected);
    expect(logger.bytesWritten).toBe(400);
    expect(w.closed).toBe(true);
  });
  it('does not alias the caller buffer and ignores writes after close', async () => {
    const w = fakeWritable();
    const logger = createDiskLogger(w);
    const buf = Uint8Array.of(1, 2, 3);
    logger.write(buf);
    buf[0] = 99;
    await logger.close();
    logger.write(Uint8Array.of(7));
    expect(Array.from(joinBytes(w.writes))).toEqual([1, 2, 3]);
  });
  it('text mode is UTF-8 safe across chunk splits and timestamps each line', async () => {
    const w = fakeWritable();
    const logger = createDiskLogger(w, { mode: 'text' });
    const bytes = enc.encode('hi \u{1F600}\nnext\n');
    for (let i = 0; i < bytes.length; i++) logger.write(bytes.subarray(i, i + 1), 0);
    await logger.close();
    const text = w.writes.join('');
    expect(text).not.toContain('\uFFFD');
    expect(text).toContain('\u{1F600}');
    expect(text.split('\n').filter(Boolean).every((l) => /^\[\d\d:\d\d:\d\d\.\d{3}\] /.test(l))).toBe(true);
  });
  it('hex mode writes one line per chunk', async () => {
    const w = fakeWritable();
    const logger = createDiskLogger(w, { mode: 'hex' });
    logger.write(Uint8Array.of(0x48, 0x69, 0x0a), 0);
    await logger.close();
    expect(w.writes[0]).toMatch(/\] 48 69 0a\n$/);
  });
  it('a persistent stream decoder keeps a split emoji intact (context decode strategy)', () => {
    const d = new TextDecoder('utf-8', { fatal: false });
    const b = enc.encode('\u{1F600}');
    const out = d.decode(b.subarray(0, 2), { stream: true }) + d.decode(b.subarray(2), { stream: true });
    expect(out).toBe('\u{1F600}');
    expect(dec.decode(b.subarray(0, 2))).toContain('\uFFFD'); // the old per-chunk behaviour
  });
});

describe('send file', () => {
  it('sends in order at a per-char delay with progress and cancel', async () => {
    const sent = [];
    const delays = [];
    const progress = [];
    const res = await sendPaced(enc.encode('abcd'), {
      unit: 'char', delayMs: 10, sendRaw: async (b) => { sent.push(dec.decode(b)); },
      sleep: async (ms) => { delays.push(ms); }, onProgress: (s, t) => progress.push([s, t]),
    });
    expect(sent).toEqual(['a', 'b', 'c', 'd']);
    expect(delays).toEqual([10, 10, 10, 10]);
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(res).toEqual({ sent: 4, total: 4, cancelled: false });

    const signal = { aborted: false };
    const sent2 = [];
    const res2 = await sendPaced(enc.encode('abcdef'), {
      unit: 'char', delayMs: 10, signal, sleep: async () => {},
      sendRaw: async (b) => { sent2.push(dec.decode(b)); if (sent2.length === 2) signal.aborted = true; },
    });
    expect(sent2).toEqual(['a', 'b']);
    expect(res2).toEqual({ sent: 2, total: 6, cancelled: true });
  });
  it('per-line mode sends whole lines', async () => {
    const sent = [];
    await sendPaced(enc.encode('one\ntwo\nthree'), { unit: 'line', delayMs: 5, sleep: async () => {}, sendRaw: async (b) => { sent.push(dec.decode(b)); } });
    expect(sent).toEqual(['one\n', 'two\n', 'three']);
  });
});
