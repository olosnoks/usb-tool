import React, { useEffect, useState } from 'react';
import { Download, Upload, Ban, Check } from 'lucide-react';
import { btn, btnPrimary, input, valueType, valueText, pickFile } from './common.jsx';
import { detectBlobType, looksLikeText, hexDump } from '../../../utils/sqliteStudio.js';

const MODES = ['Text', 'JSON', 'Binary', 'Image'];

function autoMode(v) {
  if (v instanceof Uint8Array) return detectBlobType(v)?.startsWith('image/') ? 'Image' : looksLikeText(v) ? 'Text' : 'Binary';
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { JSON.parse(v); return 'JSON'; } catch { /* not json */ } }
  return 'Text';
}

/** DB4S's "Edit Database Cell" dock. */
export default function EditCellPanel({ cell, editable, onApply }) {
  const v = cell?.value;
  const [mode, setMode] = useState('Text');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [imgUrl, setImgUrl] = useState(null);

  useEffect(() => {
    const m = autoMode(v);
    setMode(m); setErr('');
    if (v instanceof Uint8Array) setText(looksLikeText(v) ? new TextDecoder().decode(v) : '');
    else if (m === 'JSON') setText(JSON.stringify(JSON.parse(v), null, 2));
    else setText(v === null || v === undefined ? '' : String(v));
  }, [cell?.value, cell?.column]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!(v instanceof Uint8Array) || mode !== 'Image') { setImgUrl(null); return undefined; }
    const url = URL.createObjectURL(new Blob([v], { type: detectBlobType(v) || 'image/png' }));
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [v, mode]);

  const apply = () => {
    setErr('');
    if (mode === 'JSON') { try { JSON.parse(text); } catch (e) { setErr(`Invalid JSON: ${e.message}`); return; } }
    if (mode === 'Binary' || mode === 'Image') return; // nothing to apply from the read-only views
    onApply(text);
  };
  const importFile = async () => {
    const f = await pickFile('');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    onApply(mode === 'Text' && looksLikeText(bytes) ? new TextDecoder().decode(bytes) : bytes);
  };
  const exportFile = () => {
    if (v === null || v === undefined) return;
    const t = v instanceof Uint8Array ? detectBlobType(v) : null;
    const ext = t ? t.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg') : v instanceof Uint8Array ? 'bin' : mode === 'JSON' ? 'json' : 'txt';
    const blob = new Blob([v instanceof Uint8Array ? v : String(v)], { type: t || 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cell.column || 'cell'}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="border border-slate-800 rounded bg-slate-900/40 p-2 text-xs flex flex-col max-h-[64vh]">
      <div className="text-[11px] uppercase tracking-wide text-cyan-400 mb-1">Edit Database Cell</div>
      {!cell ? <div className="text-slate-600">Select a cell.</div> : (
        <>
          <div className="flex items-center gap-1 mb-1">
            <span className="font-mono text-gray-300 truncate" title={cell.column}>{cell.column}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={input + ' ml-auto'}>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="text-[10px] text-slate-500 mb-1">Type of data currently in cell: <span className="text-gray-300">{valueType(v)}</span>{v instanceof Uint8Array ? ` · ${v.length.toLocaleString()} bytes` : typeof v === 'string' ? ` · ${v.length.toLocaleString()} chars` : ''}{cell.type ? ` · column ${cell.type}` : ''}</div>
          {mode === 'Image' ? (
            imgUrl ? <div className="flex-1 overflow-auto bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:16px_16px] rounded p-1"><img src={imgUrl} alt="" className="max-w-full" /></div> : <div className="text-slate-600">Not an image.</div>
          ) : mode === 'Binary' ? (
            <pre className="flex-1 overflow-auto bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-gray-300 whitespace-pre">{v instanceof Uint8Array ? hexDump(v) : hexDump(new TextEncoder().encode(valueText(v)))}</pre>
          ) : (
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); apply(); } }}
              readOnly={!editable} spellCheck={false} className="flex-1 min-h-[12rem] bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-[11px] text-gray-200 resize-none focus:outline-none focus:border-cyan-800" />
          )}
          {err && <div className="mt-1 text-red-300">{err}</div>}
          <div className="flex flex-wrap gap-1 mt-2">
            <button className={btnPrimary} disabled={!editable || mode === 'Binary' || mode === 'Image'} onClick={apply} title="Ctrl+Enter"><Check size={12} /> Apply</button>
            <button className={btn} disabled={!editable || v === null} onClick={() => onApply(null)}><Ban size={12} /> Set as NULL</button>
            <button className={btn} disabled={!editable} onClick={importFile} title="Load a file into this cell"><Upload size={12} /> Import</button>
            <button className={btn} disabled={v === null || v === undefined} onClick={exportFile}><Download size={12} /> Export</button>
          </div>
        </>
      )}
    </div>
  );
}

