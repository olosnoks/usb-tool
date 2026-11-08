import React, { useMemo, useState } from 'react';
import { FileUp, Download } from 'lucide-react';
import JSZip from 'jszip';
import { Modal, btn, btnPrimary, input, label, ResultGrid, downloadText } from './common.jsx';
import { downloadBytes } from './useDbSession.js';
import { parseCsv, importRows, listObjects, dumpSql, toCsv, exportJson, queryAll, qid } from '../../../utils/sqliteStudio.js';

const SEPS = [[',', 'Comma ,'], [';', 'Semicolon ;'], ['\t', 'Tab'], ['|', 'Pipe |'], ['other', 'Other…']];
const QUOTES = [['"', 'Double "'], ["'", "Single '"], ['', 'None']];
const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'iso-8859-15', 'shift_jis', 'gbk', 'big5', 'koi8-r'];

/** Import > Table from CSV file. */
export function ImportCsvDialog({ session, onClose }) {
  const db = session.db;
  const [file, setFile] = useState(null);
  const [raw, setRaw] = useState(null);
  const [encoding, setEncoding] = useState('utf-8');
  const [header, setHeader] = useState(true);
  const [sep, setSep] = useState(',');
  const [otherSep, setOtherSep] = useState('');
  const [quote, setQuote] = useState('"');
  const [trim, setTrim] = useState(true);
  const [emptyAsNull, setEmptyAsNull] = useState(false);
  const [inferTypes, setInferTypes] = useState(true);
  const [table, setTable] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const tables = useMemo(() => listObjects(db).filter((o) => o.type === 'table' && !o.shadow).map((o) => o.name), [db, session.version]);
  const separator = sep === 'other' ? otherSep : sep;
  const text = useMemo(() => {
    if (!raw) return '';
    try { return new TextDecoder(encoding).decode(raw); } catch { return new TextDecoder().decode(raw); }
  }, [raw, encoding]);
  const parsed = useMemo(() => {
    if (!text || !separator) return null;
    try { return parseCsv(text, { separator, quote, trim }); } catch (e) { return { err: e.message }; }
  }, [text, separator, quote, trim]);
  const width = parsed && !parsed.err && parsed.length ? Math.max(...parsed.map((r) => r.length)) : 0;
  const previewCols = width ? Array.from({ length: width }, (_, i) => (header ? parsed[0][i] || `field${i + 1}` : `field${i + 1}`)) : [];
  const previewRows = parsed && !parsed.err ? parsed.slice(header ? 1 : 0, (header ? 1 : 0) + 20).map((r) => previewCols.map((_, i) => r[i] ?? null)) : [];
  const exists = tables.some((t) => t.toLowerCase() === table.trim().toLowerCase());

  const choose = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setDone(null); setError('');
    const buf = new Uint8Array(await f.arrayBuffer());
    // BOM sniffing for the default encoding
    const enc = buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be' : 'utf-8';
    setEncoding(enc); setRaw(buf);
    const t = new TextDecoder(enc).decode(buf);
    const first = t.split(/\r?\n/, 1)[0] || '';
    if (/\.tsv$/i.test(f.name) || (first.split('\t').length > first.split(',').length)) setSep('\t');
    else if (first.split(';').length > first.split(',').length) setSep(';');
    else setSep(',');
    setTable(f.name.replace(/\.[^.]*$/, '').replace(/[^\w]+/g, '_') || 'imported');
  };

  const run = () => {
    setError('');
    try {
      let r;
      session.mutate((d) => { r = importRows(d, table.trim(), parsed, { header, inferTypes, emptyAsNull }); return { sql: `-- import ${file.name} into ${table.trim()} (${r.rows} rows)\n${r.sql}` }; });
      setDone(r);
    } catch (e) { setError(e.message); }
  };

  return (
    <Modal wide title="Import CSV file" onClose={() => onClose(false)}
      footer={done ? <button className={btnPrimary} onClick={() => onClose(true, table.trim())}>Done</button> : <><button className={btn} onClick={() => onClose(false)}>Cancel</button><button className={btnPrimary} disabled={!parsed || parsed.err || !width || !table.trim()} onClick={run}>Import</button></>}>
      <div className="flex items-center gap-2 mb-3">
        <label className={btnPrimary + ' cursor-pointer'}><FileUp size={12} /> Choose CSV / TSV file<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={choose} /></label>
        {file && <span className="font-mono text-gray-400">{file.name} · {(file.size / 1024).toFixed(0)} KB · {parsed && !parsed.err ? `${(parsed.length - (header ? 1 : 0)).toLocaleString()} row(s), ${width} column(s)` : ''}</span>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div><div className={label}>Table name</div><input list="sqlb-import-tables" value={table} onChange={(e) => setTable(e.target.value)} className={input + ' w-full'} />
          <datalist id="sqlb-import-tables">{tables.map((t) => <option key={t} value={t} />)}</datalist>
          {table.trim() && <div className={`text-[10px] mt-0.5 ${exists ? 'text-amber-300' : 'text-emerald-400'}`}>{exists ? 'Rows will be appended to the existing table' : 'A new table will be created'}</div>}</div>
        <div><div className={label}>Field separator</div>
          <div className="flex gap-1"><select value={sep} onChange={(e) => setSep(e.target.value)} className={input}>{SEPS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
            {sep === 'other' && <input value={otherSep} onChange={(e) => setOtherSep(e.target.value)} className={input + ' w-12'} maxLength={4} />}</div></div>
        <div><div className={label}>Quote character</div><select value={quote} onChange={(e) => setQuote(e.target.value)} className={input}>{QUOTES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select>
          <div className={label + ' mt-1'}>Encoding</div><select value={encoding} onChange={(e) => setEncoding(e.target.value)} className={input}>{ENCODINGS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="flex flex-col gap-0.5">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Column names in first line</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> Trim fields</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={emptyAsNull} onChange={(e) => setEmptyAsNull(e.target.checked)} /> Empty fields as NULL</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={inferTypes} disabled={exists} onChange={(e) => setInferTypes(e.target.checked)} /> Detect column types</label>
        </div>
      </div>
      {parsed?.err && <div className="text-red-300 mb-2">{parsed.err}</div>}
      {previewCols.length > 0 && <><div className={label + ' mb-1'}>Preview (first 20 rows)</div><ResultGrid columns={previewCols} rows={previewRows} maxHeight="32vh" /></>}
      {error && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono">{error}</div>}
      {done && <div className="mt-2 p-2 border border-emerald-900 rounded bg-emerald-950/20 text-emerald-300">Imported {done.rows.toLocaleString()} row(s) into {done.created ? 'new' : 'existing'} table <span className="font-mono">{table}</span>.</div>}
    </Modal>
  );
}

/** File > Export dialog: SQL dump, CSV, JSON. */
export function ExportDialog({ session, initialFormat = 'sql', onClose }) {
  const db = session.db;
  const objects = useMemo(() => listObjects(db).filter((o) => (o.type === 'table' || o.type === 'view') && !o.shadow), [db]);
  const [format, setFormat] = useState(initialFormat);
  const [picked, setPicked] = useState(() => new Set(objects.filter((o) => o.type === 'table').map((o) => o.name)));
  const [what, setWhat] = useState('both'); // both | schema | data
  const [colNames, setColNames] = useState(false);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [dropTables, setDropTables] = useState(false);
  const [sep, setSep] = useState(',');
  const [quote, setQuote] = useState('"');
  const [csvHeader, setCsvHeader] = useState(true);
  const [newline, setNewline] = useState('\r\n');
  const [pretty, setPretty] = useState(true);
  const [msg, setMsg] = useState('');

  const base = (session.info?.name || 'database').replace(/\.[^.]*$/, '');
  const list = objects.filter((o) => format !== 'sql' || o.type === 'table');
  const chosen = list.filter((o) => picked.has(o.name)).map((o) => o.name);
  const allTables = format === 'sql' && chosen.length === list.length;

  const run = async () => {
    setMsg('');
    try {
      if (format === 'sql') {
        const text = dumpSql(db, { tables: allTables ? null : chosen, schema: what !== 'data', data: what !== 'schema', columnNames: colNames, ifNotExists, dropTables });
        downloadText(`${base}.sql`, text, 'application/sql');
      } else {
        const files = chosen.map((t) => {
          if (format === 'csv') { const r = queryAll(db, `SELECT * FROM ${qid(t)}`); return [`${t}.csv`, toCsv(r.columns, r.rows, { separator: sep, quote, header: csvHeader, newline })]; }
          return [`${t}.json`, exportJson(db, t, { pretty })];
        });
        if (files.length === 1) downloadText(files[0][0], files[0][1], format === 'csv' ? 'text/csv' : 'application/json');
        else {
          const zip = new JSZip();
          for (const [n, c] of files) zip.file(n, c);
          downloadBytes(`${base}-${format}.zip`, await zip.generateAsync({ type: 'blob' }));
        }
      }
      setMsg(`Exported ${format === 'sql' && allTables ? 'the database' : `${chosen.length} object(s)`}.`);
    } catch (e) { setMsg(`Export failed: ${e.message}`); }
  };

  const tabCls = (f) => `px-3 py-1 text-xs ${format === f ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`;
  return (
    <Modal wide title="Export" onClose={onClose} footer={<>{msg && <span className="mr-auto text-emerald-400">{msg}</span>}<button className={btn} onClick={onClose}>Close</button><button className={btnPrimary} disabled={!chosen.length} onClick={run}><Download size={12} /> Export</button></>}>
      <div className="flex rounded overflow-hidden border border-slate-800 w-fit mb-3">
        <button className={tabCls('sql')} onClick={() => setFormat('sql')}>SQL file</button>
        <button className={tabCls('csv')} onClick={() => setFormat('csv')}>CSV file(s)</button>
        <button className={tabCls('json')} onClick={() => setFormat('json')}>JSON file(s)</button>
      </div>
      <div className="grid grid-cols-[minmax(12rem,16rem)_1fr] gap-4">
        <div>
          <div className="flex items-center justify-between mb-1"><span className={label}>{format === 'sql' ? 'Tables' : 'Tables & views'}</span>
            <span className="text-[10px]"><button className="text-cyan-400" onClick={() => setPicked(new Set(list.map((o) => o.name)))}>all</button> · <button className="text-cyan-400" onClick={() => setPicked(new Set())}>none</button></span></div>
          <div className="border border-slate-800 rounded max-h-64 overflow-auto">
            {list.map((o) => (
              <label key={o.name} className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-slate-800/50 cursor-pointer">
                <input type="checkbox" checked={picked.has(o.name)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(o.name); else n.delete(o.name); return n; })} />
                <span className="font-mono truncate">{o.name}</span>{o.type === 'view' && <span className="text-[9px] text-slate-500">view</span>}
              </label>
            ))}
            {!list.length && <div className="px-2 py-2 text-slate-600">Nothing to export.</div>}
          </div>
        </div>
        <div className="space-y-2">
          {format === 'sql' && (
            <>
              <div className="flex gap-3">{[['both', 'Schema and data'], ['schema', 'Schema only'], ['data', 'Data only']].map(([v, l]) => <label key={v} className="inline-flex items-center gap-1"><input type="radio" checked={what === v} onChange={() => setWhat(v)} /> {l}</label>)}</div>
              <label className="flex items-center gap-1"><input type="checkbox" checked={colNames} onChange={(e) => setColNames(e.target.checked)} /> Keep column names in INSERT INTO</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={ifNotExists} onChange={(e) => setIfNotExists(e.target.checked)} /> Keep old schema (CREATE TABLE IF NOT EXISTS)</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={dropTables} onChange={(e) => setDropTables(e.target.checked)} /> Overwrite old schema (DROP TABLE, then CREATE TABLE)</label>
              <div className="text-[10px] text-slate-500">{allTables ? 'All tables plus indexes, views, triggers and sqlite_sequence.' : 'Selected tables plus their indexes and triggers.'}</div>
            </>
          )}
          {format === 'csv' && (
            <>
              <label className="flex items-center gap-1"><input type="checkbox" checked={csvHeader} onChange={(e) => setCsvHeader(e.target.checked)} /> Column names in first line</label>
              <div className="flex items-center gap-2"><span className={label + ' w-28'}>Field separator</span><select value={sep} onChange={(e) => setSep(e.target.value)} className={input}>{SEPS.filter(([v]) => v !== 'other').map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className={label + ' w-28'}>Quote character</span><select value={quote} onChange={(e) => setQuote(e.target.value)} className={input}>{QUOTES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className={label + ' w-28'}>New line</span><select value={newline} onChange={(e) => setNewline(e.target.value)} className={input}><option value={'\r\n'}>Windows (CRLF)</option><option value={'\n'}>Unix (LF)</option></select></div>
              <div className="text-[10px] text-slate-500">BLOBs are written as hex. Several tables are bundled into a .zip.</div>
            </>
          )}
          {format === 'json' && (
            <>
              <label className="flex items-center gap-1"><input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> Pretty print</label>
              <div className="text-[10px] text-slate-500">Each table becomes an array of objects; BLOBs are base64 strings. Several tables are bundled into a .zip.</div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
