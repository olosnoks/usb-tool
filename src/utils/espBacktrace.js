/**
 * ESP32 crash / backtrace decoder (offline). Equivalent of `idf.py monitor`'s addr2line
 * step and the Arduino "EspExceptionDecoder": takes the crash text and the firmware
 * .elf and returns function names and file:line for every code address.
 *
 * Address handling (documented because it is easy to get wrong):
 *  - Frame 0 (the PC / MEPC / epc1 / abort PC) is the exact faulting instruction: it is
 *    looked up as-is.
 *  - Return addresses (Backtrace entries after the first, A0 on Xtensa, RA on RISC-V,
 *    the ESP8266 call0 return) point just after a call, so they are mapped back to the
 *    call site before lookup:
 *      Xtensa (windowed ABI):  site = ((ra & 0x3FFFFFFF) | 0x40000000) - 3
 *        (the top two bits of a windowed return address carry the call size; code lives
 *        at 0x40000000+, so they are replaced, and the 3-byte call instruction is backed up)
 *      ESP8266 (Xtensa LX106, call0 ABI):  site = ra - 3
 *      RISC-V:  site = ra - 1 (stays inside the 2- or 4-byte call instruction)
 *  - Stack-dump candidates are looked up at the exact value and labelled as candidates:
 *    they may be data, stale return addresses or saved pointers.
 *
 * Line numbers come from DWARF .debug_line (v2-5). If that section is missing or uses an
 * unsupported construct the decoder falls back to function names only and says so.
 */

import { parseElf } from './espBacktrace/elf.js';
import { parseDebugLine, lookupLine } from './espBacktrace/dwarfLine.js';
import { parsePanic, extractLatestPanic, explainCause, ESP32_RESET_CAUSES, ESP8266_RESET_CAUSES } from './espBacktrace/panic.js';

export { parseElf, parseDebugLine, lookupLine, parsePanic, extractLatestPanic, explainCause, ESP32_RESET_CAUSES, ESP8266_RESET_CAUSES };

const MAX_CANDIDATES = 64;

/** Address used for symbol/line lookup for a return address on the given architecture. */
export function callSiteFor(arch, ra) {
  if (arch === 'xtensa') return (((ra & 0x3fffffff) | 0x40000000) >>> 0) - 3;
  if (arch === 'esp8266') return ra - 3;
  if (arch === 'riscv') return ra - 1;
  return ra;
}

const hex = (n) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** Parse the ELF and its DWARF line table. Throws if the file is not an ELF32 image. */
export function prepareElf(bytes) {
  const elf = parseElf(bytes);
  const tryBytes = (name) => {
    try { return elf.sectionBytes(name); } catch { return null; }
  };
  let lines = null;
  let lineInfo = 'none';
  let lineNote = '';
  const lineBytes = tryBytes('.debug_line');
  if (!elf.section('.debug_line')) {
    lineNote = 'No .debug_line section: rebuild with debug info (-g) for file:line. Function names still work.';
  } else if (!lineBytes) {
    lineInfo = 'function-only';
    lineNote = 'The .debug_line section could not be read (compressed or truncated). Function names only.';
  } else {
    try {
      const parsed = parseDebugLine(lineBytes, {
        lineStr: tryBytes('.debug_line_str'),
        str: tryBytes('.debug_str'),
      });
      lines = parsed;
      if (!parsed.entries.length) {
        lineInfo = 'function-only';
        lineNote = parsed.errors.length
          ? `DWARF line table not usable (${parsed.errors[0]}). Function names only.`
          : 'DWARF line table is empty. Function names only.';
        lines = null;
      } else if (parsed.errors.length) {
        lineInfo = 'partial';
        lineNote = `Some DWARF line units could not be read (${parsed.errors[0]}). Those addresses show no file:line.`;
      } else {
        lineInfo = 'full';
      }
    } catch (e) {
      lineInfo = 'function-only';
      lineNote = `DWARF line table not supported (${e.message}). Function names only.`;
    }
  }
  return {
    elf,
    lines,
    lineInfo,
    lineNote,
    summary: {
      arch: elf.arch,
      sectionCount: elf.sections.length,
      functionCount: elf.functionCount,
      execRangeCount: elf.execRanges.length,
      lineRows: lines ? lines.entries.length : 0,
      dwarfVersions: lines ? [...new Set(lines.versions)] : [],
      dwarfErrors: lines ? lines.errors : [],
    },
  };
}

