import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  HardDrive,
  Folder,
  FolderUp,
  FileText,
  FileCode,
  FileArchive,
  File as FileIcon,
  Sliders,
  Cpu,
  Radio,
  ChevronRight,
  X
} from 'lucide-react';
import { fmtSize, baseName, extOf, parentOf, joinPath, parseWigle } from '../../../utils/pigletToolkit';

// Same behaviour as the Piglet Toolkit in olosnoks/warhog web-flasher/toolkit.js:
// folder navigation, sortable columns, click / Ctrl / Shift selection, toolbar
// actions on the selection, drag-and-drop upload, folder download into a
// picked folder, recursive delete, text + WiGLE CSV viewers.

const TEXT_EXT = ['cfg', 'csv', 'txt', 'log', 'json', 'md', 'ini', 'conf'];
const PREVIEW_MAX = 256 * 1024;
const CSV_PREVIEW_MAX = 10 * 1024 * 1024;     // CSV logs are capped at 9 MiB on the device
const DL_CONFIRM_BYTES = 25 * 1024 * 1024;    // ask first above this (USB is ~100s of KB/s)
const TEXT_LINES_MAX = 20000;                 // beyond this, plain <pre> (big logs)
const CSV_ROWS_MAX = 2000;                    // rows drawn at once; filter to narrow down

function typeOf(e) {
  if (e.dir) return 'Folder';
  const x = extOf(e.name);
  return ({ csv: 'CSV log', cfg: 'Config', txt: 'Text', log: 'Log', json: 'JSON', bin: 'Firmware',
            pcap: 'Capture', pcapng: 'Capture', gz: 'Archive', tmp: 'Temp' })[x] || (x ? x.toUpperCase() + ' file' : 'File');
}

function EntryIcon({ entry }) {
  if (entry.dir) return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
  const x = extOf(entry.name);
  if (x === 'csv') return <FileText className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (['cfg', 'ini', 'conf'].includes(x)) return <Sliders className="w-4 h-4 text-orange-400 shrink-0" />;
  if (x === 'json') return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
  if (x === 'bin') return <Cpu className="w-4 h-4 text-violet-400 shrink-0" />;
  if (x === 'gz') return <FileArchive className="w-4 h-4 text-violet-400 shrink-0" />;
  if (x === 'pcap' || x === 'pcapng') return <Radio className="w-4 h-4 text-sky-400 shrink-0" />;
  if (['txt', 'log', 'md'].includes(x)) return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  return <FileIcon className="w-4 h-4 text-slate-400 shrink-0" />;
}

