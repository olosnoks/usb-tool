import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';

export const btn = 'px-2.5 py-1 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1 whitespace-nowrap';
export const btnPrimary = 'px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1 whitespace-nowrap';
export const btnDanger = 'px-2.5 py-1 bg-red-950/40 border border-red-900 text-red-200 rounded text-xs hover:bg-red-900/50 disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1 whitespace-nowrap';
export const input = 'bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-gray-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-700';
export const label = 'text-[11px] text-slate-400';

export function downloadText(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Read a user-picked file via a transient <input type=file>. */
export function pickFile(accept, { multiple = false } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file'; el.accept = accept || ''; el.multiple = multiple;
    el.onchange = () => resolve(multiple ? Array.from(el.files || []) : el.files?.[0] || null);
    el.click();
  });
}

export function cellPreview(v) {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'italic text-slate-600' };
  if (v instanceof Uint8Array) return { text: `BLOB (${v.length} B)`, cls: 'italic text-violet-400/80' };
  if (typeof v === 'number') return { text: String(v), cls: 'text-amber-200/90 text-right' };
  const s = String(v);
  return { text: s.length > 300 ? s.slice(0, 300) + '…' : s.replace(/\n/g, '⏎'), cls: 'text-gray-200' };
}

export const valueType = (v) => (v === null || v === undefined ? 'NULL' : v instanceof Uint8Array ? 'BLOB' : typeof v === 'number' ? (Number.isInteger(v) ? 'INTEGER' : 'REAL') : 'TEXT');

