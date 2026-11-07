import React, { useMemo, useState } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';

/**
 * Regex tester (regex101-style), fully client-side — no network. Build a
 * JavaScript regular expression, see live match highlighting, capture groups
 * (including named groups and indices), a match list, and a replace preview.
 *
 * Uses the browser's own RegExp engine, so the syntax and flags are exactly
 * what the app's other tools (and any JS you write) will see.
 */

const FLAGS = [
  { f: 'g', label: 'global', desc: 'find all matches' },
  { f: 'i', label: 'ignore case', desc: 'case-insensitive' },
  { f: 'm', label: 'multiline', desc: '^ and $ match line breaks' },
  { f: 's', label: 'dotall', desc: '. matches newlines' },
  { f: 'u', label: 'unicode', desc: 'full unicode' },
  { f: 'y', label: 'sticky', desc: 'match from lastIndex' },
];

const CHEATS = [
  ['\\d', 'digit'], ['\\w', 'word char'], ['\\s', 'whitespace'], ['.', 'any char'],
  ['^ $', 'start / end'], ['[abc]', 'set'], ['[^abc]', 'negated set'], ['a|b', 'alt'],
  ['a*', '0+'], ['a+', '1+'], ['a?', '0 or 1'], ['a{2,4}', 'range'],
  ['(…)', 'group'], ['(?<n>…)', 'named'], ['(?:…)', 'non-capture'], ['\\b', 'word boundary'],
  ['(?=…)', 'lookahead'], ['(?<=…)', 'lookbehind'],
];

const MAX_MATCHES = 10000;

function runRegex(pattern, flags, text) {
  if (!pattern) return { matches: [], error: '' };
  let re;
  try { re = new RegExp(pattern, flags); } catch (e) { return { matches: [], error: e.message }; }
  const matches = [];
  if (!flags.includes('g')) {
    const m = re.exec(text);
    if (m) matches.push(m);
    return { matches, error: '', re };
  }
  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null) {
    matches.push(m);
    if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width infinite loop
    if (++guard > MAX_MATCHES) return { matches, error: `Stopped at ${MAX_MATCHES} matches.`, re };
  }
  return { matches, error: '', re };
}

/** Build highlighted segments from match ranges. */
function highlight(text, matches) {
  if (!matches.length) return [{ text, hit: false }];
  const segs = [];
  let pos = 0;
  matches.forEach((m, i) => {
    const start = m.index;
    const end = start + (m[0]?.length || 0);
    if (start > pos) segs.push({ text: text.slice(pos, start), hit: false });
    segs.push({ text: text.slice(start, end) || '∅', hit: true, i });
    pos = end;
  });
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false });
  return segs;
}

export default function RegexTesterWorkbench() {
  const [pattern, setPattern] = useState('(\\w+)@(\\w+\\.\\w+)');
  const [flags, setFlags] = useState('gim');
  const [text, setText] = useState('Contact alice@example.com or bob@test.org for details.');
  const [replacement, setReplacement] = useState('');
  const [copied, setCopied] = useState(false);

  const toggleFlag = (f) => setFlags((s) => (s.includes(f) ? s.replace(f, '') : s + f));

  const { matches, error } = useMemo(() => runRegex(pattern, flags, text), [pattern, flags, text]);
  const segments = useMemo(() => highlight(text, matches), [text, matches]);

  const replaced = useMemo(() => {
    if (!pattern || error) return '';
    try { return text.replace(new RegExp(pattern, flags), replacement); } catch { return ''; }
  }, [pattern, flags, text, replacement, error]);

  const copyPattern = () => {
    navigator.clipboard?.writeText(`/${pattern}/${flags}`);
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      {/* Pattern row */}
      <div className="flex items-stretch gap-1 mb-2 font-mono text-sm">
        <span className="flex items-center text-slate-500 px-1">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          spellCheck={false}
          placeholder="regular expression"
          className={`flex-1 bg-slate-900 border rounded px-2 py-1.5 text-cyan-300 ${error ? 'border-red-800' : 'border-slate-800'}`}
        />
        <span className="flex items-center text-slate-500 px-1">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value.replace(/[^gimsuy]/g, ''))}
          spellCheck={false}
          className="w-20 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-amber-300"
        />
        <button onClick={copyPattern} title="Copy /pattern/flags" className="px-2 bg-slate-800 rounded hover:bg-slate-700 text-gray-300">
          {copied ? <Check size={14} /> : <Copy size={14} />}
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
      </div>

      {error && (
        <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

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
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">Highlighted ({matches.length} match{matches.length === 1 ? '' : 'es'})</div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {segments.map((s, i) => s.hit
              ? <mark key={i} className="bg-cyan-500/30 text-cyan-100 rounded-sm" title={`match ${s.i + 1}`}>{s.text}</mark>
              : <span key={i} className="text-slate-400">{s.text}</span>)}
            {!text && <span className="text-slate-600">empty</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Match details</div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-48 overflow-auto text-xs font-mono">
            {matches.length === 0 && <div className="text-slate-600">No matches.</div>}
            {matches.map((m, i) => (
              <div key={i} className="mb-2 pb-2 border-b border-slate-900 last:border-0">
                <div className="text-cyan-300">#{i + 1} @ {m.index}: <span className="text-gray-200">{JSON.stringify(m[0])}</span></div>
                {m.length > 1 && Array.from({ length: m.length - 1 }, (_, g) => (
                  <div key={g} className="text-slate-400 pl-3">group {g + 1}: <span className="text-emerald-300">{m[g + 1] === undefined ? '—' : JSON.stringify(m[g + 1])}</span></div>
                ))}
                {m.groups && Object.keys(m.groups).length > 0 && Object.entries(m.groups).map(([k, v]) => (
                  <div key={k} className="text-slate-400 pl-3">{'<'}{k}{'>'}: <span className="text-purple-300">{v === undefined ? '—' : JSON.stringify(v)}</span></div>
                ))}
              </div>
            ))}
          </div>

          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">Replace</div>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            spellCheck={false}
            placeholder="replacement (use $1, $<name>)"
            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 mb-1"
          />
          <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-24 overflow-auto text-amber-200">
            {pattern && !error ? (replaced || <span className="text-slate-600">no change</span>) : <span className="text-slate-600">—</span>}
          </div>
        </div>
      </div>

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
