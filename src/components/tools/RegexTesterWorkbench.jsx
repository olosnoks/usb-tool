import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, AlertTriangle, Link2 } from 'lucide-react';
import {
  ENGINE_LABEL, DEFAULT_TIMEOUT_MS, LANGUAGES, PATTERN_LIBRARY,
  normalizeFlags, createRegexRunner, timeoutMessage, highlightSegments, caseVerdict,
  explainPattern, generateCode, decodeState, encodeState, buildPermalink,
} from '../../utils/regexTools.js';

/**
 * Regex tester (regex101-style), fully client-side — no network. Build a
 * JavaScript regular expression, see live match highlighting, capture groups
 * (including named groups and indices), a match list, a replace preview, a
 * pattern explanation and code for other languages.
 *
 * Matching runs in a Web Worker with a timeout, so a catastrophic-backtracking
 * pattern shows a message instead of freezing the tab. The engine is the
 * browser's own RegExp (ECMAScript); other languages differ in places.
 */

const FLAGS = [
  { f: 'g', label: 'global', desc: 'find all matches' },
  { f: 'i', label: 'ignore case', desc: 'case-insensitive' },
  { f: 'm', label: 'multiline', desc: '^ and $ match line breaks' },
  { f: 's', label: 'dotall', desc: '. matches newlines' },
  { f: 'u', label: 'unicode', desc: 'full unicode' },
  { f: 'v', label: 'unicodeSets', desc: 'unicode with set notation (replaces u)' },
  { f: 'y', label: 'sticky', desc: 'match from lastIndex' },
  { f: 'd', label: 'indices', desc: 'report group start/end positions' },
];

const CHEATS = [
  ['\\d', 'digit'], ['\\w', 'word char'], ['\\s', 'whitespace'], ['.', 'any char'],
  ['^ $', 'start / end'], ['[abc]', 'set'], ['[^abc]', 'negated set'], ['a|b', 'alt'],
  ['a*', '0+'], ['a+', '1+'], ['a?', '0 or 1'], ['a{2,4}', 'range'],
  ['(…)', 'group'], ['(?<n>…)', 'named'], ['(?:…)', 'non-capture'], ['\\b', 'word boundary'],
  ['(?=…)', 'lookahead'], ['(?<=…)', 'lookbehind'],
];

const MODES = [['matches', 'Matches'], ['matchAll', 'matchAll (all)'], ['split', 'Split']];
const TIMEOUTS = [[500, '0.5 s'], [2000, '2 s'], [5000, '5 s'], [10000, '10 s']];

const DEFAULTS = {
  pattern: '(\\w+)@(\\w+\\.\\w+)',
  flags: 'gim',
  text: 'Contact alice@example.com or bob@test.org for details.',
  replacement: '',
  mode: 'matches',
  cases: [],
};

function initialState() {
  try {
    const s = typeof window !== 'undefined' ? decodeState(window.location.hash) : null;
    if (s) return s;
  } catch { /* no window */ }
  return DEFAULTS;
}

function ExplainTree({ nodes, depth = 0 }) {
  return nodes.map((n, i) => (
    <div key={i} style={{ paddingLeft: depth ? 12 : 0 }}>
      <div className="py-0.5">
        <code className="text-cyan-300">{n.text}{n.quantifier ? <span className="text-amber-300">{n.quantifier.text}</span> : null}</code>
        <span className="text-slate-400"> — {n.desc}</span>
        {n.quantifier && <span className="text-amber-200">, repeated {n.quantifier.desc}</span>}
      </div>
      {n.children && <ExplainTree nodes={n.children} depth={depth + 1} />}
    </div>
  ));
}

