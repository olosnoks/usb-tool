import { describe, it, expect } from 'vitest';
import { createPackStore } from '../src/utils/packStore';

// A tiny in-memory IndexedDB: just what packStore calls.
function fakeIdb() {
  const data = new Map();
  const req = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
  const store = {
    put: (v) => req(() => { data.set(v.key, v); return v.key; }),
    get: (k) => req(() => data.get(k)),
    getAll: () => req(() => [...data.values()]),
    delete: (k) => req(() => { data.delete(k); })
  };
  const db = { createObjectStore() {}, transaction: () => ({ objectStore: () => store }) };
  return { open: () => { const r = { result: db }; queueMicrotask(() => { r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
}

describe('packStore', () => {
  it('saves, lists, loads and removes files by kind and name', async () => {
    const s = createPackStore(fakeIdb());
    const bytes = Uint8Array.from([1, 2, 3]);
    expect(await s.save('svd', 'STM32F103.svd', bytes)).toBe(true);
    await s.save('pack', 'Keil.STM32F1.pack', bytes);
    expect(await s.list('svd')).toEqual(['STM32F103.svd']);
    expect(Array.from(await s.load('svd', 'STM32F103.svd'))).toEqual([1, 2, 3]);
    expect(await s.load('svd', 'missing')).toBeNull();
    await s.remove('svd', 'STM32F103.svd');
    expect(await s.list('svd')).toEqual([]);
  });

  it('is a harmless no-op without IndexedDB', async () => {
    const s = createPackStore(null);
    expect(s.available).toBe(false);
    expect(await s.save('svd', 'a', new Uint8Array(1))).toBe(false);
    expect(await s.list('svd')).toEqual([]);
    expect(await s.load('svd', 'a')).toBeNull();
  });
});
