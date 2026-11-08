import { useCallback, useEffect, useRef, useState } from 'react';
import { getSqlJs } from '../../../utils/sqljs.js';
import { registerFunctions, readPragmas, writePragmas, PRAGMAS, scalar } from '../../../utils/sqliteStudio.js';

// Session pragmas (not stored in the file) are reset whenever sql.js
// serializes the database, so they're captured and re-applied around export().
const SESSION_PRAGMAS = PRAGMAS.filter((p) => !p.stored && p.kind !== 'readonly' && p.name !== 'journal_mode').map((p) => p.name);

const FINGERPRINT_SQL = 'SELECT total_changes(), (SELECT * FROM pragma_schema_version), (SELECT * FROM pragma_user_version), (SELECT * FROM pragma_application_id), (SELECT * FROM pragma_page_size), (SELECT * FROM pragma_auto_vacuum)';

export const SQLITE_EXTS = ['.sqlite', '.sqlite3', '.db', '.db3', '.s3db', '.sl3'];
export const SQLITE_ACCEPT = SQLITE_EXTS.join(',') + ',application/x-sqlite3,application/vnd.sqlite3';
const FS_TYPES = [{ description: 'SQLite database', accept: { 'application/x-sqlite3': SQLITE_EXTS } }];

export const hasFsAccess = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

export function downloadBytes(name, bytes, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function writeHandle(handle, bytes) {
  if (handle.requestPermission && (await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
    const p = await handle.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') throw new Error('Permission to write the file was denied');
  }
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

/**
 * One open database, DB4S-style: edits happen in memory; "Write Changes"
 * persists them (to the original file when the browser supports the File
 * System Access API, otherwise via Save As / download); "Revert Changes" goes
 * back to the last written state.
 */
export function useDbSession(onLog) {
  const dbRef = useRef(null);
  const savedRef = useRef(null);   // bytes of the last written state
  const baseRef = useRef('');      // fingerprint at the last written state
  const [info, setInfo] = useState(null); // { name, handle, size }
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [sqlLog, setSqlLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const fingerprint = () => {
    try { return JSON.stringify(dbRef.current.exec(FINGERPRINT_SQL)[0].values[0]); } catch { return ''; }
  };

  const logSql = useCallback((sql, source = 'app') => {
    if (!sql) return;
    const entries = (Array.isArray(sql) ? sql : [sql]).map((s) => ({ t: new Date(), source, sql: s }));
    setSqlLog((l) => [...l, ...entries].slice(-2000));
  }, []);

  /** Re-render consumers and recompute the dirty flag. */
  const refresh = useCallback(() => {
    if (!dbRef.current) return;
    setDirty(fingerprint() !== baseRef.current);
    setVersion((v) => v + 1);
  }, []);

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

  /** Serialize to bytes (sql.js reopens the DB; restore functions + session pragmas). */
  const snapshot = useCallback(() => {
    const db = dbRef.current;
    const prag = readPragmas(db);
    const bytes = db.export();
    registerFunctions(db);
    const restore = {};
    for (const n of SESSION_PRAGMAS) if (prag[n] !== null && prag[n] !== undefined) restore[n] = prag[n];
    try { writePragmas(db, restore); } catch { /* best effort */ }
    return bytes;
  }, []);

  const markClean = (bytes) => {
    savedRef.current = bytes;
    baseRef.current = fingerprint();
    setDirty(false);
    setVersion((v) => v + 1);
  };

  const load = useCallback(async (name, bytes, handle = null) => {
    const SQL = await getSqlJs();
    const db = bytes ? new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : new SQL.Database();
    try {
      scalar(db, 'SELECT count(*) FROM sqlite_master'); // validates the header / file
    } catch (e) {
      db.close();
      throw new Error(`${name}: not a valid SQLite database (${e.message})`);
    }
    registerFunctions(db);
    db.run('PRAGMA foreign_keys = ON'); // DB4S default
    try { dbRef.current?.close(); } catch { /* ignore */ }
    dbRef.current = db;
    const saved = bytes ? (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : db.export();
    if (!bytes) { registerFunctions(db); db.run('PRAGMA foreign_keys = ON'); }
    setInfo({ name, handle, size: saved.byteLength });
    setSqlLog([]);
    markClean(saved);
    onLog?.(`Opened ${name} (${(saved.byteLength / 1024).toFixed(0)} KB)`);
    return db;
  }, [onLog]);

  const open = useCallback(async (name, bytes, handle) => {
    setBusy(true);
    try { return await load(name, bytes, handle); } finally { setBusy(false); }
  }, [load]);

  /** Open via the File System Access picker; returns false if unsupported. */
  const openWithPicker = useCallback(async () => {
    if (!hasFsAccess()) return false;
    let handle;
    try { [handle] = await window.showOpenFilePicker({ types: FS_TYPES, excludeAcceptAllOption: false }); } catch (e) {
      if (e.name === 'AbortError') return true;
      return false; // e.g. blocked in an iframe — fall back to <input type=file>
    }
    const file = await handle.getFile();
    await open(file.name, new Uint8Array(await file.arrayBuffer()), handle);
    return true;
  }, [open]);

  const create = useCallback((name = 'untitled.sqlite') => open(name, null, null), [open]);

  const saveAs = useCallback(async (suggested) => {
    if (!dbRef.current) return;
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
        setInfo({ name: handle.name || name, handle, size: bytes.byteLength });
        markClean(bytes);
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

  /** Persist changes: to the file handle if we have one, else Save As. */
  const writeChanges = useCallback(async () => {
    if (!dbRef.current) return false;
    if (!info?.handle) return saveAs();
    const bytes = snapshot();
    await writeHandle(info.handle, bytes);
    setInfo((i) => ({ ...i, size: bytes.byteLength }));
    markClean(bytes);
    logSql('-- changes written to ' + info.name);
    onLog?.(`Wrote changes to ${info.name}`);
    return true;
  }, [info, saveAs, snapshot, logSql, onLog]);

  const revert = useCallback(async () => {
    if (!savedRef.current || !info) return;
    const SQL = await getSqlJs();
    const db = new SQL.Database(savedRef.current);
    registerFunctions(db);
    db.run('PRAGMA foreign_keys = ON');
    try { dbRef.current?.close(); } catch { /* ignore */ }
    dbRef.current = db;
    baseRef.current = fingerprint();
    setDirty(false);
    setVersion((v) => v + 1);
    logSql('-- reverted to last written state');
    onLog?.(`Reverted ${info.name}`);
  }, [info, logSql, onLog]);

  const close = useCallback(() => {
    try { dbRef.current?.close(); } catch { /* ignore */ }
    dbRef.current = null; savedRef.current = null; baseRef.current = '';
    setInfo(null); setDirty(false); setSqlLog([]); setVersion((v) => v + 1);
  }, []);

  /** Current bytes without changing saved state (for export/combine). */
  const currentBytes = useCallback(() => (dbRef.current ? snapshot() : null), [snapshot]);

  // Warn before leaving the page with unwritten changes; free memory on unmount.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => () => { try { dbRef.current?.close(); } catch { /* ignore */ } }, []);

  return {
    get db() { return dbRef.current; },
    info, version, dirty, busy, sqlLog,
    open, openWithPicker, create, close, revert, writeChanges, saveAs, currentBytes,
    mutate, exec, refresh, logSql, clearLog: () => setSqlLog([]),
  };
}
