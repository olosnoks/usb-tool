import { describe, it, expect } from 'vitest';
import {
  loadMacros, saveMacros, exportMacros, importMacros, expandEscapes, normalizeMacro, MACROS_STORAGE_KEY
} from '../src/utils/consoleMacros';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

describe('console macros', () => {
  it('survive a reload (save then load from the same storage)', () => {
    const st = memStorage();
    const macros = [normalizeMacro({ name: 'Reset', text: 'reset', ending: '\r' }), normalizeMacro({ name: 'Ver', text: 'version' })];
    expect(saveMacros(macros, st)).toBe(true);
    const loaded = loadMacros(st);
    expect(loaded.map((m) => [m.name, m.text, m.ending])).toEqual([['Reset', 'reset', '\r'], ['Ver', 'version', '\r\n']]);
  });
  it('tolerates empty or corrupt storage', () => {
    const st = memStorage();
    expect(loadMacros(st)).toEqual([]);
    st.setItem(MACROS_STORAGE_KEY, '{not json');
    expect(loadMacros(st)).toEqual([]);
    st.setItem(MACROS_STORAGE_KEY, JSON.stringify([{ name: '', text: 'x' }, { name: 'ok', text: 'y' }]));
    expect(loadMacros(st)).toHaveLength(1);
  });
  it('round-trips export/import and rejects junk', () => {
    const macros = [normalizeMacro({ name: 'A', text: 'ls\\r', ending: '' })];
    const back = importMacros(exportMacros(macros));
    expect(back[0]).toMatchObject({ name: 'A', text: 'ls\\r', ending: '' });
    expect(importMacros(JSON.stringify([{ name: 'B', text: 'b' }]))[0].name).toBe('B');
    expect(() => importMacros('{"x":1}')).toThrow();
    expect(() => importMacros('[{"name":""}]')).toThrow();
  });
  it('expands escapes', () => {
    expect(expandEscapes('a\\r\\nb\\x03\\t\\e\\\\')).toBe('a\r\nb\x03\t\x1b\\');
    expect(expandEscapes('keep \\q')).toBe('keep \\q');
  });
});
