import { describe, it, expect } from 'vitest';
import {
  isElf, parseElf, parseMapFile, aggregateMap, filterSymbols, groupByNamespace, squarify, buildTree, layoutTree,
  capItems, diffRows, toCsv, formatBytes,
} from '../src/utils/elfSize.js';

/**
 * Minimal ELF writer for tests. sections: [{name, type?, flags?, addr?, data?, size? (NOBITS)}],
 * symbols: [{name, value, size, type, bind, section: name | 'UNDEF' | 'ABS'}],
 * segments: [{type, vaddr, paddr, filesz, memsz, flags}]. Supports ELF32/ELF64, LE/BE.
 */
function strtab(names) {
  const bytes = [0];
  const offs = {};
  for (const n of names) {
    if (n === '' || offs[n] !== undefined) { offs[n] = offs[n] ?? 0; continue; }
    offs[n] = bytes.length;
    for (const c of n) bytes.push(c.charCodeAt(0));
    bytes.push(0);
  }
  return { bytes: new Uint8Array(bytes), offs };
}

function buildElf({ bits = 32, le = true, machine = 40, entry = 0x08000000, sections = [], symbols = [], segments = [] }) {
  const W = bits / 8;
  const EH = bits === 64 ? 64 : 52;
  const SH = bits === 64 ? 64 : 40;
  const SYM = bits === 64 ? 24 : 16;
  const PH = bits === 64 ? 56 : 32;
  const shstr = strtab(['', ...sections.map((s) => s.name), '.symtab', '.strtab', '.shstrtab']);
  const strSyms = strtab(['', ...symbols.map((s) => s.name)]);

  const list = [{ name: '', type: 0, flags: 0, addr: 0, size: 0, data: null, link: 0, entsize: 0 }];
  for (const s of sections) {
    const nobits = s.type === 8;
    list.push({
      name: s.name, type: s.type ?? 1, flags: s.flags ?? 0, addr: s.addr ?? 0,
      size: nobits ? s.size : (s.data ? s.data.length : 0), data: nobits ? null : (s.data || null), link: 0, entsize: 0,
    });
  }
  const symIndexOf = (sec) => {
    if (sec === 'UNDEF') return 0;
    if (sec === 'ABS') return 0xfff1;
    const i = list.findIndex((x) => x.name === sec);
    if (i < 0) throw new Error(`no section ${sec}`);
    return i;
  };
  const symData = new Uint8Array((symbols.length + 1) * SYM);
  const dv0 = new DataView(symData.buffer);
  const wr0 = (dv, o, v, n) => {
    if (n === 8) dv.setBigUint64(o, BigInt(v), le);
    else if (n === 4) dv.setUint32(o, v >>> 0, le);
    else if (n === 2) dv.setUint16(o, v, le);
    else dv.setUint8(o, v);
  };
  symbols.forEach((s, k) => {
    const o = (k + 1) * SYM;
    const info = ((s.bind ?? 1) << 4) | (s.type ?? 0);
    const nameOff = strSyms.offs[s.name] ?? 0;
    const shndx = symIndexOf(s.section ?? 'UNDEF');
    if (bits === 32) {
      wr0(dv0, o, nameOff, 4); wr0(dv0, o + 4, s.value, 4); wr0(dv0, o + 8, s.size, 4);
      wr0(dv0, o + 12, info, 1); wr0(dv0, o + 13, 0, 1); wr0(dv0, o + 14, shndx, 2);
    } else {
      wr0(dv0, o, nameOff, 4); wr0(dv0, o + 4, info, 1); wr0(dv0, o + 5, 0, 1); wr0(dv0, o + 6, shndx, 2);
      wr0(dv0, o + 8, s.value, 8); wr0(dv0, o + 16, s.size, 8);
    }
  });
  const symIdx = list.length;
  list.push({ name: '.symtab', type: 2, flags: 0, addr: 0, size: symData.length, data: symData, link: symIdx + 1, entsize: SYM });
  list.push({ name: '.strtab', type: 3, flags: 0, addr: 0, size: strSyms.bytes.length, data: strSyms.bytes, link: 0, entsize: 0 });
  list.push({ name: '.shstrtab', type: 3, flags: 0, addr: 0, size: shstr.bytes.length, data: shstr.bytes, link: 0, entsize: 0 });
  const shstrIdx = list.length - 1;

  const align = (n, a) => Math.ceil(n / a) * a;
  let off = EH + segments.length * PH;
  for (const s of list) {
    if (s.data) { off = align(off, 4); s.offset = off; off += s.data.length; } else s.offset = 0;
  }
  const shoff = align(off, 8);
  const buf = new Uint8Array(shoff + list.length * SH);
  const dv = new DataView(buf.buffer);
  const wr = (o, v, n) => wr0(dv, o, v, n);

  buf.set([0x7f, 0x45, 0x4c, 0x46], 0);
  buf[4] = bits === 64 ? 2 : 1;
  buf[5] = le ? 1 : 2;
  buf[6] = 1;
  wr(16, 2, 2);
  wr(18, machine, 2);
  wr(20, 1, 4);
  wr(24, entry, W);
  wr(24 + W, segments.length ? EH : 0, W);
  wr(24 + 2 * W, shoff, W);
  wr(24 + 3 * W, 0, 4);
  wr(28 + 3 * W, EH, 2);
  wr(30 + 3 * W, PH, 2);
  wr(32 + 3 * W, segments.length, 2);
  wr(34 + 3 * W, SH, 2);
  wr(36 + 3 * W, list.length, 2);
  wr(38 + 3 * W, shstrIdx, 2);

  segments.forEach((p, i) => {
    const o = EH + i * PH;
    wr(o, p.type ?? 1, 4);
    if (bits === 64) { wr(o + 4, p.flags ?? 0, 4); wr(o + 8, 0, W); } else { wr(o + 6 * W, p.flags ?? 0, 4); wr(o + W, 0, W); }
    wr(o + 2 * W, p.vaddr, W);
    wr(o + 3 * W, p.paddr ?? p.vaddr, W);
    wr(o + 4 * W, p.filesz ?? 0, W);
    wr(o + 5 * W, p.memsz ?? 0, W);
  });

  list.forEach((s, i) => {
    const o = shoff + i * SH;
    wr(o, shstr.offs[s.name] ?? 0, 4);
    wr(o + 4, s.type, 4);
    wr(o + 8, s.flags, W);
    wr(o + 8 + W, s.addr, W);
    wr(o + 8 + 2 * W, s.offset, W);
    wr(o + 8 + 3 * W, s.size, W);
    wr(o + 8 + 4 * W, s.link, 4);
    wr(o + 16 + 4 * W, 4, W);
    wr(o + 16 + 5 * W, s.entsize, W);
    if (s.data) buf.set(s.data, s.offset);
  });
  return buf;
}

