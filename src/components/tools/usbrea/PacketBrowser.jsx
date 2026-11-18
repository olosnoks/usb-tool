// Packet browser for the USB Protocol RE tool: filterable, virtualised transfer list with a hexdump pane and
// the descriptors found in the capture. Only the visible rows are rendered, so 100k+ transfers stay smooth.
import React, { useMemo, useState } from 'react';
import { XFER_NAMES } from '../../../utils/usbrea/model';
import { hex } from '../../../utils/usbrea/bytes';
import { ascii, decode_setup, find_descriptors } from '../../../utils/usbrea/setupDecode';
import { endpoint_stats, wireshark_filter, transfers_to_csv, diff_bytes, render_diff } from '../../../utils/usbrea/packetTools';

const ROW_H = 20;
const VIEW_H = 340;
const COLS = 'grid-cols-[60px_80px_40px_40px_50px_44px_60px_1fr]';
const field = 'bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-xs text-gray-200 font-mono';

export function hexdump(data) {
  const lines = [];
  for (let o = 0; o < data.length; o += 16) {
    const chunk = data.subarray(o, o + 16);
    lines.push(`${o.toString(16).padStart(4, '0')}  ${hex(chunk, ' ').padEnd(47)}  ${ascii(chunk, 16)}`);
  }
  return lines.join('\n') || '(no data)';
}

