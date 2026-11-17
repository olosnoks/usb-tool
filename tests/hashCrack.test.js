import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { md4Hex } from '../src/utils/md4.js';
import { hashOne, normalizeHash, expandRules, ruleMultiplier, parseMask, maskKeyspace, maskCandidates, HASH_MODES } from '../src/utils/hashCrack.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const enc = (s) => new TextEncoder().encode(s);

describe('md4 / ntlm', () => {
  it('matches RFC 1320 vectors', () => {
    expect(md4Hex(enc(''))).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
    expect(md4Hex(enc('abc'))).toBe('a448017aaf21d8525fc10ae87aa6729d');
    expect(md4Hex(enc('message digest'))).toBe('d9130a8164549fe818874806e1c7014b');
  });
  it('computes NTLM of a password', async () => {
    expect(await hashOne('ntlm', 'password')).toBe('8846f7eaee8fb117ad06bdd830b7586c');
  });
});

describe('hashOne modes', () => {
  it('MD5 / SHA-1 / SHA-256 of "abc"', async () => {
    expect(await hashOne('md5', 'abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await hashOne('sha1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await hashOne('sha256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('salted variants differ by order', async () => {
    const ps = await hashOne('md5ps', 'pass', 'salt');
    const sp = await hashOne('md5sp', 'pass', 'salt');
    expect(ps).toBe(await hashOne('md5', 'passsalt'));
    expect(sp).toBe(await hashOne('md5', 'saltpass'));
    expect(ps).not.toBe(sp);
  });
  it('double md5', async () => {
    const once = await hashOne('md5', 'abc');
    expect(await hashOne('md5md5', 'abc')).toBe(await hashOne('md5', once));
  });
  it('every declared mode produces a hex digest', async () => {
    for (const m of HASH_MODES) {
      const h = await hashOne(m.id, 'secret', 'NaCl');
      expect(h).toMatch(/^[0-9a-f]+$/);
    }
  });
});

describe('normalizeHash', () => {
  it('lowercases, trims and strips MySQL asterisk', () => {
    expect(normalizeHash('  ABCDEF ')).toBe('abcdef');
    expect(normalizeHash('*A94A8FE5')).toBe('a94a8fe5');
  });
});

describe('rules', () => {
  it('none returns just the word', () => {
    expect(expandRules('word', 'none')).toEqual(['word']);
  });
  it('append adds digits and suffixes, keeps base first', () => {
    const r = expandRules('cat', 'append');
    expect(r[0]).toBe('cat');
    expect(r).toContain('cat1');
    expect(r).toContain('cat123');
    expect(r).toContain('catcat');
  });
  it('best64 includes case, leet and append variants, deduped', () => {
    const r = expandRules('Pass', 'best64');
    expect(r).toContain('pass');
    expect(r).toContain('PASS');
    expect(r).toContain('ssaP'); // reverse
    expect(r.some((x) => /4/.test(x))).toBe(true); // leet a->4
    expect(new Set(r).size).toBe(r.length); // deduped
    expect(ruleMultiplier('best64')).toBeGreaterThan(ruleMultiplier('none'));
  });
});

describe('mask', () => {
  it('parses charset tokens and literals', () => {
    const sets = parseMask('ab?d');
    expect(sets.length).toBe(3);
    expect(sets[0]).toBe('a');
    expect(sets[2]).toBe('0123456789');
  });
  it('computes keyspace', () => {
    expect(maskKeyspace(parseMask('?l?l'))).toBe(26 * 26);
    expect(maskKeyspace(parseMask('?d?d?d'))).toBe(1000);
  });
  it('iterates in odometer order', () => {
    const got = [...maskCandidates(parseMask('?d?d'))];
    expect(got.length).toBe(100);
    expect(got[0]).toBe('00');
    expect(got[1]).toBe('01');
    expect(got[99]).toBe('99');
  });
  it('supports literal prefixes', () => {
    const got = [...maskCandidates(parseMask('pin?d'))];
    expect(got[0]).toBe('pin0');
    expect(got[9]).toBe('pin9');
  });
});

import { parseTargetLine, parseTargets, maskPassword, HASH_HEX_LENGTH } from '../src/utils/hashCrack.js';

describe('hash:salt target parsing (DAT-9)', () => {
  const md5pw = '5f4dcc3b5aa765d61d8327deb882cf99';
  it('accepts hash:salt for salted modes and keeps colons inside the salt', () => {
    expect(parseTargetLine(`${md5pw}:NaCl`, 'md5ps')).toEqual({ ok: true, hash: md5pw, salt: 'NaCl' });
    expect(parseTargetLine(`${md5pw}:a:b:c`, 'md5sp')).toEqual({ ok: true, hash: md5pw, salt: 'a:b:c' });
  });
  it('falls back to the shared salt and errors when there is none', () => {
    expect(parseTargetLine(md5pw, 'md5ps', 'shared')).toMatchObject({ ok: true, salt: 'shared' });
    // a trailing colon (empty salt part) also uses the shared salt
    expect(parseTargetLine(`${md5pw}:`, 'md5ps', 'shared')).toMatchObject({ ok: true, salt: 'shared' });
    expect(parseTargetLine(`${md5pw}:`, 'md5ps').ok).toBe(false);
    expect(parseTargetLine(md5pw, 'md5ps').ok).toBe(false);
  });
  it('ignores a trailing colon / suffix for unsalted modes', () => {
    expect(parseTargetLine(`${md5pw}:`, 'md5')).toEqual({ ok: true, hash: md5pw, salt: '' });
  });
  it('rejects bcrypt and $id$ strings with a clear message instead of treating them as hex', () => {
    for (const s of ['$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '$1$salt$qJH7.N4xYta3aEG/dfqo/0', '$6$rounds=5000$salt$abc']) {
      const r = parseTargetLine(s, 'md5');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Unsupported hash format/);
    }
  });
  it('validates hex and length per mode', () => {
    expect(parseTargetLine('zzzz', 'md5').error).toMatch(/hex/);
    expect(parseTargetLine('abcd', 'sha1').error).toMatch(/needs 40/);
    for (const m of HASH_MODES) expect(HASH_HEX_LENGTH[m.id], m.id).toBeGreaterThan(0);
  });
  it('de-duplicates and reports line numbers for bad lines', () => {
    const { targets, errors } = parseTargets(`${md5pw}\n${md5pw.toUpperCase()}\n\nnope\n`, 'md5');
    expect(targets).toHaveLength(1);
    expect(errors).toEqual([{ line: 4, error: 'not a hex digest' }]);
  });
  it('same hash with different salts stays distinct', () => {
    expect(parseTargets(`${md5pw}:a\n${md5pw}:b`, 'md5ps').targets).toHaveLength(2);
  });
  it('cracks a salted hash from a hash:salt line', async () => {
    const h = await hashOne('md5ps', 'password', 'NaCl');
    const t = parseTargetLine(`${h}:NaCl`, 'md5ps');
    expect(await hashOne('md5ps', 'password', t.salt)).toBe(t.hash);
  });
});

describe('maskPassword', () => {
  it('shows length only, never characters', () => {
    expect(maskPassword('hunter2')).toBe('******* (7 chars)');
    expect(maskPassword('a')).toBe('* (1 char)');
    expect(maskPassword('x'.repeat(20))).toBe('************… (20 chars)');
    expect(maskPassword('hunter2')).not.toMatch(/hunter/);
  });
});

import { readFileSync } from 'node:fs';

describe('cracker never logs plaintext (DAT-9 source guard)', () => {
  const src = readFileSync(new URL('../src/components/tools/HashcatCrackerWorkbench.jsx', import.meta.url), 'utf8');
  const logCalls = src.split('\n').filter((l) => /\blog\(/.test(l));
  it('no log() call interpolates a candidate, password or mask literal', () => {
    expect(logCalls.length).toBeGreaterThan(3);
    for (const l of logCalls) {
      expect(l, l).not.toMatch(/\$\{\s*(cand|hit\.password|password|mask)\s*\}/);
    }
  });
  it('cracked lines go through maskPassword', () => {
    expect(logCalls.filter((l) => /Cracked/.test(l)).every((l) => /maskPassword\(/.test(l))).toBe(true);
  });
});