const TEXT = new Uint8Array(16).fill(0x90);
const RODATA = new Uint8Array(8).fill(1);
const DATA = new Uint8Array([1, 2, 3, 4]);
const SHF = { W: 1, A: 2, X: 4 };

function sampleSpec() {
  return {
    machine: 40,
    entry: 0x08000000,
    sections: [
      { name: '.text', type: 1, flags: SHF.A | SHF.X, addr: 0x08000000, data: TEXT },
      { name: '.rodata', type: 1, flags: SHF.A, addr: 0x08000010, data: RODATA },
      { name: '.data', type: 1, flags: SHF.A | SHF.W, addr: 0x20000000, data: DATA },
      { name: '.bss', type: 8, flags: SHF.A | SHF.W, addr: 0x20000004, size: 12 },
      { name: '.debug_info', type: 1, flags: 0, data: new Uint8Array(6) },
    ],
    symbols: [
      { name: 'main', value: 0x08000000, size: 8, type: 2, bind: 1, section: '.text' },
      { name: 'table', value: 0x08000010, size: 8, type: 1, bind: 0, section: '.rodata' },
      { name: 'counter', value: 0x20000004, size: 4, type: 1, bind: 1, section: '.bss' },
      { name: 'ns::foo', value: 0x08000008, size: 4, type: 2, bind: 1, section: '.text' },
      { name: 'printf', value: 0, size: 0, type: 0, bind: 1, section: 'UNDEF' },
    ],
    segments: [
      { type: 1, vaddr: 0x08000000, paddr: 0x08000000, filesz: 0x20, memsz: 0x20, flags: 5 },
      { type: 1, vaddr: 0x20000000, paddr: 0x08000100, filesz: 4, memsz: 16, flags: 6 },
    ],
  };
}

