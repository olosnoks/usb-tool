import React, { useEffect, useMemo, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { btn, btnPrimary, input } from './common.jsx';
import { PRAGMAS, readPragmas, writePragmas } from '../../../utils/sqliteStudio.js';

/** Edit Pragmas tab. */
export default function PragmasTab({ session }) {
  const { db, version } = session;
  const current = useMemo(() => (db ? readPragmas(db) : {}), [db, version]);
  const [edits, setEdits] = useState({});
  const [msg, setMsg] = useState(null);
  useEffect(() => { setEdits({}); }, [current]);

  const changed = Object.keys(edits).filter((k) => String(edits[k]) !== String(current[k]));
  const val = (n) => (n in edits ? edits[n] : current[n]);

  const save = () => {
    setMsg(null);
    try {
      const ch = Object.fromEntries(changed.map((k) => [k, edits[k]]));
      session.mutate((d) => ({ sqls: writePragmas(d, ch) }));
      setMsg({ ok: true, text: `Saved ${changed.length} pragma(s).` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        <button className={btnPrimary} disabled={!changed.length} onClick={save}><Save size={12} /> Save</button>
        <button className={btn} disabled={!changed.length} onClick={() => setEdits({})}><Undo2 size={12} /> Reset</button>
        {msg && <span className={`ml-2 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-300'}`}>{msg.text}</span>}
        <span className="ml-auto text-[10px] text-slate-500">"file" = stored in the database file; others apply to this session only. page_size / auto_vacuum run VACUUM.</span>
      </div>
      <div className="border border-slate-800 rounded overflow-auto max-h-[62vh]">
        <table className="min-w-full text-xs">
          <tbody>
            {PRAGMAS.map((p) => {
              const v = val(p.name);
              const dirty = changed.includes(p.name);
              return (
                <tr key={p.name} className={`border-b border-slate-900 ${dirty ? 'bg-amber-950/20' : 'odd:bg-slate-900/30'}`}>
                  <td className="px-2 py-1 font-mono text-gray-200 whitespace-nowrap w-48">{p.name}{p.stored && <span className="ml-1 text-[9px] text-cyan-500/80">file</span>}</td>
                  <td className="px-2 py-1 w-56">
                    {p.kind === 'readonly' ? <span className="font-mono text-slate-400">{String(v ?? '—')}</span>
                      : p.kind === 'bool' ? <input type="checkbox" checked={!!v} onChange={(e) => setEdits({ ...edits, [p.name]: e.target.checked })} />
                      : p.kind === 'enum' ? <select value={String(v ?? '')} onChange={(e) => setEdits({ ...edits, [p.name]: e.target.value })} className={input}>{[...new Set([...p.options, String(v ?? '')])].filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
                      : p.options ? <select value={String(v ?? '')} onChange={(e) => setEdits({ ...edits, [p.name]: e.target.value })} className={input}>{p.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      : <input value={v ?? ''} onChange={(e) => setEdits({ ...edits, [p.name]: e.target.value })} className={input + ' w-32'} />}
                  </td>
                  <td className="px-2 py-1 text-slate-500">{p.help}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