export default function RegexTesterWorkbench() {
  const init = useMemo(initialState, []);
  const [pattern, setPattern] = useState(init.pattern);
  const [flags, setFlags] = useState(init.flags);
  const [text, setText] = useState(init.text);
  const [replacement, setReplacement] = useState(init.replacement);
  const [mode, setMode] = useState(init.mode);
  const [cases, setCases] = useState(init.cases || []);
  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);
  const [lang, setLang] = useState('js');
  const [copied, setCopied] = useState('');
  const [result, setResult] = useState({ matches: [], error: '' });
  const [caseResults, setCaseResults] = useState([]);
  const [running, setRunning] = useState(false);
  const runnerRef = useRef(null);

  if (!runnerRef.current) {
    runnerRef.current = createRegexRunner({
      timeoutMs: DEFAULT_TIMEOUT_MS,
      createWorker: typeof Worker !== 'undefined'
        ? () => new Worker(new URL('../../workers/regexWorker.js', import.meta.url), { type: 'module' })
        : undefined,
    });
  }
  useEffect(() => () => runnerRef.current?.dispose(), []);

  const toggleFlag = (f) => setFlags((s) => {
    if (s.includes(f)) return normalizeFlags(s.replace(f, ''));
    let next = s;
    if (f === 'u') next = next.replace('v', '');
    if (f === 'v') next = next.replace('u', '');
    return normalizeFlags(next + f);
  });

  // Run matching (worker + timeout) a moment after the last edit.
  useEffect(() => {
    let cancelled = false;
    const runner = runnerRef.current;
    runner.setTimeoutMs(timeoutMs);
    setRunning(true);
    const timer = setTimeout(async () => {
      const res = await runner.run({ pattern, flags, text, replacement, mode });
      if (cancelled || res.superseded) return;
      setResult(res);
      if (res.timedOut || res.error) { setCaseResults([]); setRunning(false); return; }
      const out = [];
      for (const c of cases) {
        const r = await runner.run({ pattern, flags, text: c.text, mode: 'matches', maxMatches: 1 });
        if (cancelled) return;
        out.push(r.timedOut ? { timedOut: true } : { count: r.matches.length });
      }
      if (!cancelled) { setCaseResults(out); setRunning(false); }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pattern, flags, text, replacement, mode, cases, timeoutMs]);

  const matches = result.matches || [];
  const error = result.timedOut ? timeoutMessage(result.timeoutMs || timeoutMs) : result.error;
  const segments = useMemo(() => highlightSegments(text, matches), [text, matches]);
  const explanation = useMemo(() => explainPattern(pattern), [pattern]);
  const code = useMemo(() => {
    try { return generateCode(lang, { pattern, flags, text, replacement }); } catch (e) { return `// ${e.message}`; }
  }, [lang, pattern, flags, text, replacement]);

  const flash = (k) => { setCopied(k); setTimeout(() => setCopied(''), 1200); };
  const copy = (k, value) => { navigator.clipboard?.writeText(value); flash(k); };

  const share = () => {
    const state = { pattern, flags, text, replacement, mode, cases };
    const link = buildPermalink(state, typeof window !== 'undefined' ? window.location : undefined);
    try { window.history.replaceState(null, '', `#${encodeState(state)}`); } catch { /* ignore */ }
    copy('share', link);
  };

  const loadLibrary = (e) => {
    const p = PATTERN_LIBRARY[Number(e.target.value)];
    e.target.value = '';
    if (!p) return;
    setPattern(p.pattern); setFlags(p.flags); setText(p.sample); setMode('matches');
  };

  const setCase = (i, patch) => setCases((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-slate-400">
        <span>Engine: <span className="text-slate-200">{ENGINE_LABEL}</span></span>
        <span className="flex-1" />
        <select onChange={loadLibrary} defaultValue="" aria-label="Pattern library" className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5">
          <option value="">Common patterns…</option>
          {PATTERN_LIBRARY.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
        </select>
        <label className="flex items-center gap-1">Timeout
          <select value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5">
            {TIMEOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button onClick={share} title="Copy a link that restores the pattern, flags, text and replacement" className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 rounded hover:bg-slate-700 text-gray-300">
          {copied === 'share' ? <Check size={12} /> : <Link2 size={12} />} Share link
        </button>
      </div>

      {/* Pattern row */}
      <div className="flex items-stretch gap-1 mb-2 font-mono text-sm">
        <span className="flex items-center text-slate-500 px-1">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          spellCheck={false}
          placeholder="regular expression"
          aria-label="Regular expression"
          className={`flex-1 bg-slate-900 border rounded px-2 py-1.5 text-cyan-300 ${error ? 'border-red-800' : 'border-slate-800'}`}
        />
        <span className="flex items-center text-slate-500 px-1">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(normalizeFlags(e.target.value))}
          spellCheck={false}
          aria-label="Flags"
          className="w-20 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-amber-300"
        />
        <button onClick={() => copy('pattern', `/${pattern}/${flags}`)} title="Copy /pattern/flags" className="px-2 bg-slate-800 rounded hover:bg-slate-700 text-gray-300">
          {copied === 'pattern' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {FLAGS.map(({ f, label, desc }) => (
          <button
            key={f}
            onClick={() => toggleFlag(f)}
            title={desc}
            className={`px-2 py-0.5 rounded text-[11px] border ${flags.includes(f) ? 'bg-cyan-900/50 border-cyan-700 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-gray-200'}`}
          >
            {f} · {label}
          </button>
        ))}
        <span className="flex-1" />
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode" className="bg-slate-900 border border-slate-800 rounded px-1 text-[11px] text-slate-300">
          {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </div>
      )}
      {result.truncated && !error && <div className="mb-2 text-xs text-amber-300">Stopped at the match limit; later matches are not shown.</div>}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Test string</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={6}
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-gray-200 resize-y"
          />
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">
            Highlighted ({matches.length} match{matches.length === 1 ? '' : 'es'}){running && ' …'}
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto" data-testid="regex-highlight">
            {segments.map((s, i) => {
              if (!s.hit) return <span key={i} className="text-slate-400">{s.text}</span>;
              if (s.empty) {
                return <span key={i} data-zero-width className="inline-block w-0 h-[1em] align-text-bottom border-l-2 border-cyan-400" title={`empty match ${s.i + 1}`} />;
              }
              return <mark key={i} className="bg-cyan-500/30 text-cyan-100 rounded-sm" title={`match ${s.i + 1}`}>{s.text}</mark>;
            })}
            {!text && <span className="text-slate-600">empty</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{mode === 'split' ? 'Split parts' : 'Match details'}</div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-48 overflow-auto text-xs font-mono">
            {mode === 'split' ? (
              result.split
                ? result.split.map((p, i) => <div key={i} className="text-gray-200">#{i + 1}: {p === null ? <span className="text-slate-600">undefined</span> : JSON.stringify(p)}</div>)
                : <div className="text-slate-600">Enter a pattern to split on.</div>
            ) : (
              <>
                {matches.length === 0 && <div className="text-slate-600">No matches.</div>}
                {matches.map((m, i) => (
                  <div key={i} className="mb-2 pb-2 border-b border-slate-900 last:border-0">
                    <div className="text-cyan-300">#{i + 1} @ {m.index}: <span className="text-gray-200">{JSON.stringify(m.text)}</span></div>
                    {m.groups.map((g, k) => (
                      <div key={k} className="text-slate-400 pl-3">group {k + 1}: <span className="text-emerald-300">{g === undefined || g === null ? '—' : JSON.stringify(g)}</span>
                        {m.indices?.[k + 1] && <span className="text-slate-500"> [{m.indices[k + 1][0]}, {m.indices[k + 1][1]}]</span>}
                      </div>
                    ))}
                    {Object.entries(m.named || {}).map(([k, v]) => (
                      <div key={k} className="text-slate-400 pl-3">{'<'}{k}{'>'}: <span className="text-purple-300">{v === undefined ? '—' : JSON.stringify(v)}</span></div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">Replace</div>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            spellCheck={false}
            placeholder="replacement (use $1, $<name>)"
            aria-label="Replacement"
            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 mb-1"
          />
          <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-24 overflow-auto text-amber-200">
            {pattern && !error ? (result.replaced || <span className="text-slate-600">no change</span>) : <span className="text-slate-600">—</span>}
          </div>
        </div>
      </div>

      <details className="mt-3" open>
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Explanation</summary>
        <div className="mt-2 bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono max-h-56 overflow-auto" data-testid="regex-explain">
          {explanation.error && <div className="text-amber-300">Cannot explain: {explanation.error}</div>}
          {!pattern ? <span className="text-slate-600">Enter a pattern.</span> : <ExplainTree nodes={explanation.nodes} />}
        </div>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Test cases ({cases.length})</summary>
        <div className="mt-2 space-y-1">
          {cases.map((c, i) => {
            const cr = caseResults[i];
            const ok = cr && !cr.timedOut ? caseVerdict(cr.count, c.expect) : null;
            return (
              <div key={i} className="flex items-center gap-1 text-xs">
                <input value={c.text} onChange={(e) => setCase(i, { text: e.target.value })} spellCheck={false} aria-label={`Test case ${i + 1}`}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-gray-200" />
                <select value={c.expect} onChange={(e) => setCase(i, { expect: e.target.value })} className="bg-slate-900 border border-slate-800 rounded px-1 py-1">
                  <option value="any">any</option><option value="match">should match</option><option value="nomatch">should not match</option>
                </select>
                <span className={`w-16 text-center ${ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-slate-500'}`}>
                  {!cr ? '…' : cr.timedOut ? 'timeout' : `${cr.count ? 'match' : 'no match'}${ok === true ? ' ✓' : ok === false ? ' ✗' : ''}`}
                </span>
                <button onClick={() => setCases((cs) => cs.filter((_, k) => k !== i))} className="text-slate-500 hover:text-gray-200" aria-label="Remove test case">x</button>
              </div>
            );
          })}
          <button onClick={() => setCases((cs) => [...cs, { text: '', expect: 'match' }])} className="text-[11px] text-cyan-300 hover:text-cyan-200">+ Add test case</button>
        </div>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Code generator</summary>
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[11px]">
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <button onClick={() => copy('code', code)} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300">
              {copied === 'code' ? <Check size={11} /> : <Copy size={11} />} Copy
            </button>
            <span className="text-[10px] text-slate-500">Other engines differ from {ENGINE_LABEL}; check lookarounds and named groups.</span>
          </div>
          <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-[11px] font-mono text-gray-300 overflow-auto max-h-64" data-testid="regex-code">{code}</pre>
        </div>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Quick reference</summary>
        <div className="mt-2 grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))] text-[11px]">
          {CHEATS.map(([tok, desc]) => (
            <div key={tok} className="flex gap-2"><code className="text-cyan-300 min-w-[4.5rem]">{tok}</code><span className="text-slate-500">{desc}</span></div>
          ))}
        </div>
      </details>
    </div>
  );
}