/** Filter transfers; exported for tests. `f` = { device, endpoint, direction, type, hex }. */
export function filter_transfers(transfers, f) {
  const needle = (f.hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  const ep = f.endpoint === '' || f.endpoint == null ? null : Number(f.endpoint);
  return transfers.filter((t) => {
    if (f.device !== '' && f.device != null && t.device !== Number(f.device)) return false;
    if (ep !== null && (t.endpoint & 0x7f) !== ep) return false;
    if (f.direction === 'in' && !t.is_in) return false;
    if (f.direction === 'out' && !t.is_out) return false;
    if (f.type !== '' && f.type != null && t.xfer_type !== Number(f.type)) return false;
    if (needle && !hex(t.data).includes(needle) && !(t.setup && hex(t.setup).includes(needle))) return false;
    return true;
  });
}

export default function PacketBrowser({ transfers, ids }) {
  const [flt, setFlt] = useState({ device: '', endpoint: '', direction: '', type: '', hex: '' });
  const [scroll, setScroll] = useState(0);
  const [sel, setSel] = useState(null);
  const [cmp, setCmp] = useState(null);
  const t0 = useMemo(() => {
    let m = Infinity;
    for (const t of transfers) if (t.ts < m) m = t.ts;
    return Number.isFinite(m) ? m : 0;
  }, [transfers]);
  const devices = useMemo(() => [...new Set(transfers.map((t) => t.device))].sort((a, b) => a - b), [transfers]);
  const rows = useMemo(() => filter_transfers(transfers, flt), [transfers, flt]);
  const stats = useMemo(() => endpoint_stats(transfers), [transfers]);
  const wsFilter = useMemo(() => wireshark_filter(flt), [flt]);
  const descriptors = useMemo(() => find_descriptors(transfers), [transfers]);
  const idOf = (d) => {
    const i = ids instanceof Map ? ids.get(d) : ids?.[d];
    return i && i[0] != null ? `${i[0].toString(16).padStart(4, '0')}:${i[1].toString(16).padStart(4, '0')}` : null;
  };
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 5);
  const last = Math.min(rows.length, first + Math.ceil(VIEW_H / ROW_H) + 10);
  const set = (k) => (e) => { setFlt((p) => ({ ...p, [k]: e.target.value })); setScroll(0); };
  const selected = sel != null ? transfers.find((t) => t.frame === sel) : null;
  const other = cmp != null ? transfers.find((t) => t.frame === cmp) : null;
  const diff = selected && other ? render_diff(diff_bytes(other.data, selected.data)) : null;
  const dl = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const btn = 'px-2 py-1 rounded text-[11px] border bg-slate-800/60 border-slate-700 text-gray-300 hover:bg-slate-700/60 disabled:opacity-40';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 items-center text-xs text-gray-300">
        <select value={flt.device} onChange={set('device')} className={field} aria-label="Device filter">
          <option value="">All devices</option>
          {devices.map((d) => <option key={d} value={d}>#{d}{idOf(d) ? ` ${idOf(d)}` : ''}</option>)}
        </select>
        <input value={flt.endpoint} onChange={set('endpoint')} className={`${field} w-24`} placeholder="endpoint #" inputMode="numeric" />
        <select value={flt.direction} onChange={set('direction')} className={field} aria-label="Direction filter">
          <option value="">In + Out</option><option value="in">IN only</option><option value="out">OUT only</option>
        </select>
        <select value={flt.type} onChange={set('type')} className={field} aria-label="Type filter">
          <option value="">All types</option>
          {Object.entries(XFER_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={flt.hex} onChange={set('hex')} className={`${field} w-48`} placeholder="hex substring (aa 01)" />
        <span className="text-gray-500">{rows.length.toLocaleString()} of {transfers.length.toLocaleString()} transfers</span>
        <button type="button" className={btn} disabled={!rows.length} title="Download the filtered transfers as CSV" onClick={() => dl('transfers.csv', transfers_to_csv(rows, t0), 'text/csv')}>CSV</button>
        <button type="button" className={btn} disabled={!wsFilter} title="Copy a Wireshark display filter equivalent to these filters" onClick={() => navigator.clipboard?.writeText(wsFilter)}>Copy Wireshark filter</button>
      </div>
      {wsFilter && <div className="text-[11px] font-mono text-gray-500 break-all" data-testid="ws-filter">{wsFilter}</div>}
      <div className="border border-slate-800 rounded overflow-x-auto">
       <div className="min-w-[520px]">
        <div className={`grid ${COLS} gap-2 px-2 py-1 bg-slate-900/60 text-[10px] uppercase text-gray-500 font-mono`}>
          <span>Frame</span><span>Time (s)</span><span>Bus</span><span>Dev</span><span>EP</span><span>Dir</span><span>Type</span><span>Len / setup / ASCII</span>
        </div>
        <div style={{ height: VIEW_H, overflowY: 'auto' }} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} data-testid="packet-list">
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(first, last).map((t, i) => (
              <div
                key={t.frame}
                onClick={(e) => { if (e.shiftKey && sel != null && sel !== t.frame) setCmp(sel); setSel(t.frame); }}
                role="row"
                style={{ position: 'absolute', top: (first + i) * ROW_H, height: ROW_H, left: 0, right: 0 }}
                className={`grid ${COLS} gap-2 px-2 items-center text-[11px] font-mono cursor-pointer whitespace-nowrap ${sel === t.frame ? 'bg-amber-500/20 text-amber-100' : 'text-gray-300 hover:bg-slate-800/60'}`}
              >
                <span>{t.frame}</span>
                <span>{(t.ts - t0).toFixed(4)}</span>
                <span>{t.bus}</span>
                <span>{t.device}</span>
                <span>{t.endpoint & 0x7f}</span>
                <span>{t.is_in ? 'IN' : 'OUT'}</span>
                <span>{t.kind}</span>
                <span className="truncate">{t.data.length}{t.setup ? ` ${decode_setup(t.setup, t.data)}` : ''}{t.data.length ? `  ${ascii(t.data)}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
       </div>
      </div>
      {selected && (
        <div className="border border-slate-800 rounded p-2">
          <div className="text-xs text-gray-400 mb-1">
            Frame {selected.frame}: device {selected.device} {idOf(selected.device) || ''} endpoint {selected.endpoint & 0x7f} {selected.is_in ? 'IN' : 'OUT'} {selected.kind}, {selected.data.length} bytes{selected.setup ? `, setup ${hex(selected.setup, ' ')}` : ''}
          </div>
          {selected.setup && <div className="text-xs text-amber-300 font-mono mb-1">{decode_setup(selected.setup, selected.data)}</div>}
          <pre className="text-[11px] text-gray-200 overflow-auto max-h-48 whitespace-pre">{hexdump(selected.data)}</pre>
          <div className="text-[10px] text-gray-500 mt-1">Shift-click another row to diff it against the previously selected one.</div>
          {diff && (
            <div className="mt-1">
              <div className="text-xs text-gray-400">Diff: A = frame {other.frame}, B = frame {selected.frame} <button type="button" className={btn} onClick={() => setCmp(null)}>Clear diff</button></div>
              <pre className="text-[11px] text-amber-200 overflow-auto max-h-48 whitespace-pre" data-testid="packet-diff">{diff}</pre>
            </div>
          )}
        </div>
      )}
      <details className="border border-slate-800 rounded p-2">
        <summary className="text-xs font-bold text-gray-300 uppercase tracking-wider cursor-pointer">Endpoint statistics ({stats.length})</summary>
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-[11px] text-gray-300 font-mono">
            <thead><tr className="text-left text-gray-500"><th>Dev</th><th>EP</th><th>Dir</th><th>Type</th><th>Pkts</th><th>Bytes</th><th>Min/Max</th><th>Span (s)</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={`${s.device}-${s.endpoint}-${s.dir}-${s.kind}`} className="border-t border-slate-800">
                  <td>{s.device}</td><td>{s.endpoint}</td><td>{s.dir}</td><td>{s.kind}</td><td>{s.packets}</td><td>{s.bytes}</td><td>{s.min}/{s.max}</td><td>{(s.last - s.first).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="border border-slate-800 rounded p-2">
        <div className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-1">Descriptors found in capture</div>
        {descriptors.length === 0 ? (
          <div className="text-xs text-gray-500">None. Descriptors are only present if the capture started before the device was enumerated.</div>
        ) : (
          <table className="w-full text-xs text-gray-300 font-mono">
            <tbody>
              {descriptors.map((d) => (
                <tr key={d.frame} className="border-t border-slate-800 align-top cursor-pointer" onClick={() => setSel(d.frame)}>
                  <td className="py-1 pr-2">#{d.frame}</td><td className="pr-2">dev {d.device}</td><td className="pr-2">{d.kind}</td><td>{d.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
