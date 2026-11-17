import React, { useMemo, useRef, useState } from 'react';
import { Hash, Calculator, Search, Copy, Check, Square, Play } from 'lucide-react';
import {
  allChecksums,
  matchExpected,
  bytesFromInput,
  parseSampleText,
  reverseCrc,
  locateCrc,
} from '../../utils/crcReverse.js';

/**
 * CRC reverse-engineering and checksum catalogue. Fully offline: nothing here touches hardware.
 * Tabs: Calculator (every catalogue CRC and simple sum of an input), Reverse (solve the model from
 * sample frames), Locate (find which byte range a CRC at the end of a frame covers).
 */

const TABS = [
  ['calc', 'Calculator', Calculator],
  ['reverse', 'Reverse', Hash],
  ['locate', 'Locate', Search],
];

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-gray-200';
const btnCls = 'px-3 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40';

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(String(text));
        setDone(true);
        setTimeout(() => setDone(false), 900);
      }}
      className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
    >
      {done ? <Check size={11} /> : <Copy size={11} />} {label}
    </button>
  );
}

function ErrorList({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="p-2 border border-red-900 rounded bg-red-950/30 text-[11px] text-red-300 space-y-0.5">
      {errors.map((e, i) => <div key={i}>{e}</div>)}
    </div>
  );
}

function Progress({ progress, onCancel }) {
  if (!progress) return null;
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400">
      <div className="flex-1 h-1.5 bg-slate-900 rounded overflow-hidden">
        <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono w-40 truncate">{progress.stage} {pct}%</span>
      <button type="button" onClick={onCancel} className={`${btnCls} bg-slate-800 text-slate-200 hover:bg-slate-700`}>
        <Square size={11} /> Cancel
      </button>
    </div>
  );
}