function symbolize(prepared, addr) {
  if (!prepared) return { func: null, offset: null, file: null, line: null, inExec: false };
  const sym = prepared.elf.symbolAt(addr);
  const ln = prepared.lines ? lookupLine(prepared.lines, addr) : null;
  return {
    func: sym ? sym.name : null,
    offset: sym ? sym.offset : null,
    file: ln ? ln.file : null,
    line: ln ? ln.line : null,
    inExec: prepared.elf.isExec(addr),
  };
}

function buildFrames(panic, prepared) {
  const frames = [];
  const add = (role, pc, isReturn) => {
    const lookup = isReturn ? callSiteFor(panic.arch, pc) : pc;
    frames.push({ index: frames.length, role, pc, lookup, ...symbolize(prepared, lookup) });
  };
  const regVal = (name) => {
    const r = panic.registers.find((x) => x.name === name);
    return r ? r.value : null;
  };

  if (panic.backtrace.length) {
    panic.backtrace.forEach((f, i) => add(i === 0 ? 'PC' : 'return', f.pc, i > 0));
    return frames;
  }
  if (panic.abortPc !== null && panic.abortPc !== undefined) add('abort PC', panic.abortPc, false);
  const pcName = panic.arch === 'riscv' ? 'MEPC' : panic.arch === 'esp8266' ? 'EPC1' : 'PC';
  const pc = regVal(pcName);
  if (pc !== null && pc !== undefined && !(panic.abortPc === pc && frames.length)) add(pcName, pc, false);
  if (panic.arch === 'xtensa') {
    const a0 = regVal('A0');
    if (a0) add('A0 (return address)', a0, true);
  } else if (panic.arch === 'riscv') {
    const ra = regVal('RA');
    if (ra) add('RA (return address)', ra, true);
  }
  return frames;
}

/**
 * Decode a panic against an ELF (prepared with prepareElf, or null for no ELF).
 * @param {string|object} panicInput crash text or an already-parsed panic
 * @param {object|null} prepared
 */
export function decodeBacktrace(panicInput, prepared = null) {
  const panic = typeof panicInput === 'string' ? parsePanic(panicInput) : panicInput;
  const notes = [...panic.warnings];

  if (!prepared) {
    notes.push('No ELF loaded: addresses are shown without function names or file:line.');
  } else {
    if (prepared.lineNote) notes.push(prepared.lineNote);
    if (prepared.elf.functionCount === 0) notes.push('The ELF has no FUNC symbols (stripped .symtab?): no function names.');
    const want = panic.arch === 'riscv' ? 'riscv' : (panic.arch === 'xtensa' || panic.arch === 'esp8266') ? 'xtensa' : null;
    if (want && prepared.elf.arch !== want) {
      notes.push(`The ELF targets ${prepared.elf.arch} but the crash text looks like ${panic.arch}: the symbols will not match. Use the .elf from the same build that crashed.`);
    }
  }
  const frames = buildFrames(panic, prepared);
  if (!frames.length && panic.kind !== 'unknown') notes.push('No code addresses found in this crash text.');

  const registers = panic.registers.map((r) => {
    const isRet = (panic.arch === 'xtensa' && r.name === 'A0') || (panic.arch === 'riscv' && r.name === 'RA');
    const lookup = isRet ? callSiteFor(panic.arch, r.value) : r.value;
    const sym = prepared && prepared.elf.isExec(lookup) ? symbolize(prepared, lookup) : null;
    return {
      name: r.name,
      value: r.value,
      hex: hex(r.value),
      symbol: sym && (sym.func || sym.file) ? sym : null,
      isReturn: isRet,
    };
  });

  const candidates = [];
  if (prepared) {
    const seen = new Set();
    for (const w of panic.stackWords) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (seen.has(w) || !prepared.elf.isExec(w)) continue;
      seen.add(w);
      candidates.push({ addr: w, hex: hex(w), ...symbolize(prepared, w) });
    }
  }
  if (panic.stackWords.length && !candidates.length) {
    notes.push(prepared ? 'Stack dump present, but no word points into executable code of this ELF.' : 'Stack dump present: load the ELF to look for code addresses in it.');
  }

  const cause = panic.cause ? { ...panic.cause, explanation: explainCause(panic.cause.name) } : null;
  return {
    arch: panic.arch,
    kind: panic.kind,
    core: panic.core,
    chip: panic.chip,
    cause,
    faultAddress: panic.faultAddress,
    faultRegister: panic.faultRegister,
    assert: panic.assert,
    reset: panic.reset,
    frames,
    registers,
    candidates,
    notes,
    lineInfo: prepared ? prepared.lineInfo : 'none',
    hasBacktraceLine: panic.hasBacktraceLine,
    backtraceCorrupted: panic.backtraceCorrupted,
  };
}

