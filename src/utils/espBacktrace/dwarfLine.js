/**
 * DWARF .debug_line parser (line-number program), versions 2 to 5, 32- and 64-bit DWARF.
 *
 * Output is a single sorted table of address -> file:line rows across all compile
 * units. Sequences that start at address 0 (sections discarded by --gc-sections) are
 * dropped. Unsupported constructs (DWARF < 2 or > 5, strx/addrx forms, compressed
 * sections) throw, and parseDebugLine() keeps whatever units parsed before the error.
 *
 * Address advance: maximum_operations_per_instruction is treated as 1 (VLIW op_index is
 * not modelled); ESP targets (Xtensa, RISC-V) are never VLIW.
 */

const FORM = {
  string: 0x08, line_strp: 0x1f, strp: 0x0e, udata: 0x0f, data1: 0x0b, data2: 0x05,
  data4: 0x06, data8: 0x07, data16: 0x1e, block: 0x09, strp_sup: 0x1d,
};
const LNCT_PATH = 1;
const LNCT_DIRECTORY_INDEX = 2;

class Reader {
  constructor(bytes, pos = 0, end = bytes.length) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
    this.end = end;
  }
  need(n) {
    if (this.pos + n > this.end) throw new Error('DWARF line table ended unexpectedly.');
  }
  u8() { this.need(1); return this.b[this.pos++]; }
  i8() { const v = this.u8(); return v > 127 ? v - 256 : v; }
  u16() { this.need(2); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  u64() { return this.u32() + this.u32() * 0x100000000; }
  /** Unsigned little-endian integer of n bytes (n up to 8). */
  uint(n) {
    this.need(n);
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + this.b[this.pos + i];
    this.pos += n;
    return v;
  }
  uleb() {
    let result = 0;
    let mul = 1;
    let byte;
    do {
      byte = this.u8();
      result += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    return result;
  }
  sleb() {
    let result = 0;
    let mul = 1;
    let byte;
    do {
      byte = this.u8();
      result += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    if (byte & 0x40) result -= mul;
    return result;
  }
  cstr() {
    const start = this.pos;
    while (this.pos < this.end && this.b[this.pos] !== 0) this.pos++;
    if (this.pos >= this.end) throw new Error('DWARF string runs past the end of .debug_line.');
    const s = new TextDecoder().decode(this.b.subarray(start, this.pos));
    this.pos++;
    return s;
  }
  skip(n) { this.need(n); this.pos += n; }
}

const strAt = (section, off) => {
  if (!section) throw new Error('DWARF file name uses a string section that is not present.');
  let end = off;
  while (end < section.length && section[end] !== 0) end++;
  return new TextDecoder().decode(section.subarray(off, end));
};

function readForm(r, form, ctx) {
  switch (form) {
    case FORM.string: return r.cstr();
    case FORM.line_strp: return strAt(ctx.lineStr, r.uint(ctx.offsetSize));
    case FORM.strp: return strAt(ctx.str, r.uint(ctx.offsetSize));
    case FORM.udata: return r.uleb();
    case FORM.data1: return r.u8();
    case FORM.data2: return r.u16();
    case FORM.data4: return r.u32();
    case FORM.data8: return r.u64();
    case FORM.data16: r.skip(16); return null;
    case FORM.block: r.skip(r.uleb()); return null;
    default:
      throw new Error(`Unsupported DWARF form 0x${form.toString(16)} in a line table header.`);
  }
}

/** Parse one unit header starting at `offset`. */
export function parseLineHeader(bytes, offset, ctx = {}) {
  const r = new Reader(bytes, offset);
  let unitLength = r.u32();
  let offsetSize = 4;
  if (unitLength === 0xffffffff) { unitLength = r.u64(); offsetSize = 8; }
  if (unitLength === 0) throw new Error('Empty DWARF line unit.');
  const unitEnd = r.pos + unitLength;
  if (unitEnd > bytes.length) throw new Error('DWARF line unit runs past the end of .debug_line.');
  r.end = unitEnd;

  const version = r.u16();
  if (version < 2 || version > 5) throw new Error(`Unsupported DWARF line table version ${version} (supported: 2-5).`);
  let addrSize = 4;
  if (version >= 5) { addrSize = r.u8(); r.u8(); /* segment_selector_size */ }
  const headerLength = offsetSize === 8 ? r.u64() : r.u32();
  const programStart = r.pos + headerLength;
  const minInst = r.u8();
  if (version >= 4) r.u8(); /* maximum_operations_per_instruction */
  const defaultIsStmt = r.u8() !== 0;
  const lineBase = r.i8();
  const lineRange = r.u8();
  const opcodeBase = r.u8();
  if (lineRange === 0) throw new Error('DWARF line_range is zero.');
  const stdLengths = [0];
  for (let i = 1; i < opcodeBase; i++) stdLengths.push(r.u8());

  const dirs = [];
  const files = [];
  if (version >= 5) {
    const readEntries = () => {
      const fmtCount = r.u8();
      const fmt = [];
      for (let i = 0; i < fmtCount; i++) fmt.push({ type: r.uleb(), form: r.uleb() });
      const count = r.uleb();
      const out = [];
      for (let i = 0; i < count; i++) {
        const entry = { name: '', dir: 0 };
        for (const f of fmt) {
          const v = readForm(r, f.form, { ...ctx, offsetSize });
          if (f.type === LNCT_PATH) entry.name = v;
          else if (f.type === LNCT_DIRECTORY_INDEX) entry.dir = v;
        }
        out.push(entry);
      }
      return out;
    };
    for (const d of readEntries()) dirs.push(d.name);
    for (const f of readEntries()) files.push(f);
  } else {
    dirs.push(''); // index 0 = compilation directory (not stored in v2-4 tables)
    for (;;) {
      const d = r.cstr();
      if (!d) break;
      dirs.push(d);
    }
    for (;;) {
      const name = r.cstr();
      if (!name) break;
      const dir = r.uleb();
      r.uleb(); r.uleb(); // mtime, length
      files.push({ name, dir });
    }
  }

  const resolveFile = (index) => {
    const entry = version >= 5 ? files[index] : files[index - 1];
    if (!entry) return `<file ${index}>`;
    const name = entry.name;
    if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) return name;
    const dir = dirs[entry.dir];
    return dir ? `${dir.replace(/[\\/]$/, '')}/${name}` : name;
  };

  return {
    version, offsetSize, addrSize, unitEnd, programStart, minInst, defaultIsStmt,
    lineBase, lineRange, opcodeBase, stdLengths, resolveFile,
  };
}

/** Run the line-number state machine for one unit. Returns raw rows (file resolved). */
export function runLineProgram(bytes, h) {
  const r = new Reader(bytes, h.programStart, h.unitEnd);
  const rows = [];
  let address = 0;
  let file = 1;
  let line = 1;
  let isStmt = h.defaultIsStmt;
  let seqStart = 0;
  let seqZero = false;

  const reset = () => {
    address = 0; file = 1; line = 1; isStmt = h.defaultIsStmt; seqStart = rows.length; seqZero = false;
  };
  const emit = (end) => {
    rows.push({ address, file: h.resolveFile(file), line, isStmt, end });
  };

  while (r.pos < r.end) {
    const op = r.u8();
    if (op >= h.opcodeBase) {
      const adj = op - h.opcodeBase;
      address += Math.floor(adj / h.lineRange) * h.minInst;
      line += h.lineBase + (adj % h.lineRange);
      emit(false);
    } else if (op === 0) {
      const len = r.uleb();
      if (len === 0) break;
      const next = r.pos + len;
      const sub = r.u8();
      if (sub === 1) { // DW_LNE_end_sequence
        if (seqZero) rows.length = seqStart; // dead sequence (address 0)
        else emit(true);
        reset();
      } else if (sub === 2) { // DW_LNE_set_address
        address = r.uint(len - 1);
        if (address === 0) seqZero = true;
      }
      // DW_LNE_define_file (3), set_discriminator (4) and unknown: skipped by length
      r.pos = next;
    } else {
      switch (op) {
        case 1: emit(false); break; // DW_LNS_copy
        case 2: address += r.uleb() * h.minInst; break; // advance_pc
        case 3: line += r.sleb(); break; // advance_line
        case 4: file = r.uleb(); break; // set_file
        case 5: r.uleb(); break; // set_column
        case 6: isStmt = !isStmt; break; // negate_stmt
        case 7: break; // set_basic_block
        case 8: address += Math.floor((255 - h.opcodeBase) / h.lineRange) * h.minInst; break; // const_add_pc
        case 9: address += r.u16(); break; // fixed_advance_pc
        case 10: case 11: break; // prologue_end, epilogue_begin
        case 12: r.uleb(); break; // set_isa
        default:
          for (let i = 0; i < (h.stdLengths[op] || 0); i++) r.uleb();
      }
    }
  }
  return rows;
}

/**
 * Parse every unit in a .debug_line section.
 * @returns {{entries:object[], units:number, versions:number[], errors:string[]}}
 *   entries are sorted by address; {address, file, line, end}.
 */
export function parseDebugLine(lineBytes, ctx = {}) {
  const entries = [];
  const versions = [];
  const errors = [];
  let units = 0;
  let off = 0;
  while (off < lineBytes.length) {
    let h;
    try {
      h = parseLineHeader(lineBytes, off, ctx);
    } catch (e) {
      errors.push(e.message);
      break;
    }
    try {
      const rows = runLineProgram(lineBytes, h);
      for (const row of rows) {
        entries.push({ address: row.address, file: row.file, line: row.line, end: row.end });
      }
      versions.push(h.version);
      units++;
    } catch (e) {
      errors.push(e.message);
    }
    off = h.unitEnd;
  }
  // Same address: end-of-sequence rows sort before starts so a new sequence wins.
  entries.sort((a, b) => a.address - b.address || (a.end === b.end ? 0 : a.end ? -1 : 1));
  return { entries, units, versions, errors };
}

/** File:line for an address, or null when the address is outside every sequence. */
export function lookupLine(table, addr) {
  const e = table && table.entries;
  if (!e || !e.length) return null;
  let lo = 0;
  let hi = e.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (e[mid].address <= addr) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0 || e[idx].end) return null;
  return { file: e[idx].file, line: e[idx].line };
}
