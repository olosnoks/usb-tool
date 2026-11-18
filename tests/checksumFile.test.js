import { describe, it, expect } from 'vitest';
import { parseChecksumFile, verifyChecksums, formatBsdSums } from '../src/utils/checksumFile.js';

const H = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
describe('parseChecksumFile', () => {
  it('parses GNU, BSD, SFV and skips comments', () => {
    const t = `# c\n${H}  a.txt\n${H} *b dir/c.bin\nSHA256 (d.txt) = ${H.toUpperCase()}\n; sfv\ne.txt 352441C2\nnonsense\n`;
    const { entries, bad } = parseChecksumFile(t);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b dir/c.bin', 'd.txt', 'e.txt']);
    expect(entries[2]).toMatchObject({ algo: 'SHA-256', hash: H });
    expect(entries[3]).toMatchObject({ algo: 'CRC-32', hash: '352441c2' });
    expect(bad).toEqual([7]);
  });
});
describe('verifyChecksums', () => {
  const files = [
    { name: 'a.txt', rows: [{ id: 'SHA-256', value: H }, { id: 'MD5', value: 'x'.repeat(32) }] },
    { name: 'b.txt', rows: [{ id: 'SHA-256', value: '0'.repeat(64) }] },
    { name: 'extra.txt', rows: [] },
  ];
  it('reports ok, failed, missing, unlisted', () => {
    const entries = [
      { hash: H, name: 'a.txt', algo: null },
      { hash: H, name: 'sub/b.txt', algo: null },
      { hash: H, name: 'gone.txt', algo: null },
    ];
    const v = verifyChecksums(entries, files);
    expect(v.results.map((r) => r.status)).toEqual(['ok', 'failed', 'missing']);
    expect(v.ok).toBe(1); expect(v.failed).toBe(1); expect(v.missing).toBe(1);
    expect(v.unlisted).toEqual(['extra.txt']);
  });
  it('honours BSD algo tag and flags unknown length', () => {
    const v = verifyChecksums([{ hash: 'abcd', name: 'a.txt', algo: null }, { hash: H, name: 'a.txt', algo: 'SHA-256' }], files);
    expect(v.results.map((r) => r.status)).toEqual(['unknown', 'ok']);
  });
});
describe('formatBsdSums', () => {
  it('formats tag lines', () => {
    expect(formatBsdSums([{ name: 'a', value: 'aa' }], 'SHA-256')).toBe('SHA256 (a) = aa\n');
  });
});
