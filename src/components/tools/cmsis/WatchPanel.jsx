import React, { useState, useEffect } from 'react';
import { Eye, Plus, X } from 'lucide-react';
import { resolveWatch } from '../../../utils/cortexRegs';

const h8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const btn = 'flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-[11px] font-bold disabled:opacity-40';

/**
 * Watch list of 32-bit words by address or ELF symbol name. Reads go through
 * the MEM-AP, so they also work while the core runs. "Live" refreshes twice a
 * second, skipping ticks while another probe action is in progress.
 */
export default function WatchPanel({ client, guard, busyRef, busy, setError }) {
  const [expr, setExpr] = useState('');
  const [items, setItems] = useState([]); // { expr, address, value, prev, err }
  const [live, setLive] = useState(false);

  const refreshAll = async (list) => {
    const out = [];
    for (const it of list) {
      try {
        const [value] = await client.readWordsAt(it.address, 1);
        out.push({ ...it, prev: it.value, value, err: '' });
      } catch (e) {
        out.push({ ...it, err: e.message });
      }
    }
    return out;
  };

  const add = () => guard('watch', async () => {
    const address = resolveWatch(expr, client.symbols);
    if (address === null) throw new Error(`"${expr}" is not an address${client.symbols ? ' or known symbol' : ' (load an ELF to use symbol names)'}.`);
    const [item] = await refreshAll([{ expr: expr.trim(), address, value: undefined }]);
    setItems((prev) => [...prev, item]);
    setExpr('');
  });

  useEffect(() => {
    if (!live || !items.length) return undefined;
    const t = setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        setItems(await refreshAll(items));
      } catch (e) {
        setError(`Watch stopped: ${e.message}`);
        setLive(false);
      } finally {
        busyRef.current = false;
      }
    }, 500);
    return () => clearInterval(t);
  }, [live, items]);

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-bold text-[11px] text-slate-200 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-cyan-400" /> WATCH
        </span>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 text-[10px] text-slate-400" title="Re-read every watch twice a second, also while the CPU runs">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-cyan-500" /> live
          </label>
          <button onClick={() => guard('watch', async () => setItems(await refreshAll(items)))} disabled={!!busy || !items.length} className={btn}>REFRESH</button>
        </div>
      </div>
      <div className="flex gap-1">
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="0x20000100 or symbol+4"
          aria-label="Watch address or symbol"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-[11px] text-cyan-300 outline-none focus:border-cyan-500/60"
        />
        <button onClick={add} disabled={!!busy || !expr.trim()} className={btn} title="Add to the watch list"><Plus className="w-3 h-3" /> ADD</button>
      </div>
      {items.length > 0 && (
        <table className="w-full text-left text-[11px]">
          <thead className="text-[10px] text-slate-500 uppercase"><tr><th>Expr</th><th>Hex</th><th>Dec</th><th className="w-4" /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.expr}-${i}`} className="border-t border-slate-900">
                <td className="py-0.5 text-slate-400 truncate max-w-[8rem]" title={h8(it.address)}>{it.expr}</td>
                {it.err ? (
                  <td colSpan={2} className="text-rose-300">{it.err}</td>
                ) : (
                  <>
                    <td className={`font-bold ${it.prev !== undefined && it.prev !== it.value ? 'text-amber-300' : 'text-cyan-300'}`}>{h8(it.value)}</td>
                    <td className="text-slate-400">{it.value >>> 0}</td>
                  </>
                )}
                <td><button onClick={() => setItems((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${it.expr}`} className="text-slate-500 hover:text-rose-300"><X className="w-3 h-3" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
