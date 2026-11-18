import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Download, FileUp, Send, X, Search } from 'lucide-react';
import {
  resolveInput, detectFormats, decodeAs, encodeJson, splitFrames, FORMAT_LABELS, TEXT_ENCODINGS,
  FRAMINGS, toHex, toBase64,
} from '../../utils/binaryDecoder.js';
import {
  parseTemplate, decodeStruct, inspectBytes, findBytes, parsePattern, STRUCT_EXAMPLE, STRUCT_EXAMPLE_HEX, STRUCT_TYPES,
} from '../../utils/binaryStruct.js';

/**
 * Binary Payload Decoder: offline, schema-less decoding of serialized payloads.
 * Decode (protobuf, CBOR, MessagePack, BSON; COBS / COBS-R / SLIP / HDLC framing),
 * Encode (JSON to CBOR or MessagePack) and Framing (COBS / COBS-R / SLIP / HDLC).
 * Nothing leaves the browser; no hardware is involved.
 */

const PAGE = 2048;
const MAX_CHILDREN_SHOWN = 500;
const TABS = [['decode', 'Decode'], ['struct', 'Struct'], ['encode', 'Encode JSON'], ['framing', 'Framing']];
const FRAMING_OPTIONS = [['none', 'None'], ['cobs', 'COBS'], ['cobs-r', 'COBS/R'], ['slip', 'SLIP'], ['hdlc', 'HDLC-style (0x7E/0x7D)']];

const CBOR_SAMPLE_HEX = 'a3' + '6673656e736f72' + '63696d75' + '6474656d70' + 'f94d60' + '626f6b' + 'f5';
const EXAMPLES = [
  { label: 'Protobuf', text: '089601120774657374696e671a03089601', format: 'protobuf' },
  { label: 'CBOR map', text: CBOR_SAMPLE_HEX, format: 'cbor' },
  { label: 'MessagePack', text: '82a16101a16292c3c0', format: 'msgpack' },
  { label: 'BSON', text: '16000000' + '02' + '68656c6c6f00' + '06000000' + '776f726c6400' + '00', format: 'bson' },
  { label: 'SLIP frame', text: 'c001dbdcdbdd02c0', framing: 'slip' },
  { label: 'COBS frame', text: '0311220233' + '00', framing: 'cobs' },
];

const copyText = (t) => navigator.clipboard?.writeText(String(t));

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const selectCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200';
const btnCls = 'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-slate-800 text-gray-300 hover:bg-slate-700 hover:text-white disabled:opacity-40';

function Panel({ title, children, right }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const MODE_LABELS = { bytes: 'bytes', string: 'string', message: 'nested message', packed: 'packed varints' };

function NodeRow({ node, path, depth, sel, onSelect, expanded, onToggle, overrides, onMode }) {
  const children = node.children || [];
  const hasKids = children.length > 0;
  const open = expanded[path] ?? depth < 2;
  const isSel = sel && sel.path === path;
  const shown = children.slice(0, MAX_CHILDREN_SHOWN);
  const options = node.meta?.options;
  return (
    <div>
      <div
        onClick={() => onSelect({ path, offset: node.offset, length: node.length })}
        className={`flex items-start gap-1 py-0.5 pr-1 rounded cursor-pointer text-xs font-mono ${isSel ? 'bg-cyan-900/40' : 'hover:bg-slate-900'}`}
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(path, !open); }}
          className="w-3 shrink-0 text-slate-500 mt-px"
          aria-label={hasKids ? (open ? 'Collapse' : 'Expand') : undefined}
        >
          {hasKids && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </button>
        <span className="text-cyan-300 shrink-0">{node.label || '·'}</span>
        <span className="text-[10px] text-slate-500 shrink-0 px-1 border border-slate-800 rounded">{node.type}</span>
        <span className="text-gray-200 break-all min-w-0">{node.value}</span>
        {node.note && <span className="text-slate-500 text-[10px] shrink-0">{node.note}</span>}
        <span className="ml-auto text-[10px] text-slate-600 whitespace-nowrap shrink-0 pl-2">@{node.offset} +{node.length}</span>
        {options && options.length > 1 && (
          <select
            aria-label={`Interpret field ${node.label} as`}
            value={node.meta.mode}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onMode(node.offset, e.target.value)}
            className="ml-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-amber-300 shrink-0"
          >
            {options.map((o) => <option key={o} value={o}>{MODE_LABELS[o]}</option>)}
          </select>
        )}
      </div>
      {node.error && <div className="text-[11px] text-red-400 font-mono" style={{ paddingLeft: depth * 14 + 18 }}>{node.error}</div>}
      {hasKids && open && shown.map((c, i) => (
        <NodeRow
          key={`${path}.${i}`}
          node={c}
          path={`${path}.${i}`}
          depth={depth + 1}
          sel={sel}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
          overrides={overrides}
          onMode={onMode}
        />
      ))}
      {hasKids && open && children.length > MAX_CHILDREN_SHOWN && (
        <div className="text-[11px] text-slate-500 font-mono" style={{ paddingLeft: depth * 14 + 18 }}>
          ... {children.length - MAX_CHILDREN_SHOWN} more not shown (use Export JSON for everything)
        </div>
      )}
    </div>
  );
}

