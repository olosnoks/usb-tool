import { describe, it, expect } from 'vitest';
import {
  decodeBacktrace, formatReport, prepareElf, callSiteFor, parsePanic, extractLatestPanic,
  parseElf, parseDebugLine, lookupLine, explainCause,
} from '../src/utils/espBacktrace.js';

// ---------- byte helpers for building test images ----------
const enc = (s) => Array.from(new TextEncoder().encode(s));
const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const uleb = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const sleb = (n) => {
  const out = [];
  let more = true;
  while (more) {
    let b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
};

// Standard opcode operand counts for opcode_base 13 (opcodes 1..12).
const STD_LENGTHS = [0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1];
const setAddress = (addr) => [0, 5, 2, ...u32(addr)];
const endSequence = () => [0, 1, 1];
const advanceLine = (d) => [3, ...sleb(d)];
const advancePc = (d) => [2, ...uleb(d)];

/** DWARF 4 unit (one include dir "/src", one file "main.c" in dir 1). */
function dwarf4Unit(program) {
  const afterHeaderLength = [
    1, 1, 1, 0xfb, 14, 13, // min_inst, max_ops, default_is_stmt, line_base (-5), line_range, opcode_base
    ...STD_LENGTHS,
    ...enc('/src'), 0, 0, // include_directories
    ...enc('main.c'), 0, 1, 0, 0, // file 1: main.c, dir 1
    0,
  ];
  const body = [...u16(4), ...u32(afterHeaderLength.length), ...afterHeaderLength, ...program];
  return [...u32(body.length), ...body];
}

/** DWARF 5 unit: dirs /build and /src, files main.c (dir 0) and util.c (dir 1), names in .debug_line_str. */
function dwarf5Unit(program) {
  const afterHeaderLength = [
    1, 1, 1, 0xfb, 14, 13,
    ...STD_LENGTHS,
    1, 1, 0x08, // directory format: count 1; (DW_LNCT_path, DW_FORM_string)
    2, ...enc('/build'), 0, ...enc('/src'), 0, // 2 directories
    2, 1, 0x1f, 2, 0x0f, // file format: (path, DW_FORM_line_strp), (directory_index, DW_FORM_udata)
    2, // 2 files
    ...u32(0), 0, // main.c at .debug_line_str+0, dir 0
    ...u32(7), 1, // util.c at .debug_line_str+7, dir 1
  ];
  const body = [...u16(5), 4, 0, ...u32(afterHeaderLength.length), ...afterHeaderLength, ...program];
  return [...u32(body.length), ...body];
}

/**
 * Build a minimal ELF32 little-endian image: .text (alloc+exec), optional .debug_line,
 * .debug_line_str, .symtab/.strtab and .shstrtab.
 */
function buildElf({ machine = 94, textAddr = 0x40080000, textSize = 0x200, funcs = [], debugLine = null, debugLineStr = null }) {
  const shstr = [0];
  const shName = {};
  for (const n of ['.text', '.debug_line', '.debug_line_str', '.symtab', '.strtab', '.shstrtab']) {
    shName[n] = shstr.length;
    shstr.push(...enc(n), 0);
  }
  const strtab = [0];
  const symNameOff = funcs.map((f) => {
    const o = strtab.length;
    strtab.push(...enc(f.name), 0);
    return o;
  });
  const sym = new Array(16).fill(0); // null symbol
  funcs.forEach((f, i) => {
    sym.push(...u32(symNameOff[i]), ...u32(f.value), ...u32(f.size), f.info ?? 0x12, 0, ...u16(f.shndx ?? 1));
  });

  const list = [{ name: '.text', type: 1, flags: 0x6, addr: textAddr, data: new Array(textSize).fill(0) }];
  if (debugLine) list.push({ name: '.debug_line', type: 1, flags: 0, addr: 0, data: debugLine });
  if (debugLineStr) list.push({ name: '.debug_line_str', type: 1, flags: 0x30, addr: 0, data: debugLineStr });
  list.push({ name: '.symtab', type: 2, flags: 0, addr: 0, data: sym, entsize: 16 });
  list.push({ name: '.strtab', type: 3, flags: 0, addr: 0, data: strtab });
  list.push({ name: '.shstrtab', type: 3, flags: 0, addr: 0, data: shstr });

  const parts = [];
  let cur = 52;
  const place = (bytes) => {
    while (cur % 4) { parts.push(0); cur++; }
    const o = cur;
    for (const b of bytes) parts.push(b);
    cur += bytes.length;
    return o;
  };
  const offsets = list.map((s) => place(s.data));
  while (cur % 4) { parts.push(0); cur++; }
  const shoff = cur;
  const shnum = list.length + 1;
  const shstrndx = list.findIndex((s) => s.name === '.shstrtab') + 1;
  const strtabIdx = list.findIndex((s) => s.name === '.strtab') + 1;
  const shdr = (name, type, flags, addr, offset, size, link = 0, entsize = 0) => [
    ...u32(name), ...u32(type), ...u32(flags), ...u32(addr), ...u32(offset), ...u32(size),
    ...u32(link), ...u32(0), ...u32(4), ...u32(entsize),
  ];
  const hdr = [...shdr(0, 0, 0, 0, 0, 0)];
  list.forEach((s, i) => {
    const link = s.name === '.symtab' ? strtabIdx : 0;
    hdr.push(...shdr(shName[s.name], s.type, s.flags, s.addr, offsets[i], s.data.length, link, s.entsize || 0));
  });
  const eh = [
    0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ...u16(2), ...u16(machine), ...u32(1), ...u32(0), ...u32(0), ...u32(shoff), ...u32(0),
    ...u16(52), ...u16(0), ...u16(0), ...u16(40), ...u16(shnum), ...u16(shstrndx),
  ];
  return Uint8Array.from([...eh, ...parts, ...hdr]);
}

// Firmware used by the end-to-end tests:
//   helper   0x40080000 size 0x100  (FUNC)
//   app_main 0x40080100 size 0x40   (FUNC)
//   some_table is OBJECT data at 0x3ffb0000 and must be ignored.
const FUNCS = [
  { name: 'helper', value: 0x40080000, size: 0x100 },
  { name: 'app_main', value: 0x40080100, size: 0x40 },
  { name: 'some_table', value: 0x3ffb0000, size: 4, info: 0x11 },
];

// .debug_line (DWARF 4): seq1 0x40080000 line 7 ... end 0x40080100; seq2 0x40080100 line 42 ... end 0x40080140;
// plus a dead sequence at address 0 (gc'd) that must be dropped.
const LINE_V4 = dwarf4Unit([
  ...setAddress(0x40080000), ...advanceLine(6), 1, ...advancePc(0x100), ...endSequence(),
  ...setAddress(0x40080100), ...advanceLine(41), 1, ...advancePc(0x40), ...endSequence(),
  ...setAddress(0), 1, ...endSequence(),
]);

const XTENSA_PANIC = `
Guru Meditation Error: Core  0 panic'ed (LoadProhibited). Exception was unhandled.
Core  0 register dump:
PC      : 0x40080012  PS      : 0x00060030  A0      : 0x80080108  A1      : 0x3ffb1f70
A2      : 0x00000000  A3      : 0x3ffb1f90  A4      : 0x00000000  A5      : 0x00000000
EXCVADDR: 0x00000000  EXCCAUSE: 0x0000001c

Backtrace: 0x40080012:0x3ffb1f70 0x80080108:0x3ffb1f90 0x40080400:0x3ffb1fb0|<-CORRUPTED
`;

const RISCV_PANIC = `
Guru Meditation Error: Core  0 panic'ed (Store access fault). Exception was unhandled.
Core  0 register dump:
MEPC    : 0x40080034  RA      : 0x40080021  SP      : 0x3fc9f1b0  GP      : 0x3fc9a000
TP      : 0x3fc8c000  T0      : 0x00000000  T1      : 0x00000001  T2      : 0x00000002
MSTATUS : 0x00001880  MTVAL   : 0x00000000  MCAUSE  : 0x00000007  MHARTID : 0x00000000

Stack memory:
3fc9f1b0: 0x40080105 0x00000000 0x3fc9f1c0 0x40080000
3fc9f1c0: 0x3fc8c000 0x40080018 0x00000000 0x3fc9a000
`;

const ESP8266_PANIC = `
Fatal exception (28):
epc1=0x40080034 epc2=0x00000000 epc3=0x00000000 excvaddr=0x00000000 depc=0x00000000

ctx: cont
sp: 3ffffe50 end: 3fffffd0 offset: 01a0
stack>>>
3ffffe50:  40080105 00000000 3fffff00 40080000
<<<stack<<<
`;

const ABORT_PANIC = `
abort() was called at PC 0x40080106 on core 0

Backtrace: 0x40080106:0x3ffb1f70 0x40080118:0x3ffb1f90
`;

describe('callSiteFor (return-address mapping)', () => {
  it('Xtensa: replaces the window bits and backs up the 3-byte call', () => {
    expect(callSiteFor('xtensa', 0x80080108)).toBe(0x40080105);
    expect(callSiteFor('xtensa', 0x40080108)).toBe(0x40080105);
  });
  it('ESP8266 backs up 3 bytes; RISC-V backs up 1 byte', () => {
    expect(callSiteFor('esp8266', 0x40080108)).toBe(0x40080105);
    expect(callSiteFor('riscv', 0x40080021)).toBe(0x40080020);
  });
});

describe('panic text parsing', () => {
  it('parses an Xtensa Guru Meditation block with backtrace and CORRUPTED marker', () => {
    const p = parsePanic(XTENSA_PANIC);
    expect(p.arch).toBe('xtensa');
    expect(p.kind).toBe('guru');
    expect(p.core).toBe(0);
    expect(p.cause).toEqual({ name: 'LoadProhibited', code: null, source: 'banner' });
    expect(p.faultRegister).toBe('EXCVADDR');
    expect(p.faultAddress).toBe(0);
    expect(p.registers.find((r) => r.name === 'PC').value).toBe(0x40080012);
    expect(p.registers.find((r) => r.name === 'A0').value).toBe(0x80080108);
    expect(p.registers.find((r) => r.name === 'EXCCAUSE').value).toBe(0x1c);
    expect(p.backtrace).toEqual([
      { pc: 0x40080012, sp: 0x3ffb1f70 },
      { pc: 0x80080108, sp: 0x3ffb1f90 },
      { pc: 0x40080400, sp: 0x3ffb1fb0 },
    ]);
    expect(p.backtraceCorrupted).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/CORRUPTED/);
  });

  it('parses a RISC-V panic: MEPC/RA/MCAUSE and the stack memory dump', () => {
    const p = parsePanic(RISCV_PANIC);
    expect(p.arch).toBe('riscv');
    expect(p.kind).toBe('guru');
    expect(p.cause.name).toBe('Store access fault');
    expect(p.registers.find((r) => r.name === 'MEPC').value).toBe(0x40080034);
    expect(p.registers.find((r) => r.name === 'RA').value).toBe(0x40080021);
    expect(p.faultRegister).toBe('MTVAL');
    expect(p.stackWords).toEqual([
      0x40080105, 0, 0x3fc9f1c0, 0x40080000, 0x3fc8c000, 0x40080018, 0, 0x3fc9a000,
    ]);
  });

  it('falls back to MCAUSE when the banner has no cause name', () => {
    const p = parsePanic('MEPC    : 0x40080034  RA      : 0x40080021\nMTVAL   : 0x00000000  MCAUSE  : 0x00000002\n');
    expect(p.arch).toBe('riscv');
    expect(p.cause.name).toBe('Illegal instruction');
    expect(p.kind).toBe('register-dump');
  });

  it('parses an ESP8266 "Fatal exception" with cause table and stack>>> dump', () => {
    const p = parsePanic(ESP8266_PANIC);
    expect(p.arch).toBe('esp8266');
    expect(p.kind).toBe('fatal');
    expect(p.cause).toEqual({ name: 'LoadProhibited', code: 28, source: 'table' });
    expect(p.registers.find((r) => r.name === 'EPC1').value).toBe(0x40080034);
    expect(p.stackWords).toEqual([0x40080105, 0, 0x3fffff00, 0x40080000]);
  });

  it('parses abort() with its PC and the backtrace', () => {
    const p = parsePanic(ABORT_PANIC);
    expect(p.kind).toBe('abort');
    expect(p.arch).toBe('xtensa');
    expect(p.abortPc).toBe(0x40080106);
    expect(p.core).toBe(0);
    expect(p.backtrace.length).toBe(2);
    expect(p.backtraceCorrupted).toBe(false);
  });

  it('parses an ESP-IDF assert failed line', () => {
    const p = parsePanic('assert failed: xTaskPriorityDisinherit tasks.c:4123 (pxMutexHolder == pxCurrentTCB)\nBacktrace: 0x40080110:0x3ffb1f70\n');
    expect(p.kind).toBe('assert');
    expect(p.assert).toEqual({ func: 'xTaskPriorityDisinherit', file: 'tasks.c', line: 4123, expr: 'pxMutexHolder == pxCurrentTCB' });
  });

  it('reads ESP-IDF and ESP8266 reset reasons', () => {
    const idf = parsePanic('rst:0x10 (RTCWDT_RTC_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\n' + XTENSA_PANIC);
    expect(idf.reset).toEqual({ code: 0x10, name: 'RTCWDT_RTC_RESET', source: 'banner', boot: 'SPI_FAST_FLASH_BOOT' });
    const esp8266 = parsePanic('rst cause:2, boot mode:(3,6)\n' + ESP8266_PANIC);
    expect(esp8266.reset.name).toBe('exception reset');
    expect(esp8266.reset.code).toBe(2);
  });

  it('reports no markers for ordinary text', () => {
    const p = parsePanic('I (123) app: hello world');
    expect(p.kind).toBe('unknown');
    expect(p.warnings.join(' ')).toMatch(/No ESP panic markers/);
  });

  it('explains known causes and leaves unknown ones blank', () => {
    expect(explainCause('LoadProhibited')).toMatch(/read/);
    expect(explainCause('Store access fault')).toMatch(/store failed/);
    expect(explainCause('Interrupt wdt timeout on CPU0')).toMatch(/watchdog/);
    expect(explainCause('something new')).toBe('');
  });
});

