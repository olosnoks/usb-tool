import { useCallback, useEffect, useRef, useState } from 'react';
import { getSqlJs } from '../../../utils/sqljs.js';
import { registerFunctions, readPragmas, writePragmas, PRAGMAS, scalar, qid } from '../../../utils/sqliteStudio.js';

// Session pragmas (not stored in the file) are reset whenever sql.js
// serializes the database, so they're captured and re-applied around export().
const SESSION_PRAGMAS = PRAGMAS.filter((p) => !p.stored && p.kind !== 'readonly' && p.name !== 'journal_mode').map((p) => p.name);

const FINGERPRINT_SQL = 'SELECT total_changes(), (SELECT * FROM pragma_schema_version), (SELECT * FROM pragma_user_version), (SELECT * FROM pragma_application_id), (SELECT * FROM pragma_page_size), (SELECT * FROM pragma_auto_vacuum)';

export const SQLITE_EXTS = ['.sqlite', '.sqlite3', '.db', '.db3', '.s3db', '.sl3'];
export const SQLITE_ACCEPT = SQLITE_EXTS.join(',') + ',application/x-sqlite3,application/vnd.sqlite3';
const FS_TYPES = [{ description: 'SQLite database', accept: { 'application/x-sqlite3': SQLITE_EXTS } }];
const MAX_UNDO = 200;

export const hasFsAccess = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