function Inspector({ bytes, offset }) {
  const [little, setLittle] = useState(true);
  const rows = useMemo(() => inspectBytes(bytes, offset, little), [bytes, offset, little]);
  if (offset == null || !rows.length) return <div className="text-[10px] text-slate-600">Click a byte to inspect it as integers, floats and time.</div>;
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
        <span>Inspector @{offset}</span>
        <button type="button" className={btnCls} onClick={() => setLittle((v) => !v)} title="Toggle byte order" aria-label="Toggle byte order">{little ? 'little-endian' : 'big-endian'}</button>
      </div>
      <div className="grid grid-cols-2 @md:grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] font-mono">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-1 min-w-0">
            <span className="text-slate-500 shrink-0">{r.label}</span>
            <span className="text-gray-200 break-all">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HexView({ bytes, sel, page, setPage, onPick }) {
  const pages = Math.max(1, Math.ceil(bytes.length / PAGE));
  const start = page * PAGE;
  const [query, setQuery] = useState('');
  const [qmode, setQmode] = useState('hex');
  const [hitIdx, setHitIdx] = useState(0);
  const search = useMemo(() => {
    if (!query.trim()) return { hits: [], len: 0 };
    try { return { hits: findBytes(bytes, query, qmode), len: parsePattern(query, qmode).length }; } catch (e) { return { hits: [], len: 0, error: e.message }; }
  }, [bytes, query, qmode]);
  const goHit = (i) => {
    if (!search.hits.length) return;
    const k = (i + search.hits.length) % search.hits.length;
    setHitIdx(k);
    onPick?.({ offset: search.hits[k], length: search.len });
  };
  const rows = [];
  for (let r = 0; r < PAGE / 16; r++) {
    const rowStart = start + r * 16;
    if (rowStart >= bytes.length) break;
    const cells = [];
    let ascii = '';
    for (let i = rowStart; i < rowStart + 16; i++) {
      if (i >= bytes.length) { cells.push(<span key={i} className="inline-block w-5" />); continue; }
      const b = bytes[i];
      const inSel = sel && i >= sel.offset && i < sel.offset + sel.length;
      cells.push(
        <span
          key={i}
          onClick={() => onPick?.({ offset: i, length: 1 })}
          className={`inline-block w-5 text-center cursor-pointer ${inSel ? 'bg-cyan-700 text-white rounded-sm' : 'text-gray-300 hover:bg-slate-800'}`}
        >
          {b.toString(16).padStart(2, '0')}
        </span>,
      );
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    }
    rows.push(
      <div key={rowStart} className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-slate-600 w-16 shrink-0">{rowStart.toString(16).padStart(8, '0')}</span>
        <span className="flex gap-1">{cells}</span>
        <span className="text-slate-500">{ascii}</span>
      </div>,
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
        <button className={btnCls} onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Prev</button>
        <span>page {page + 1}/{pages} · {bytes.length} B</span>
        <button className={btnCls} onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1}>Next</button>
        {sel && <span className="ml-auto text-cyan-300">@{sel.offset} +{sel.length}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Search size={11} className="text-slate-500" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHitIdx(0); }}
          onKeyDown={(e) => { if (e.key === 'Enter') goHit(e.shiftKey ? hitIdx - 1 : hitIdx); }}
          placeholder={qmode === 'hex' ? 'de ad ?? ef' : 'text'}
          aria-label="Search bytes"
          className="flex-1 min-w-[6rem] bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 font-mono text-gray-200"
        />
        <select value={qmode} onChange={(e) => { setQmode(e.target.value); setHitIdx(0); }} className={selectCls} aria-label="Search mode">
          <option value="hex">hex</option>
          <option value="text">text</option>
        </select>
        <button className={btnCls} disabled={!search.hits.length} onClick={() => goHit(hitIdx - 1)} aria-label="Previous match">Prev</button>
        <button className={btnCls} disabled={!search.hits.length} onClick={() => goHit(hitIdx + 1)} aria-label="Next match">Next</button>
        <span className="text-slate-500">{search.error ? <span className="text-red-400">{search.error}</span> : query.trim() ? `${search.hits.length}${search.hits.length >= 1000 ? '+' : ''} match(es)` : ''}</span>
      </div>
      <div className="max-h-[360px] overflow-auto font-mono text-[11px] leading-5 bg-slate-950 border border-slate-800 rounded p-1.5">
        {rows}
      </div>
      <Inspector bytes={bytes} offset={sel ? sel.offset : null} />
    </div>
  );
}

