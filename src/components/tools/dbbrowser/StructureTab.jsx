import React, { useMemo, useState } from 'react';
import { Table as TableIcon, ChevronRight, ChevronDown, Plus, Pencil, Trash2, ListTree, Eye, Zap, Copy, KeyRound, Search } from 'lucide-react';
import { btn, btnDanger, Modal } from './common.jsx';
import { TableEditor, IndexEditor, ViewEditor } from './SchemaEditors.jsx';
import { listObjects, columnsOf, parseCreateTable, scalar, qid } from '../../../utils/sqliteStudio.js';

const GROUPS = [
  { type: 'table', label: 'Tables', icon: TableIcon },
  { type: 'index', label: 'Indices', icon: ListTree },
  { type: 'view', label: 'Views', icon: Eye },
  { type: 'trigger', label: 'Triggers', icon: Zap },
];

/** Database Structure tab: schema tree + create/modify/delete. */
export default function StructureTab({ session, onBrowse }) {
  const { db, version } = session;
  const [open, setOpen] = useState({ table: true, index: false, view: true, trigger: false });
  const [expanded, setExpanded] = useState({});
  const [sel, setSel] = useState(null); // { type, name }
  const [dialog, setDialog] = useState(null); // 'createTable' | 'modifyTable' | 'createIndex' | 'createView' | 'delete'
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const objects = useMemo(() => (db ? listObjects(db).filter((o) => !o.shadow) : []), [db, version]);
  const counts = useMemo(() => {
    const out = {};
    for (const o of objects) if (o.type === 'table') { try { out[o.name] = scalar(db, `SELECT COUNT(*) FROM ${qid(o.name)}`); } catch { out[o.name] = null; } }
    return out;
  }, [db, objects]);
  const selObj = sel && objects.find((o) => o.type === sel.type && o.name === sel.name);
  const tables = objects.filter((o) => o.type === 'table').map((o) => o.name);
  const q = search.trim().toLowerCase();
  const visible = (o) => !q || o.name.toLowerCase().includes(q) || (o.tbl_name || '').toLowerCase().includes(q);

  const columnRows = (name) => {
    const parsed = parseCreateTable(objects.find((o) => o.name === name)?.sql);
    return columnsOf(db, name).map((c) => {
      const pc = parsed?.columns.find((x) => x.name === c.name);
      let schema = `${qid(c.name)} ${c.type}`.trim();
      if (pc) {
        const bits = [c.notnull && 'NOT NULL', pc.unique && 'UNIQUE', pc.default != null && `DEFAULT ${pc.default}`, pc.check && `CHECK(${pc.check})`, pc.collate && `COLLATE ${pc.collate}`, pc.fk && `REFERENCES ${pc.fk}`, pc.generated && `AS (${pc.generated.expr})`].filter(Boolean);
        if (bits.length) schema += ' ' + bits.join(' ');
      }
      return { ...c, schema };
    });
  };

  const drop = () => {
    setError('');
    try {
      session.exec(`DROP ${selObj.type.toUpperCase()} ${qid(selObj.name)}`);
      setSel(null); setDialog(null);
    } catch (e) { setError(e.message); }
  };

  const copySql = () => { if (selObj?.sql) navigator.clipboard?.writeText(selObj.sql + ';'); };
  const modifiable = selObj?.type === 'table' && !selObj.virtual && !!parseCreateTable(selObj.sql);

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <button className={btn} onClick={() => setDialog('createTable')}><Plus size={12} /> Create Table</button>
        <button className={btn} disabled={!tables.length} onClick={() => setDialog('createIndex')}><ListTree size={12} /> Create Index</button>
        <button className={btn} onClick={() => setDialog('createView')}><Eye size={12} /> Create View</button>
        <button className={btn} disabled={!modifiable} title={selObj?.type === 'table' && !modifiable ? 'This table definition cannot be edited (virtual / AS SELECT)' : ''} onClick={() => setDialog('modifyTable')}><Pencil size={12} /> Modify Table</button>
        <button className={btnDanger} disabled={!selObj} onClick={() => setDialog('delete')}><Trash2 size={12} /> Delete {selObj ? selObj.type : ''}</button>
        <button className={btn} disabled={!selObj || !['table', 'view'].includes(selObj.type)} onClick={() => onBrowse(selObj.name)}><TableIcon size={12} /> Browse</button>
        <button className={btn} disabled={!selObj?.sql} onClick={copySql}><Copy size={12} /> Copy CREATE</button>
        <div className="ml-auto relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter…" className="bg-slate-900 border border-slate-700 rounded pl-6 pr-2 py-1 text-xs w-40" />
        </div>
      </div>
      {error && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono">{error}</div>}

      <div className="border border-slate-800 rounded overflow-auto max-h-[62vh]">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900 sticky top-0 z-10">
            <tr className="text-left text-slate-400">
              <th className="px-2 py-1 font-normal w-[30%]">Name</th><th className="px-2 py-1 font-normal w-[14%]">Type</th><th className="px-2 py-1 font-normal">Schema</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(({ type, label, icon: Icon }) => {
              const items = objects.filter((o) => o.type === type && visible(o));
              return (
                <React.Fragment key={type}>
                  <tr className="bg-slate-900/60 cursor-pointer hover:bg-slate-800/60" onClick={() => setOpen((s) => ({ ...s, [type]: !s[type] }))}>
                    <td colSpan={3} className="px-2 py-1 text-gray-200">
                      <span className="inline-flex items-center gap-1">{open[type] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Icon size={12} className="text-cyan-400" /> {label} ({items.length})</span>
                    </td>
                  </tr>
                  {open[type] && items.map((o) => {
                    const isSel = sel?.type === o.type && sel?.name === o.name;
                    const exp = type === 'table' && expanded[o.name];
                    return (
                      <React.Fragment key={o.name}>
                        <tr onClick={() => setSel({ type: o.type, name: o.name })} onDoubleClick={() => ['table', 'view'].includes(type) && onBrowse(o.name)}
                          className={`cursor-default ${isSel ? 'bg-cyan-950/50' : 'hover:bg-slate-800/40'}`}>
                          <td className="px-2 py-0.5 pl-6 font-mono text-gray-100 whitespace-nowrap">
                            {type === 'table' ? (
                              <button onClick={(e) => { e.stopPropagation(); setExpanded((s) => ({ ...s, [o.name]: !s[o.name] })); }} className="mr-1 text-slate-400 align-middle">{exp ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                            ) : <span className="inline-block w-[15px]" />}
                            {o.name}
                            {type === 'table' && counts[o.name] != null && <span className="ml-2 text-slate-500">{counts[o.name].toLocaleString()} rows</span>}
                            {type === 'index' && <span className="ml-2 text-slate-500">on {o.tbl_name}</span>}
                            {o.virtual && <span className="ml-2 text-violet-400/80">virtual</span>}
                          </td>
                          <td className="px-2 py-0.5 text-slate-400">{type}</td>
                          <td className="px-2 py-0.5 font-mono text-slate-500 truncate max-w-[40rem]" title={o.sql}>{(o.sql || '').replace(/\s+/g, ' ')}</td>
                        </tr>
                        {exp && columnRows(o.name).map((c) => (
                          <tr key={c.name} onClick={() => setSel({ type: o.type, name: o.name })} className={isSel ? 'bg-cyan-950/30' : ''}>
                            <td className="px-2 py-0.5 pl-12 font-mono text-gray-300 whitespace-nowrap">{c.pk ? <KeyRound size={10} className="inline mr-1 text-amber-400" /> : null}{c.name}</td>
                            <td className="px-2 py-0.5 text-cyan-300/80">{c.type}</td>
                            <td className="px-2 py-0.5 font-mono text-slate-500 truncate max-w-[40rem]">{c.schema}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {selObj?.sql && <pre className="mt-2 bg-slate-900 border border-slate-800 rounded p-2 text-[11px] text-emerald-200/80 whitespace-pre-wrap max-h-48 overflow-auto">{selObj.sql};</pre>}

      {dialog === 'createTable' && <TableEditor session={session} table={null} onClose={(ok, name) => { setDialog(null); if (ok) setSel({ type: 'table', name }); }} />}
      {dialog === 'modifyTable' && selObj && <TableEditor session={session} table={selObj.name} onClose={(ok, name) => { setDialog(null); if (ok) setSel({ type: 'table', name }); }} />}
      {dialog === 'createIndex' && <IndexEditor session={session} tables={tables} defaultTable={selObj?.type === 'table' ? selObj.name : selObj?.tbl_name} onClose={() => setDialog(null)} />}
      {dialog === 'createView' && <ViewEditor session={session} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && selObj && (
        <Modal title={`Delete ${selObj.type}`} onClose={() => setDialog(null)}
          footer={<><button className={btn} onClick={() => setDialog(null)}>Cancel</button><button className={btnDanger} onClick={drop}><Trash2 size={12} /> Delete</button></>}>
          Are you sure you want to delete the {selObj.type} <span className="font-mono text-cyan-300">{selObj.name}</span>?
          {selObj.type === 'table' && ' All of its data, indexes and triggers will be removed.'} You can still undo this with Revert Changes until you write changes.
        </Modal>
      )}
    </div>
  );
}