describe('extractLatestPanic (serial buffer)', () => {
  it('returns the most recent panic block, not an earlier one', () => {
    const buf = [
      'I (10) boot: starting',
      "Guru Meditation Error: Core  0 panic'ed (IllegalInstruction). Exception was unhandled.",
      'Core  0 register dump:',
      'PC      : 0x40080000  A0      : 0x00000000',
      'Rebooting...',
      'ESP-ROM:esp32',
      "Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.",
      'Core  0 register dump:',
      'PC      : 0x40080010  A0      : 0x00000000',
      'Backtrace: 0x40080010:0x3ffb1f70',
      'Rebooting...',
      'I (20) boot: again',
    ].join('\r\n');
    const got = extractLatestPanic(buf);
    expect(got.found).toBe(true);
    expect(got.text).toContain('StoreProhibited');
    expect(got.text).not.toContain('IllegalInstruction');
    expect(got.text).toContain('Backtrace: 0x40080010');
  });

  it('finds nothing in a log without panic markers', () => {
    expect(extractLatestPanic('I (1) app: ok\nI (2) app: still ok\n')).toEqual({ found: false, text: '' });
  });
});

describe('ELF32 reader and symbol lookup', () => {
  const elfBytes = buildElf({ funcs: FUNCS, debugLine: LINE_V4 });

  it('reads arch, exec ranges and FUNC symbols only', () => {
    const elf = parseElf(elfBytes);
    expect(elf.arch).toBe('xtensa');
    expect(elf.functionCount).toBe(2);
    expect(elf.execRanges).toEqual([{ name: '.text', start: 0x40080000, end: 0x40080200 }]);
    expect(elf.isExec(0x40080010)).toBe(true);
    expect(elf.isExec(0x3ffb0000)).toBe(false);
  });

  it('maps addresses to function + offset (nearest preceding, within size)', () => {
    const elf = parseElf(elfBytes);
    expect(elf.symbolAt(0x40080012)).toMatchObject({ name: 'helper', offset: 0x12 });
    expect(elf.symbolAt(0x40080100)).toMatchObject({ name: 'app_main', offset: 0 });
    expect(elf.symbolAt(0x40080140)).toBeNull(); // past app_main's size
    expect(elf.symbolAt(0x3ffb0000)).toBeNull(); // data object, not a function
  });

  it('rejects non-ELF, ELF64 and truncated input', () => {
    expect(() => parseElf(new Uint8Array([1, 2, 3]))).toThrow(/too small/);
    expect(() => parseElf(new Uint8Array(64))).toThrow(/magic/);
    const elf64 = Uint8Array.from(elfBytes);
    elf64[4] = 2;
    expect(() => parseElf(elf64)).toThrow(/ELF32/);
  });
});