// ---------- Decode tab ----------

function DecodeTab({ onSendToFraming, handoff, handoffKey }) {
  const [source, setSource] = useState({ kind: 'text', text: EXAMPLES[0].text, name: '' });
  const [encoding, setEncoding] = useState('auto');
  const [format, setFormat] = useState('auto');
  const [framing, setFraming] = useState('none');
  const [frameIndex, setFrameIndex] = useState(0);
  const [overrides, setOverrides] = useState({});
  const [expanded, setExpanded] = useState({});
  const [sel, setSel] = useState(null);
  const [page, setPage] = useState(0);
  const [fileError, setFileError] = useState('');

  const resetView = () => { setOverrides({}); setExpanded({}); setSel(null); setPage(0); setFrameIndex(0); };

  // bytes sent from another tab (Encode / Framing) become the input
  useEffect(() => {
    if (!handoff) return;
    setSource({ kind: 'bytes', bytes: handoff.bytes, name: 'bytes from another tab' });
    setFraming('none');
    setFormat('auto');
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey]);

  const resolved = useMemo(() => {
    try {
      const r = source.kind === 'text'
        ? resolveInput({ text: source.text, encoding })
        : resolveInput({ bytes: source.bytes, encoding: 'auto' });
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [source, encoding]);

  const frames = useMemo(() => {
    if (!resolved.ok || framing === 'none') return null;
    try { return splitFrames(resolved.bytes, framing); } catch { return []; }
  }, [resolved, framing]);

  const payload = framing === 'none' ? (resolved.ok ? resolved.bytes : null) : frames?.[frameIndex]?.payload ?? null;
  const payloadError = framing !== 'none' && frames && !frames.length ? 'No frames found in the input.' : null;

  const detected = useMemo(() => (payload && payload.length ? detectFormats(payload) : []), [payload]);
  const activeFormat = format === 'auto' ? detected[0]?.format : format;

  const result = useMemo(() => {
    if (!payload || !payload.length || !activeFormat) return null;
    try {
      return { ok: true, r: decodeAs(payload, activeFormat, { overrides: activeFormat === 'protobuf' ? overrides : {} }) };
    } catch (e) {
      return { ok: false, error: e.message, offset: e.offset };
    }
  }, [payload, activeFormat, overrides]);

  const onSelect = (s) => {
    setSel({ path: s.path, offset: s.offset, length: s.length });
    setPage(Math.floor(s.offset / PAGE));
  };
  const onToggle = (path, open) => setExpanded((e) => ({ ...e, [path]: open }));
  const onMode = (offset, mode) => setOverrides((o) => ({ ...o, [offset]: mode }));

  const onFile = async (file) => {
    setFileError('');
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { setFileError('File is larger than 16 MB; not decoded.'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSource({ kind: 'bytes', bytes, name: file.name });
    resetView();
  };

  const setText = (text) => { setSource({ kind: 'text', text, name: '' }); resetView(); };
  const loadExample = (ex) => {
    setSource({ kind: 'text', text: ex.text, name: '' });
    setEncoding('auto');
    setFormat(ex.format ?? 'auto');
    setFraming(ex.framing ?? 'none');
    resetView();
  };
  const clearFile = () => { setSource({ kind: 'text', text: '', name: '' }); resetView(); };

  const jsonText = result?.ok ? JSON.stringify(result.r.json, null, 2) : '';
  const payloadHex = payload ? toHex(payload) : '';

  return (
    <div className="space-y-2">
      <Panel
        title="Input"
        right={(
          <span className="flex gap-1 flex-wrap">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} className={btnCls} onClick={() => loadExample(ex)}>{ex.label}</button>
            ))}
          </span>
        )}
      >
        {source.kind === 'text' ? (
          <textarea
            value={source.text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="Payload text"
            placeholder="Hex (with or without spaces), base64, base64url or base32 text"
            className="w-full h-20 bg-slate-900 border border-slate-800 rounded p-2 font-mono text-xs text-gray-200"
          />
        ) : (
          <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
            <FileUp size={14} className="text-cyan-400" />
            <span className="truncate">{source.name}</span>
            <span className="text-slate-500">{source.bytes.length} bytes</span>
            <button className={btnCls} onClick={clearFile}><X size={11} /> Clear file</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-400">
            <span>Text encoding</span>
            <select value={encoding} disabled={source.kind !== 'text'} onChange={(e) => { setEncoding(e.target.value); resetView(); }} className={selectCls} aria-label="Text encoding">
              {Object.entries(TEXT_ENCODINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className={`${btnCls} cursor-pointer`}>
            <FileUp size={11} /> Open file
            <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {fileError && <span className="text-red-400">{fileError}</span>}
        </div>
        <div className="text-[11px] text-slate-500 font-mono mt-2">
          {resolved.ok
            ? `${resolved.bytes.length} byte(s) · ${resolved.note}`
            : <span className="text-red-400">{resolved.error}</span>}
          {resolved.ok && resolved.candidates?.length > 0 && (
            <span className="ml-2 text-slate-600">
              candidates: {resolved.candidates.map((c) => `${c.encoding} ${Math.round(c.confidence * 100)}%`).join(', ')}
            </span>
          )}
        </div>
      </Panel>

      <Panel title="Format and framing">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-400">
            <span>Payload format</span>
            <select value={format} onChange={(e) => { setFormat(e.target.value); setOverrides({}); setExpanded({}); setSel(null); }} className={selectCls} aria-label="Payload format">
              <option value="auto">Auto-detect</option>
              {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1 text-slate-400">
            <span>Framing</span>
            <select value={framing} onChange={(e) => { setFraming(e.target.value); setFrameIndex(0); setSel(null); setOverrides({}); }} className={selectCls} aria-label="Framing">
              {FRAMING_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        {format === 'auto' && detected.length > 0 && (
          <div className="mt-2 space-y-1">
            {detected.map((d) => (
              <div key={d.format} className="flex items-center gap-2 text-[11px] font-mono">
                <span className="w-24 text-gray-300">{FORMAT_LABELS[d.format]?.split(' ')[0] || d.format}</span>
                <span className="w-12 text-cyan-300">{Math.round(d.confidence * 100)}%</span>
                <span className="h-1.5 flex-1 max-w-[160px] bg-slate-800 rounded overflow-hidden"><span className="block h-full bg-cyan-600" style={{ width: `${Math.round(d.confidence * 100)}%` }} /></span>
                <span className="text-slate-500">{d.reason}</span>
              </div>
            ))}
            <div className="text-[10px] text-slate-600">Heuristic scores, not proof. Protobuf has no schema, so a valid-looking parse is only a suggestion.</div>
          </div>
        )}
        {format === 'auto' && detected.length === 0 && payload && payload.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-300">No format recognised. Choose one explicitly, or check the framing.</div>
        )}
        {framing !== 'none' && frames && (
          <div className="mt-3">
            <div className="text-[10px] text-slate-500 mb-1">{frames.length} frame(s) found with {FRAMINGS[framing]?.label}. Click one to decode its payload.</div>
            <div className="flex flex-wrap gap-1">
              {frames.map((f, i) => (
                <button
                  key={`${f.offset}-${i}`}
                  onClick={() => { setFrameIndex(i); setSel(null); setOverrides({}); setExpanded({}); }}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono border ${i === frameIndex ? 'border-cyan-600 bg-cyan-900/40 text-cyan-200' : 'border-slate-800 bg-slate-900 text-gray-400 hover:text-gray-200'} ${f.error ? 'text-red-300' : ''}`}
                  title={f.error || ''}
                >
                  #{i} @{f.offset} · {f.payload ? f.payload.length : 0} B{f.error ? ' · error' : ''}{f.incomplete ? ' · incomplete' : ''}
                </button>
              ))}
            </div>
            {payloadError && <div className="text-amber-300 text-[11px] mt-1">{payloadError}</div>}
          </div>
        )}
      </Panel>

      {payload && payload.length > 0 && (
        <Panel
          title={`Decoded${activeFormat ? ` · ${FORMAT_LABELS[activeFormat]}` : ''}`}
          right={(
            <span className="flex gap-1 flex-wrap">
              <button className={btnCls} onClick={() => copyText(payloadHex)}><Copy size={11} /> Copy hex</button>
              <button className={btnCls} disabled={!result?.ok} onClick={() => download(`decoded-${activeFormat}.json`, jsonText, 'application/json')}><Download size={11} /> JSON</button>
              {activeFormat === 'cbor' && result?.ok && result.r.diag && (
                <button className={btnCls} onClick={() => download('decoded-cbor.diag.txt', result.r.diag, 'text/plain')}><Download size={11} /> Diagnostic</button>
              )}
              <button className={btnCls} onClick={() => onSendToFraming(payload)}><Send size={11} /> Send to Framing</button>
            </span>
          )}
        >
          {!activeFormat && <div className="text-amber-300 text-xs">Pick a format to decode.</div>}
          {result && !result.ok && (
            <div className="p-2 mb-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono">
              {activeFormat} decode failed{result.offset !== undefined ? ` at byte offset ${result.offset}` : ''}: {result.error}
            </div>
          )}
          {result?.ok && result.r.warnings.map((w) => (
            <div key={w} className="text-[11px] text-amber-300 mb-1">{w}</div>
          ))}
          {result?.ok && (
            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Tree (click a node to highlight its bytes; offsets are into the payload)</div>
                <div className="max-h-[420px] overflow-auto bg-slate-950 border border-slate-800 rounded p-1">
                  <NodeRow
                    node={result.r.root}
                    path="r"
                    depth={0}
                    sel={sel}
                    onSelect={onSelect}
                    expanded={expanded}
                    onToggle={onToggle}
                    overrides={overrides}
                    onMode={onMode}
                  />
                </div>
              </div>
              <HexView bytes={payload} sel={sel} page={page} setPage={setPage} onPick={(p) => { setSel({ path: null, ...p }); setPage(Math.floor(p.offset / PAGE)); }} />
            </div>
          )}
          {!result && activeFormat && <div className="text-xs text-slate-500">Decoding...</div>}
        </Panel>
      )}
      {!payload && framing !== 'none' && (
        <div className="text-xs text-slate-500">Select a frame above to decode its payload.</div>
      )}
    </div>
  );
}

// ---------- Encode tab ----------

const ENCODE_SAMPLE = '{\n  "sensor": "imu",\n  "temp": 21.5,\n  "ok": true,\n  "samples": [1, -2, 300],\n  "raw": { "$hex": "deadbeef" }\n}';

function EncodeTab({ onSendToDecode }) {
  const [text, setText] = useState(ENCODE_SAMPLE);
  const [format, setFormat] = useState('cbor');
  const out = useMemo(() => {
    try {
      return { ok: true, ...encodeJson(text, format) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [text, format]);

  return (
    <div className="space-y-2">
      <Panel
        title="JSON input"
        right={(
          <label className="inline-flex items-center gap-1 text-xs text-slate-400">
            <span>Output</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={selectCls} aria-label="Encode output format">
              <option value="cbor">CBOR (RFC 8949)</option>
              <option value="msgpack">MessagePack</option>
            </select>
          </label>
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="JSON to encode"
          className="w-full h-44 bg-slate-900 border border-slate-800 rounded p-2 font-mono text-xs text-gray-200"
        />
        <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          Wrappers for types JSON lacks: <span className="font-mono">{'{"$hex":"0102"}'}</span> byte string,
          {' '}<span className="font-mono">{'{"$int":"18446744073709551616"}'}</span> big integer,
          {' '}<span className="font-mono">{'{"$float":"NaN"}'}</span>,
          {' '}<span className="font-mono">{'{"$tag":1,"$value":1363896240}'}</span> (CBOR only),
          {' '}<span className="font-mono">{'{"$simple":16}'}</span> (CBOR only),
          {' '}<span className="font-mono">{'{"$ext":5,"$hex":"ff"}'}</span> (MessagePack ext).
          Other numbers use the smallest integer form, or float when fractional. MessagePack floats are always 64-bit.
        </div>
      </Panel>
      <Panel title="Output">
        {!out.ok && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono">{out.error}</div>}
        {out.ok && (
          <div className="space-y-2">
            <div className="text-xs font-mono text-gray-300 break-all">{out.hex}</div>
            <div className="text-[11px] font-mono text-slate-500 break-all">base64: {out.base64}</div>
            {out.diag && <div className="text-[11px] font-mono text-cyan-300 break-all whitespace-pre-wrap">{out.diag}</div>}
            <div className="text-[11px] text-slate-500">{out.bytes.length} byte(s) · round-trip decode: {out.roundTrip ? 'ok' : 'failed'}</div>
            <div className="flex flex-wrap gap-1">
              <button className={btnCls} onClick={() => copyText(out.hex)}><Copy size={11} /> Copy hex</button>
              <button className={btnCls} onClick={() => download(`payload.${format === 'cbor' ? 'cbor' : 'msgpack'}`, out.bytes, 'application/octet-stream')}><Download size={11} /> Download .bin</button>
              <button className={btnCls} onClick={() => onSendToDecode(out.bytes)}><Send size={11} /> Decode this</button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Framing tab ----------

const COBS_MODES = new Set(['cobs', 'cobs-r']);

function FramingTab({ onSendToDecode }) {
  const [mode, setMode] = useState('cobs-r');
  const [dir, setDir] = useState('encode');
  const [text, setText] = useState('2fa200927326');
  const [delim, setDelim] = useState(true);

  const input = useMemo(() => {
    try {
      return { ok: true, ...resolveInput({ text, encoding: 'auto' }) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [text]);

  const encoded = useMemo(() => {
    if (!input.ok || dir !== 'encode') return null;
    try {
      let enc = FRAMINGS[mode].encode(input.bytes);
      if (COBS_MODES.has(mode) && delim) {
        const withZero = new Uint8Array(enc.length + 1);
        withZero.set(enc);
        enc = withZero;
      }
      // round-trip check through the matching decoder
      const frames = splitFrames(enc, mode);
      const back = frames.length === 1 ? frames[0].payload : null;
      const same = !!back && back.length === input.bytes.length && back.every((b, i) => b === input.bytes[i]);
      return { ok: true, bytes: enc, same };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [input, mode, dir, delim]);

  const decoded = useMemo(() => {
    if (!input.ok || dir !== 'decode') return null;
    try {
      return { ok: true, frames: splitFrames(input.bytes, mode) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [input, mode, dir]);

  return (
    <div className="space-y-2">
      <Panel title="Framing">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-400">
            <span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls} aria-label="Framing mode">
              {FRAMING_OPTIONS.filter(([k]) => k !== 'none').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1 text-slate-400">
            <span>Direction</span>
            <select value={dir} onChange={(e) => setDir(e.target.value)} className={selectCls} aria-label="Direction">
              <option value="encode">Encode payload</option>
              <option value="decode">Split / decode stream</option>
            </select>
          </label>
          {COBS_MODES.has(mode) && dir === 'encode' && (
            <label className="inline-flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={delim} onChange={(e) => setDelim(e.target.checked)} />
              <span>append 0x00 frame delimiter</span>
            </label>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Framing input"
          placeholder={dir === 'encode' ? 'Payload as hex or base64' : 'Stream as hex or base64 (may hold several frames)'}
          className="w-full h-20 mt-2 bg-slate-900 border border-slate-800 rounded p-2 font-mono text-xs text-gray-200"
        />
        {!input.ok && <div className="text-red-400 text-xs mt-1">{input.error}</div>}
        <div className="text-[10px] text-slate-600 mt-1">
          {input.ok && `${input.bytes.length} byte(s) · ${input.note}. Text is treated as hex or base64 when it looks like it, otherwise as UTF-8.`}
        </div>
      </Panel>

      {encoded && (
        <Panel title={`${FRAMINGS[mode].label} encoded`}>
          {!encoded.ok && <div className="text-red-400 text-xs font-mono">{encoded.error}</div>}
          {encoded.ok && (
            <div className="space-y-2">
              <div className="font-mono text-xs text-gray-200 break-all">{toHex(encoded.bytes)}</div>
              <div className="font-mono text-[11px] text-slate-500 break-all">base64: {toBase64(encoded.bytes)}</div>
              <div className="text-[11px] text-slate-500">{encoded.bytes.length} byte(s) · round-trip through the decoder: {encoded.same ? 'ok' : 'MISMATCH'}</div>
              <div className="flex gap-1 flex-wrap">
                <button className={btnCls} onClick={() => copyText(toHex(encoded.bytes))}><Copy size={11} /> Copy hex</button>
                <button className={btnCls} onClick={() => download(`frame-${mode}.bin`, encoded.bytes, 'application/octet-stream')}><Download size={11} /> Download .bin</button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {decoded && (
        <Panel title={`${FRAMINGS[mode].label} frames`}>
          {!decoded.ok && <div className="text-red-400 text-xs font-mono">{decoded.error}</div>}
          {decoded.ok && decoded.frames.length === 0 && <div className="text-xs text-slate-500">No frames found.</div>}
          {decoded.ok && decoded.frames.map((f, i) => (
            <div key={`${f.offset}-${i}`} className="flex flex-wrap items-center gap-2 py-1 border-b border-slate-900 last:border-0 text-xs font-mono">
              <span className="text-cyan-300">#{i}</span>
              <span className="text-slate-500">@{f.offset} +{f.length}</span>
              <span className={`break-all ${f.error ? 'text-red-300' : 'text-gray-200'}`}>{f.payload ? toHex(f.payload) : ''}</span>
              {f.error && <span className="text-red-400">{f.error}</span>}
              {f.payload && f.payload.length > 0 && (
                <button className={`${btnCls} ml-auto`} onClick={() => onSendToDecode(f.payload)}><Send size={11} /> Decode payload</button>
              )}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

// ---------- Struct tab ----------

function StructTab() {
  const [hexText, setHexText] = useState(STRUCT_EXAMPLE_HEX);
  const [fileBytes, setFileBytes] = useState(null);
  const [tmpl, setTmpl] = useState(STRUCT_EXAMPLE);
  const [startAt, setStartAt] = useState('0');
  const [sel, setSel] = useState(null);
  const [page, setPage] = useState(0);
  const [fileError, setFileError] = useState('');

  const input = useMemo(() => {
    if (fileBytes) return { ok: true, bytes: fileBytes.bytes };
    try { return { ok: true, bytes: resolveInput({ text: hexText, encoding: 'auto' }).bytes }; } catch (e) { return { ok: false, error: e.message }; }
  }, [hexText, fileBytes]);
  const parsed = useMemo(() => parseTemplate(tmpl), [tmpl]);
  const start = Math.max(0, parseInt(startAt, 10) || 0);
  const result = useMemo(
    () => (input.ok ? decodeStruct(input.bytes, parsed.fields, start) : null),
    [input, parsed, start],
  );
  const onFile = async (file) => {
    setFileError('');
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { setFileError('File is larger than 16 MB.'); return; }
    setFileBytes({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    setSel(null);
    setPage(0);
  };
  const pick = (p) => { setSel({ path: null, ...p }); setPage(Math.floor(p.offset / PAGE)); };
  const exportJson = () => {
    const out = {};
    result.rows.forEach((r) => { out[r.name] = r.value; });
    download('struct-decoded.json', JSON.stringify(out, null, 2), 'application/json');
  };

  return (
    <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
      <div className="space-y-2 min-w-0">
        <Panel title="Data">
          {fileBytes ? (
            <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
              <FileUp size={14} className="text-cyan-400" />
              <span className="truncate">{fileBytes.name}</span>
              <span className="text-slate-500">{fileBytes.bytes.length} B</span>
              <button className={btnCls} onClick={() => setFileBytes(null)}><X size={11} /> Clear</button>
            </div>
          ) : (
            <textarea value={hexText} onChange={(e) => setHexText(e.target.value)} spellCheck={false} aria-label="Struct data" placeholder="Hex or base64 bytes" className="w-full h-16 bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-xs text-gray-200" />
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
            <label className={`${btnCls} cursor-pointer`}><FileUp size={11} /> Open file<input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
            <label className="inline-flex items-center gap-1 text-slate-400">
              <span>Start offset</span>
              <input value={startAt} onChange={(e) => setStartAt(e.target.value)} inputMode="numeric" aria-label="Start offset" className={`${selectCls} w-16`} />
            </label>
            {input.ok ? <span className="text-[11px] text-slate-500">{input.bytes.length} byte(s)</span> : <span className="text-red-400 text-[11px]">{input.error}</span>}
            {fileError && <span className="text-red-400 text-[11px]">{fileError}</span>}
          </div>
        </Panel>
        <Panel title="Template" right={<button className={btnCls} onClick={() => { setTmpl(STRUCT_EXAMPLE); setHexText(STRUCT_EXAMPLE_HEX); setFileBytes(null); }}>Example</button>}>
          <textarea value={tmpl} onChange={(e) => setTmpl(e.target.value)} spellCheck={false} aria-label="Struct template" className="w-full h-40 bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-xs text-gray-200" />
          {parsed.errors.map((er) => <div key={er} className="text-[11px] text-red-400 font-mono">{er}</div>)}
          <details className="mt-1 text-[11px] text-slate-500">
            <summary className="cursor-pointer">Template syntax</summary>
            <div className="mt-1 leading-relaxed font-mono">
              One field per line: name: type, name: type[n], name: type[other_field], name: type[*] (rest of data).
              Types: {STRUCT_TYPES.join(' ')}. Byte order: an endian le or endian be line, or a suffix such as u16be. Put hex, bin or dec after the type to choose the number format. char[n] and cstr are UTF-8 text, bytes[n] is raw. A # starts a comment. No nested structs, unions or conditions.
            </div>
          </details>
        </Panel>
      </div>
      <div className="space-y-2 min-w-0">
        <Panel
          title="Fields"
          right={result && result.rows.length > 0 && (
            <button className={btnCls} onClick={exportJson}><Download size={11} /> JSON</button>
          )}
        >
          {result?.rows.length === 0 && !result.error && <div className="text-xs text-slate-500">No fields yet.</div>}
          <div className="max-h-[260px] overflow-auto">
            {result?.rows.map((r) => {
              const isSel = sel && sel.offset === r.offset && sel.length === Math.max(1, r.length);
              return (
                <div
                  key={r.name}
                  onClick={() => pick({ offset: r.offset, length: Math.max(1, r.length) })}
                  className={`flex flex-wrap items-start gap-x-2 py-0.5 px-1 rounded cursor-pointer text-xs font-mono ${isSel ? 'bg-cyan-900/40' : 'hover:bg-slate-900'}`}
                >
                  <span className="text-cyan-300 shrink-0">{r.name}</span>
                  <span className="text-[10px] text-slate-500 border border-slate-800 rounded px-1 shrink-0">{r.type}</span>
                  <span className="text-gray-200 break-all min-w-0">{r.value}</span>
                  <span className="ml-auto text-[10px] text-slate-600 whitespace-nowrap">@{r.offset} +{r.length}</span>
                </div>
              );
            })}
          </div>
          {result?.error && <div className="mt-1 p-1.5 border border-red-900 rounded bg-red-950/30 text-[11px] text-red-300 font-mono">{result.error}</div>}
          {result && !result.error && input.ok && result.end < input.bytes.length && (
            <div className="mt-1 text-[11px] text-slate-500">{input.bytes.length - result.end} byte(s) after the last field are not covered.</div>
          )}
        </Panel>
        {input.ok && input.bytes.length > 0 && (
          <Panel title="Bytes"><HexView bytes={input.bytes} sel={sel} page={page} setPage={setPage} onPick={pick} /></Panel>
        )}
      </div>
    </div>
  );
}

// ---------- shell ----------

export default function BinaryDecoderWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('decode');
  const [handoff, setHandoff] = useState(null);
  const [handoffKey, setHandoffKey] = useState(0);

  // all tabs stay mounted (hidden with CSS) so that switching tabs keeps each tab's input
  const sendTo = (bytes, to) => {
    setHandoff({ bytes: new Uint8Array(bytes), to });
    setHandoffKey((k) => k + 1);
    setTab(to);
    onLogMessage?.(`Binary decoder: ${bytes.length} byte(s) sent to the ${to === 'decode' ? 'decoder' : 'framing'} tab`, 'info');
  };
  const show = (k) => (tab === k ? '' : 'hidden');

  return (
    <div className="space-y-2 text-gray-200">
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-2.5 py-1 text-xs rounded-t whitespace-nowrap ${tab === k ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center pr-1 text-[10px] text-slate-600 whitespace-nowrap hidden @lg:inline">Offline, schema-less: nothing leaves the browser</span>
      </div>
      <div className={show('decode')}>
        <DecodeTab
          onSendToFraming={(b) => sendTo(b, 'framing')}
          handoff={handoff?.to === 'decode' ? handoff : null}
          handoffKey={handoffKey}
        />
      </div>
      <div className={show('struct')}><StructTab /></div>
      <div className={show('encode')}><EncodeTab onSendToDecode={(b) => sendTo(b, 'decode')} /></div>
      <div className={show('framing')}><FramingTab onSendToDecode={(b) => sendTo(b, 'decode')} /></div>
    </div>
  );
}
