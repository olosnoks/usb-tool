/**
 * ELF / GNU ld map size analyzer: pure parsing and layout logic (no React, no I/O).
 *
 * - parseElf(bytes): ELF32/ELF64, little or big endian. Section headers, program headers
 *   (PT_LOAD), .symtab (falls back to .dynsym) with names from the linked string table.
 *   Flash/RAM totals follow `size -A` semantics: FLASH = every loaded section's file image
 *   (text, rodata, and the LMA image of .data); RAM = loaded WRITE sections (.data, .bss,
 *   .noinit). Non-loaded sections (.debug_*, .comment, ...) are not counted.
 * - parseMapFile(text): GNU ld `-Map` output. Memory Configuration regions with usage,
 *   output sections (with load address), and input section lines aggregated by library
 *   (archive) and object file.
 * - Symbol filtering, C++ namespace grouping (first '::' segment; names are NOT demangled),
 *   squarified treemap layout, diff between two loads, CSV export.
 */

export const SHT_NOBITS = 8;
export const SHT_SYMTAB = 2;
export const SHT_DYNSYM = 11;
export const SHF_WRITE = 0x1;
export const SHF_ALLOC = 0x2;
export const SHF_EXECINSTR = 0x4;
export const SHN_UNDEF = 0;
export const SHN_ABS = 0xfff1;
export const SHN_COMMON = 0xfff2;
export const SHN_XINDEX = 0xffff;

const SECTION_TYPES = {
  0: 'NULL', 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 4: 'RELA', 5: 'HASH', 6: 'DYNAMIC', 7: 'NOTE',
  8: 'NOBITS', 9: 'REL', 11: 'DYNSYM', 14: 'INIT_ARRAY', 15: 'FINI_ARRAY', 0x6ffffff6: 'GNU_HASH',
  0x70000001: 'ARM_EXIDX', 0x70000003: 'ARM_ATTRIBUTES',
};
const SEGMENT_TYPES = {
  0: 'NULL', 1: 'LOAD', 2: 'DYNAMIC', 3: 'INTERP', 4: 'NOTE', 6: 'PHDR', 7: 'TLS',
  0x70000001: 'ARM_EXIDX', 0x6474e551: 'GNU_STACK', 0x6474e552: 'GNU_RELRO',
};
const SYMBOL_TYPES = { 0: 'NOTYPE', 1: 'OBJECT', 2: 'FUNC', 3: 'SECTION', 4: 'FILE', 5: 'COMMON', 6: 'TLS', 10: 'IFUNC' };
const SYMBOL_BINDS = { 0: 'LOCAL', 1: 'GLOBAL', 2: 'WEAK', 10: 'UNIQUE' };
const MACHINES = {
  2: 'SPARC', 3: 'x86', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC64', 40: 'ARM', 62: 'x86-64', 83: 'AVR',
  94: 'Xtensa', 105: 'MSP430', 183: 'AArch64', 243: 'RISC-V',
};
const ELF_TYPES = { 0: 'NONE', 1: 'REL', 2: 'EXEC', 3: 'DYN', 4: 'CORE' };

export function isElf(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  return b.length >= 16 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
}

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

const hex = (n) => '0x' + Number(n).toString(16);

function flagString(f) {
  return (f & SHF_WRITE ? 'W' : '-') + (f & SHF_ALLOC ? 'A' : '-') + (f & SHF_EXECINSTR ? 'X' : '-');
}

