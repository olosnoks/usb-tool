/**
 * IndexedDB store for CMSIS-Pack / FLM / SVD files, keyed by kind and name, so
 * a pack loaded once is still there next visit. Everything degrades to a no-op
 * when IndexedDB is unavailable (private mode, tests); pass `factory` to inject one.
 */

const DB_NAME = 'usb-tool-dap-files';
const STORE = 'files';

function open(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export function createPackStore(factory = (typeof indexedDB !== 'undefined' ? indexedDB : null)) {
  const available = !!factory;
  const run = async (mode, fn, fallback) => {
    if (!available) return fallback;
    try {
      const db = await open(factory);
      return await fn(db.transaction(STORE, mode).objectStore(STORE));
    } catch (e) {
      return fallback;
    }
  };
  return {
    available,
    /** kind: 'pack' | 'flm' | 'svd'. Resolves true when stored. */
    save: (kind, name, bytes) => run('readwrite', async (s) => { await wrap(s.put({ key: `${kind}:${name}`, kind, name, bytes, savedAt: Date.now() })); return true; }, false),
    load: (kind, name) => run('readonly', async (s) => (await wrap(s.get(`${kind}:${name}`)))?.bytes ?? null, null),
    list: (kind) => run('readonly', async (s) => (await wrap(s.getAll())).filter((r) => r.kind === kind).map((r) => r.name).sort(), []),
    remove: (kind, name) => run('readwrite', async (s) => { await wrap(s.delete(`${kind}:${name}`)); return true; }, false)
  };
}

export const packStore = createPackStore();