describe('parseElf (ELF32 little endian)', () => {
  const elf = parseElf(buildElf(sampleSpec()));

  it('reads the header', () => {
    expect(elf.bits).toBe(32);
    expect(elf.endian).toBe('LE');
    expect(elf.machineName).toBe('ARM');
    expect(elf.typeName).toBe('EXEC');
    expect(elf.entry).toBe(0x08000000);
  });

  it('reads section names, flags and regions', () => {
    const byName = Object.fromEntries(elf.sections.map((s) => [s.name, s]));
    expect(byName['.text'].flagStr).toBe('-AX');
    expect(byName['.text'].region).toBe('FLASH');
    expect(byName['.data'].region).toBe('RAM');
    expect(byName['.bss'].typeName).toBe('NOBITS');
    expect(byName['.debug_info'].region).toBe('DEBUG');
  });

  it('counts FLASH as loaded file images and RAM as loaded writable sections', () => {
    // FLASH: text 16 + rodata 8 + data LMA image 4. RAM: data 4 + bss 12. Debug is not counted.
    expect(elf.flashBytes).toBe(28);
    expect(elf.ramBytes).toBe(16);
    const bss = elf.sections.find((s) => s.name === '.bss');
    expect(bss.flashBytes).toBe(0);
    expect(bss.ramBytes).toBe(12);
  });

  it('maps a section LMA through the PT_LOAD segment that holds its VMA', () => {
    const data = elf.sections.find((s) => s.name === '.data');
    expect(data.addr).toBe(0x20000000);
    expect(data.lma).toBe(0x08000100);
    expect(elf.segments.map((p) => p.typeName)).toEqual(['LOAD', 'LOAD']);
    expect(elf.segments[1].flagStr).toBe('RW-');
  });

  it('reads the symbol table with names, types, bindings and sections', () => {
    expect(elf.symbolTableName).toBe('.symtab');
    expect(elf.symbols).toHaveLength(5);
    const main = elf.symbols.find((s) => s.name === 'main');
    expect(main).toMatchObject({ value: 0x08000000, size: 8, typeName: 'FUNC', bindName: 'GLOBAL', section: '.text', region: 'FLASH' });
    const table = elf.symbols.find((s) => s.name === 'table');
    expect(table).toMatchObject({ typeName: 'OBJECT', bindName: 'LOCAL', region: 'FLASH' });
    const counter = elf.symbols.find((s) => s.name === 'counter');
    expect(counter).toMatchObject({ section: '.bss', region: 'RAM', size: 4 });
    expect(elf.symbols.find((s) => s.name === 'printf').section).toBe('(UNDEF)');
  });

  it('rejects non-ELF input and truncated files', () => {
    expect(() => parseElf(new Uint8Array(64))).toThrow(/Not an ELF/);
    expect(isElf(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toBe(false);
    const full = buildElf(sampleSpec());
    expect(() => parseElf(full.slice(0, 60))).toThrow(/truncated or corrupt/);
  });
});

describe('parseElf (ELF64 and big endian)', () => {
  it('parses ELF64 little endian', () => {
    const elf = parseElf(buildElf({ ...sampleSpec(), bits: 64, machine: 62 }));
    expect(elf.bits).toBe(64);
    expect(elf.machineName).toBe('x86-64');
    expect(elf.flashBytes).toBe(28);
    expect(elf.ramBytes).toBe(16);
    const main = elf.symbols.find((s) => s.name === 'main');
    expect(main).toMatchObject({ value: 0x08000000, size: 8, typeName: 'FUNC' });
    expect(elf.symbols.find((s) => s.name === 'counter').value).toBe(0x20000004);
  });

  it('parses ELF32 big endian', () => {
    const elf = parseElf(buildElf({ ...sampleSpec(), le: false, machine: 94 }));
    expect(elf.endian).toBe('BE');
    expect(elf.machineName).toBe('Xtensa');
    expect(elf.sections.find((s) => s.name === '.text').addr).toBe(0x08000000);
    expect(elf.symbols.find((s) => s.name === 'ns::foo')).toMatchObject({ value: 0x08000008, size: 4 });
  });
});

describe('symbol filtering and namespaces', () => {
  const elf = parseElf(buildElf(sampleSpec()));
  it('filters by name, type and region', () => {
    expect(filterSymbols(elf.symbols, { query: 'NS::' }).map((s) => s.name)).toEqual(['ns::foo']);
    expect(filterSymbols(elf.symbols, { type: 'FUNC' }).map((s) => s.name).sort()).toEqual(['main', 'ns::foo']);
    expect(filterSymbols(elf.symbols, { region: 'RAM' }).map((s) => s.name)).toEqual(['counter']);
    expect(filterSymbols(elf.symbols, { minSize: 8, type: 'all', bind: 'all' }).map((s) => s.name).sort()).toEqual(['main', 'table']);
  });
  it('groups by the first :: segment, unmangled names under (no ::)', () => {
    const groups = groupByNamespace(elf.symbols);
    const ns = groups.find((g) => g.name === 'ns');
    expect(ns).toMatchObject({ size: 4, count: 1 });
    expect(groups.find((g) => g.name === '(no ::)').count).toBe(4);
  });
});

const MAP = `
Archive member included to satisfy reference by file (symbol)

libc.a(printf.o)              build/main.o (printf)

Memory Configuration

Name             Origin             Length             Attributes
FLASH            0x0000000008000000 0x0000000000000100 xr
RAM              0x0000000020000000 0x0000000000000080 xrw
*default*        0x0000000000000000 0xffffffffffffffff

Linker script and memory map

.isr_vector    0x08000000       0x10
 *(.isr_vector)
 .isr_vector   0x08000000       0x10 build/startup.o
.text          0x08000010       0x30
 .text          0x08000010       0x20 build/main.o
                0x08000010                main
 .text.wrap
                0x08000030       0x10 libc.a(printf.o)
.data          0x20000000       0x08 load address 0x08000040
 .data          0x20000000        0x8 build/main.o
.bss           0x20000008       0x10
 *fill*         0x20000018       0x4
 COMMON         0x2000001c       0x4 build/main.o

Discarded input sections

 .comment       0x0                0x20 build/main.o
`;

describe('parseMapFile (GNU ld)', () => {
  const map = parseMapFile(MAP);

  it('parses memory regions and skips *default*', () => {
    expect(map.regions.map((r) => r.name)).toEqual(['FLASH', 'RAM']);
    expect(map.regions[0]).toMatchObject({ origin: 0x08000000, length: 0x100, attributes: 'xr' });
  });

  it('computes region usage with load addresses (.data counts in FLASH and RAM)', () => {
    const flash = map.regions[0];
    const ram = map.regions[1];
    // FLASH: isr 0x10 + text 0x30 + .data LMA 8 = 72 bytes of 256.
    expect(flash.used).toBe(0x10 + 0x30 + 8);
    expect(flash.usedPct).toBeCloseTo((72 / 256) * 100, 6);
    // RAM: .data 8 + .bss 0x10 = 24 bytes of 128.
    expect(ram.used).toBe(8 + 0x10);
    expect(ram.usedPct).toBeCloseTo((24 / 128) * 100, 6);
  });

  it('reads output sections with their load address', () => {
    const data = map.outputSections.find((s) => s.name === '.data');
    expect(data).toMatchObject({ addr: 0x20000000, lma: 0x08000040, size: 8, region: 'RAM', lmaRegion: 'FLASH' });
    expect(map.outputSections.map((s) => s.name)).toEqual(['.isr_vector', '.text', '.data', '.bss']);
  });

  it('reads input sections, archive members, wrapped lines and skips fill and discarded lines', () => {
    const libs = map.inputs.filter((i) => i.library === 'libc.a');
    expect(libs).toHaveLength(1);
    expect(libs[0]).toMatchObject({ section: '.text', name: '.text.wrap', size: 0x10, member: 'printf.o', file: 'libc.a(printf.o)' });
    expect(map.inputs.some((i) => i.name.startsWith('*'))).toBe(false);
    expect(map.inputs.some((i) => i.file.includes('build/main.o') && i.name === '.comment')).toBe(false);
    expect(map.inputs.find((i) => i.name === 'COMMON')).toMatchObject({ size: 4, section: '.bss' });
  });

  it('aggregates by library and by object file', () => {
    const agg = aggregateMap(map);
    expect(agg.byLibrary.map((g) => [g.name, g.size])).toEqual([['build/main.o', 0x20 + 8 + 4], ['build/startup.o', 0x10], ['libc.a', 0x10]]);
    expect(agg.byObject.find((g) => g.name === 'libc.a(printf.o)')).toMatchObject({ library: 'libc.a', size: 0x10 });
    expect(agg.byObject.find((g) => g.name === 'build/main.o').count).toBe(3);
  });

  it('rejects text that is not a GNU ld map', () => {
    expect(() => parseMapFile('hello world\nnot a map\n')).toThrow(/Not a GNU ld map/);
  });
});

describe('treemap layout', () => {
  it('squarify areas are proportional and sum to the rectangle', () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const W = 600;
    const H = 400;
    const rects = squarify(values, 0, 0, W, H);
    const total = values.reduce((a, b) => a + b, 0);
    let sum = 0;
    rects.forEach((r, i) => {
      const area = r.w * r.h;
      expect(area).toBeCloseTo((values[i] / total) * W * H, 4);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-6);
      sum += area;
    });
    expect(sum).toBeCloseTo(W * H, 4);
  });

  it('gives zero-size items an empty rectangle', () => {
    const rects = squarify([0, 5, -1, 5], 10, 20, 100, 50);
    expect(rects[0].w * rects[0].h).toBe(0);
    expect(rects[2].w * rects[2].h).toBe(0);
    expect(rects[1].w * rects[1].h + rects[3].w * rects[3].h).toBeCloseTo(5000, 6);
  });

  it('leaves of a nested tree partition the root area', () => {
    const items = [
      { value: 100, path: ['FLASH', '.text', 'main'] },
      { value: 50, path: ['FLASH', '.text', 'helper'] },
      { value: 30, path: ['FLASH', '.rodata', 'table'] },
      { value: 20, path: ['RAM', '.bss', 'counter'] },
    ];
    const laid = layoutTree(buildTree(items), 0, 0, 800, 400);
    const leaves = laid.filter((r) => r.leaf);
    expect(leaves).toHaveLength(4);
    const area = leaves.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBeCloseTo(800 * 400, 3);
    const root = laid.find((r) => r.depth === 0);
    expect(root.value).toBe(200);
    expect(laid.find((r) => r.name === 'FLASH').value).toBe(180);
  });

  it('caps the item count and merges the rest into one other item', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ value: 10 - i, path: [`s${i}`] }));
    const capped = capItems(items, 4);
    expect(capped).toHaveLength(4);
    expect(capped[3].other).toBe(true);
    expect(capped[3].value).toBe(7 + 6 + 5 + 4 + 3 + 2 + 1);
    expect(capped.reduce((a, i) => a + i.value, 0)).toBe(55);
  });
});

