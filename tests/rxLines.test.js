import { describe, it, expect } from 'vitest';
import { createLineAssembler } from '../src/utils/rxLines.js';

const enc = (s) => new TextEncoder().encode(s);
const texts = (lines) => lines.map((l) => l.text);

describe('createLineAssembler', () => {
  it('splits LF, CR and CRLF', () => {
    const a = createLineAssembler();
    expect(texts(a.push(enc('a\nb\rc\r\nd\n')))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('carries a partial line across chunks', () => {
    const a = createLineAssembler();
    expect(a.push(enc('temp:2'))).toEqual([]);
    expect(a.partial()).toBe('temp:2');
    expect(texts(a.push(enc('4.5\n')))).toEqual(['temp:24.5']);
  });

  it('treats CRLF split across chunks as one terminator', () => {
    const a = createLineAssembler();
    expect(texts(a.push(enc('one\r')))).toEqual(['one']);
    expect(texts(a.push(enc('\ntwo\r\n')))).toEqual(['two']);
  });

  it('keeps a chunk longer than its predecessor intact', () => {
    const a = createLineAssembler();
    const out = [...a.push(enc('ab\n')), ...a.push(enc('0123456789\n'))];
    expect(texts(out)).toEqual(['ab', '0123456789']);
  });

  it('decodes a multibyte character split across chunks', () => {
    const a = createLineAssembler();
    const bytes = enc('x\u{1F600}y\n'); // 4-byte emoji
    const out = [...a.push(bytes.slice(0, 2)), ...a.push(bytes.slice(2, 4)), ...a.push(bytes.slice(4))];
    expect(texts(out)).toEqual(['x\u{1F600}y']);
  });

  it('caps runaway lines', () => {
    const a = createLineAssembler({ maxLine: 5 });
    expect(texts(a.push(enc('abcdefghijkl\n')))).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('flush returns the unterminated tail once', () => {
    const a = createLineAssembler();
    a.push(enc('par'));
    expect(texts(a.flush())).toEqual(['par']);
    expect(a.flush()).toEqual([]);
  });

  it('stamps a line with the time of its first byte', () => {
    const a = createLineAssembler();
    a.push(enc('ab'), 100);
    const out = a.push(enc('c\n'), 250);
    expect(out).toEqual([{ text: 'abc', t: 100 }]);
  });

  it('reassembles 10 000 lines from 7-byte chunks', () => {
    const a = createLineAssembler();
    const all = enc(Array.from({ length: 10000 }, (_, i) => `v:${i % 7}`).join('\n') + '\n');
    let n = 0;
    for (let i = 0; i < all.length; i += 7) n += a.push(all.slice(i, i + 7)).length;
    expect(n).toBe(10000);
  });
});