function readCString(bytes, off) {
  if (off < 0 || off >= bytes.length) return '';
  let end = off;
  while (end < bytes.length && bytes[end] !== 0) end++;
  let s = '';
  for (let i = off; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Parse an ELF image. Throws Error with a readable message for non-ELF or corrupt input.
 * Addresses/sizes are returned as JS numbers (exact below 2^53, which covers firmware).
 */
export function parseElf(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isElf(bytes)) throw new Error('Not an ELF file (missing 0x7F "ELF" magic)');
  const bits = bytes[4] === 2 ? 64 : bytes[4] === 1 ? 32 : 0;
  if (!bits) throw new Error(`Unknown ELF class ${bytes[4]}`);
  const le = bytes[5] === 1;
  if (!le && bytes[5] !== 2) throw new Error(`Unknown ELF data encoding ${bytes[5]}`);
  const W = bits / 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  const word = (o) => (bits === 64 ? Number(view.getBigUint64(o, le)) : view.getUint32(o, le));

  try {
    const eType = u16(16);
    const machine = u16(18);
    const entry = word(24);
    const phoff = word(24 + W);
    const shoff = word(24 + 2 * W);
    const base = 24 + 3 * W; // e_flags
    const phentsize = u16(base + 6);
    let phnum = u16(base + 8);
    const shentsize = u16(base + 10);
    let shnum = u16(base + 12);
    let shstrndx = u16(base + 14);

    // Section headers (raw). Extended numbering: shnum/shstrndx live in section 0.
    const shSize = bits === 64 ? 64 : 40;
    const readShRaw = (i) => {
      const o = shoff + i * (shentsize || shSize);
      return {
        nameOff: u32(o),
        type: u32(o + 4),
        flags: word(o + 8),
        addr: word(o + 8 + W),
        offset: word(o + 8 + 2 * W),
        size: word(o + 8 + 3 * W),
        link: u32(o + 8 + 4 * W),
        info: u32(o + 12 + 4 * W),
        align: word(o + 16 + 4 * W),
        entsize: word(o + 16 + 5 * W),
      };
    };
    if (shoff && shnum === 0) shnum = readShRaw(0).size;
    if (shstrndx === SHN_XINDEX && shoff) shstrndx = readShRaw(0).link;
    if (phnum === 0xffff && phoff) phnum = 0; // extended phnum is not supported; ignore
    const rawSections = [];
    for (let i = 0; shoff && i < shnum; i++) rawSections.push(readShRaw(i));

    const shstr = rawSections[shstrndx];
    const shstrBytes = shstr ? bytes.subarray(shstr.offset, shstr.offset + shstr.size) : new Uint8Array();
    const sections = rawSections.map((s, index) => {
      const loaded = (s.flags & SHF_ALLOC) !== 0;
      const write = (s.flags & SHF_WRITE) !== 0;
      const flashBytes = loaded && s.type !== SHT_NOBITS ? s.size : 0;
      const ramBytes = loaded && write ? s.size : 0;
      const region = !loaded ? 'DEBUG' : write ? 'RAM' : 'FLASH';
      return {
        index,
        name: readCString(shstrBytes, s.nameOff),
        type: s.type,
        typeName: SECTION_TYPES[s.type] || `TYPE_${hex(s.type)}`,
        flags: s.flags,
        flagStr: flagString(s.flags),
        addr: s.addr,
        offset: s.offset,
        size: s.size,
        link: s.link,
        info: s.info,
        entsize: s.entsize,
        align: s.align,
        loaded,
        region,
        flashBytes,
        ramBytes,
        lma: s.addr,
      };
    });

    const segments = [];
    for (let i = 0; phoff && i < phnum; i++) {
      const o = phoff + i * phentsize;
      const type = u32(o);
      const flags = bits === 64 ? u32(o + 4) : word(o + 6 * W);
      segments.push({
        index: i,
        type,
        typeName: SEGMENT_TYPES[type] || `TYPE_${hex(type)}`,
        flags,
        flagStr: (flags & 4 ? 'R' : '-') + (flags & 2 ? 'W' : '-') + (flags & 1 ? 'X' : '-'),
        offset: word(o + (bits === 64 ? 8 : W)),
        vaddr: word(o + 2 * W),
        paddr: word(o + 3 * W),
        filesz: word(o + 4 * W),
        memsz: word(o + 5 * W),
      });
    }

    // LMA: a loaded section's load address comes from the PT_LOAD segment that holds its VMA.
    const loads = segments.filter((s) => s.type === 1);
    for (const sec of sections) {
      if (!sec.loaded || !sec.addr) continue;
      const seg = loads.find((s) => sec.addr >= s.vaddr && sec.addr < s.vaddr + s.memsz);
      if (seg) sec.lma = seg.paddr + (sec.addr - seg.vaddr);
    }

    // Symbols: prefer .symtab, fall back to .dynsym.
    const symSec = rawSections.find((s) => s.type === SHT_SYMTAB) || rawSections.find((s) => s.type === SHT_DYNSYM);
    const symbols = [];
    if (symSec) {
      const strSec = rawSections[symSec.link];
      const strBytes = strSec ? bytes.subarray(strSec.offset, strSec.offset + strSec.size) : new Uint8Array();
      const entSize = symSec.entsize || (bits === 64 ? 24 : 16);
      const count = Math.floor(symSec.size / entSize);
      for (let i = 1; i < count; i++) { // entry 0 is the null symbol
        const o = symSec.offset + i * entSize;
        let name, info, shndx, value, size;
        if (bits === 32) {
          name = u32(o); value = u32(o + 4); size = u32(o + 8); info = bytes[o + 12]; shndx = u16(o + 14);
        } else {
          name = u32(o); info = bytes[o + 4]; shndx = u16(o + 6); value = word(o + 8); size = word(o + 16);
        }
        const type = info & 0xf;
        const bind = info >> 4;
        const sec = shndx > 0 && shndx < sections.length && shndx < SHN_ABS ? sections[shndx] : null;
        const region = sec ? sec.region : shndx === SHN_ABS ? 'ABS' : shndx === SHN_UNDEF ? 'UNDEF' : shndx === SHN_COMMON ? 'COMMON' : 'OTHER';
        symbols.push({
          name: readCString(strBytes, name),
          value,
          size,
          type,
          typeName: SYMBOL_TYPES[type] || `TYPE_${type}`,
          bind,
          bindName: SYMBOL_BINDS[bind] || `BIND_${bind}`,
          shndx,
          section: sec ? sec.name : shndx === SHN_ABS ? '(ABS)' : shndx === SHN_UNDEF ? '(UNDEF)' : shndx === SHN_COMMON ? '(COMMON)' : `(index ${shndx})`,
          region,
        });
      }
    }

    const flashBytes = sections.reduce((a, s) => a + s.flashBytes, 0);
    const ramBytes = sections.reduce((a, s) => a + s.ramBytes, 0);
    return {
      bits,
      endian: le ? 'LE' : 'BE',
      type: u16(16),
      typeName: ELF_TYPES[eType] || `TYPE_${eType}`,
      machine,
      machineName: MACHINES[machine] || `machine ${hex(machine)}`,
      entry,
      sections,
      segments,
      symbols,
      symbolTableName: symSec ? (symSec.type === SHT_SYMTAB ? '.symtab' : '.dynsym') : null,
      flashBytes,
      ramBytes,
    };
  } catch (e) {
    if (e instanceof RangeError) throw new Error('ELF file is truncated or corrupt (header or table points past the end of the file)');
    throw e;
  }
}

/** Keep only symbols matching every given criterion. */
export function filterSymbols(symbols, opts = {}) {
  const q = (opts.query || '').trim().toLowerCase();
  return symbols.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (opts.type && opts.type !== 'all' && s.typeName !== opts.type) return false;
    if (opts.bind && opts.bind !== 'all' && s.bindName !== opts.bind) return false;
    if (opts.region && opts.region !== 'all' && s.region !== opts.region) return false;
    if (opts.section && opts.section !== 'all' && s.section !== opts.section) return false;
    if (opts.minSize && s.size < opts.minSize) return false;
    return true;
  });
}