function CalcTab() {
  const [mode, setMode] = useState('hex');
  const [text, setText] = useState('31 32 33 34 35 36 37 38 39');
  const [expected, setExpected] = useState('');
  const [filter, setFilter] = useState('');
  const bytes = useMemo(() => {
    try {
      return { value: bytesFromInput(text, mode), error: '' };
    } catch (e) {
      return { value: null, error: e.message };
    }
  }, [text, mode]);
  const list = useMemo(() => (bytes.value ? allChecksums(bytes.value) : []), [bytes]);
  const { expected: expectedValue, matches } = useMemo(() => {
    try {
      return matchExpected(list, expected);
    } catch {
      return { expected: null, matches: [] };
    }
  }, [list, expected]);
  const matchSet = new Set(matches.map((m) => m.name));
  const visible = list.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls} aria-label="Input encoding">
          <option value="hex">Hex bytes</option>
          <option value="ascii">ASCII text</option>
        </select>
        <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Expected value (hex, optional)" aria-label="Expected checksum" className={`${inputCls} w-56`} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter algorithms" className={`${inputCls} w-44`} />
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} spellCheck={false} aria-label="Input bytes" className={`${inputCls} w-full`} />
      {bytes.error && <ErrorList errors={[bytes.error]} />}
      <div className="text-[11px] text-slate-500">
        {bytes.value ? `${bytes.value.length} byte(s).` : ''}
        {expected && (expectedValue === null
          ? ' Enter a hex value to match.'
          : ` ${matches.length} algorithm(s) produce 0x${expectedValue.toString(16)}.`)}
      </div>
      <div className="max-h-80 overflow-auto border border-slate-800 rounded">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-slate-950 text-slate-500 text-left">
            <tr><th className="px-2 py-1">Algorithm</th><th className="px-2 py-1">Width</th><th className="px-2 py-1">Value</th></tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.family + c.name} className={`border-t border-slate-900 ${matchSet.has(c.name) ? 'bg-emerald-950/40 text-emerald-300' : 'text-gray-300'}`}>
                <td className="px-2 py-0.5">{c.name}</td>
                <td className="px-2 py-0.5">{c.width}</td>
                <td className="px-2 py-0.5">0x{c.hex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReverseTab({ onLogMessage }) {
  const [layout, setLayout] = useState('tail');
  const [tailBytes, setTailBytes] = useState(2);
  const [orders, setOrders] = useState({ be: true, le: false });
  const [samplesText, setSamplesText] = useState('');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const parsed = useMemo(() => parseSampleText(samplesText, { layout, tailBytes }), [samplesText, layout, tailBytes]);

  const run = async () => {
    const chosen = Object.keys(orders).filter((k) => orders[k]);
    if (!parsed.samples.length || parsed.errors.length || !chosen.length) return;
    cancelRef.current = false;
    setRunning(true);
    setResult(null);
    try {
      const res = await reverseCrc(parsed.samples, {
        orders: chosen,
        bruteWidths: [8, 16],
        known32: true,
        onProgress: (p) => setProgress(p),
        isCancelled: () => cancelRef.current,
      });
      setResult(res);
      onLogMessage?.(`CRC reverse: ${res.candidates.length} model(s) for ${parsed.samples.length} sample(s)${res.cancelled ? ' (cancelled)' : ''}`, 'info');
    } catch (e) {
      setResult({ candidates: [], notes: [`Error: ${e.message}`], cancelled: false });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const copyAll = () => result && navigator.clipboard?.writeText(result.candidates.map((c) => c.revEng || c.name).join('\n'));
  const canRun = !running && parsed.samples.length > 0 && parsed.errors.length === 0 && Object.values(orders).some(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <label className="flex items-center gap-1">Layout
          <select value={layout} onChange={(e) => setLayout(e.target.value)} className={inputCls} aria-label="Sample layout">
            <option value="tail">frame (checksum at tail)</option>
            <option value="separate">payload:checksum</option>
          </select>
        </label>
        {layout === 'tail' && (
          <label className="flex items-center gap-1">Checksum bytes
            <select value={tailBytes} onChange={(e) => setTailBytes(Number(e.target.value))} className={inputCls} aria-label="Checksum bytes">
              {[1, 2, 3, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <span>Byte order:</span>
        {['be', 'le'].map((o) => (
          <label key={o} className="flex items-center gap-1">
            <input type="checkbox" checked={orders[o]} onChange={(e) => setOrders((s) => ({ ...s, [o]: e.target.checked }))} />
            {o === 'be' ? 'big-endian' : 'little-endian'}
          </label>
        ))}
      </div>
      <textarea
        value={samplesText}
        onChange={(e) => setSamplesText(e.target.value)}
        rows={5}
        spellCheck={false}
        aria-label="Sample frames"
        placeholder={layout === 'tail'
          ? 'One frame per line, hex. The last checksum bytes are the stored CRC.\n01 03 00 00 00 02 C4 0B\n01 03 04 00 11 22 33 44 ...'
          : 'One sample per line as payloadHex:checksumHex\n0102030405:AABB'}
        className={`${inputCls} w-full`}
      />
      <ErrorList errors={parsed.errors} />
      <div className="text-[11px] text-slate-500">
        {parsed.samples.length} sample(s). Need at least 2 for the brute-force search; 3 or more to rule out chance matches.
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!canRun} onClick={run} className={`${btnCls} bg-cyan-700 text-white hover:bg-cyan-600`}>
          <Play size={11} /> Solve
        </button>
        {!running && result && <CopyButton text={result.candidates.map((c) => c.revEng || c.name).join('\n')} label="Copy all" />}
      </div>
      <Progress progress={progress} onCancel={() => { cancelRef.current = true; }} />
      {result && (
        <div className="space-y-2">
          {result.notes.map((n, i) => <div key={i} className="text-[11px] text-slate-500">{n}</div>)}
          {result.cancelled && <div className="text-[11px] text-amber-300">Cancelled: results are partial.</div>}
          {result.candidates.length === 0 && !result.cancelled && (
            <div className="text-xs text-amber-300">No model fits every sample (catalogue, sums, brute force and width-32 known polys).</div>
          )}
          {result.candidates.map((c, i) => (
            <div key={i} className="p-2 border border-slate-800 rounded bg-slate-950 text-xs font-mono">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-emerald-300">{c.name || (c.source === 'brute' ? 'unnamed model' : c.source)}</span>
                <span className="text-slate-500">[{c.source}, {c.byteOrder ? (c.byteOrder === 'be' ? 'big-endian' : 'little-endian') : ''}]</span>
                {c.source !== 'sum' && !c.determined && <span className="text-amber-300">init/xorout not fully determined</span>}
              </div>
              {c.revEng && <div className="text-gray-300 break-all mt-1">{c.revEng}</div>}
              {c.source === 'sum' && <div className="text-gray-400 mt-1">width {c.width}; matches every sample</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocateTab() {
  const [frameText, setFrameText] = useState('');
  const [k, setK] = useState(2);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);

  const run = async () => {
    setError('');
    setResult(null);
    cancelRef.current = false;
    let frame;
    try {
      frame = bytesFromInput(frameText, 'hex');
    } catch (e) {
      setError(e.message);
      return;
    }
    setRunning(true);
    try {
      const res = await locateCrc(frame, { k, onProgress: setProgress, isCancelled: () => cancelRef.current });
      setResult({ ...res, length: frame.length });
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">
        Enter one frame. Its last <em>k</em> bytes are treated as a stored checksum; every range that ends just before them is tested against each catalogue CRC (width up to 8k bits) and each simple sum, in both byte orders.
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <label className="flex items-center gap-1">Checksum bytes
          <select value={k} onChange={(e) => setK(Number(e.target.value))} className={inputCls} aria-label="Checksum bytes for locate">
            {[1, 2, 3, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <textarea value={frameText} onChange={(e) => setFrameText(e.target.value)} rows={3} spellCheck={false} aria-label="Frame to locate" placeholder="Frame hex, e.g. AA BB 01 02 03 04 05 06 C1 2D" className={`${inputCls} w-full`} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={running || !frameText.trim()} onClick={run} className={`${btnCls} bg-cyan-700 text-white hover:bg-cyan-600`}>
          <Search size={11} /> Locate
        </button>
      </div>
      <ErrorList errors={error ? [error] : []} />
      <Progress progress={progress} onCancel={() => { cancelRef.current = true; }} />
      {result && (
        <div className="space-y-1">
          {result.cancelled && <div className="text-[11px] text-amber-300">Cancelled: results are partial.</div>}
          {result.matches.length === 0 && !result.cancelled && (
            <div className="text-xs text-amber-300">No catalogue CRC or simple sum over any range of this frame matches the trailing bytes.</div>
          )}
          {result.matches.map((m, i) => (
            <div key={i} className="p-2 border border-slate-800 rounded bg-slate-950 text-xs font-mono text-gray-200">
              {m.name} ({m.byteOrder === 'be' ? 'big-endian' : 'little-endian'}): bytes {m.start}..{m.end - 1} of {result.length}, checksum at {m.end}..{result.length - 1}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CrcReverseWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('calc');
  return (
    <div className="p-3 space-y-3 text-gray-200 font-sans">
      <div className="flex items-center gap-2">
        <Hash size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold">CRC Reverse &amp; Checksum Catalogue</h2>
        <span className="text-[10px] text-slate-500">offline, RevEng parameters</span>
      </div>
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs inline-flex items-center gap-1.5 border-b-2 ${tab === id ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === 'calc' && <CalcTab />}
      {tab === 'reverse' && <ReverseTab onLogMessage={onLogMessage} />}
      {tab === 'locate' && <LocateTab />}
    </div>
  );
}
