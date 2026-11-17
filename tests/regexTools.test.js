import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import RegexTesterWorkbench from '../src/components/tools/RegexTesterWorkbench.jsx';
import {
  normalizeFlags, runMatch, createRegexRunner, highlightSegments, explainPattern, explainLines,
  generateCode, encodeState, decodeState, buildPermalink, caseVerdict, PATTERN_LIBRARY, ENGINE_LABEL,
} from '../src/utils/regexTools.js';

describe('flags', () => {
  it('normalizes: dedupe, order, drop invalid, v beats u', () => {
    expect(normalizeFlags('gg')).toBe('g');
    expect(normalizeFlags('yimgxd')).toBe('dgimy');
    expect(normalizeFlags('uv')).toBe('v');
    expect(normalizeFlags(undefined)).toBe('');
  });
  it('typing gg does not throw in runMatch', () => {
    expect(() => runMatch({ pattern: 'a', flags: 'gg', text: 'aa' })).not.toThrow();
    expect(runMatch({ pattern: 'a', flags: 'gg', text: 'aa' }).matches).toHaveLength(2);
  });
});

describe('runMatch (worker protocol function)', () => {
  it('returns a plain match shape with groups and named groups', () => {
    const r = runMatch({ pattern: '(?<y>\\d{4})-(\\d{2})', flags: 'g', text: 'on 2024-05 and 1999-12' });
    expect(r.error).toBe('');
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toMatchObject({ index: 3, length: 7, text: '2024-05', groups: ['2024', '05'], named: { y: '2024' } });
    expect(() => structuredClone(r)).not.toThrow();
  });
  it('d flag adds indices', () => {
    const r = runMatch({ pattern: '(b)', flags: 'd', text: 'abc' });
    expect(r.matches[0].indices).toEqual([[1, 2], [1, 2]]);
  });
  it('reports syntax errors and handles empty pattern', () => {
    expect(runMatch({ pattern: '(', flags: '', text: 'x' }).error).toMatch(/./);
    expect(runMatch({ pattern: '', text: 'x' }).matches).toEqual([]);
  });
  it('zero-width global matches terminate', () => {
    const r = runMatch({ pattern: '\\b', flags: 'g', text: 'ab cd' });
    expect(r.matches.map((m) => m.index)).toEqual([0, 2, 3, 5]);
    expect(runMatch({ pattern: '', flags: 'g', text: 'x' }).matches).toEqual([]);
    expect(runMatch({ pattern: 'x*', flags: 'gu', text: 'a\u{1F600}' }).matches.length).toBe(3);
  });
  it('matchAll forces g; split mode; replace', () => {
    expect(runMatch({ pattern: 'a', flags: '', text: 'aaa', mode: 'matchAll' }).matches).toHaveLength(3);
    expect(runMatch({ pattern: 'a', flags: '', text: 'aaa' }).matches).toHaveLength(1);
    expect(runMatch({ pattern: ',\\s*', text: 'a, b,c', mode: 'split' }).split).toEqual(['a', 'b', 'c']);
    expect(runMatch({ pattern: '(\\w+)@', flags: 'g', text: 'x@ y@', replacement: '<$1>' }).replaced).toBe('<x> <y>');
  });
  it('caps the match list', () => {
    const r = runMatch({ pattern: 'a', flags: 'g', text: 'a'.repeat(50), maxMatches: 10 });
    expect(r.matches).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});

describe('runner with timeout', () => {
  const hang = () => ({ postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null });

  it('times out when the worker never answers and terminates it', async () => {
    const w = hang();
    const runner = createRegexRunner({ createWorker: () => w, timeoutMs: 30 });
    const res = await runner.run({ pattern: '(a+)+$', flags: '', text: 'aaaaaaaaaaaaaaaaaaaaaaaa!' });
    expect(res.timedOut).toBe(true);
    expect(w.terminate).toHaveBeenCalled();
  });
  it('resolves with the worker result when it answers in time', async () => {
    const w = hang();
    w.postMessage = vi.fn(({ id, req }) => setTimeout(() => w.onmessage({ data: { id, result: runMatch(req) } }), 1));
    const runner = createRegexRunner({ createWorker: () => w, timeoutMs: 500 });
    const res = await runner.run({ pattern: 'b', flags: 'g', text: 'abcabcabcabc' });
    expect(res.matches).toHaveLength(4);
  });
  it('runs tiny inputs synchronously (no worker created)', async () => {
    const createWorker = vi.fn();
    const runner = createRegexRunner({ createWorker });
    const res = await runner.run({ pattern: 'a', flags: 'g', text: 'aaa' });
    expect(res.matches).toHaveLength(3);
    expect(createWorker).not.toHaveBeenCalled();
  });
  it('supersedes a stale request', async () => {
    const w = hang();
    const runner = createRegexRunner({ createWorker: () => w, timeoutMs: 200 });
    const first = runner.run({ pattern: 'a', text: 'aaaaaaaaaaaaaaaa' });
    runner.run({ pattern: 'b', text: 'aaaaaaaaaaaaaaaa' });
    expect((await first).superseded).toBe(true);
    runner.dispose();
  });
  it('really would hang: the catastrophic pattern is exponential (guard on a short input)', () => {
    // Only a short input; the long one is what the worker timeout protects against.
    const t0 = Date.now();
    runMatch({ pattern: '(a+)+$', flags: '', text: `${'a'.repeat(18)}!` });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('highlight segmentation', () => {
  it('never inserts text for zero-width matches', () => {
    const text = 'ab cd';
    const { matches } = runMatch({ pattern: '\\b', flags: 'g', text });
    const segs = highlightSegments(text, matches);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.empty)).toHaveLength(4);
    expect(segs.some((s) => s.text.includes('\u2205'))).toBe(false);
  });
  it('segments normal matches and the remainder', () => {
    const { matches } = runMatch({ pattern: 'b+', flags: 'g', text: 'abbc' });
    expect(highlightSegments('abbc', matches)).toEqual([
      { text: 'a', hit: false }, { text: 'bb', hit: true, i: 0 }, { text: 'c', hit: false },
    ]);
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('explainer', () => {
  it('explains (?<year>\\d{4})-\\d{2}', () => {
    const { nodes, error } = explainPattern('(?<year>\\d{4})-\\d{2}');
    expect(error).toBe('');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ type: 'group', kind: 'named', name: 'year', number: 1, text: '(?<year>\\d{4})' });
    expect(nodes[0].children[0]).toMatchObject({ type: 'escape', text: '\\d', quantifier: { text: '{4}', min: 4, max: 4 } });
    expect(nodes[1]).toMatchObject({ type: 'literal', text: '-' });
    expect(nodes[2].quantifier.desc).toMatch(/exactly 2 times/);
  });
  it('covers groups, classes, quantifiers, anchors, lookarounds', () => {
    const { nodes, error } = explainPattern('^(?:a|b)+(?=x)(?!y)(?<=p)(?<!q)[^a-z\\d]*?\\bz{2,}$');
    expect(error).toBe('');
    const lines = explainLines(nodes).join('\n');
    expect(lines).toMatch(/Start of the string/);
    expect(lines).toMatch(/Non-capturing group/);
    expect(lines).toMatch(/Alternation/);
    expect(lines).toMatch(/1 or more times, as many as possible/);
    expect(lines).toMatch(/Positive lookahead/);
    expect(lines).toMatch(/Negative lookahead/);
    expect(lines).toMatch(/Positive lookbehind/);
    expect(lines).toMatch(/Negative lookbehind/);
    expect(lines).toMatch(/Any single character except: a-z, \\d/);
    expect(lines).toMatch(/0 or more times, as few as possible \(lazy\)/);
    expect(lines).toMatch(/Word boundary/);
    expect(lines).toMatch(/2 or more times/);
    expect(lines).toMatch(/End of the string/);
  });
  it('numbers capture groups and handles backreferences', () => {
    const { nodes } = explainPattern('(a)(?<n>b)\\1\\k<n>');
    expect(nodes[0].number).toBe(1);
    expect(nodes[1].number).toBe(2);
    expect(nodes[2].type).toBe('backreference');
    expect(nodes[3].desc).toMatch(/"n"/);
  });
  it('merges plain literal runs and reports errors without throwing', () => {
    expect(explainPattern('abc').nodes).toHaveLength(1);
    expect(explainPattern('ab+').nodes).toHaveLength(2);
    expect(explainPattern('(abc').error).toMatch(/Unterminated group/);
    expect(explainPattern('abc)').error).toMatch(/Unmatched/);
    expect(explainPattern('*a').error).toMatch(/Nothing to repeat/);
    expect(explainPattern('[abc').error).toMatch(/Unterminated/);
  });
});

describe('code generator', () => {
  const state = { pattern: '(?<year>\\d{4})-(\\d{2})', flags: 'gi', text: 'on 2024-05 "x"', replacement: '$<year>/$2$$' };

  it('JavaScript output parses and runs', () => {
    const code = generateCode('js', state);
    const logs = [];
    // eslint-disable-next-line no-new-func
    new Function('console', code)({ log: (...a) => logs.push(a) });
    expect(logs.length).toBe(2);
    expect(logs[0][1]).toBe('2024-05');
    expect(logs[1][0]).toBe('on 2024/05$ "x"');
  });
  it('JavaScript uses RegExp() when the pattern contains a slash', () => {
    const code = generateCode('js', { pattern: 'a/b', flags: 'g', text: '', replacement: '' });
    expect(code).toContain('new RegExp("a/b", "g")');
    // eslint-disable-next-line no-new-func
    expect(() => new Function('console', code)).not.toThrow();
  });
  it('Python: named groups, flags, replacement syntax', () => {
    const code = generateCode('python', state);
    expect(code).toContain('r"(?P<year>\\d{4})-(\\d{2})"');
    expect(code).toContain('re.IGNORECASE');
    expect(code).toContain('finditer');
    expect(code).toContain('r"\\g<year>/\\g<2>$"');
    expect(code).toContain('text = "on 2024-05 \\"x\\""');
  });
  it('PHP: delimiters, escaped slash, flags', () => {
    const code = generateCode('php', { pattern: 'a/b\\/c', flags: 'gi', text: "it's", replacement: '$1' });
    expect(code).toContain("'/a\\\\/b\\\\/c/i'");
    expect(code).toContain("$text = 'it\\'s';");
    expect(code).toContain('preg_match_all');
    expect(code).toContain("'${1}'");
  });
  it('Go: inline flags, raw string, P-named groups, RE2 warning', () => {
    const code = generateCode('go', state);
    expect(code).toContain('regexp.MustCompile(`(?i)(?P<year>\\d{4})-(\\d{2})`)');
    expect(code).toContain('FindAllStringSubmatch');
    expect(code).toContain('"${year}/${2}$$"');
    expect(generateCode('go', { pattern: 'a(?=b)', flags: '', text: '', replacement: '' })).toMatch(/RE2 has no lookarounds/);
  });
  it('C#: verbatim string quote doubling and options', () => {
    const code = generateCode('csharp', { pattern: 'say "hi"', flags: 'gim', text: '', replacement: '' });
    expect(code).toContain('new Regex(@"say ""hi""", RegexOptions.IgnoreCase | RegexOptions.Multiline)');
    expect(code).toContain('foreach (Match m in re.Matches(text))');
  });
  it('non-global flags use the single-match APIs', () => {
    expect(generateCode('python', { pattern: 'a', flags: '', text: 'a' })).toContain('pattern.search');
    expect(generateCode('csharp', { pattern: 'a', flags: '', text: 'a' })).toContain('re.Match(text)');
  });
  it('rejects unknown languages', () => {
    expect(() => generateCode('cobol', state)).toThrow();
  });
});

describe('permalinks', () => {
  it('round-trips pattern, flags, text, replacement, mode and cases (unicode safe)', () => {
    const s = { pattern: '(\\w+)é', flags: 'dgim', text: 'line1\nçé \u{1F600}', replacement: '$1-$&', mode: 'split', cases: [{ text: 'abc', expect: 'match' }] };
    const enc = encodeState(s);
    expect(enc.startsWith('regex=')).toBe(true);
    expect(decodeState(`#${enc}`)).toEqual({ ...s });
  });
  it('rejects garbage and normalizes flags', () => {
    expect(decodeState('')).toBeNull();
    expect(decodeState('#tool=regex-tester')).toBeNull();
    expect(decodeState('#regex=!!!')).toBeNull();
    const d = decodeState(`#${encodeState({ pattern: 'a', flags: 'gg', text: '' })}`);
    expect(d.flags).toBe('g');
    expect(d.mode).toBe('matches');
  });
  it('permalink keeps ?tool= so the app opens the Regex Tester', () => {
    const url = buildPermalink({ pattern: 'a', flags: 'g', text: 't' }, { origin: 'https://x.test', pathname: '/' });
    expect(url).toMatch(/^https:\/\/x\.test\/\?tool=regex-tester#regex=/);
    expect(decodeState(url.slice(url.indexOf('#')))).toMatchObject({ pattern: 'a' });
  });
});

describe('misc', () => {
  it('case verdicts', () => {
    expect(caseVerdict(1, 'match')).toBe(true);
    expect(caseVerdict(0, 'match')).toBe(false);
    expect(caseVerdict(0, 'nomatch')).toBe(true);
    expect(caseVerdict(3, 'any')).toBeNull();
  });
  it('every library pattern compiles and matches its sample', () => {
    for (const p of PATTERN_LIBRARY) {
      const r = runMatch({ pattern: p.pattern, flags: p.flags, text: p.sample });
      expect(r.error, p.name).toBe('');
      expect(r.matches.length, p.name).toBeGreaterThan(0);
    }
  });
  it('component renders the engine label and the explanation', () => {
    const html = renderToString(React.createElement(RegexTesterWorkbench, {}));
    expect(html).toContain(ENGINE_LABEL.replace('(', '(').replace(')', ')'));
    expect(html).toContain('Code generator');
    expect(html).toContain('Share link');
    expect(html).toContain('regex-explain');
  });
});