describe('DWARF .debug_line parser', () => {
  it('runs a DWARF 4 line program and drops the dead (address 0) sequence', () => {
    const t = parseDebugLine(Uint8Array.from(LINE_V4));
    expect(t.errors).toEqual([]);
    expect(t.units).toBe(1);
    expect(t.versions).toEqual([4]);
    expect(t.entries.some((e) => e.address === 0)).toBe(false);
    expect(lookupLine(t, 0x40080000)).toEqual({ file: '/src/main.c', line: 7 });
    expect(lookupLine(t, 0x400800ff)).toEqual({ file: '/src/main.c', line: 7 });
    expect(lookupLine(t, 0x40080105)).toEqual({ file: '/src/main.c', line: 42 });
    expect(lookupLine(t, 0x40080140)).toBeNull(); // end of sequence
    expect(lookupLine(t, 0x3ffb0000)).toBeNull();
  });

  it('runs a DWARF 5 line program (directory/file entry formats, line_strp, const_add_pc, negative advance)', () => {
    const lineStr = Uint8Array.from(enc('main.c\0util.c\0'));
    const program = [
      ...setAddress(0x40080000),
      4, 0, // set_file 0 (main.c)
      ...advanceLine(4), // line 5
      1, // copy
      8, // const_add_pc: +17 bytes
      3, 0x7f, // advance_line -1 -> line 4
      1, // copy at 0x40080011
      4, 1, // set_file 1 (util.c)
      ...advancePc(3),
      ...endSequence(),
    ];
    const t = parseDebugLine(Uint8Array.from(dwarf5Unit(program)), { lineStr });
    expect(t.errors).toEqual([]);
    expect(t.versions).toEqual([5]);
    expect(lookupLine(t, 0x40080000)).toEqual({ file: '/build/main.c', line: 5 });
    expect(lookupLine(t, 0x40080012)).toEqual({ file: '/build/main.c', line: 4 });
    expect(lookupLine(t, 0x40080014)).toBeNull();
  });

  it('reports an unsupported version without throwing', () => {
    const t = parseDebugLine(Uint8Array.from([2, 0, 0, 0, 6, 0]));
    expect(t.entries).toEqual([]);
    expect(t.errors[0]).toMatch(/version 6/);
  });
});