describe('diff and CSV', () => {
  it('diffs by key, sorted by growth, with added and removed status', () => {
    const rows = diffRows(
      [{ key: 'a', size: 10 }, { key: 'b', size: 50 }, { key: 'gone', size: 5 }],
      [{ key: 'a', size: 25 }, { key: 'b', size: 40 }, { key: 'new', size: 7 }],
    );
    expect(rows.map((r) => r.key)).toEqual(['a', 'new', 'gone', 'b']);
    expect(rows[0]).toMatchObject({ before: 10, after: 25, delta: 15, status: 'grew' });
    expect(rows[1]).toMatchObject({ status: 'added', delta: 7 });
    expect(rows[2]).toMatchObject({ status: 'removed', delta: -5 });
    expect(rows[3]).toMatchObject({ status: 'shrank', delta: -10 });
  });

  it('sums duplicate keys before diffing', () => {
    const rows = diffRows([{ key: 'x', size: 4 }, { key: 'x', size: 6 }], [{ key: 'x', size: 3 }]);
    expect(rows[0]).toMatchObject({ before: 10, after: 3, delta: -7 });
  });

  it('writes CSV with quoting and neutralizes spreadsheet formulas', () => {
    const csv = toCsv([{ name: 'a,"b"', size: 4 }, { name: '=HYPERLINK(x)', size: 2 }], [{ key: 'name', label: 'name' }, { key: 'size', label: 'size' }]);
    expect(csv).toBe('name,size\r\n"a,""b""",4\r\n\'=HYPERLINK(x),2\r\n');
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(null)).toBe('-');
  });
});