export function downloadBytes(name, bytes, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function ensurePermission(handle, mode) {
  if (!handle.queryPermission) return;
  if ((await handle.queryPermission({ mode })) === 'granted') return;
  if ((await handle.requestPermission({ mode })) !== 'granted') throw new Error(`Permission to ${mode === 'readwrite' ? 'write' : 'read'} ${handle.name} was denied`);
}

async function writeHandle(handle, bytes) {
  await ensurePermission(handle, 'readwrite');
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

// ---- recent files (File System Access handles kept in IndexedDB) ----
const IDB = { name: 'dbbrowser', store: 'recent' };
function idb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const r = indexedDB.open(IDB.name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB.store, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const q = db.transaction(IDB.store).objectStore(IDB.store).getAll();
    q.onsuccess = () => resolve(q.result.sort((a, b) => b.t - a.t));
    q.onerror = () => reject(q.error);
  });
}
async function idbPut(entries, removeIds = []) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB.store, 'readwrite');
    const st = tx.objectStore(IDB.store);
    removeIds.forEach((id) => st.delete(id));
    entries.forEach((e) => st.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * One open database, DB4S-style: edits happen in memory; "Write Changes"
 * persists them (to the original file when the browser supports the File
 * System Access API, otherwise via Save As / download); "Revert Changes" goes
 * back to the last written state. Also: read-only mode, attached databases,
 * an undo/redo stack for Browse edits, and recent files.
 */
export function useDbSession(onLog) {
  const dbRef = useRef(null);
  const savedRef = useRef(null);   // bytes of the last written state
  const baseRef = useRef('');      // fingerprint at the last written state
  const forcedDirty = useRef(false); // dirty state carried across a non-saving export
  const attachRef = useRef([]);    // [{ alias, name, holder }]
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const readOnlyRef = useRef(false);
  const [info, setInfo] = useState(null); // { name, handle, size, readOnly, sink }
  // sink: { label, write(bytes) } — where Write Changes goes when there is no file handle
  // (an embedding page's own store, e.g. the WarHog flasher's SD card).
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [sqlLog, setSqlLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [recent, setRecent] = useState([]);

  const fingerprint = () => {
    try { return JSON.stringify(dbRef.current.exec(FINGERPRINT_SQL)[0].values[0]); } catch { return ''; }
  };
  const computeDirty = () => forcedDirty.current || fingerprint() !== baseRef.current;

  const logSql = useCallback((sql, source = 'app') => {
    if (!sql) return;
    const entries = (Array.isArray(sql) ? sql : [sql]).map((s) => ({ t: new Date(), source, sql: s }));
    setSqlLog((l) => [...l, ...entries].slice(-2000));
  }, []);

  /** Re-render consumers and recompute the dirty flag. */
  const refresh = useCallback(() => {
    if (!dbRef.current) return;
    setDirty(computeDirty());
    setVersion((v) => v + 1);
  }, []);

  /** Per-connection setup: functions, default pragmas, read-only, attachments. */
  const prepare = (db, sessionPragmas) => {
    registerFunctions(db);
    if (sessionPragmas) { try { writePragmas(db, sessionPragmas); } catch { /* best effort */ } } else db.run('PRAGMA foreign_keys = ON'); // DB4S default
    for (const a of attachRef.current) {
      try { db.run(`ATTACH ? AS ${qid(a.alias)}`, ['/' + a.holder.filename]); } catch (e) { onLog?.(`Re-attach ${a.alias} failed: ${e.message}`); }
    }
    if (readOnlyRef.current) db.run('PRAGMA query_only = ON');
  };

  /** Run a mutation fn(db); log its SQL; refresh. Errors propagate. */
  const mutate = useCallback((fn, source = 'app') => {
    const db = dbRef.current;
    if (!db) throw new Error('No database open');
    try {
      const res = fn(db);
      const sqls = res && (res.sql || res.sqls);
      if (sqls) logSql(sqls, source);
      return res;
    } finally {
      refresh();
    }
  }, [logSql, refresh]);

  const exec = useCallback((sql, params, source = 'app') => mutate((db) => { db.run(sql, params); return { sql }; }, source), [mutate]);

  /** Serialize to bytes (sql.js reopens the DB; restore everything per-connection). */
  const snapshot = useCallback(() => {
    const db = dbRef.current;
    const wasDirty = computeDirty();
    const prag = readPragmas(db);
    if (readOnlyRef.current) db.run('PRAGMA query_only = OFF');
    const bytes = db.export();
    const restore = {};
    for (const n of SESSION_PRAGMAS) if (prag[n] !== null && prag[n] !== undefined) restore[n] = prag[n];
    prepare(db, restore);
    baseRef.current = fingerprint();
    forcedDirty.current = wasDirty;
    return bytes;
  }, []);

  const markClean = (bytes) => {
    savedRef.current = bytes;
    baseRef.current = fingerprint();
    forcedDirty.current = false;
    setDirty(false);
    setVersion((v) => v + 1);
  };

  const clearUndo = () => { undoRef.current = []; redoRef.current = []; };

  const detachAll = () => {
    for (const a of attachRef.current) { try { a.holder.close(); } catch { /* ignore */ } }
    attachRef.current = [];
    setAttachments([]);
  };

  const rememberRecent = async (handle) => {
    if (!handle) return;
    try {
      const all = await idbAll();
      const dupes = [];
      for (const e of all) { try { if (await e.handle.isSameEntry(handle)) dupes.push(e.id); } catch { /* stale */ } }
      const keep = all.filter((e) => !dupes.includes(e.id));
      const extra = keep.slice(9).map((e) => e.id);
      await idbPut([{ id: `${Date.now()}-${Math.random()}`, name: handle.name, handle, t: Date.now() }], [...dupes, ...extra]);
      setRecent(await idbAll());
    } catch { /* recent files are best effort */ }
  };
  useEffect(() => { idbAll().then(setRecent).catch(() => {}); }, []);

  const load = useCallback(async (name, bytes, handle = null, { readOnly = false, sink = null } = {}) => {
    const SQL = await getSqlJs();
    const db = bytes ? new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : new SQL.Database();
    try {
      scalar(db, 'SELECT count(*) FROM sqlite_master'); // validates the header / file
    } catch (e) {
      db.close();
      throw new Error(`${name}: not a valid SQLite database (${e.message})`);
    }
    try { dbRef.current?.close(); } catch { /* ignore */ }
    detachAll();
    readOnlyRef.current = readOnly;
    dbRef.current = db;
    const saved = bytes ? (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : db.export();
    prepare(db);
    clearUndo();
    setInfo({ name, handle, size: saved.byteLength, readOnly, sink });
    setSqlLog([]);
    markClean(saved);
    onLog?.(`Opened ${name} (${(saved.byteLength / 1024).toFixed(0)} KB)${readOnly ? ' read-only' : ''}`);
    if (handle) rememberRecent(handle);
    return db;
  }, [onLog]);

  const open = useCallback(async (name, bytes, handle, opts) => {
    setBusy(true);
    try { return await load(name, bytes, handle, opts); } finally { setBusy(false); }
  }, [load]);

  /** Open via the File System Access picker; returns false if unsupported. */
  const openWithPicker = useCallback(async (opts) => {
    if (!hasFsAccess()) return false;
    let handle;
    try { [handle] = await window.showOpenFilePicker({ types: FS_TYPES, excludeAcceptAllOption: false }); } catch (e) {
      if (e.name === 'AbortError') return true;
      return false; // e.g. blocked in an iframe — fall back to <input type=file>
    }
    const file = await handle.getFile();
    await open(file.name, new Uint8Array(await file.arrayBuffer()), handle, opts);
    return true;
  }, [open]);

  const openRecent = useCallback(async (entry, opts) => {
    await ensurePermission(entry.handle, opts?.readOnly ? 'read' : 'readwrite');
    const file = await entry.handle.getFile();
    await open(file.name, new Uint8Array(await file.arrayBuffer()), entry.handle, opts);
  }, [open]);

  const forgetRecent = useCallback(async () => { try { const all = await idbAll(); await idbPut([], all.map((e) => e.id)); } catch { /* ignore */ } setRecent([]); }, []);

  const create = useCallback((name = 'untitled.sqlite') => open(name, null, null), [open]);

  const saveAs = useCallback(async (suggested) => {
    if (!dbRef.current) return false;
    const bytes = snapshot();
    const name = suggested || info?.name || 'database.sqlite';
    if (typeof window.showSaveFilePicker === 'function') {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: FS_TYPES }); } catch (e) {
        if (e.name === 'AbortError') return false;
        handle = null;
      }
      if (handle) {
        await writeHandle(handle, bytes);
        readOnlyRef.current = false;
        try { dbRef.current.run('PRAGMA query_only = OFF'); } catch { /* ignore */ }
        setInfo({ name: handle.name || name, handle, size: bytes.byteLength, readOnly: false });
        markClean(bytes);
        rememberRecent(handle);
        onLog?.(`Saved ${handle.name || name} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
        return true;
      }
    }
    downloadBytes(name, bytes, 'application/x-sqlite3');
    setInfo((i) => ({ ...i, name, size: bytes.byteLength }));
    markClean(bytes);
    onLog?.(`Downloaded ${name} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
    return true;
  }, [info, snapshot, onLog]);

  /** Write to a host sink { label, write(bytes) } and keep it: later Write Changes go there too. */
  const writeTo = useCallback(async (sink) => {
    if (!dbRef.current || readOnlyRef.current) return false;
    const bytes = snapshot();
    await sink.write(bytes);
    setInfo((i) => ({ ...i, sink, size: bytes.byteLength }));
    markClean(bytes);
    logSql('-- changes written to ' + sink.label);
    onLog?.(`Wrote changes to ${sink.label}`);
    return true;
  }, [snapshot, logSql, onLog]);

  /** Persist changes: to the file handle if we have one, else to the host's sink, else Save As. */
  const writeChanges = useCallback(async () => {
    if (!dbRef.current || readOnlyRef.current) return false;
    if (!info?.handle) return info?.sink ? writeTo(info.sink) : saveAs();
    const bytes = snapshot();
    await writeHandle(info.handle, bytes);
    setInfo((i) => ({ ...i, size: bytes.byteLength }));
    markClean(bytes);
    logSql('-- changes written to ' + info.name);
    onLog?.(`Wrote changes to ${info.name}`);
    return true;
  }, [info, saveAs, writeTo, snapshot, logSql, onLog]);

  /** Attach (or drop) a host sink for Write Changes on the open database. */
  const setSink = useCallback((sink) => setInfo((i) => (i ? { ...i, sink: sink || null } : i)), []);

  const revert = useCallback(async () => {
    if (!savedRef.current || !info) return;
    const SQL = await getSqlJs();
    const db = new SQL.Database(savedRef.current);
    try { dbRef.current?.close(); } catch { /* ignore */ }
    dbRef.current = db;
    prepare(db);
    clearUndo();
    baseRef.current = fingerprint();
    forcedDirty.current = false;
    setDirty(false);
    setVersion((v) => v + 1);
    logSql('-- reverted to last written state');
    onLog?.(`Reverted ${info.name}`);
  }, [info, logSql, onLog]);

  const close = useCallback(() => {
    try { dbRef.current?.close(); } catch { /* ignore */ }
    detachAll();
    dbRef.current = null; savedRef.current = null; baseRef.current = ''; forcedDirty.current = false;
    clearUndo();
    setInfo(null); setDirty(false); setSqlLog([]); setVersion((v) => v + 1);
  }, []);

  /** Current bytes without changing saved state (for export/combine). */
  const currentBytes = useCallback(() => (dbRef.current ? snapshot() : null), [snapshot]);

  // ---- attached databases ----
  const attach = useCallback(async (name, bytes, alias) => {
    const db = dbRef.current;
    if (!db) throw new Error('Open a database first');
    const a = String(alias || '').trim();
    if (!/^[A-Za-z_][\w$]*$/.test(a)) throw new Error('Schema name must be a plain identifier (letters, digits, _)');
    if (['main', 'temp'].includes(a.toLowerCase()) || attachRef.current.some((x) => x.alias.toLowerCase() === a.toLowerCase())) throw new Error(`Schema name "${a}" is already in use`);
    const SQL = await getSqlJs();
    const holder = new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    try { scalar(holder, 'SELECT count(*) FROM sqlite_master'); } catch (e) { holder.close(); throw new Error(`${name}: not a valid SQLite database (${e.message})`); }
    try {
      const ro = readOnlyRef.current;
      if (ro) db.run('PRAGMA query_only = OFF');
      db.run(`ATTACH ? AS ${qid(a)}`, ['/' + holder.filename]);
      if (ro) db.run('PRAGMA query_only = ON');
    } catch (e) { holder.close(); throw e; }
    attachRef.current = [...attachRef.current, { alias: a, name, holder }];
    setAttachments(attachRef.current.map(({ alias: x, name: n }) => ({ alias: x, name: n })));
    logSql(`ATTACH '${name}' AS ${qid(a)}`);
    refresh();
  }, [logSql, refresh]);

  const detach = useCallback((alias) => {
    const db = dbRef.current;
    const entry = attachRef.current.find((x) => x.alias === alias);
    if (!db || !entry) return;
    db.run(`DETACH ${qid(alias)}`);
    try { entry.holder.close(); } catch { /* ignore */ }
    attachRef.current = attachRef.current.filter((x) => x !== entry);
    setAttachments(attachRef.current.map(({ alias: x, name: n }) => ({ alias: x, name: n })));
    logSql(`DETACH ${qid(alias)}`);
    refresh();
  }, [logSql, refresh]);

  /** Bytes of an attached database (including changes made through this session). */
  const attachedBytes = useCallback((alias) => attachRef.current.find((x) => x.alias === alias)?.holder.export() || null, []);

  // ---- undo / redo (Browse edits) ----
  /** Record an undoable action: { label, undo(db), redo(db) } — call after doing it. */
  const pushUndo = useCallback((action) => {
    undoRef.current = [...undoRef.current, { ...action, schema: scalar(dbRef.current, 'PRAGMA schema_version') }].slice(-MAX_UNDO);
    redoRef.current = [];
  }, []);

  const step = (from, to, kind) => {
    const db = dbRef.current;
    const stack = from.current;
    if (!db || !stack.length) return;
    const action = stack[stack.length - 1];
    if (scalar(db, 'PRAGMA schema_version') !== action.schema) {
      clearUndo(); refresh();
      throw new Error('The schema changed since this edit, so it can no longer be undone');
    }
    mutate((d) => {
      d.run('SAVEPOINT sqlb_undo');
      try { action[kind](d); d.run('RELEASE sqlb_undo'); } catch (e) { d.run('ROLLBACK TO sqlb_undo'); d.run('RELEASE sqlb_undo'); throw e; }
      return { sql: `-- ${kind}: ${action.label}` };
    });
    from.current = stack.slice(0, -1);
    to.current = [...to.current, { ...action, schema: scalar(db, 'PRAGMA schema_version') }];
  };
  const undo = useCallback(() => step(undoRef, redoRef, 'undo'), [mutate]);
  const redo = useCallback(() => step(redoRef, undoRef, 'redo'), [mutate]);

  // Warn before leaving the page with unwritten changes; free memory on unmount.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => () => { try { dbRef.current?.close(); } catch { /* ignore */ } detachAll(); }, []);

  return {
    get db() { return dbRef.current; },
    info, version, dirty, busy, sqlLog, attachments, recent,
    readOnly: !!info?.readOnly,
    canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0,
    undoLabel: undoRef.current[undoRef.current.length - 1]?.label, redoLabel: redoRef.current[redoRef.current.length - 1]?.label,
    open, openWithPicker, openRecent, forgetRecent, create, close, revert, writeChanges, writeTo, saveAs, currentBytes, setSink,
    attach, detach, attachedBytes,
    mutate, exec, refresh, logSql, clearLog: () => setSqlLog([]),
    pushUndo, undo, redo,
  };
}