/** Group by the first '::' segment. Names are not demangled, so mangled (_Z...) names fall in '(no ::)'. */
export function groupByNamespace(symbols) {
  const map = new Map();
  for (const s of symbols) {
    const i = s.name.indexOf('::');
    const ns = i > 0 ? s.name.slice(0, i) : '(no ::)';
    const g = map.get(ns) || { name: ns, size: 0, count: 0 };
    g.size += s.size;
    g.count += 1;
    map.set(ns, g);
  }
  return [...map.values()].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

/* ---------------- GNU ld map files ---------------- */

const HEX = '0x[0-9a-fA-F]+';
const RE_REGION = new RegExp(`^(\\S+)\\s+(${HEX})\\s+(${HEX})\\s*(\\S*)\\s*$`);
const RE_OUT_FULL = new RegExp(`^(\\.\\S*)\\s+(${HEX})\\s+(${HEX})(?:\\s+load address\\s+(${HEX}))?`);
const RE_OUT_WRAP_NAME = /^(\.\S*)\s*$/;
const RE_ADDR_SIZE = new RegExp(`^\\s+(${HEX})\\s+(${HEX})(?:\\s+load address\\s+(${HEX}))?(?:\\s+(.*?))?\\s*$`);
const RE_IN_FULL = new RegExp(`^\\s(\\S+)\\s+(${HEX})\\s+(${HEX})\\s+(\\S.*?)\\s*$`);
const RE_IN_WRAP_NAME = /^\s(\S+)\s*$/;
const RE_ARCHIVE = /^(.+?\.(?:a|lib))\(([^()]+)\)$/i;

function parseMemoryConfig(lines) {
  const regions = [];
  const start = lines.findIndex((l) => /^Memory Configuration\s*$/.test(l));
  if (start < 0) return regions;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^Linker script and memory map/.test(l)) break;
    if (!l.trim() || /^Name\s+Origin\s+Length/.test(l)) continue;
    const m = l.trim().match(RE_REGION);
    if (m && !m[1].startsWith('*')) {
      regions.push({
        name: m[1],
        origin: Number(m[2]),
        length: Number(m[3]),
        attributes: m[4] || '',
        used: 0,
        usedPct: 0,
      });
    }
  }
  return regions;
}

