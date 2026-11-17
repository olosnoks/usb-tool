import { describe, it, expect } from 'vitest';
import { compilePattern, scanChunk, TAIL_LIMIT } from '../src/components/CrashAlertDeck.jsx';
import { maskPassword } from '../src/components/tools/PwnedPasswordsCheckerWorkbench.jsx';
import { REFERENCE_ARTICLES } from '../src/wiki/articles/referenceArticles.js';

const run = (chunks, pats) => {
  const compiled = pats.map(compilePattern);
  let tail = ''; const hits = [];
  for (const c of chunks) { const r = scanChunk(tail, c, compiled); tail = r.tail; if (r.hit) hits.push(r.hit); }
  return hits;
};

describe('CrashAlertDeck matching', () => {
  it('finds a signature split across chunks, once', () => {
    const hits = run(['boot ok\nGuru Med', 'itation Error: core 0', ' more text', ' even more'], ['Guru Meditation Error']);
    expect(hits).toHaveLength(1);
  });
  it('regex patterns work; invalid regex falls back to text', () => {
    expect(run(['PANIC at 0x12'], [String.raw`/panic\s+at/i`])).toHaveLength(1);
    const c = compilePattern('/(/');
    expect(c.invalid).toBe(true);
    expect(c.kind).toBe('text');
  });
  it('fires again for a new occurrence', () => {
    expect(run(['HardFault', 'x', 'HardFault'], ['HardFault'])).toHaveLength(2);
  });
  it('bounds the tail', () => {
    const r = scanChunk('', 'a'.repeat(TAIL_LIMIT * 3), []);
    expect(r.tail.length).toBe(TAIL_LIMIT);
  });
});

describe('Pwned passwords masking', () => {
  it('never contains the password', () => {
    const m = maskPassword('hunter2');
    expect(m).toBe('h•••(7)');
    expect(m).not.toContain('unter2');
  });
});

describe('wiki troubleshooting article', () => {
  it('links to a registered tool id', () => {
    expect(REFERENCE_ARTICLES.find((a) => a.id === 'troubleshooting').toolId).toBe('setup');
  });
});