describe('decodeBacktrace (end to end with a crafted ELF)', () => {
  const prepared = prepareElf(buildElf({ funcs: FUNCS, debugLine: LINE_V4 }));

  it('prepareElf reports full line info when .debug_line is present', () => {
    expect(prepared.lineInfo).toBe('full');
    expect(prepared.summary.dwarfVersions).toEqual([4]);
    expect(prepared.summary.functionCount).toBe(2);
  });

  it('decodes Xtensa frames: exact PC, windowed return address and CORRUPTED tail', () => {
    const r = decodeBacktrace(XTENSA_PANIC, prepared);
    expect(r.frames[0]).toMatchObject({ role: 'PC', lookup: 0x40080012, func: 'helper', offset: 0x12, file: '/src/main.c', line: 7 });
    expect(r.frames[1]).toMatchObject({ role: 'return', lookup: 0x40080105, func: 'app_main', offset: 5, file: '/src/main.c', line: 42 });
    expect(r.frames[2]).toMatchObject({ func: null, file: null });
    expect(r.cause.explanation).toMatch(/read/);
    expect(r.backtraceCorrupted).toBe(true);
    const a0 = r.registers.find((x) => x.name === 'A0');
    expect(a0.symbol).toMatchObject({ func: 'app_main', offset: 5, file: '/src/main.c', line: 42 });
  });

  it('decodes RISC-V: MEPC exact, RA mapped to RA-1, and stack candidates', () => {
    const r = decodeBacktrace(RISCV_PANIC, prepared);
    expect(r.frames.map((f) => [f.role, f.func, f.offset])).toEqual([
      ['MEPC', 'helper', 0x34],
      ['RA (return address)', 'helper', 0x20],
    ]);
    expect(r.candidates.map((c) => c.addr)).toEqual([0x40080105, 0x40080000, 0x40080018]);
    expect(r.candidates[0]).toMatchObject({ func: 'app_main', offset: 5 });
  });

  it('decodes ESP8266 EPC1 and stack>>> candidates', () => {
    const r = decodeBacktrace(ESP8266_PANIC, prepared);
    expect(r.arch).toBe('esp8266');
    expect(r.frames.map((f) => [f.role, f.func, f.offset])).toEqual([['EPC1', 'helper', 0x34]]);
    expect(r.candidates.map((c) => c.addr)).toEqual([0x40080105, 0x40080000]);
  });

  it('decodes an abort() backtrace with mapped return address', () => {
    const r = decodeBacktrace(ABORT_PANIC, prepared);
    expect(r.frames[0]).toMatchObject({ func: 'app_main', offset: 6, role: 'PC' });
    expect(r.frames[1]).toMatchObject({ func: 'app_main', offset: 0x15, lookup: 0x40080115 });
    expect(r.cause.name).toBe('abort()');
  });

  it('without an ELF it shows addresses only and says so', () => {
    const r = decodeBacktrace(XTENSA_PANIC, null);
    expect(r.frames[0]).toMatchObject({ pc: 0x40080012, func: null, file: null });
    expect(r.notes.join(' ')).toMatch(/No ELF loaded/);
    expect(r.lineInfo).toBe('none');
  });

  it('warns when the ELF is for a different architecture than the crash text', () => {
    const r = decodeBacktrace(RISCV_PANIC, prepareElf(buildElf({ machine: 94, funcs: FUNCS, debugLine: LINE_V4 })));
    expect(r.notes.join(' ')).toMatch(/will not match/);
  });

  it('falls back to function names when there is no .debug_line', () => {
    const p = prepareElf(buildElf({ funcs: FUNCS, debugLine: null }));
    expect(p.lineInfo).toBe('none');
    const r = decodeBacktrace(XTENSA_PANIC, p);
    expect(r.frames[1]).toMatchObject({ func: 'app_main', offset: 5, file: null, line: null });
    expect(r.notes.join(' ')).toMatch(/-g/);
  });

  it('falls back to function names when the DWARF version is unsupported', () => {
    const badLine = [...u32(2), ...u16(6)];
    const p = prepareElf(buildElf({ funcs: FUNCS, debugLine: badLine }));
    expect(p.lineInfo).toBe('function-only');
    expect(p.lineNote).toMatch(/version 6/);
    expect(decodeBacktrace(XTENSA_PANIC, p).frames[1].func).toBe('app_main');
  });

  it('formatReport produces the copy-as-text report', () => {
    const text = formatReport(decodeBacktrace(XTENSA_PANIC, prepared));
    expect(text).toContain('Cause: LoadProhibited');
    expect(text).toContain('helper+0x12');
    expect(text).toContain('app_main+0x5  /src/main.c:42');
    expect(text).toContain('Registers:');
  });
});