/**
 * Parse GNU ld map text. Returns { regions, outputSections, inputs, hasLinkerMap }.
 * Throws when the text has neither a Memory Configuration nor output section lines.
 */
export function parseMapFile(text) {
  const lines = String(text).split(/\r?\n/);
  const regions = parseMemoryConfig(lines);
  const regionAt = (addr) => {
    const r = regions.find((x) => addr >= x.origin && addr < x.origin + x.length);
    return r ? r.name : 'OTHER';
  };
  const hasLinkerMap = lines.some((l) => /^Linker script and memory map/.test(l));

  const outputSections = [];
  const inputs = [];
  let mode = 'out'; // 'out' | 'skip'
  let cur = null;
  let pendingOut = null;
  let pendingIn = null;

  const addOutput = (name, addr, size, lma) => {
    cur = { name, addr, size, lma: lma ?? addr, region: regionAt(addr), lmaRegion: regionAt(lma ?? addr) };
    outputSections.push(cur);
  };
  // *fill* padding and zero-size lines are skipped.
  const pushInput = (name, addr, size, fileField) => {
    if (!cur || !size || name.startsWith('*')) return;
    const arch = fileField.match(RE_ARCHIVE);
    inputs.push({
      section: cur.name,
      name,
      addr,
      size,
      file: fileField,
      library: arch ? arch[1] : fileField,
      member: arch ? arch[2] : null,
      region: regionAt(addr),
    });
  };

  for (const line of lines) {
    if (!line.trim()) { pendingOut = null; pendingIn = null; continue; }
    const col0 = !/^\s/.test(line);

    if (col0) {
      pendingIn = null;
      if (/^Discarded input sections/.test(line)) { mode = 'skip'; cur = null; pendingOut = null; continue; }
      if (/^(Cross Reference Table|Archive member included|Memory Configuration|Linker script and memory map)/.test(line)) {
        mode = /^Linker script/.test(line) ? 'out' : 'skip';
        cur = null; pendingOut = null; continue;
      }
      mode = 'out';
      const m = line.match(RE_OUT_FULL);
      if (m) { pendingOut = null; addOutput(m[1], Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : undefined); continue; }
      const w = line.match(RE_OUT_WRAP_NAME);
      if (w) { pendingOut = w[1]; cur = null; continue; }
      pendingOut = null;
      cur = null;
      continue;
    }

    if (mode !== 'out') continue;

    if (pendingOut) {
      const m = line.match(RE_ADDR_SIZE);
      if (m) { addOutput(pendingOut, Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : undefined); pendingOut = null; continue; }
      pendingOut = null;
    }
    if (!cur) continue;

    if (pendingIn) {
      const m = line.match(RE_ADDR_SIZE);
      if (m) {
        pushInput(pendingIn, Number(m[1]), Number(m[2]), (m[4] || '').trim());
        pendingIn = null;
        continue;
      }
      pendingIn = null;
    }
    const full = line.match(RE_IN_FULL);
    if (full) { pushInput(full[1], Number(full[2]), Number(full[3]), full[4]); continue; }
    const wrap = line.match(RE_IN_WRAP_NAME);
    if (wrap) pendingIn = wrap[1];
  }

  if (!regions.length && !outputSections.length) {
    throw new Error('Not a GNU ld map file (no "Memory Configuration" or output section lines found)');
  }

  // Region usage. A section with a load address occupies its LMA region (flash image) and,
  // when its VMA lives elsewhere (.data), its VMA region too. Sections without a load address
  // occupy their VMA region.
  for (const os of outputSections) {
    if (!os.size) continue;
    const lmaR = regions.find((r) => r.name === os.lmaRegion);
    const vmaR = regions.find((r) => r.name === os.region);
    if (lmaR) lmaR.used += os.size;
    if (vmaR && vmaR !== lmaR) vmaR.used += os.size;
  }
  for (const r of regions) r.usedPct = r.length ? (r.used / r.length) * 100 : 0;

  return { hasLinkerMap, regions, outputSections, inputs };
}