export const valueText = (v) => (v === null || v === undefined ? '' : v instanceof Uint8Array ? Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('') : String(v));

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`bg-slate-950 border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[92vh] w-full ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="text-sm text-cyan-300">{title}</div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={16} /></button>
        </div>
        <div className="p-4 overflow-auto text-xs text-gray-200">{children}</div>
        {footer && <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** A small dropdown menu: items = [{ label, icon, onClick, disabled, sep }]. */
export function Menu({ label: text, icon: Icon, items, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className={btn} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {Icon && <Icon size={13} />} {text} <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[14rem] bg-slate-900 border border-slate-700 rounded shadow-xl py-1">
          {items.map((it, i) => (it.sep ? <div key={i} className="my-1 border-t border-slate-800" /> : (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-2">
              {it.icon && <it.icon size={13} className="text-slate-400" />} {it.label}
              {it.hint && <span className="ml-auto text-[10px] text-slate-500">{it.hint}</span>}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

/** Read-only grid for query results. */
export function ResultGrid({ columns, rows, maxHeight = '45vh', onCellClick, selected }) {
  return (
    <div className="overflow-auto border border-slate-800 rounded" style={{ maxHeight }}>
      <table className="text-xs font-mono border-collapse min-w-full">
        <thead className="sticky top-0 bg-slate-900 z-10">
          <tr>
            <th className="px-2 py-1 text-right text-slate-600 border-b border-r border-slate-800 w-10">#</th>
            {columns.map((c, i) => <th key={i} className="px-2 py-1 text-left text-slate-300 border-b border-r border-slate-800 whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-slate-900/30">
              <td className="px-2 py-0.5 text-right text-slate-600 border-b border-r border-slate-900">{ri + 1}</td>
              {r.map((v, ci) => {
                const p = cellPreview(v);
                const sel = selected && selected.r === ri && selected.c === ci;
                return (
                  <td key={ci} onClick={() => onCellClick?.(ri, ci)} title={typeof v === 'string' ? v.slice(0, 2000) : undefined}
                    className={`px-2 py-0.5 border-b border-r border-slate-900 max-w-[24rem] truncate ${p.cls} ${sel ? 'outline outline-1 outline-cyan-500 bg-cyan-950/40' : ''}`}>{p.text}</td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length + 1} className="px-2 py-4 text-center text-slate-600">No rows.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa'];

/** Simple SVG plot of tabular data (line / points / bars). */
export function Plot({ columns, rows }) {
  const numericCols = useMemo(() => columns.map((c, i) => ({ c, i })).filter(({ i }) => rows.some((r) => typeof r[i] === 'number')), [columns, rows]);
  const [x, setX] = useState(-1); // -1 = row number
  const [ys, setYs] = useState(() => numericCols.slice(0, 1).map((n) => n.i));
  const [kind, setKind] = useState('line');
  useEffect(() => { setYs((cur) => { const ok = cur.filter((i) => numericCols.some((n) => n.i === i)); return ok.length ? ok : numericCols.slice(0, 1).map((n) => n.i); }); }, [numericCols]);

  const W = 760; const H = 260; const P = { l: 52, r: 12, t: 10, b: 28 };
  const xNumeric = x < 0 || rows.every((r) => typeof r[x] === 'number' || r[x] === null);
  const pts = rows.map((r, idx) => ({ x: x < 0 ? idx + 1 : r[x], ys: ys.map((yi) => (typeof r[yi] === 'number' ? r[yi] : null)) }));
  const xs = xNumeric ? pts.map((p) => p.x).filter((v) => typeof v === 'number') : pts.map((_, i) => i);
  const allY = pts.flatMap((p) => p.ys).filter((v) => v !== null);
  if (!numericCols.length) return <div className="text-xs text-slate-500 p-2">No numeric columns to plot.</div>;
  const xmin = Math.min(...xs); const xmax = Math.max(...xs);
  let ymin = Math.min(0, ...allY); let ymax = Math.max(...allY, 1);
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const sx = (v, i) => P.l + ((xNumeric ? v : i) - xmin) / ((xmax - xmin) || 1) * (W - P.l - P.r);
  const sy = (v) => H - P.b - (v - ymin) / (ymax - ymin) * (H - P.t - P.b);
  const ticks = (a, b, n = 5) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const fmt = (v) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(1) : +v.toFixed(2));
  const order = pts.map((p, i) => ({ p, i })).filter(({ p }) => !xNumeric || typeof p.x === 'number').sort((a, b) => (xNumeric ? a.p.x - b.p.x : a.i - b.i));
  const bw = Math.max(1, (W - P.l - P.r) / Math.max(1, order.length) / Math.max(1, ys.length) * 0.8);

  return (
    <div className="border border-slate-800 rounded p-2 bg-slate-950">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <span className={label}>X</span>
        <select value={x} onChange={(e) => setX(+e.target.value)} className={input}>
          <option value={-1}>(row number)</option>
          {columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
        </select>
        <span className={label}>Y</span>
        {numericCols.map(({ c, i }, k) => (
          <label key={i} className="inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={ys.includes(i)} onChange={(e) => setYs((s) => (e.target.checked ? [...s, i] : s.filter((v) => v !== i)))} />
            <span style={{ color: ys.includes(i) ? PALETTE[ys.indexOf(i) % PALETTE.length] : undefined }}>{c}</span>
          </label>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={input + ' ml-auto'}>
          <option value="line">Line</option><option value="points">Points</option><option value="bars">Bars</option>
        </select>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {ticks(ymin, ymax).map((t, i) => (
          <g key={i}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="#1e293b" /><text x={P.l - 4} y={sy(t) + 3} fontSize="9" fill="#64748b" textAnchor="end">{fmt(t)}</text></g>
        ))}
        {xNumeric && ticks(xmin, xmax).map((t, i) => <text key={i} x={sx(t)} y={H - P.b + 14} fontSize="9" fill="#64748b" textAnchor="middle">{fmt(t)}</text>)}
        <line x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} stroke="#334155" />
        <line x1={P.l} x2={W - P.r} y1={sy(Math.max(ymin, 0))} y2={sy(Math.max(ymin, 0))} stroke="#334155" />
        {ys.map((yi, k) => {
          const color = PALETTE[k % PALETTE.length];
          const seq = order.map(({ p, i }) => ({ X: sx(p.x, i), v: p.ys[k] })).filter((q) => q.v !== null);
          if (kind === 'line') return <polyline key={yi} fill="none" stroke={color} strokeWidth="1.5" points={seq.map((q) => `${q.X},${sy(q.v)}`).join(' ')} />;
          if (kind === 'points') return <g key={yi}>{seq.map((q, j) => <circle key={j} cx={q.X} cy={sy(q.v)} r="2.5" fill={color} />)}</g>;
          return <g key={yi}>{seq.map((q, j) => { const y0 = sy(Math.max(ymin, 0)); const y1 = sy(q.v); return <rect key={j} x={q.X - (bw * ys.length) / 2 + k * bw} width={bw} y={Math.min(y0, y1)} height={Math.abs(y0 - y1)} fill={color} opacity="0.85" />; })}</g>;
        })}
      </svg>
    </div>
  );
}