function saveBytes(name, bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
//  Text viewer: line numbers, wrapping, key=value / comment colours
// ---------------------------------------------------------------------------
const NON_TEXT = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f�]+/g;
function ShowText({ text }) {
  // Show bytes that aren't text (NUL, control chars, U+FFFD) as faint dots.
  const parts = [];
  let last = 0;
  text.replace(NON_TEXT, (m, off) => {
    if (off > last) parts.push(text.slice(last, off));
    parts.push(<b key={off} className="text-slate-600 font-normal">{'·'.repeat(m.length)}</b>);
    last = off + m.length;
    return m;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function TextView({ text, ext }) {
  const lines = useMemo(() => {
    const ls = text.replace(/\r\n?/g, '\n').split('\n');
    if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop();
    return ls;
  }, [text]);
  if (lines.length > TEXT_LINES_MAX) {
    return <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all p-3">{text}</pre>;
  }
  const kv = ['cfg', 'ini', 'conf', 'txt'].includes(ext);
  return (
    <div className="font-mono text-[11px] leading-5 py-2">
      {lines.map((ln, n) => {
        let body;
        if (kv && /^\s*[#;]/.test(ln)) body = <span className="text-slate-500"><ShowText text={ln} /></span>;
        else if (kv && /^\s*\[[^\]]+\]\s*$/.test(ln)) body = <span className="text-violet-300"><ShowText text={ln} /></span>;
        else if (kv && /^\s*[\w.\-]+\s*=/.test(ln)) {
          const i = ln.indexOf('=');
          body = (
            <>
              <span className="text-sky-300"><ShowText text={ln.slice(0, i)} /></span>
              <span className="text-slate-500">=</span>
              <span className="text-amber-200"><ShowText text={ln.slice(i + 1)} /></span>
            </>
          );
        } else body = <span className="text-slate-200"><ShowText text={ln} /></span>;
        return (
          <div key={n} className="flex hover:bg-slate-900/60">
            <i className="not-italic select-none text-right text-slate-600 w-12 shrink-0 pr-3">{n + 1}</i>
            <span className="whitespace-pre-wrap break-all pr-3 min-w-0">{body}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  CSV (WiGLE log) viewer
// ---------------------------------------------------------------------------
function CsvCard({ val, label, warn }) {
  return (
    <div className={`px-3 py-2 rounded-lg border ${warn ? 'border-rose-500/40 bg-rose-500/10' : 'border-slate-800 bg-slate-950'}`}>
      <b className={`block text-sm ${warn ? 'text-rose-300' : 'text-slate-100'}`}>{val}</b>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

function CsvCards({ data }) {
  const { rows, bad } = data;
  const wifi = rows.filter((r) => r.type === 'WIFI'), ble = rows.length - wifi.length;
  const open = wifi.filter((r) => /^\[?(open|none)?\]?$/i.test(r.auth.replace(/\[ESS\]/i, '').trim())).length;
  const ssids = new Set(wifi.map((r) => r.ssid).filter(Boolean)).size;
  const gps = rows.filter((r) => r.lat && r.lon).length;
  const times = rows.map((r) => r.seen).filter((t) => /^\d{4}-/.test(t)).sort();
  const best = rows.reduce((m, r) => (r.rssi != null && (m == null || r.rssi > m.rssi) ? r : m), null);
  let span = null;
  if (times.length) {
    const t0 = times[0], t1 = times[times.length - 1];
    span = t0.slice(0, 10) === t1.slice(0, 10)
      ? <CsvCard val={t0.slice(11, 16) + ' → ' + t1.slice(11, 16)} label={'on ' + t0.slice(0, 10)} />
      : <CsvCard val={t0.slice(5, 10) + ' → ' + t1.slice(5, 10)} label={'dates seen (' + t0.slice(0, 4) + ')'} />;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
      <CsvCard val={rows.length.toLocaleString()} label="networks logged" />
      <CsvCard val={wifi.length.toLocaleString()} label="Wi-Fi" />
      <CsvCard val={ble.toLocaleString()} label="BLE" />
      <CsvCard val={ssids.toLocaleString()} label="unique SSIDs" />
      <CsvCard val={open.toLocaleString()} label="open Wi-Fi" />
      <CsvCard val={rows.length ? Math.round(100 * gps / rows.length) + '%' : '—'} label="with GPS fix" />
      {span}
      {best && <CsvCard val={best.rssi + ' dBm'} label={'strongest: ' + (best.ssid || best.mac)} />}
      {bad > 0 && <CsvCard val={bad.toLocaleString()} label="unreadable lines skipped" warn />}
    </div>
  );
}

const CSV_COLS = [
  ['type', 'Type'], ['ssid', 'SSID / name'], ['mac', 'MAC'], ['auth', 'Security'], ['ch', 'Ch', true],
  ['rssi', 'Signal', true], ['seen', 'First seen'], ['loc', 'Location']
];

function CsvTable({ data }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('seen');
  const [dir, setDir] = useState(-1);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = data.rows.filter((r) => (!type || r.type === type) &&
      (!ql || (r.ssid + ' ' + r.mac + ' ' + r.auth + ' ' + (r.ch ?? '') + ' ' + r.seen).toLowerCase().includes(ql)));
    out.sort((a, b) => {
      let x = a[sort], y = b[sort];
      if (sort === 'loc') { x = a.lat; y = b.lat; }
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })) * dir;
    });
    return out;
  }, [data, q, type, sort, dir]);

  const onSort = (key) => {
    if (sort === key) setDir(-dir);
    else { setSort(key); setDir(key === 'rssi' || key === 'seen' ? -1 : 1); }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by SSID, MAC, auth, channel…"
          className="flex-1 min-w-[12rem] bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-amber-500/50"
        />
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 border border-slate-800 rounded">
          {[['', 'All'], ['WIFI', 'Wi-Fi'], ['BLE', 'BLE']].map(([t, l]) => (
            <button key={l} type="button" onClick={() => setType(t)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${type === t ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
              {l}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-500">
          {rows.length === data.rows.length
            ? rows.length.toLocaleString() + ' rows'
            : rows.length.toLocaleString() + ' of ' + data.rows.length.toLocaleString() + ' rows'}
        </span>
      </div>
      <div className="max-h-[55vh] overflow-auto border border-slate-800 rounded-lg">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-900 text-slate-400 sticky top-0">
            <tr>
              {CSV_COLS.map(([key, label, num]) => (
                <th key={key} onClick={() => onSort(key)}
                  className={`py-1.5 px-2 cursor-pointer select-none whitespace-nowrap ${num ? 'text-right' : ''}`}>
                  {label}{sort === key ? (dir > 0 ? ' ▴' : ' ▾') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.slice(0, CSV_ROWS_MAX).map((r, i) => {
              const sec = r.auth.replace(/\[ESS\]/ig, '').replace(/^\[|\]$/g, '').trim();
              const isOpen = !sec || /^open$/i.test(sec), isWep = /wep/i.test(sec);
              const lv = r.rssi == null ? 0 : r.rssi >= -55 ? 4 : r.rssi >= -67 ? 3 : r.rssi >= -78 ? 2 : 1;
              return (
                <tr key={r.mac + i} className="hover:bg-slate-800/40">
                  <td className="py-1 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${r.type === 'BLE' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-sky-500/20 text-sky-300'}`}>
                      {r.type === 'BLE' ? 'BLE' : 'Wi-Fi'}
                    </span>
                  </td>
                  <td className={`py-1 px-2 max-w-[14rem] truncate ${r.ssid ? 'text-slate-100 font-semibold' : 'text-slate-500 italic'}`}>
                    {r.ssid || (r.type === 'BLE' ? '(no name)' : '(hidden)')}
                  </td>
                  <td className="py-1 px-2 font-mono text-slate-400">{r.mac}</td>
                  <td className="py-1 px-2">
                    {r.type !== 'BLE' && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isOpen ? 'bg-emerald-500/20 text-emerald-300' : isWep ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800 text-slate-300'}`}>
                        {isOpen ? 'Open' : sec.replace(/\]\[/g, ' ')}
                      </span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right">{r.ch ?? ''}</td>
                  <td className="py-1 px-2 text-right whitespace-nowrap">
                    {r.rssi != null && (
                      <>
                        <span className="inline-flex items-end gap-px h-2.5 mr-1.5 align-middle">
                          {[1, 2, 3, 4].map((n) => (
                            <i key={n} className={`w-0.5 ${n <= lv ? 'bg-emerald-400' : 'bg-slate-700'}`} style={{ height: (n * 25) + '%' }} />
                          ))}
                        </span>
                        {r.rssi} dBm
                      </>
                    )}
                  </td>
                  <td className="py-1 px-2 font-mono text-slate-400 whitespace-nowrap">{r.seen}</td>
                  <td className="py-1 px-2 font-mono whitespace-nowrap">
                    {r.lat && r.lon ? (
                      <a className="text-cyan-300 hover:underline" target="_blank" rel="noopener noreferrer"
                        href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=18/${r.lat}/${r.lon}`}>
                        {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                      </a>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > CSV_ROWS_MAX && (
          <div className="p-2 text-center text-[11px] text-slate-500">
            Showing the first {CSV_ROWS_MAX.toLocaleString()} rows. Use the filter to narrow it down.
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewModal({ preview, onClose }) {
  const [mode, setMode] = useState(preview.csv ? 'table' : 'text');
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const table = mode === 'table' && preview.csv;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className={`bg-[#12151c] border border-slate-700 rounded-xl shadow-2xl w-full ${table ? 'max-w-6xl' : 'max-w-3xl'} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800">
          <b className="text-xs text-slate-100 font-mono truncate flex-1">{preview.path}  ({fmtSize(preview.bytes.length)})</b>
          {preview.csv && (
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 border border-slate-800 rounded">
              {[['table', 'Networks'], ['text', 'Text']].map(([m, l]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${mode === m ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => saveBytes(preview.name, preview.bytes)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200">
            <Download className="w-3 h-3" /> Download
          </button>
          <button type="button" onClick={onClose} title="Close (Esc)" className="p-1 rounded hover:bg-slate-800 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto p-3 space-y-3">
          {table ? (
            <>
              <CsvCards data={preview.csv} />
              <CsvTable data={preview.csv} />
            </>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded-lg">
              <TextView text={preview.text} ext={extOf(preview.name)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  File browser
// ---------------------------------------------------------------------------
export default function PigletFileBrowser({ client, connected, busy, setBusy, setStatus, log, onCsvRows }) {
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState([]);       // [{ path, name, dir, size }]
  const [loadState, setLoadState] = useState({ loading: false, error: '' });
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(-1);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const listRef = useRef(null);
  const uploadRef = useRef(null);

  const view = useMemo(() => {
    const k = sortKey, d = sortDir;
    return entries.slice().sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;             // folders first
      let r = 0;
      if (k === 'size') r = a.size - b.size;
      else if (k === 'type') r = typeOf(a).localeCompare(typeOf(b));
      if (!r) r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return r * d;
    });
  }, [entries, sortKey, sortDir]);

  const refresh = useCallback(async (dir) => {
    if (!client.connected) return;
    setLoadState({ loading: true, error: '' });
    setBusy(true);
    try {
      const { files, dirs } = await client.ls(dir);
      const next = dirs.map((p) => ({ path: p, name: baseName(p), dir: true, size: 0 }))
        .concat(files.map((f) => ({ path: f.path, name: baseName(f.path), dir: false, size: f.size })));
      setEntries(next);
      const keep = new Set(next.map((e) => e.path));
      setSelected((s) => new Set([...s].filter((p) => keep.has(p))));
      setLoadState({ loading: false, error: '' });
    } catch (e) {
      setEntries([]);
      setLoadState({ loading: false, error: 'Could not open ' + dir + ': ' + e.message });
    } finally {
      setBusy(false);
    }
  }, [client, setBusy]);

  // List the card when the session opens, and reset when it closes.
  useEffect(() => {
    if (connected) { setCwd('/'); refresh('/'); }
    else { setEntries([]); setSelected(new Set()); setAnchor(-1); setPreview(null); setCwd('/'); }
  }, [connected, refresh]);

  const navigate = (path) => {
    if (busyRef.current) return;
    const p = path || '/';
    setCwd(p);
    setSelected(new Set()); setAnchor(-1);
    refresh(p);
  };

  const onRowClick = (ev, idx) => {
    if (busyRef.current) return;
    const p = view[idx].path;
    setSelected((prev) => {
      const s = new Set(prev);
      if (ev.shiftKey && anchor >= 0) {
        if (!(ev.ctrlKey || ev.metaKey)) s.clear();
        const a = Math.min(anchor, idx), b = Math.max(anchor, idx);
        for (let i = a; i <= b; i++) s.add(view[i].path);
      } else if (ev.ctrlKey || ev.metaKey) {
        if (s.has(p)) s.delete(p); else s.add(p);
      } else {
        s.clear(); s.add(p);
      }
      return s;
    });
    if (!ev.shiftKey || anchor < 0) setAnchor(idx);
  };

  const fetchFile = (it) => client.getRetry(it.path, (r, t) => setStatus('reading ' + it.name + ' ' + fmtSize(r) + ' / ' + fmtSize(t)));

  const downloadItems = async (items) => {
    if (!items.length || busyRef.current) return;
    setBusy(true);
    try {
      for (const it of items) {
        log('GET ' + it.path + ' …');
        const bytes = await fetchFile(it);
        saveBytes(it.name, bytes);
        log('Saved ' + it.name + ' (' + bytes.length + ' B)');
      }
      setStatus('downloaded ' + items.length + ' file' + (items.length === 1 ? '' : 's'));
    } catch (e) { log('GET failed: ' + e.message); setStatus('download failed: ' + e.message); }
    finally { setBusy(false); }
  };

  // Every file and folder under the selection, with paths relative to cwd.
  const collectTree = async (items) => {
    const files = [], dirs = [];
    const rel = (p) => p.slice(cwd === '/' ? 1 : cwd.length + 1);
    const walk = async (dir) => {
      dirs.push({ path: dir, name: rel(dir) + '/' });
      setStatus('listing ' + dir + '…');
      const r = await client.ls(dir);
      for (const f of r.files) files.push({ path: f.path, name: rel(f.path), size: f.size });
      for (const sub of r.dirs) await walk(sub);
    };
    for (const it of items) {
      if (it.dir) await walk(it.path);
      else files.push({ path: it.path, name: rel(it.path), size: it.size });
    }
    return { files, dirs };
  };

  const writeTree = async (root, files, dirs) => {
    const dirCache = new Map([['', root]]);
    const dirFor = async (relDir) => {
      if (dirCache.has(relDir)) return dirCache.get(relDir);
      const i = relDir.lastIndexOf('/');
      const parent = await dirFor(i < 0 ? '' : relDir.slice(0, i));
      const h = await parent.getDirectoryHandle(relDir.slice(i + 1), { create: true });
      dirCache.set(relDir, h);
      return h;
    };
    for (const d of dirs) await dirFor(d.name.replace(/\/$/, ''));    // keeps empty folders
    const total = files.reduce((t, f) => t + f.size, 0);
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const bytes = await client.getRetry(f.path, (r) => {
        setStatus('saving ' + (i + 1) + '/' + files.length + ' · ' + fmtSize(done + r) + ' / ' + fmtSize(total));
      });
      done += bytes.length;
      const j = f.name.lastIndexOf('/');
      const dir = await dirFor(j < 0 ? '' : f.name.slice(0, j));
      const fh = await dir.getFileHandle(f.name.slice(j + 1), { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      log('Saved ' + f.name + ' (' + bytes.length + ' B)');
    }
  };

  // Files download normally. Folders need somewhere to go, so Chrome/Edge's
  // folder picker writes the tree as plain files into a folder the user picks;
  // without it, a folder's files fall back to ordinary downloads.
  const downloadSelection = async () => {
    const items = view.filter((e) => selected.has(e.path));
    if (!items.length || busyRef.current) return;
    if (!items.some((it) => it.dir)) return downloadItems(items);
    let root = null;
    if (window.showDirectoryPicker) {            // the picker must open straight from the click
      try { root = await window.showDirectoryPicker({ id: 'piglet-sd', mode: 'readwrite' }); }
      catch (e) { if (e.name === 'AbortError') return; root = null; }
    }
    setBusy(true);
    let fallback = null;
    try {
      const { files, dirs } = await collectTree(items);
      const total = files.reduce((t, f) => t + f.size, 0);
      if (total > DL_CONFIRM_BYTES &&
          !window.confirm('Download ' + files.length + ' files (' + fmtSize(total) + ')?\nOver USB this can take a while.')) {
        setStatus('download cancelled');
        return;
      }
      if (root) {
        await writeTree(root, files, dirs);
        setStatus('saved ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' (' + fmtSize(total) + ') into ' + root.name);
      } else {
        fallback = files.map((f) => ({ path: f.path, name: baseName(f.path), size: f.size }));
      }
    } catch (e) { log('Download failed: ' + e.message); setStatus('download failed: ' + e.message); }
    finally { setBusy(false); busyRef.current = false; }
    if (fallback) await downloadItems(fallback);
  };

  const previewItem = async (it) => {
    setBusy(true);
    try {
      const bytes = await fetchFile(it);
      const text = new TextDecoder().decode(bytes);
      const csv = extOf(it.name) === 'csv' ? parseWigle(text) : null;
      setPreview({ path: it.path, name: it.name, bytes, text, csv });
      if (csv && onCsvRows) onCsvRows(csv.rows, it.name);
      setStatus('previewing ' + it.name);
    } catch (e) { log('GET failed: ' + e.message); setStatus('preview failed: ' + e.message); }
    finally { setBusy(false); }
  };

  const openItem = (it) => {
    if (busyRef.current) return;
    if (it.dir) { navigate(it.path); return; }
    const max = extOf(it.name) === 'csv' ? CSV_PREVIEW_MAX : PREVIEW_MAX;
    if (TEXT_EXT.includes(extOf(it.name)) && it.size <= max) { previewItem(it); return; }
    downloadItems([it]);
  };

  // Folders are deleted contents-first: every file, then the folders deepest
  // first (the firmware's RM only removes a folder once it is empty). The log
  // the Piglet is writing is refused by the firmware ("busy") and kept.
  const deleteSelected = async () => {
    const items = view.filter((e) => selected.has(e.path));
    if (!items.length || busyRef.current) return;
    setBusy(true);
    let tree;
    try { tree = await collectTree(items); }
    catch (e) { setBusy(false); window.alert('Could not list the selection: ' + e.message); return; }
    const { files, dirs } = tree;
    const bytes = files.reduce((t, f) => t + f.size, 0);
    const what = !dirs.length
      ? (files.length === 1 ? files[0].path : files.length + ' files')
      : dirs.length + ' folder' + (dirs.length === 1 ? '' : 's') + ' and ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' (' + fmtSize(bytes) + ')';
    if (!window.confirm('Permanently delete ' + what + ' from the SD card?\nThis cannot be undone.')) {
      setBusy(false); setStatus('delete cancelled'); return;
    }
    let failed = 0, inUse = 0, n = 0;
    const total = files.length + dirs.length;
    for (const f of files) {
      setStatus('deleting ' + (++n) + '/' + total + ' · ' + f.name);
      try { await client.rm(f.path); log('Deleted ' + f.path); }
      catch (e) { if (/busy/.test(e.message)) inUse++; else failed++; log('RM failed ' + f.path + ': ' + e.message); }
    }
    const depth = (p) => p.split('/').length;
    for (const d of dirs.slice().sort((a, b) => depth(b.path) - depth(a.path))) {
      setStatus('deleting ' + (++n) + '/' + total + ' · ' + d.name);
      try { await client.rm(d.path); log('Deleted folder ' + d.path); }
      catch (e) { if (!inUse) failed++; log('RM failed ' + d.path + ': ' + e.message); }
    }
    setSelected(new Set());
    setBusy(false);
    busyRef.current = false;
    const notes = [];
    if (inUse) notes.push('The log the Piglet is writing right now was kept (and its folder with it).');
    if (failed) notes.push(failed + ' item(s) could not be deleted — see the log.' +
      (dirs.length ? ' Deleting folders needs the latest Piglet firmware.' : ''));
    setStatus(notes.length ? 'delete finished with notes' : 'deleted ' + what);
    if (notes.length) window.alert(notes.join('\n'));
    refresh(cwd);
  };

  const uploadFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length || busyRef.current) return;
    const clash = list.filter((f) => entries.some((e) => !e.dir && e.name === f.name)).map((f) => f.name);
    if (clash.length && !window.confirm('Replace existing file' + (clash.length > 1 ? 's' : '') + ' in ' + cwd + '?\n' + clash.join('\n'))) return;
    setBusy(true);
    try {
      for (const file of list) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = joinPath(cwd, file.name);
        log('PUT ' + path + ' (' + bytes.length + ' B) …');
        await client.put(path, bytes, (s, t) => setStatus('uploading ' + file.name + ' ' + fmtSize(s) + ' / ' + fmtSize(t)));
        log('Uploaded ' + path);
      }
      setStatus('uploaded ' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' to ' + cwd);
    } catch (e) { log('PUT failed: ' + e.message); window.alert('Upload failed: ' + e.message); }
    finally { setBusy(false); busyRef.current = false; }
    refresh(cwd);
  };

  const onListKey = (ev) => {
    if (busyRef.current || preview) return;
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'a') {
      ev.preventDefault(); setSelected(new Set(view.map((e) => e.path)));
    } else if (k === 'Delete') {
      ev.preventDefault(); deleteSelected();
    } else if (k === 'Backspace') {
      ev.preventDefault(); if (cwd !== '/') navigate(parentOf(cwd));
    } else if (k === 'Enter') {
      const sel = view.filter((e) => selected.has(e.path));
      if (sel.length === 1) { ev.preventDefault(); openItem(sel[0]); }
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!view.length) return;
      ev.preventDefault();
      const cur = anchor >= 0 ? anchor : (k === 'ArrowDown' ? -1 : view.length);
      const next = Math.max(0, Math.min(view.length - 1, cur + (k === 'ArrowDown' ? 1 : -1)));
      setSelected((prev) => { const s = ev.shiftKey ? new Set(prev) : new Set(); s.add(view[next].path); return s; });
      setAnchor(next);
      const row = listRef.current && listRef.current.querySelector('[data-idx="' + next + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  };

  const selItems = view.filter((e) => selected.has(e.path));
  const selFiles = selItems.filter((e) => !e.dir);
  const nd = view.filter((e) => e.dir).length, nf = view.length - nd;
  let statusLine = nd + ' folder' + (nd === 1 ? '' : 's') + ', ' + nf + ' file' + (nf === 1 ? '' : 's');
  if (selItems.length) {
    statusLine += ' · ' + selItems.length + ' selected' + (selFiles.length ? ' (' + fmtSize(selFiles.reduce((t, e) => t + e.size, 0)) + ')' : '');
  }
  const segs = cwd.split('/').filter(Boolean);
  const arrow = (k) => (sortKey === k ? (sortDir > 0 ? ' ▴' : ' ▾') : '');
  const onSort = (k) => { if (sortKey === k) setSortDir(-sortDir); else { setSortKey(k); setSortDir(1); } };
  const tb = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="bg-[#0d1016] border border-slate-700 rounded-xl overflow-hidden shadow-xl">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
          <i className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
          <i className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        </span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200 mx-auto">
          {segs.length ? <Folder className="w-3.5 h-3.5 text-amber-400" /> : <HardDrive className="w-3.5 h-3.5 text-slate-400" />}
          {segs.length ? segs[segs.length - 1] : 'SD card'}
        </span>
      </div>

      {/* Toolbar + address bar */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 border-b border-slate-800 bg-[#12151c]">
        <button type="button" className={`${tb} bg-slate-800 hover:bg-slate-700 text-slate-200`} title="Up one folder (Backspace)"
          disabled={busy || cwd === '/'} onClick={() => navigate(parentOf(cwd))}>
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button type="button" className={`${tb} bg-slate-800 hover:bg-slate-700 text-slate-200`} title="Refresh"
          disabled={busy} onClick={() => refresh(cwd)}>
          <RefreshCw className={`w-3.5 h-3.5 ${loadState.loading ? 'animate-spin' : ''}`} />
        </button>
        <nav className="flex-1 min-w-[10rem] flex items-center gap-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono overflow-x-auto" aria-label="Current folder">
          <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {segs.length === 0 ? <span className="text-slate-100">SD</span> : (
            <button type="button" className="text-amber-300 hover:underline" onClick={() => navigate('/')}>SD</button>
          )}
          {segs.map((s, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
              {i === segs.length - 1 ? <span className="text-slate-100">{s}</span> : (
                <button type="button" className="text-amber-300 hover:underline" onClick={() => navigate('/' + segs.slice(0, i + 1).join('/'))}>{s}</button>
              )}
            </React.Fragment>
          ))}
        </nav>
        <button type="button" className={`${tb} bg-slate-800 hover:bg-slate-700 text-slate-200`} title="Upload into this folder (or drop files on the list)"
          disabled={busy} onClick={() => uploadRef.current && uploadRef.current.click()}>
          <Upload className="w-3.5 h-3.5" /><span>Upload</span>
        </button>
        <button type="button" className={`${tb} bg-amber-500 hover:bg-amber-400 text-slate-950`}
          title={selItems.some((e) => e.dir) ? 'Download into a folder you choose' : 'Download selected'}
          disabled={busy || !selItems.length} onClick={downloadSelection}>
          <Download className="w-3.5 h-3.5" /><span>Download</span>
        </button>
        <button type="button" className={`${tb} bg-rose-600/80 hover:bg-rose-600 text-white`} title="Delete selected (Del)"
          disabled={busy || !selItems.length} onClick={deleteSelected}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <input ref={uploadRef} type="file" multiple className="hidden"
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* File list */}
      <div
        ref={listRef}
        tabIndex={0}
        aria-label="Files"
        onKeyDown={onListKey}
        onClick={(ev) => { if (ev.target === ev.currentTarget) { setSelected(new Set()); setAnchor(-1); } }}
        onDragOver={(ev) => { if (!connected || busy) return; ev.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(ev) => { ev.preventDefault(); setDragOver(false); if (connected && !busy) uploadFiles(ev.dataTransfer.files); }}
        className={`min-h-[18rem] max-h-[28rem] overflow-y-auto outline-none select-none text-xs ${dragOver ? 'ring-2 ring-inset ring-amber-500 bg-amber-500/5' : ''}`}
      >
        <div className="grid grid-cols-[1fr_6rem_7rem] gap-2 px-3 py-1.5 sticky top-0 bg-slate-900 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400">
          <span className="cursor-pointer" onClick={() => onSort('name')}>Name{arrow('name')}</span>
          <span className="cursor-pointer text-right" onClick={() => onSort('size')}>Size{arrow('size')}</span>
          <span className="cursor-pointer" onClick={() => onSort('type')}>Type{arrow('type')}</span>
        </div>
        {cwd !== '/' && !loadState.loading && (
          <div className="grid grid-cols-[1fr_6rem_7rem] gap-2 px-3 py-1.5 hover:bg-slate-800/50 cursor-default"
            onDoubleClick={() => navigate(parentOf(cwd))}>
            <span className="flex items-center gap-2"><FolderUp className="w-4 h-4 text-amber-400" /><b className="font-semibold text-slate-200">..</b></span>
            <span />
            <span className="text-slate-500">Parent folder</span>
          </div>
        )}
        {loadState.loading ? (
          <div className="py-12 text-center text-slate-500">Loading {cwd}…</div>
        ) : loadState.error ? (
          <div className="py-12 text-center text-rose-400">{loadState.error}</div>
        ) : !view.length ? (
          <div className="py-12 text-center text-slate-500">This folder is empty. Drop files here to upload.</div>
        ) : view.map((it, idx) => (
          <div
            key={it.path}
            data-idx={idx}
            title={it.path}
            onClick={(ev) => onRowClick(ev, idx)}
            onDoubleClick={() => openItem(it)}
            className={`grid grid-cols-[1fr_6rem_7rem] gap-2 px-3 py-1.5 cursor-default ${selected.has(it.path) ? 'bg-amber-500/20 text-amber-100' : 'hover:bg-slate-800/50 text-slate-200'}`}
          >
            <span className="flex items-center gap-2 min-w-0"><EntryIcon entry={it} /><b className="font-semibold truncate">{it.name}</b></span>
            <span className="text-right font-mono text-slate-400">{it.dir ? '—' : fmtSize(it.size)}</span>
            <span className="text-slate-500 truncate">{typeOf(it)}</span>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-900 text-[11px] text-slate-400 flex justify-between gap-2">
        <span>{statusLine}</span>
        <span className="hidden sm:inline text-slate-600">Double-click to open · Ctrl/Shift to multi-select · Del to delete</span>
      </div>

      {preview && <PreviewModal preview={preview} onClose={() => { setPreview(null); listRef.current && listRef.current.focus(); }} />}
    </div>
  );
}