/** Aggregate map inputs by library (archive or loose object), by object file and by output section. */
export function aggregateMap(map) {
  const add = (m, key, size, extra) => {
    const g = m.get(key) || { name: key, size: 0, count: 0, ...extra };
    g.size += size;
    g.count += 1;
    m.set(key, g);
  };
  const byLib = new Map();
  const byObj = new Map();
  for (const i of map.inputs) {
    add(byLib, i.library, i.size);
    add(byObj, i.file, i.size, { library: i.library });
  }
  const bySection = map.outputSections.filter((s) => s.size).map((s) => ({ name: s.name, size: s.size, region: s.region, lmaRegion: s.lmaRegion, count: 1 }));
  const sort = (a, b) => b.size - a.size || a.name.localeCompare(b.name);
  return {
    byLibrary: [...byLib.values()].sort(sort),
    byObject: [...byObj.values()].sort(sort),
    bySection: bySection.sort(sort),
  };
}

/* ---------------- Treemap ---------------- */

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). values -> rects {x,y,w,h} in the same order.
 * Zero/negative/non-finite values get an empty rect. Rect areas sum to w*h (within float error).
 */
export function squarify(values, x, y, w, h) {
  const out = values.map(() => ({ x, y, w: 0, h: 0 }));
  let total = 0;
  const idx = [];
  values.forEach((v, i) => { if (Number.isFinite(v) && v > 0) { idx.push(i); total += v; } });
  if (!idx.length || !(w > 0) || !(h > 0)) return out;
  const scale = (w * h) / total;
  const items = idx.map((i) => ({ i, area: values[i] * scale })).sort((a, b) => b.area - a.area);

  let rect = { x, y, w, h };
  let row = [];
  const worst = (r, side) => {
    let s = 0; let mx = 0; let mn = Infinity;
    for (const it of r) { s += it.area; if (it.area > mx) mx = it.area; if (it.area < mn) mn = it.area; }
    const s2 = s * s; const side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };
  const layoutRow = () => {
    const s = row.reduce((a, it) => a + it.area, 0);
    if (rect.w >= rect.h) {
      // strip down the left edge; width = s / height
      const colW = rect.h > 0 ? s / rect.h : 0;
      let yy = rect.y;
      for (const it of row) {
        const hh = colW > 0 ? it.area / colW : 0;
        out[it.i] = { x: rect.x, y: yy, w: colW, h: hh };
        yy += hh;
      }
      rect = { x: rect.x + colW, y: rect.y, w: Math.max(0, rect.w - colW), h: rect.h };
    } else {
      // strip across the top; height = s / width
      const rowH = rect.w > 0 ? s / rect.w : 0;
      let xx = rect.x;
      for (const it of row) {
        const ww = rowH > 0 ? it.area / rowH : 0;
        out[it.i] = { x: xx, y: rect.y, w: ww, h: rowH };
        xx += ww;
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: Math.max(0, rect.h - rowH) };
    }
    row = [];
  };
  for (const it of items) {
    const side = Math.min(rect.w, rect.h);
    if (side <= 0) break;
    if (row.length === 0 || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else { layoutRow(); row.push(it); }
  }
  if (row.length) layoutRow();
  return out;
}

/** items: [{ value, path: [string...] }] -> tree of nodes { name, key, value, children: Map }. */
export function buildTree(items) {
  const root = { name: '', key: '', value: 0, children: new Map() };
  for (const it of items) {
    if (!(it.value > 0) || !it.path || !it.path.length) continue;
    root.value += it.value;
    let node = root;
    let key = '';
    for (const seg of it.path) {
      key += '\u0001' + seg;
      let child = node.children.get(seg);
      if (!child) { child = { name: seg, key, value: 0, children: new Map() }; node.children.set(seg, child); }
      child.value += it.value;
      node = child;
    }
  }
  return root;
}

/** Lay a tree out into rects {name, key, depth, value, x, y, w, h, leaf}. The root is depth 0. */
export function layoutTree(root, x = 0, y = 0, w = 1, h = 1) {
  const out = [];
  const visit = (node, rx, ry, rw, rh, depth) => {
    const leaf = node.children.size === 0;
    out.push({ name: node.name, key: node.key, depth, value: node.value, x: rx, y: ry, w: rw, h: rh, leaf });
    if (leaf) return;
    const kids = [...node.children.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const rects = squarify(kids.map((k) => k.value), rx, ry, rw, rh);
    kids.forEach((k, i) => visit(k, rects[i].x, rects[i].y, rects[i].w, rects[i].h, depth + 1));
  };
  visit(root, x, y, w, h, 0);
  return out;
}

/** Keep the largest maxItems items; the rest are merged into one '(other N items)' item. */
export function capItems(items, maxItems) {
  const valid = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (valid.length <= maxItems) return valid;
  const head = valid.slice(0, Math.max(0, maxItems - 1));
  const rest = valid.slice(Math.max(0, maxItems - 1));
  head.push({ value: rest.reduce((a, i) => a + i.value, 0), path: [`(other ${rest.length} items)`], other: true });
  return head;
}

/* ---------------- Compare ---------------- */

/**
 * Diff two lists of {key, size}. Duplicate keys are summed. Result is sorted by growth
 * (largest increase first, largest decrease last).
 */
export function diffRows(beforeRows, afterRows) {
  const a = new Map();
  const b = new Map();
  for (const r of beforeRows) a.set(r.key, (a.get(r.key) || 0) + r.size);
  for (const r of afterRows) b.set(r.key, (b.get(r.key) || 0) + r.size);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out = [];
  for (const key of keys) {
    const before = a.get(key) || 0;
    const after = b.get(key) || 0;
    const delta = after - before;
    const status = !a.has(key) ? 'added' : !b.has(key) ? 'removed' : delta > 0 ? 'grew' : delta < 0 ? 'shrank' : 'same';
    out.push({ key, before, after, delta, status });
  }
  return out.sort((x, y) => y.delta - x.delta || x.key.localeCompare(y.key));
}

/* ---------------- CSV ---------------- */

/** columns: [{ key, label }]. Strings starting with = + - @ are prefixed with ' (spreadsheet formula safety). */
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

/* ---------------- size(1) style totals ---------------- */

/**
 * Berkeley-format totals like `arm-none-eabi-size`: text = allocated read-only sections,
 * data = allocated writable sections with file contents, bss = allocated writable NOBITS.
 * dec = text + data + bss.
 */
export function berkeleySize(sections) {
  let text = 0;
  let data = 0;
  let bss = 0;
  for (const s of sections || []) {
    if (!s.loaded) continue;
    if (s.type === SHT_NOBITS) {
      if ((s.flags & SHF_WRITE) !== 0) bss += s.size;
      continue; // read-only NOBITS (e.g. .tbss) occupies nothing
    }
    if ((s.flags & SHF_WRITE) !== 0) data += s.size;
    else text += s.size;
  }
  const dec = text + data + bss;
  return { text, data, bss, dec, hex: dec.toString(16) };
}

/** Text of the Berkeley line, laid out like `size` output (header plus one row). */
export function berkeleyLine(totals, filename = '') {
  const heads = ['text', 'data', 'bss', 'dec'];
  const cols = [totals.text, totals.data, totals.bss, totals.dec].map(String);
  const w = heads.map((h, i) => Math.max(h.length, cols[i].length) + 3);
  const head = heads.map((h, i) => h.padStart(w[i])).join('') + '     hex filename';
  const row = cols.map((c, i) => c.padStart(w[i])).join('') + ' ' + totals.hex.padStart(7) + (filename ? ` ${filename}` : '');
  return `${head}\n${row}`;
}

/* ---------------- Budgets ---------------- */

/** Parses "64K", "1.5M", "512KiB", "0x10000", "65536" to bytes. Returns null when not a positive size. */
export function parseSizeInput(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, '');
  if (!t) return null;
  if (/^0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t, 16) || null;
  const m = /^(\d+(?:\.\d+)?)(k|m|g)?(?:i?b)?$/i.exec(t);
  if (!m) return null;
  const mult = { k: 1024, m: 1024 * 1024, g: 1024 ** 3 }[(m[2] || '').toLowerCase()] || 1;
  const n = Math.round(Number(m[1]) * mult);
  return n > 0 ? n : null;
}

/** { used, limit, pct, free, over, level: 'ok'|'warn'|'high'|'over' } for a byte budget. */
export function budgetStatus(used, limit) {
  if (!limit) return null;
  const pct = (used / limit) * 100;
  const level = used > limit ? 'over' : pct > 90 ? 'high' : pct > 70 ? 'warn' : 'ok';
  return { used, limit, pct, free: limit - used, over: used > limit, level };
}

/** Common parts for the budget dropdown (flash, RAM in bytes). Check your own linker script. */
export const MCU_PRESETS = [
  { id: 'custom', label: 'custom', flash: 0, ram: 0 },
  { id: 'atmega328p', label: 'ATmega328P (32K / 2K)', flash: 32768, ram: 2048 },
  { id: 'stm32f103c8', label: 'STM32F103C8 (64K / 20K)', flash: 65536, ram: 20480 },
  { id: 'stm32f411ce', label: 'STM32F411CE (512K / 128K)', flash: 524288, ram: 131072 },
  { id: 'rp2040', label: 'RP2040 (2M QSPI / 264K)', flash: 2097152, ram: 270336 },
  { id: 'nrf52840', label: 'nRF52840 (1M / 256K)', flash: 1048576, ram: 262144 },
  { id: 'esp32c3', label: 'ESP32-C3 (4M / 400K)', flash: 4194304, ram: 409600 },
];

/* ---------------- Markdown report ---------------- */

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\|').replace(/`/g, "'").replace(/\r?\n/g, ' ');
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Markdown size-delta report for a PR comment. `rows` come from diffRows; `totals` is optional
 * { fa, fb, ra, rb }. Lists the `top` largest growths and the `top` largest reductions.
 */
export function deltaMarkdown({ title = 'Size delta', label = 'item', totals = null, rows = [], top = 10 } = {}) {
  const out = [`### ${mdCell(title)}`, ''];
  if (totals) {
    out.push('| Region | A | B | Delta |', '|---|---:|---:|---:|');
    out.push(`| FLASH | ${totals.fa} | ${totals.fb} | ${signed(totals.fb - totals.fa)} |`);
    out.push(`| RAM | ${totals.ra} | ${totals.rb} | ${signed(totals.rb - totals.ra)} |`, '');
  }
  const grew = rows.filter((r) => r.delta > 0).slice(0, top);
  const shrank = rows.filter((r) => r.delta < 0).slice(-top).reverse();
  const table = (list) => {
    out.push(`| ${mdCell(label)} | A | B | Delta |`, '|---|---:|---:|---:|');
    for (const r of list) out.push(`| \`${mdCell(r.key || '(unnamed)')}\` | ${r.before} | ${r.after} | ${signed(r.delta)} |`);
    out.push('');
  };
  if (grew.length) { out.push('**Largest growth** (bytes)', ''); table(grew); }
  if (shrank.length) { out.push('**Largest reduction** (bytes)', ''); table(shrank); }
  if (!grew.length && !shrank.length) out.push('No size changes.', '');
  return out.join('\n');
}
