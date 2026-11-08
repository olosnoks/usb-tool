import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, AlertTriangle } from 'lucide-react';
import { Modal, btn, btnPrimary, input, label } from './common.jsx';
import { buildCreateTable, parseCreateTable, alterTable, buildCreateIndex, columnsOf, qid } from '../../../utils/sqliteStudio.js';

const TYPES = ['INTEGER', 'TEXT', 'BLOB', 'REAL', 'NUMERIC', 'ANY'];
const COLLATIONS = ['', 'BINARY', 'NOCASE', 'RTRIM'];

const newField = (n) => ({ key: Math.random(), name: n, type: 'TEXT', notnull: false, pk: 0, pkDesc: false, autoinc: false, unique: false, default: '', check: '', collate: '', fk: '', generated: null, extra: [], orig: null });

/**
 * Create / Modify Table dialog. `table` = existing table name (modify) or
 * null (create).
 */
export function TableEditor({ session, table, onClose }) {
  const db = session.db;
  const initial = useMemo(() => {
    if (!table) return { name: '', withoutRowid: false, strict: false, constraints: [], columns: [{ ...newField('id'), type: 'INTEGER', pk: 1, notnull: true }] };
    const sql = db.exec('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name = ?', [table])[0]?.values[0][0];
    const m = parseCreateTable(sql);
    if (!m) return null;
    m.columns = m.columns.map((c) => ({ ...c, key: Math.random(), orig: c.name, default: c.default ?? '', check: c.check ?? '', collate: c.collate ?? '', fk: c.fk ?? '' }));
    return m;
  }, [db, table]);

  const [model, setModel] = useState(initial);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState(null);
  const [constraintsText, setConstraintsText] = useState((initial?.constraints || []).join(',\n'));

  if (!initial) {
    return <Modal title="Modify table" onClose={onClose}>This table's definition can't be edited here (virtual table or CREATE TABLE … AS SELECT). Use Execute SQL instead.</Modal>;
  }

  const setCol = (i, patch) => setModel((m) => {
    const columns = m.columns.map((c, k) => (k === i ? { ...c, ...patch } : { ...c }));
    // keep PK ordering compact
    if ('pk' in patch) {
      const order = columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
      if (patch.pk && columns[i].pk === -1) { order.splice(order.indexOf(columns[i]), 1); order.push(columns[i]); }
      order.forEach((c, k) => { c.pk = k + 1; });
    }
    return { ...m, columns };
  });
  const move = (i, to) => setModel((m) => {
    const cols = [...m.columns]; const [c] = cols.splice(i, 1);
    const j = Math.max(0, Math.min(cols.length, to)); cols.splice(j, 0, c); setSel(j);
    return { ...m, columns: cols };
  });
  const addField = () => setModel((m) => {
    let n = 'Field1'; let k = 1;
    while (m.columns.some((c) => c.name.toLowerCase() === n.toLowerCase())) n = `Field${++k}`;
    setSel(m.columns.length);
    return { ...m, columns: [...m.columns, newField(n)] };
  });
  const removeField = (i) => setModel((m) => { const columns = m.columns.filter((_, k) => k !== i); setSel(Math.max(0, Math.min(i, columns.length - 1))); return { ...m, columns }; });

  const finalModel = { ...model, constraints: splitConstraints(constraintsText) };
  const problems = validate(finalModel, db, table);
  let preview = '';
  try { preview = buildCreateTable(finalModel); } catch (e) { preview = `-- ${e.message}`; }

  const save = () => {
    setError('');
    try {
      if (table) {
        let res;
        session.mutate((d) => { res = alterTable(d, table, finalModel); return { sql: `-- modify table ${table}\n${preview}` }; });
        if (res.warnings.length) { setWarnings(res.warnings); return; }
      } else {
        session.exec(preview);
      }
      onClose(true, finalModel.name);
    } catch (e) { setError(e.message || String(e)); }
  };

  const pkCount = model.columns.filter((c) => c.pk).length;
  const th = 'px-1.5 py-1 text-left text-[10px] uppercase tracking-wide text-slate-500 font-normal whitespace-nowrap';
  const cb = 'accent-cyan-500';

  if (warnings) {
    return (
      <Modal title="Table modified" onClose={() => onClose(true, finalModel.name)} footer={<button className={btnPrimary} onClick={() => onClose(true, finalModel.name)}>OK</button>}>
        <div className="text-amber-300 mb-2 inline-flex items-center gap-1"><AlertTriangle size={14} /> The table was changed, with these side effects:</div>
        <ul className="list-disc ml-5 text-gray-300">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </Modal>
    );
  }

  return (
    <Modal wide title={table ? `Edit table definition — ${table}` : 'Create table'} onClose={() => onClose(false)}
      footer={<>
        {problems.length > 0 && <span className="mr-auto text-amber-300 inline-flex items-center gap-1"><AlertTriangle size={13} /> {problems[0]}</span>}
        <button className={btn} onClick={() => onClose(false)}>Cancel</button>
        <button className={btnPrimary} disabled={problems.length > 0} onClick={save}>{table ? 'Save' : 'Create'}</button>
      </>}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className={label}>Table name</span>
        <input autoFocus value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value })} className={input + ' w-64'} placeholder="table name" />
        <label className="inline-flex items-center gap-1"><input type="checkbox" className={cb} checked={!!model.withoutRowid} onChange={(e) => setModel({ ...model, withoutRowid: e.target.checked })} /> Without Rowid</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" className={cb} checked={!!model.strict} onChange={(e) => setModel({ ...model, strict: e.target.checked })} /> Strict</label>
      </div>

      <div className="flex items-center gap-1 mb-1">
        <button className={btn} onClick={addField}><Plus size={12} /> Add field</button>
        <button className={btn} disabled={!model.columns.length} onClick={() => removeField(sel)}><Trash2 size={12} /> Remove</button>
        <button className={btn} disabled={sel === 0} onClick={() => move(sel, 0)} title="Move to top"><ChevronsUp size={12} /></button>
        <button className={btn} disabled={sel === 0} onClick={() => move(sel, sel - 1)} title="Move up"><ArrowUp size={12} /></button>
        <button className={btn} disabled={sel >= model.columns.length - 1} onClick={() => move(sel, sel + 1)} title="Move down"><ArrowDown size={12} /></button>
        <button className={btn} disabled={sel >= model.columns.length - 1} onClick={() => move(sel, model.columns.length - 1)} title="Move to bottom"><ChevronsDown size={12} /></button>
      </div>
      <div className="overflow-auto border border-slate-800 rounded mb-3 max-h-[38vh]">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900 sticky top-0">
            <tr>
              <th className={th}>Name</th><th className={th}>Type</th>
              <th className={th} title="Not null">NN</th><th className={th} title="Primary key">PK</th><th className={th} title="Autoincrement">AI</th><th className={th} title="Unique">U</th>
              <th className={th}>Default</th><th className={th}>Check</th><th className={th}>Collation</th><th className={th}>Foreign key</th>
            </tr>
          </thead>
          <tbody>
            {model.columns.map((c, i) => (
              <tr key={c.key} onClick={() => setSel(i)} className={i === sel ? 'bg-cyan-950/40' : 'odd:bg-slate-900/30'}>
                <td className="px-1 py-0.5"><input value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} className={input + ' w-36'} />
                  {c.orig && c.orig !== c.name && <div className="text-[9px] text-amber-400/80">was {c.orig}</div>}
                  {c.generated && <div className="text-[9px] text-violet-400/80">generated: {c.generated.expr}</div>}</td>
                <td className="px-1 py-0.5"><input list="sqlb-types" value={c.type} onChange={(e) => setCol(i, { type: e.target.value })} className={input + ' w-28'} /></td>
                <td className="px-1.5 text-center"><input type="checkbox" className={cb} checked={!!c.notnull} onChange={(e) => setCol(i, { notnull: e.target.checked })} /></td>
                <td className="px-1.5 text-center whitespace-nowrap"><input type="checkbox" className={cb} checked={!!c.pk} onChange={(e) => setCol(i, { pk: e.target.checked ? -1 : 0, autoinc: e.target.checked ? c.autoinc : false })} />{pkCount > 1 && c.pk ? <sup className="text-slate-500 ml-0.5">{c.pk}</sup> : null}</td>
                <td className="px-1.5 text-center"><input type="checkbox" className={cb} checked={!!c.autoinc} disabled={!c.pk || pkCount !== 1} onChange={(e) => setCol(i, { autoinc: e.target.checked, type: e.target.checked ? 'INTEGER' : c.type })} /></td>
                <td className="px-1.5 text-center"><input type="checkbox" className={cb} checked={!!c.unique} onChange={(e) => setCol(i, { unique: e.target.checked })} /></td>
                <td className="px-1 py-0.5"><input value={c.default} onChange={(e) => setCol(i, { default: e.target.value })} className={input + ' w-28'} placeholder="" /></td>
                <td className="px-1 py-0.5"><input value={c.check} onChange={(e) => setCol(i, { check: e.target.value })} className={input + ' w-32'} placeholder="expr" /></td>
                <td className="px-1 py-0.5"><select value={c.collate} onChange={(e) => setCol(i, { collate: e.target.value })} className={input}>{[...new Set([...COLLATIONS, c.collate])].map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select></td>
                <td className="px-1 py-0.5"><input value={c.fk} onChange={(e) => setCol(i, { fk: e.target.value })} className={input + ' w-40'} placeholder="table(col) ON DELETE …" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="sqlb-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <div className={label + ' mb-1'}>Table constraints (one per line, e.g. <span className="font-mono">UNIQUE(a, b)</span>, <span className="font-mono">FOREIGN KEY(x) REFERENCES t(id)</span>)</div>
          <textarea value={constraintsText} onChange={(e) => setConstraintsText(e.target.value)} rows={5} spellCheck={false} className={input + ' w-full resize-y'} />
        </div>
        <div>
          <div className={label + ' mb-1'}>SQL</div>
          <pre className="bg-slate-900 border border-slate-800 rounded p-2 text-[11px] text-emerald-200/90 whitespace-pre-wrap max-h-40 overflow-auto">{preview}</pre>
        </div>
      </div>
      {table && <div className="mt-2 text-[10px] text-slate-500">Renames use ALTER TABLE RENAME so indexes, triggers and views follow. Other changes rebuild the table (copy rows into a new definition) inside a savepoint — rolled back if anything fails.</div>}
      {error && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono">{error}</div>}
    </Modal>
  );
}

function splitConstraints(text) {
  // split on top-level commas/newlines
  const out = []; let d = 0; let cur = '';
  for (const ch of text) {
    if (ch === '(') d++; if (ch === ')') d--;
    if ((ch === ',' || ch === '\n') && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function validate(model, db, table) {
  const p = [];
  if (!model.name.trim()) p.push('Enter a table name');
  else if (!table || model.name.toLowerCase() !== table.toLowerCase()) {
    const exists = db.exec('SELECT 1 FROM sqlite_master WHERE name = ? COLLATE NOCASE', [model.name])[0];
    if (exists) p.push(`An object named "${model.name}" already exists`);
  }
  if (/^sqlite_/i.test(model.name)) p.push('Names starting with sqlite_ are reserved');
  if (!model.columns.length) p.push('Add at least one field');
  const seen = new Set();
  for (const c of model.columns) {
    if (!c.name.trim()) { p.push('Every field needs a name'); break; }
    if (seen.has(c.name.toLowerCase())) { p.push(`Duplicate field name "${c.name}"`); break; }
    seen.add(c.name.toLowerCase());
  }
  const pk = model.columns.filter((c) => c.pk);
  if (model.columns.some((c) => c.autoinc) && (pk.length !== 1 || !/^INTEGER$/i.test(pk[0].type.trim()))) p.push('AUTOINCREMENT needs a single INTEGER primary key');
  if (model.withoutRowid && !pk.length) p.push('WITHOUT ROWID tables need a primary key');
  if (model.withoutRowid && model.columns.some((c) => c.autoinc)) p.push('AUTOINCREMENT is not allowed on WITHOUT ROWID tables');
  if (model.strict) {
    const bad = model.columns.find((c) => !c.generated && !/^(INT|INTEGER|REAL|TEXT|BLOB|ANY)$/i.test(c.type.trim()));
    if (bad) p.push(`STRICT tables only allow INT, INTEGER, REAL, TEXT, BLOB or ANY ("${bad.name}")`);
  }
  return p;
}

/** Create Index dialog. */
export function IndexEditor({ session, tables, defaultTable, onClose }) {
  const db = session.db;
  const [table, setTable] = useState(defaultTable || tables[0] || '');
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [cols, setCols] = useState([]); // [{name, desc}]
  const [where, setWhere] = useState('');
  const [error, setError] = useState('');
  const available = useMemo(() => (table ? columnsOf(db, table).filter((c) => !c.hidden).map((c) => c.name) : []), [db, table]);
  const effName = name || (table && cols.length ? `idx_${table}_${cols.map((c) => c.name).join('_')}` : '');
  const sql = table && cols.length ? buildCreateIndex({ name: effName, table, unique, columns: cols, where }) : '';
  const toggle = (c) => setCols((cs) => (cs.some((x) => x.name === c) ? cs.filter((x) => x.name !== c) : [...cs, { name: c, desc: false }]));
  const save = () => { try { session.exec(sql); onClose(true); } catch (e) { setError(e.message); } };
  return (
    <Modal title="Create index" onClose={() => onClose(false)} footer={<><button className={btn} onClick={() => onClose(false)}>Cancel</button><button className={btnPrimary} disabled={!sql} onClick={save}>Create</button></>}>
      <div className="grid grid-cols-[7rem_1fr] gap-2 items-center mb-3">
        <span className={label}>Index name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={effName || 'idx_…'} className={input} />
        <span className={label}>Table</span>
        <select value={table} onChange={(e) => { setTable(e.target.value); setCols([]); }} className={input}>{tables.map((t) => <option key={t}>{t}</option>)}</select>
        <span className={label}>Unique</span><label className="inline-flex items-center gap-1"><input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> UNIQUE</label>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className={label + ' mb-1'}>Table columns (click to add)</div>
          <div className="border border-slate-800 rounded max-h-48 overflow-auto">
            {available.map((c) => (
              <button key={c} onClick={() => toggle(c)} className={`w-full text-left px-2 py-1 font-mono ${cols.some((x) => x.name === c) ? 'text-slate-600' : 'text-gray-200 hover:bg-slate-800'}`}>{c}</button>
            ))}
          </div>
        </div>
        <div>
          <div className={label + ' mb-1'}>Index columns (in order)</div>
          <div className="border border-slate-800 rounded max-h-48 overflow-auto">
            {cols.map((c, i) => (
              <div key={c.name} className="flex items-center gap-1 px-2 py-1">
                <span className="font-mono flex-1">{c.name}</span>
                <select value={c.desc ? 'DESC' : 'ASC'} onChange={(e) => setCols((cs) => cs.map((x, k) => (k === i ? { ...x, desc: e.target.value === 'DESC' } : x)))} className={input}><option>ASC</option><option>DESC</option></select>
                <button className="text-slate-400 disabled:opacity-30" disabled={i === 0} onClick={() => setCols((cs) => { const n = [...cs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><ArrowUp size={12} /></button>
                <button className="text-slate-400 hover:text-red-300" onClick={() => toggle(c.name)}><Trash2 size={12} /></button>
              </div>
            ))}
            {!cols.length && <div className="px-2 py-2 text-slate-600">None yet.</div>}
          </div>
        </div>
      </div>
      <div className="mb-2"><div className={label + ' mb-1'}>Partial index WHERE clause (optional)</div><input value={where} onChange={(e) => setWhere(e.target.value)} className={input + ' w-full'} placeholder="e.g. deleted = 0" /></div>
      {sql && <pre className="bg-slate-900 border border-slate-800 rounded p-2 text-[11px] text-emerald-200/90 whitespace-pre-wrap">{sql}</pre>}
      {error && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono">{error}</div>}
    </Modal>
  );
}

/** Create View dialog (optionally prefilled with a SELECT). */
export function ViewEditor({ session, initialSelect = '', onClose }) {
  const [name, setName] = useState('');
  const [select, setSelect] = useState(initialSelect.replace(/;\s*$/, ''));
  const [error, setError] = useState('');
  const sql = name.trim() && select.trim() ? `CREATE VIEW ${qid(name.trim())} AS ${select.trim()}` : '';
  const save = () => { try { session.exec(sql); onClose(true); } catch (e) { setError(e.message); } };
  return (
    <Modal title="Create view" onClose={() => onClose(false)} footer={<><button className={btn} onClick={() => onClose(false)}>Cancel</button><button className={btnPrimary} disabled={!sql} onClick={save}>Create</button></>}>
      <div className="grid grid-cols-[5rem_1fr] gap-2 items-start">
        <span className={label + ' pt-1'}>View name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} />
        <span className={label + ' pt-1'}>SELECT</span><textarea value={select} onChange={(e) => setSelect(e.target.value)} rows={6} spellCheck={false} className={input + ' resize-y'} placeholder="SELECT … FROM …" />
      </div>
      {error && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono">{error}</div>}
    </Modal>
  );
}
