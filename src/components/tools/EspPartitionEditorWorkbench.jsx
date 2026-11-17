import React, { useMemo, useState } from 'react';
import { Layers, Database, Plus, Trash2, Download, Upload, FileText, AlertTriangle, CheckCircle2, Save, Pencil, Search, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import {
  parseNvsPartition, editNvsValue, valueToJson, csvCell, printableText, NVS_PAGE_SIZE
} from '../../utils/espNvs.js';
import {
  parseCsv, toCsv, resolveOffsets, validateRows, buildTableBinary, rowsFromPartitions, readDumpTable,
  patchDumpTable, patchRegion, flashMap, detectImage, parseSizeText, formatHex, formatSize, subtypesFor,
  subtypeName, TYPE_APP, TYPE_DATA, MAX_ENTRIES
} from '../../utils/espNvs/partitionTable.js';
import { parsePartitionTable } from '../../utils/espPartitions.js';

/**
 * ESP32 partition table and NVS editor. Fully offline: it works on a flash dump (read_flash /
 * Silicon Memory Dump), a standalone partitions.bin or an nvs.bin. Nothing is sent anywhere.
 */

const TABS = [['partitions', 'PARTITION TABLE', Layers], ['nvs', 'NVS STORAGE', Database]];
const DEFAULT_CSV = `# ESP-IDF default layout (template text, edit freely)
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     ,        0x6000,
phy_init, data, phy,     ,        0x1000,
factory,  app,  factory, ,        1M,
`;
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px] font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-[11px] text-gray-200 hover:border-cyan-700 hover:text-cyan-300 disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-gray-200';
const SEG_COLOR = { boot: 'bg-slate-600', table: 'bg-amber-600', app: 'bg-cyan-700', data: 'bg-emerald-700', gap: 'bg-transparent border border-dashed border-slate-700' };