const fmtLocation = (f) => {
  const fn = f.func ? `${f.func}${f.offset ? `+0x${f.offset.toString(16)}` : ''}` : '??';
  const src = f.file ? `${f.file}:${f.line}` : '';
  return { fn, src };
};

/** Plain-text report for the clipboard. */
export function formatReport(result) {
  const out = [];
  out.push(`ESP crash decode: ${result.arch}${result.chip ? ` (${result.chip})` : ''}, ${result.kind}`);
  if (result.cause) out.push(`Cause: ${result.cause.name}${result.cause.explanation ? ` - ${result.cause.explanation}` : ''}`);
  if (result.faultAddress !== null && result.faultAddress !== undefined) out.push(`Fault address (${result.faultRegister}): ${hex(result.faultAddress)}`);
  if (result.assert) out.push(`Assert: ${result.assert.file}:${result.assert.line} in ${result.assert.func}${result.assert.expr ? ` (${result.assert.expr})` : ''}`);
  if (result.reset) out.push(`Reset reason: ${result.reset.name}${result.reset.code !== undefined ? ` (code ${result.reset.code})` : ''}`);
  out.push('');
  out.push('Backtrace:');
  if (!result.frames.length) out.push('  (no code addresses)');
  result.frames.forEach((f) => {
    const { fn, src } = fmtLocation(f);
    out.push(`  #${f.index}  ${hex(f.pc)}  ${fn}${src ? `  ${src}` : ''}  [${f.role}]`);
  });
  if (result.backtraceCorrupted) out.push('  (backtrace marked CORRUPTED after the last frame)');
  out.push('');
  out.push('Registers:');
  for (const r of result.registers) {
    const s = r.symbol ? `  ${r.symbol.func || '??'}${r.symbol.offset ? `+0x${r.symbol.offset.toString(16)}` : ''}${r.symbol.file ? `  ${r.symbol.file}:${r.symbol.line}` : ''}` : '';
    out.push(`  ${r.name.padEnd(8)} ${r.hex}${s}`);
  }
  if (result.candidates.length) {
    out.push('');
    out.push('Stack-dump code candidates (not proven frames):');
    for (const c of result.candidates) {
      const { fn, src } = fmtLocation(c);
      out.push(`  ${c.hex}  ${fn}${src ? `  ${src}` : ''}`);
    }
  }
  if (result.notes.length) {
    out.push('');
    out.push('Notes:');
    for (const n of result.notes) out.push(`  - ${n}`);
  }
  out.push('');
  return out.join('\n');
}
