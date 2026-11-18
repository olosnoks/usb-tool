/**
 * ELF32 reader for the ESP backtrace decoder (little-endian only; ESP32, ESP32-S2/S3
 * (Xtensa) and ESP32-C3/C6/H2 (RISC-V) firmware builds are all ELF32 LE).
 *
 * Reads the section header table, the .symtab / .strtab pair (FUNC symbols only) and
 * the executable address ranges. DWARF sections are returned as raw bytes for
 * dwarfLine.js to parse.
 */

const SHT_SYMTAB = 2;
const SHT_NOBITS = 8;
const SHF_ALLOC = 0x2;
const SHF_EXECINSTR = 0x4;
const SHF_COMPRESSED = 0x800;
const STT_FUNC = 2;
const SHN_UNDEF = 0;
const EM_XTENSA = 94;
const EM_RISCV = 243;

const cstr = (bytes, off) => {
  let end = off;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(off, end));
};

/**
 * Parse an ELF32 little-endian image.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {{arch:string, machine:number, sections:object[], functions:object[],
 *   execRanges:object[], functionCount:number, symbolAt:(addr:number)=>object|null,
 *   isExec:(addr:number)=>boolean, section:(name:string)=>object|null,
 *   sectionBytes:(name:string)=>Uint8Array|null}}
 */
export function parseElf(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 52) throw new Error('File is too small to be an ELF image.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x7f454c46) throw new Error('Not an ELF file (missing 0x7F "ELF" magic).');
  if (bytes[4] !== 1) throw new Error('Only ELF32 images are supported (ESP firmware ELFs are ELF32).');
  if (bytes[5] !== 1) throw new Error('Only little-endian ELF images are supported.');

  const machine = dv.getUint16(18, true);
  const arch = machine === EM_XTENSA ? 'xtensa' : machine === EM_RISCV ? 'riscv' : 'other';
  const shoff = dv.getUint32(32, true);
  const shentsize = dv.getUint16(46, true);
  const shnum = dv.getUint16(48, true);
  const shstrndx = dv.getUint16(50, true);
  if (!shoff || !shnum) throw new Error('ELF image has no section header table (stripped with sstrip?).');
  if (shentsize < 40 || shoff + shnum * shentsize > bytes.length) throw new Error('ELF section header table is truncated.');

  const raw = [];
  for (let i = 0; i < shnum; i++) {
    const b = shoff + i * shentsize;
    raw.push({
      index: i,
      nameOff: dv.getUint32(b, true),
      type: dv.getUint32(b + 4, true),
      flags: dv.getUint32(b + 8, true),
      addr: dv.getUint32(b + 12, true),
      offset: dv.getUint32(b + 16, true),
      size: dv.getUint32(b + 20, true),
      link: dv.getUint32(b + 24, true),
    });
  }
  const shstr = raw[shstrndx];
  const sections = raw.map((s) => ({
    ...s,
    name: shstr && shstr.type !== SHT_NOBITS && shstr.offset + s.nameOff < bytes.length
      ? cstr(bytes, shstr.offset + s.nameOff) : '',
  }));

  const byName = new Map();
  for (const s of sections) if (s.name && !byName.has(s.name)) byName.set(s.name, s);

  const sectionBytes = (name) => {
    const s = byName.get(name);
    if (!s || s.type === SHT_NOBITS) return null;
    if (s.flags & SHF_COMPRESSED) throw new Error(`Section ${name} is compressed (SHF_COMPRESSED); not supported.`);
    if (s.offset + s.size > bytes.length) throw new Error(`Section ${name} runs past the end of the file.`);
    return bytes.subarray(s.offset, s.offset + s.size);
  };

  // FUNC symbols from every .symtab (normally exactly one).
  const functions = [];
  for (const s of sections) {
    if (s.type !== SHT_SYMTAB) continue;
    const strtab = sections[s.link];
    if (!strtab || strtab.type === SHT_NOBITS) continue;
    const count = Math.floor(s.size / 16);
    for (let i = 0; i < count; i++) {
      const b = s.offset + i * 16;
      if (b + 16 > bytes.length) break;
      const info = bytes[b + 12];
      if ((info & 0xf) !== STT_FUNC) continue;
      const shndx = dv.getUint16(b + 14, true);
      const value = dv.getUint32(b + 4, true);
      const size = dv.getUint32(b + 8, true);
      if (shndx === SHN_UNDEF || value === 0) continue;
      const nameOff = dv.getUint32(b, true);
      const name = nameOff ? cstr(bytes, strtab.offset + nameOff) : '';
      if (!name) continue;
      functions.push({ name, value, size });
    }
  }
  functions.sort((a, b) => a.value - b.value);

  const execRanges = sections
    .filter((s) => (s.flags & SHF_ALLOC) && (s.flags & SHF_EXECINSTR) && s.size > 0)
    .map((s) => ({ name: s.name, start: s.addr, end: s.addr + s.size }));

  const isExec = (addr) => execRanges.some((r) => addr >= r.start && addr < r.end);

  /** Nearest FUNC symbol at or below addr whose [value, value+size) contains it. */
  const symbolAt = (addr) => {
    if (!functions.length || !Number.isFinite(addr)) return null;
    let lo = 0;
    let hi = functions.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (functions[mid].value <= addr) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let j = idx; j >= 0 && functions[j].value === functions[idx].value; j--) {
      const f = functions[j];
      const inside = f.size > 0 ? addr < f.value + f.size : addr === f.value;
      if (inside) return { name: f.name, value: f.value, size: f.size, offset: addr - f.value };
    }
    return null;
  };

  return {
    arch,
    machine,
    sections,
    functions,
    execRanges,
    functionCount: functions.length,
    symbolAt,
    isExec,
    section: (name) => byName.get(name) || null,
    sectionBytes,
  };
}
