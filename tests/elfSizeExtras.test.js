import { describe, it, expect } from 'vitest';
import {
  berkeleySize, berkeleyLine, parseSizeInput, budgetStatus, deltaMarkdown, diffRows, MCU_PRESETS,
} from '../src/utils/elfSize.js';

const sec = (name, type, flags, size, loaded = true) => ({ name, type, flags, size, loaded });

describe('berkeleySize', () => {
  it('splits text, data and bss like size(1)', () => {
    const t = berkeleySize([
      sec('.text', 1, 6, 100), sec('.rodata', 1, 2, 20), sec('.data', 1, 3, 8),
      sec('.bss', 8, 3, 32), sec('.tbss', 8, 2, 50), sec('.debug_info', 1, 0, 999, false),
    ]);
    expect(t).toMatchObject({ text: 120, data: 8, bss: 32, dec: 160, hex: 'a0' });
  });
  it('formats header and row', () => {
    const out = berkeleyLine(berkeleySize([sec('.text', 1, 6, 100)]), 'a.elf');
    const [h, r] = out.split('\n');
    expect(h).toContain('text');
    expect(r).toContain('100');
    expect(r.endsWith('a.elf')).toBe(true);
  });
});

describe('budgets', () => {
  it('parses sizes', () => {
    expect(parseSizeInput('64K')).toBe(65536);
    expect(parseSizeInput('1.5 MiB')).toBe(1572864);
    expect(parseSizeInput('0x1000')).toBe(4096);
    expect(parseSizeInput('512')).toBe(512);
    expect(parseSizeInput('abc')).toBeNull();
    expect(parseSizeInput('')).toBeNull();
    expect(parseSizeInput('0')).toBeNull();
  });
  it('reports levels', () => {
    expect(budgetStatus(10, 0)).toBeNull();
    expect(budgetStatus(50, 100).level).toBe('ok');
    expect(budgetStatus(80, 100).level).toBe('warn');
    expect(budgetStatus(95, 100).level).toBe('high');
    const o = budgetStatus(120, 100);
    expect(o).toMatchObject({ over: true, level: 'over', free: -20 });
  });
  it('has sane presets', () => {
    for (const p of MCU_PRESETS.filter((x) => x.id !== 'custom')) expect(p.flash).toBeGreaterThan(p.ram);
  });
});

describe('deltaMarkdown', () => {
  it('lists growth and reduction and escapes pipes', () => {
    const rows = diffRows([{ key: 'a|b', size: 10 }, { key: 'c', size: 50 }], [{ key: 'a|b', size: 30 }, { key: 'c', size: 20 }]);
    const md = deltaMarkdown({ title: 'T', label: 'symbol', totals: { fa: 100, fb: 120, ra: 10, rb: 5 }, rows });
    expect(md).toContain('| FLASH | 100 | 120 | +20 |');
    expect(md).toContain('| RAM | 10 | 5 | -5 |');
    expect(md).toContain('a\|b');
    expect(md).toContain('Largest growth');
    expect(md).toContain('Largest reduction');
  });
  it('says so when nothing changed', () => {
    expect(deltaMarkdown({ rows: [] })).toContain('No size changes.');
  });
});