const fmtHex = (n) => `0x${n.toString(16).toUpperCase()}`;
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n % 1048576 ? 2 : 0)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KiB` : `${n} B`);

function download(data, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const readFile = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(new Uint8Array(fr.result));
  fr.onerror = () => reject(fr.error);
  fr.readAsArrayBuffer(file);
});

const readText = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(fr.error);
  fr.readAsText(file);
});

let rowSeq = 0;
const newRowId = () => `r${++rowSeq}`;

/** Editor row from a numeric partition row (sizes shown as K/M when exact). */
function toEditRow(r) {
  return {
    id: newRowId(),
    name: r.name,
    type: r.type,
    subtype: r.subtype,
    offText: r.offset === null || r.offset === undefined ? '' : formatHex(r.offset),
    sizeText: r.size === null || r.size === undefined ? '' : formatSize(r.size),
    encrypted: !!r.encrypted,
    readonly: !!r.readonly
  };
}

/** Parse the text fields of editor rows. Returns numeric rows plus per-row parse errors. */
function numericRows(rows) {
  const errs = {};
  const out = rows.map((r, i) => {
    let offset = null;
    let size = null;
    try { offset = r.offText.trim() === '' ? null : parseSizeText(r.offText); } catch (e) { errs[i] = e.message; }
    try { size = r.sizeText.trim() === '' ? null : parseSizeText(r.sizeText); } catch (e) { errs[i] = e.message; }
    if (size === null && !errs[i]) errs[i] = 'size is empty';
    return { name: r.name.trim(), type: r.type, subtype: r.subtype, offset, size, encrypted: r.encrypted, readonly: r.readonly };
  });
  return { rows: out, errs };
}

export default function EspPartitionEditorWorkbench({ onLogMessage }) {
  const log = (text, level = 'info') => { try { onLogMessage?.(text, level); } catch { /* optional */ } };
  const [tab, setTab] = useState('partitions');
  const [file, setFile] = useState(null); // { name, size, kind, bytes, modified }
  const [notice, setNotice] = useState(null); // { level, text }
  const [rows, setRows] = useState([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState(DEFAULT_CSV);
  const [dumpTable, setDumpTable] = useState(null); // partitions as stored in the loaded dump (for NVS lookup)

  const flashSize = file && file.kind === 'dump' ? file.size : undefined;

  const { rows: numeric, errs: rowErrs } = useMemo(() => numericRows(rows), [rows]);
  // Every row stays in place so issue indexes match table rows; unparsable fields come through as null.
  const resolved = useMemo(() => resolveOffsets(numeric), [numeric]);
  const issues = useMemo(() => {
    const list = Object.entries(rowErrs).map(([i, m]) => ({ severity: 'error', row: Number(i), message: `${rows[i]?.name || `row ${Number(i) + 1}`}: ${m}` }));
    const checked = validateRows(resolved, { flashSize }).filter((x) => x.row === null || rowErrs[x.row] === undefined);
    return [...list, ...checked];
  }, [rowErrs, rows, resolved, flashSize]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const map = useMemo(() => flashMap(resolved, flashSize), [resolved, flashSize]);

  const loadImage = async (f) => {
    try {
      const bytes = await readFile(f);
      const kind = detectImage(bytes);
      const next = { name: f.name, size: bytes.length, kind, bytes, modified: false };
      setFile(next);
      setNotice(null);
      if (kind === 'dump' || kind === 'table') {
        const parsed = kind === 'dump' ? readDumpTable(bytes) : parsePartitionTable(bytes);
        setRows(rowsFromPartitions(parsed.partitions).map(toEditRow));
        setDumpTable(kind === 'dump' ? rowsFromPartitions(parsed.partitions) : null);
        const extra = parsed.warnings?.length ? ` ${parsed.warnings.join(' ')}` : '';
        setNotice({ level: parsed.warnings?.length ? 'warn' : 'ok', text: `${kind === 'dump' ? 'Full dump' : 'partitions.bin'}: ${parsed.partitions.length} partitions loaded.${extra}` });
        log(`ESP partition table loaded from ${f.name} (${parsed.partitions.length} partitions)`, 'info');
        setTab('partitions');
      } else if (kind === 'nvs') {
        setDumpTable(null);
        setNotice({ level: 'ok', text: 'Standalone NVS image detected. Open the NVS STORAGE tab.' });
        setTab('nvs');
      } else {
        setNotice({ level: 'error', text: `${f.name} is not a full dump (no table at 0x8000), a partition table or an NVS image.` });
      }
    } catch (e) {
      setNotice({ level: 'error', text: `Could not read ${f.name}: ${e.message}` });
    }
  };

  const importCsvText = (text) => {
    const { rows: parsed, errors } = parseCsv(text);
    if (errors.length) {
      setNotice({ level: 'error', text: `CSV has ${errors.length} error(s): ${errors.slice(0, 3).map((e) => `line ${e.line}: ${e.message}`).join('; ')}` });
      return false;
    }
    setRows(parsed.map((r) => toEditRow(r)));
    setNotice({ level: 'ok', text: `Imported ${parsed.length} partition(s) from CSV. Blank offsets are resolved like gen_esp32part.py.` });
    return true;
  };

  const onCsvFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { importCsvText(await readText(f)); } catch (err) { setNotice({ level: 'error', text: `Could not read CSV: ${err.message}` }); }
  };

  const updateRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, toEditRow({ name: `part${rs.length + 1}`, type: TYPE_DATA, subtype: 0x06, offset: null, size: 0x1000 })]);
  const setType = (id, type) => setRows((rs) => rs.map((r) => {
    if (r.id !== id) return r;
    const table = subtypesFor(type);
    const keep = Object.keys(table).find((k) => table[k] === r.subtype);
    const subtype = keep ? r.subtype : type === TYPE_APP ? 0x00 : 0x06;
    return { ...r, type, subtype };
  }));

  const binary = useMemo(() => {
    if (errorCount > 0 || resolved.length === 0) return null;
    try { return buildTableBinary(resolved, { flashSize }); } catch { return null; }
  }, [errorCount, resolved, flashSize]);

  const exportCsv = () => download(toCsv(resolved), 'partitions.csv', 'text/csv');
  const exportBin = () => { if (binary) download(binary, 'partitions.bin'); };
  const patchFullDump = () => {
    if (!binary || !file || file.kind !== 'dump') return;
    const out = patchDumpTable(file.bytes, binary);
    download(out, file.name.replace(/\.bin$/i, '') + '-partitions-patched.bin');
    log('Patched partition table written into a copy of the dump', 'info');
  };

  // ---------------------------------------------------------------- NVS
  const nvsSource = useMemo(() => {
    if (!file) return null;
    if (file.kind === 'nvs') return { label: file.name, offset: 0, size: file.size, dumpBacked: false };
    if (file.kind === 'dump' && dumpTable) {
      return { dumpBacked: true, options: dumpTable.filter((p) => p.type === TYPE_DATA && p.subtype === 0x02) };
    }
    return null;
  }, [file, dumpTable]);
  const [nvsPick, setNvsPick] = useState(null);
  const pickedPart = useMemo(() => {
    if (!nvsSource || !nvsSource.dumpBacked) return null;
    const opts = nvsSource.options;
    return opts.find((p) => p.name === nvsPick) || opts[0] || null;
  }, [nvsSource, nvsPick]);

  const nvsRegion = useMemo(() => {
    if (!file || !nvsSource) return null;
    if (!nvsSource.dumpBacked) return { offset: 0, size: file.size };
    if (!pickedPart) return null;
    return { offset: pickedPart.offset, size: pickedPart.size };
  }, [file, nvsSource, pickedPart]);

  const nvsView = useMemo(() => (file && nvsRegion ? file.bytes.subarray(nvsRegion.offset, nvsRegion.offset + nvsRegion.size) : null), [file, nvsRegion]);
  const nvs = useMemo(() => {
    if (!nvsView) return { error: null, data: null };
    try { return { error: null, data: parseNvsPartition(nvsView) }; } catch (e) { return { error: e.message, data: null }; }
  }, [nvsView]);

  const [search, setSearch] = useState('');
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [maskSensitive, setMaskSensitive] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text, error }

  const visibleValues = useMemo(() => {
    const vals = nvs.data ? nvs.data.values : [];
    const q = search.trim().toLowerCase();
    return vals.filter((v) => (!onlySensitive || v.sensitive) && (!q || `${v.namespace} ${v.key} ${v.value}`.toLowerCase().includes(q)));
  }, [nvs.data, search, onlySensitive]);

  const saveEdit = () => {
    if (!editing || !nvs.data) return;
    const v = nvs.data.values.find((x) => x.location.absOffset === editing.id);
    try {
      const newNvs = editNvsValue(nvsView, v, editing.text);
      const nextBytes = nvsSource.dumpBacked ? patchRegion(file.bytes, nvsRegion.offset, newNvs) : newNvs;
      setFile({ ...file, bytes: nextBytes, modified: true });
      setEditing(null);
      setNotice({ level: 'ok', text: `Updated ${v.namespace}/${v.key}. Entry CRC recomputed; re-parsed to confirm.` });
      log(`NVS value ${v.namespace}/${v.key} edited in ${file.name}`, 'info');
    } catch (e) {
      setEditing({ ...editing, error: e.message });
    }
  };

  const nvsDownload = () => {
    if (!nvsView) return;
    download(nvsView.slice(), (file.name.replace(/\.bin$/i, '') || 'nvs') + (nvsSource.dumpBacked ? '-nvs.bin' : '-edited.bin'));
  };
  const nvsPatchDump = () => {
    if (!file || file.kind !== 'dump') return;
    download(file.bytes, file.name.replace(/\.bin$/i, '') + '-nvs-edited.bin');
  };
  const exportNvsJson = () => {
    if (!nvs.data) return;
    const doc = {
      source: file?.name,
      partition: pickedPart ? { name: pickedPart.name, offset: pickedPart.offset, size: pickedPart.size } : null,
      counts: nvs.data.counts,
      namespaces: nvs.data.namespaces,
      values: nvs.data.values.map(valueToJson),
      warnings: nvs.data.warnings
    };
    download(JSON.stringify(doc, null, 2), 'nvs-export.json', 'application/json');
  };
  const exportNvsCsv = () => {
    if (!nvs.data) return;
    const head = 'namespace,key,type,value,size,valid,sensitive,editable';
    const lines = nvs.data.values.map((v) => [v.namespace, v.key, v.type,
      v.kind === 'blob' || v.kind === 'unknown' ? Array.from(v.raw, (b) => b.toString(16).padStart(2, '0')).join('') : v.value,
      v.size, v.valid, v.sensitive ? v.sensitive : '', v.editable].map(csvCell).join(','));
    download([head, ...lines].join('\n') + '\n', 'nvs-export.csv', 'text/csv');
  };

  const blobPreview = (v) => {
    const hex = Array.from(v.raw.subarray(0, 24), (b) => b.toString(16).padStart(2, '0')).join(' ');
    return v.raw.length > 24 ? `${hex} ...` : hex;
  };
  const textOf = (v) => (v.kind === 'string' ? v.value : v.kind === 'int' || v.kind === 'float' ? v.value : printableText(v.raw) ?? '');

  return (
    <div className="flex flex-col h-full w-full text-gray-200 bg-slate-950 font-sans overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900/60">
        <Layers size={16} className="text-cyan-400" />
        <div className="text-sm font-semibold tracking-wide">ESP32 PARTITION TABLE &amp; NVS EDITOR</div>
        <div className="flex-1" />
        <label className={`${btn} cursor-pointer`}>
          <Upload size={12} /> Open .bin
          <input type="file" accept=".bin,.img,application/octet-stream" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadImage(f); }} />
        </label>
        {file && <span className="text-[11px] font-mono text-slate-400">{file.name} · {fmtBytes(file.size)} · {file.kind}{file.modified ? ' · modified' : ''}</span>}
      </div>

      <div className="flex gap-1 px-3 pt-2 border-b border-slate-800">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded-t border-b-2 ${tab === id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`mx-3 mt-2 px-2.5 py-1.5 rounded border text-[11px] flex items-start gap-2 ${notice.level === 'error' ? 'border-red-900 bg-red-950/30 text-red-300' : notice.level === 'warn' ? 'border-amber-900 bg-amber-950/30 text-amber-200' : 'border-emerald-900 bg-emerald-950/20 text-emerald-300'}`}>
          {notice.level === 'ok' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-300">dismiss</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {tab === 'partitions' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btn} cursor-pointer`}>
                <FileText size={12} /> Import CSV
                <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onCsvFile} />
              </label>
              <button className={btn} onClick={() => setPasteOpen((o) => !o)}><Pencil size={12} /> {pasteOpen ? 'Hide CSV text' : 'Paste / edit CSV text'}</button>
              <button className={btn} onClick={addRow} disabled={rows.length >= MAX_ENTRIES}><Plus size={12} /> Add partition</button>
              <button className={btn} onClick={exportCsv} disabled={resolved.length === 0}><Download size={12} /> Export CSV</button>
              <button className={btn} onClick={exportBin} disabled={!binary}><Download size={12} /> partitions.bin (0xC00)</button>
              {file?.kind === 'dump' && <button className={btn} onClick={patchFullDump} disabled={!binary}><Save size={12} /> Patch table into dump</button>}
              {!file && <span className="text-[11px] text-slate-500">Open a dump or partitions.bin, or start from CSV.</span>}
            </div>

            {pasteOpen && (
              <div className="space-y-2">
                <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} spellCheck={false} className={`${inputCls} w-full`} aria-label="CSV text" />
                <div className="flex gap-2">
                  <button className={btn} onClick={() => importCsvText(pasteText)}>Use this CSV</button>
                  <button className={btn} onClick={() => setPasteText(DEFAULT_CSV)}>Insert ESP-IDF default template</button>
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-end justify-between text-[10px] text-slate-500 font-mono">
                  <span>FLASH MAP {flashSize ? `(${fmtBytes(map.total)} dump)` : `(0x${map.total.toString(16)} span)`}</span>
                  <span>blank offset = auto</span>
                </div>
                <div className="flex h-7 w-full rounded overflow-hidden border border-slate-800 bg-slate-900" role="img" aria-label="Flash map">
                  {map.segments.map((s, i) => {
                    const pct = (100 * (s.end - s.start)) / map.total;
                    return (
                      <div key={i} title={`${s.label} ${fmtHex(s.start)}-${fmtHex(s.end)} (${fmtBytes(s.end - s.start)})`}
                        className={`${SEG_COLOR[s.kind]} h-full flex items-center justify-center overflow-hidden text-[10px] font-mono text-white/90 border-r border-slate-950`}
                        style={{ width: `${Math.max(pct, 0.4)}%` }}>
                        {pct > 9 ? s.label : ''}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
                  <span><i className="inline-block w-2.5 h-2.5 bg-slate-600 mr-1" />bootloader</span>
                  <span><i className="inline-block w-2.5 h-2.5 bg-amber-600 mr-1" />partition table</span>
                  <span><i className="inline-block w-2.5 h-2.5 bg-cyan-700 mr-1" />app</span>
                  <span><i className="inline-block w-2.5 h-2.5 bg-emerald-700 mr-1" />data</span>
                  <span><i className="inline-block w-2.5 h-2.5 border border-dashed border-slate-600 mr-1" />unallocated</span>
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="overflow-x-auto border border-slate-800 rounded">
                <table className="min-w-full text-[11px] font-mono">
                  <thead className="bg-slate-900 text-slate-500">
                    <tr>
                      {['Name', 'Type', 'Subtype', 'Offset', 'Size', 'End', 'Enc', 'RO', ''].map((h) => <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const err = rowErrs[i];
                      const rowIssues = issues.filter((x) => x.row === i);
                      const hasErr = rowIssues.some((x) => x.severity === 'error') || !!err;
                      const num = numeric[i];
                      const end = num && num.offset !== null && num.size ? num.offset + num.size : null;
                      const table = subtypesFor(r.type);
                      const names = Object.keys(table);
                      const curName = subtypeName(r.type, r.subtype);
                      const autoOff = r.offText.trim() === '';
                      return (
                        <tr key={r.id} className={`border-t border-slate-800 align-top ${hasErr ? 'bg-red-950/20' : ''}`}>
                          <td className="px-1 py-1"><input aria-label="Name" className={`${inputCls} w-28`} value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} /></td>
                          <td className="px-1 py-1">
                            <select aria-label="Type" className={inputCls} value={r.type} onChange={(e) => setType(r.id, Number(e.target.value))}>
                              <option value={TYPE_APP}>app</option>
                              <option value={TYPE_DATA}>data</option>
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select aria-label="Subtype" className={inputCls} value={r.subtype} onChange={(e) => updateRow(r.id, { subtype: Number(e.target.value) })}>
                              {names.map((k) => <option key={k} value={table[k]}>{k}</option>)}
                              {!names.includes(curName) && <option value={r.subtype}>{`0x${r.subtype.toString(16)}`}</option>}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <input aria-label="Offset" placeholder="auto" className={`${inputCls} w-24 ${autoOff ? 'text-cyan-300' : ''}`} value={r.offText} onChange={(e) => updateRow(r.id, { offText: e.target.value })} />
                            {autoOff && num?.offset !== null && num?.offset !== undefined && <div className="text-[9px] text-slate-600">= {fmtHex(num.offset)}</div>}
                          </td>
                          <td className="px-1 py-1"><input aria-label="Size" className={`${inputCls} w-20`} value={r.sizeText} onChange={(e) => updateRow(r.id, { sizeText: e.target.value })} /></td>
                          <td className="px-1 py-1 text-slate-500">{end !== null ? fmtHex(end) : '—'}</td>
                          <td className="px-1 py-1"><input aria-label="Encrypted" type="checkbox" checked={r.encrypted} onChange={(e) => updateRow(r.id, { encrypted: e.target.checked })} /></td>
                          <td className="px-1 py-1"><input aria-label="Read-only" type="checkbox" checked={r.readonly} onChange={(e) => updateRow(r.id, { readonly: e.target.checked })} /></td>
                          <td className="px-1 py-1">
                            <button aria-label="Remove partition" className="text-slate-600 hover:text-red-400" onClick={() => removeRow(r.id)}><Trash2 size={12} /></button>
                          </td>
                          {rowIssues.length > 0 && (
                            <td colSpan={9} className="px-2 pb-1 text-[10px]">
                              {rowIssues.map((x, k) => (
                                <div key={k} className={x.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{x.severity === 'error' ? 'error' : 'warn'}: {x.message}</div>
                              ))}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && (
              <div className="text-[11px] flex items-center gap-2">
                {errorCount === 0
                  ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 size={12} /> Table is valid{binary ? ` (${binary.length} bytes, MD5 entry included)` : ''}.</span>
                  : <span className="text-red-300 flex items-center gap-1"><AlertTriangle size={12} /> {errorCount} error(s): the 0xC00 binary and dump patch are blocked until they are fixed.</span>}
              </div>
            )}

            {rows.length === 0 && (
              <div className="border border-dashed border-slate-800 rounded p-4 text-[11px] text-slate-500 leading-relaxed">
                No table loaded. Open a full flash dump (the table is read from 0x8000), a partitions.bin, or import a
                gen_esp32part.py CSV. Nothing is shown until a file or CSV is provided.
              </div>
            )}
          </>
        )}

        {tab === 'nvs' && (
          <>
            {!file && <div className="border border-dashed border-slate-800 rounded p-4 text-[11px] text-slate-500">Open a full dump (its NVS data partition is found from the table) or a standalone nvs.bin.</div>}
            {file && file.kind !== 'dump' && file.kind !== 'nvs' && <div className="text-[11px] text-slate-400">Loaded {file.name} is a partition table, not NVS data. Open a dump or an nvs.bin.</div>}

            {file && nvsSource?.dumpBacked && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-slate-500">NVS partition:</span>
                {nvsSource.options.length === 0
                  ? <span className="text-amber-300">The dump's table has no data/nvs partition.</span>
                  : (
                    <select aria-label="NVS partition" className={inputCls} value={pickedPart?.name || ''} onChange={(e) => setNvsPick(e.target.value)}>
                      {nvsSource.options.map((p) => <option key={p.name} value={p.name}>{p.name} @ {fmtHex(p.offset)} ({fmtBytes(p.size)})</option>)}
                    </select>
                  )}
                <span className="text-slate-600">Table as stored in the dump (CSV edits are not applied here).</span>
              </div>
            )}

            {nvs.error && <div className="text-[11px] text-red-300">{nvs.error}</div>}

            {nvs.data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                  {[
                    ['Pages', `${nvs.data.counts.pages} (${nvs.data.counts.livePages} live)`],
                    ['Entries written / erased', `${nvs.data.counts.written} / ${nvs.data.counts.erased}`],
                    ['Entry CRC failures', String(nvs.data.counts.crcBad)],
                    ['Values (live)', String(nvs.data.values.length)]
                  ].map(([k, v]) => (
                    <div key={k} className="border border-slate-800 rounded p-2 bg-slate-900/40">
                      <div className="text-[10px] text-slate-500">{k}</div>
                      <div className="font-mono text-gray-100">{v}</div>
                    </div>
                  ))}
                </div>

                {nvs.data.warnings.map((w, i) => (
                  <div key={i} className="text-[11px] text-amber-300 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-1.5 top-1.5 text-slate-600" />
                    <input aria-label="Search NVS" placeholder="search namespace, key, value" className={`${inputCls} pl-6 w-64`} value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <label className="text-[11px] flex items-center gap-1 text-slate-400"><input type="checkbox" checked={onlySensitive} onChange={(e) => setOnlySensitive(e.target.checked)} /> <ShieldAlert size={11} className="text-amber-400" /> credentials only</label>
                  <label className="text-[11px] flex items-center gap-1 text-slate-400"><input type="checkbox" checked={maskSensitive} onChange={(e) => setMaskSensitive(e.target.checked)} /> {maskSensitive ? <EyeOff size={11} /> : <Eye size={11} />} mask secrets on screen</label>
                  <div className="flex-1" />
                  <button className={btn} onClick={exportNvsJson}><Download size={12} /> JSON</button>
                  <button className={btn} onClick={exportNvsCsv}><Download size={12} /> CSV</button>
                  <button className={btn} onClick={nvsDownload}><Download size={12} /> {nvsSource?.dumpBacked ? 'NVS partition .bin' : 'Save nvs.bin'}</button>
                  {file?.kind === 'dump' && <button className={btn} onClick={nvsPatchDump} disabled={!file.modified}><Save size={12} /> Dump with NVS edits</button>}
                </div>

                {nvs.data.namespaces.length > 0 && (
                  <div className="text-[10px] text-slate-500 font-mono">namespaces: {nvs.data.namespaces.map((n) => `${n.name}(${n.index})`).join(', ')}</div>
                )}

                <div className="overflow-x-auto border border-slate-800 rounded">
                  <table className="min-w-full text-[11px] font-mono">
                    <thead className="bg-slate-900 text-slate-500">
                      <tr>{['Namespace', 'Key', 'Type', 'Value', 'Bytes', 'Status', ''].map((h) => <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {visibleValues.map((v) => {
                        const id = v.location.absOffset;
                        const isEditing = editing?.id === id;
                        const shown = v.sensitive && maskSensitive ? '••••••••' : v.kind === 'blob' || v.kind === 'unknown' ? (v.valid ? blobPreview(v) : '<invalid>') : textOf(v);
                        return (
                          <tr key={id} className={`border-t border-slate-800 align-top ${v.sensitive ? 'bg-amber-950/25' : ''}`}>
                            <td className="px-2 py-1 text-slate-400">{v.namespace || `#${v.nsIndex}`}</td>
                            <td className="px-2 py-1 text-gray-100">
                              {v.key}
                              {v.sensitive && <div className="text-[9px] text-amber-400 flex items-center gap-1"><ShieldAlert size={9} /> {v.sensitive}</div>}
                            </td>
                            <td className="px-2 py-1 text-slate-500">{v.type}</td>
                            <td className="px-2 py-1 break-all max-w-[360px]">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <input aria-label="New value" autoFocus className={`${inputCls} w-64`} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value, error: '' })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
                                  {editing.error && <div className="text-red-300 text-[10px]">{editing.error}</div>}
                                  <div className="flex gap-1">
                                    <button className={btn} onClick={saveEdit}><Save size={11} /> Save</button>
                                    <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <span className={v.valid ? 'text-cyan-200' : 'text-red-300'}>{shown}</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-slate-500">{v.size}</td>
                            <td className="px-2 py-1">
                              {v.valid ? <span className="text-emerald-400">valid</span> : <span className="text-red-400">invalid</span>}
                              {!v.editable && v.readOnlyReason && <div className="text-[9px] text-slate-600 max-w-[180px]">{v.readOnlyReason}</div>}
                            </td>
                            <td className="px-2 py-1">
                              {v.editable && !isEditing && (
                                <button aria-label={`Edit ${v.key}`} className="text-slate-500 hover:text-cyan-300" title={v.kind === 'int' ? 'Edit integer' : 'Edit string (same length only)'}
                                  onClick={() => setEditing({ id, text: v.value, error: '' })}>
                                  <Pencil size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {visibleValues.length === 0 && (
                        <tr><td colSpan={7} className="px-2 py-3 text-slate-600">{nvs.data.values.length ? 'No values match the filter.' : 'No live values in this partition.'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer text-slate-500">Pages ({nvs.data.pages.length})</summary>
                  <div className="overflow-x-auto mt-1">
                    <table className="text-[10px] font-mono">
                      <thead className="text-slate-600"><tr>{['#', 'Offset', 'State', 'Seq', 'Ver', 'Header CRC', 'Written', 'Erased'].map((h) => <th key={h} className="px-2 text-left font-normal">{h}</th>)}</tr></thead>
                      <tbody>
                        {nvs.data.pages.map((p) => (
                          <tr key={p.index} className="border-t border-slate-900">
                            <td className="px-2">{p.index}</td>
                            <td className="px-2">{fmtHex(p.offset)}</td>
                            <td className="px-2">{p.stateName}</td>
                            <td className="px-2">{p.stateName === 'empty' ? '—' : p.seq}</td>
                            <td className={`px-2 ${p.versionOk ? '' : 'text-amber-300'}`}>{p.stateName === 'empty' ? '—' : `v${p.version === 0xfe ? 2 : p.version === 0xff ? 1 : p.version}`}</td>
                            <td className={`px-2 ${p.crcOk || p.stateName === 'empty' ? '' : 'text-red-300'}`}>{p.stateName === 'empty' ? '—' : p.crcOk ? 'ok' : 'bad'}</td>
                            <td className="px-2">{p.written}</td>
                            <td className="px-2">{p.erased}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <div className="text-[10px] text-slate-600">
                  Page size {NVS_PAGE_SIZE} bytes. Items are shown as written: each live key is the newest valid write. Blobs are read-only.
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
