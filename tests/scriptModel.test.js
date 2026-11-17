import { describe, it, expect } from 'vitest';
import {
  encodeSend, substituteVars, buildMatcher, normalizeStep, buildJUnit, buildCsv,
  saveSuite, loadSuites, deleteSuite, parseSuiteJson, exportSuiteJson, moveStep, duplicateStep,
} from '../src/utils/scriptModel';

const arr = (u) => Array.from(u);

describe('encodeSend', () => {
  it('turns \\r\\n into CR LF bytes', () => {
    expect(arr(encodeSend('AT\\r\\n'))).toEqual([65, 84, 13, 10]);
  });
  it('supports \\t \\xNN \\\\ \\0 and keeps real control chars (presets)', () => {
    expect(arr(encodeSend('\\t\\x1b\\xFF\\\\\\0'))).toEqual([9, 0x1b, 255, 0x5c, 0]);
    expect(arr(encodeSend('AT\r\n'))).toEqual([65, 84, 13, 10]);
    expect(arr(encodeSend('\x03\x03'))).toEqual([3, 3]);
  });
  it('keeps malformed escapes literally', () => {
    expect(new TextDecoder().decode(encodeSend('\\xZZ \\q'))).toBe('\\xZZ \\q');
  });
  it('substitutes variables and appends a line ending', () => {
    expect(new TextDecoder().decode(encodeSend('AT+X=${a}${missing}', { vars: { a: '7' }, lineEnding: 'crlf' }))).toBe('AT+X=7${missing}\r\n');
    expect(arr(encodeSend('x', { lineEnding: 'cr' }))).toEqual([120, 13]);
  });
  it('encodes non-ASCII as UTF-8', () => {
    expect(arr(encodeSend('é'))).toEqual([0xc3, 0xa9]);
  });
});

describe('matching', () => {
  it('regex stores numbered and named captures', () => {
    const m = buildMatcher(normalizeStep({ expect: '\\+CSQ: (\\d+),(?<ber>\\d+)', expectMode: 'regex' }));
    expect(m('x +CSQ: 21,3 OK').captures).toEqual({ 1: '21', 2: '3', ber: '3' });
    expect(m('nothing')).toBeNull();
  });
  it('plain honours the case option, any-of matches either', () => {
    const plain = buildMatcher(normalizeStep({ expect: 'ok', caseSensitive: false }));
    expect(plain('OK')).not.toBeNull();
    expect(buildMatcher(normalizeStep({ expect: 'ok' }))('OK')).toBeNull();
    const any = buildMatcher(normalizeStep({ expect: 'ERROR||FAIL', expectMode: 'any' }));
    expect(any('boom FAIL')).not.toBeNull();
    expect(any('fine')).toBeNull();
  });
  it('substituteVars leaves unknown names alone', () => {
    expect(substituteVars('${1}-${x}', { 1: 'a' })).toBe('a-${x}');
  });
  it('invalid regex throws', () => {
    expect(() => buildMatcher(normalizeStep({ expect: '(', expectMode: 'regex' }))).toThrow();
  });
});

describe('reports', () => {
  const steps = [normalizeStep({ id: 'a', send: 'AT<>', expect: 'OK' }), normalizeStep({ id: 'b', send: '=cmd', expect: 'X' }), normalizeStep({ id: 'c' })];
  const results = {
    a: { status: 'pass', timeMs: 120, iterations: [{}], output: 'OK\x01' },
    b: { status: 'fail', timeMs: 50, iterations: [{}], error: 'expected "X" timed out', output: 'no' },
  };
  it('JUnit has the minimal valid structure', () => {
    const xml = buildJUnit('My "suite"', steps, results, { timestamp: 'T' });
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toMatch(/<testsuite [^>]*tests="3" failures="1" errors="0" skipped="1"/);
    expect((xml.match(/<testcase /g) || []).length).toBe(3);
    expect(xml).toContain('<failure message="expected &quot;X&quot; timed out"/>');
    expect(xml).toContain('<skipped message="not run"/>');
    expect(xml).toContain('AT&lt;&gt;');
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    expect((xml.match(/<testcase /g) || []).length).toBe((xml.match(/<\/testcase>/g) || []).length);
  });
  it('CSV has a header, quotes cells and neutralises formulas', () => {
    const csv = buildCsv(steps, results);
    const lines = csv.trim().split('\r\n');
    expect(lines[0].split(',')[0]).toBe('index');
    expect(csv).toContain("'=cmd");
    expect(lines.length).toBe(4);
  });
});

describe('suites', () => {
  const store = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
  it('saves, lists and deletes named suites', () => {
    const s = store();
    saveSuite(s, 'one', [{ id: '1', send: 'AT', expect: 'OK' }]);
    expect(Object.keys(loadSuites(s))).toEqual(['one']);
    expect(loadSuites(s).one[0].type).toBe('send');
    deleteSuite(s, 'one');
    expect(loadSuites(s)).toEqual({});
  });
  it('round-trips through JSON and rejects junk', () => {
    const json = exportSuiteJson('n', [{ id: '1', send: 'AT' }]);
    expect(parseSuiteJson(json).steps[0].send).toBe('AT');
    expect(() => parseSuiteJson('{"a":1}')).toThrow();
    expect(loadSuites({ getItem: () => 'not json' })).toEqual({});
  });
  it('moves and duplicates', () => {
    const a = [{ id: '1' }, { id: '2' }];
    expect(moveStep(a, 0, 1).map((s) => s.id)).toEqual(['2', '1']);
    expect(moveStep(a, 0, -1)).toBe(a);
    const d = duplicateStep(a, 0);
    expect(d.length).toBe(3);
    expect(d[1].id).not.toBe('1');
  });
});
