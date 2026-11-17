/**
 * Parser for ESP-IDF / ESP8266 (Arduino SDK) crash output.
 *
 * Recognised shapes:
 *  - ESP-IDF Guru Meditation banner + "Core N register dump:" (Xtensa: PC/A0..A15/EXCVADDR,
 *    "Backtrace: PC:SP PC:SP ..." with optional "|<-CORRUPTED"; RISC-V: MEPC/RA/SP/MCAUSE/
 *    MTVAL and a "Stack memory:" dump)
 *  - ESP-IDF "abort() was called at PC 0x... on core N" and "assert failed: ..." lines
 *  - ESP8266 "Fatal exception (n):" / Arduino "Exception (n):" with epc1..excvaddr and a
 *    "stack>>>" ... "<<<stack<<<" dump
 *  - "rst:0x.. (NAME),boot:0x.. (NAME)" and "rst cause:N" reset lines
 *
 * Everything here is text parsing only; the ELF side lives in espBacktrace.js.
 */

const XTENSA_EXCCAUSE = {
  0: 'IllegalInstruction', 1: 'Syscall', 2: 'InstructionFetchError', 3: 'LoadStoreError',
  4: 'Level1Interrupt', 5: 'Alloca', 6: 'IntegerDivideByZero', 8: 'Privileged',
  9: 'LoadStoreAlignment', 12: 'InstrPIFDataError', 13: 'LoadStorePIFDataError',
  14: 'InstrPIFAddrError', 15: 'LoadStorePIFAddrError', 16: 'InstTLBMiss', 17: 'InstTLBMultiHit',
  18: 'InstFetchPrivilege', 20: 'InstFetchProhibited', 24: 'LoadStoreTLBMiss',
  25: 'LoadStoreTLBMultiHit', 26: 'LoadStorePrivilege', 28: 'LoadProhibited', 29: 'StoreProhibited',
};

const ESP8266_EXCCAUSE = {
  0: 'IllegalInstruction', 1: 'Syscall', 2: 'InstructionFetchError', 3: 'LoadStoreError',
  4: 'Level1Interrupt', 5: 'Alloca', 6: 'IntegerDivideByZero', 8: 'Privileged',
  9: 'LoadStoreAlignment', 28: 'LoadProhibited', 29: 'StoreProhibited',
};

const RISCV_MCAUSE = {
  0: 'Instruction address misaligned', 1: 'Instruction access fault', 2: 'Illegal instruction',
  3: 'Breakpoint', 4: 'Load address misaligned', 5: 'Load access fault',
  6: 'Store address misaligned', 7: 'Store access fault', 8: 'Environment call from U-mode',
  9: 'Environment call from S-mode', 11: 'Environment call from M-mode',
  12: 'Instruction page fault', 13: 'Load page fault', 15: 'Store page fault',
};

/** ESP32 rst:0x.. reason names (ROM boot banner). Chip-specific names printed by the boot ROM win. */
export const ESP32_RESET_CAUSES = {
  0x1: 'POWERON_RESET', 0x3: 'SW_RESET', 0x4: 'OWDT_RESET', 0x5: 'DEEPSLEEP_RESET',
  0x6: 'SDIO_RESET', 0x7: 'TG0WDT_SYS_RESET', 0x8: 'TG1WDT_SYS_RESET', 0x9: 'RTCWDT_SYS_RESET',
  0xa: 'INTRUSION_RESET', 0xb: 'TGWDT_CPU_RESET', 0xc: 'SW_CPU_RESET', 0xd: 'RTCWDT_CPU_RESET',
  0xe: 'EXT_CPU_RESET', 0xf: 'RTCWDT_BROWN_OUT_RESET', 0x10: 'RTCWDT_RTC_RESET',
};

/** ESP8266 "rst cause:N" values (SDK). */
export const ESP8266_RESET_CAUSES = {
  0: 'power on', 1: 'hardware watchdog reset', 2: 'exception reset', 3: 'software watchdog reset',
  4: 'software restart', 5: 'deep-sleep wake', 6: 'external (reset pin) reset',
};

/** Explanations keyed by a lower-case prefix of the normalised cause name. */
const CAUSE_HELP = [
  ['loadprohibited', 'The CPU read from an address the MMU/PMS does not allow (often a NULL or freed pointer). EXCVADDR/MTVAL holds the faulting address.'],
  ['storeprohibited', 'The CPU wrote to an address the MMU/PMS does not allow (read-only flash, NULL or freed pointer). EXCVADDR/MTVAL holds the faulting address.'],
  ['instfetchprohibited', 'The CPU tried to execute code from a region that is not executable (data RAM, unmapped flash, or a wild function pointer).'],
  ['instructionfetchprohibited', 'The CPU tried to execute code from a region that is not executable (data RAM, unmapped flash, or a wild function pointer).'],
  ['instructionfetcherror', 'Fetching an instruction failed on the bus. Often a jump to a bad address or flash cache not mapped for that region.'],
  ['instrpifdataerror', 'Instruction fetch hit a bus data error (bad or unmapped code address).'],
  ['instrpifaddrerror', 'Instruction fetch hit a bus address error (bad or unmapped code address).'],
  ['illegalinstruction', 'The CPU decoded an invalid opcode. Usually a corrupted return address, a jump into data, or a mismatched build of the code that is running.'],
  ['loadstorealignment', 'A load or store used an address that is not aligned for its access size (for example a 32-bit read from an odd address).'],
  ['loadstoreerror', 'A load or store failed on the bus (address not backed by memory).'],
  ['integerdividebyzero', 'Integer division or remainder by zero.'],
  ['level1interrupt', 'A level-1 interrupt was taken with no handler installed for that path.'],
  ['alloca', 'alloca() or a variable-length stack allocation was used with an invalid size.'],
  ['privileged', 'Privileged instruction or register used from user code.'],
  ['syscall', 'A syscall instruction was executed without a handler.'],
  ['instfetchprivilege', 'Instruction fetch denied by the privilege level (MMU).'],
  ['loadstoreprivilege', 'Load or store denied by the privilege level (MMU).'],
  ['instructionaccessfault', 'RISC-V instruction fetch failed (bad code address or unmapped region).'],
  ['loadaccessfault', 'RISC-V load failed (address not backed by memory, or PMP denied it). MTVAL holds the address.'],
  ['storeaccessfault', 'RISC-V store failed (address not backed by memory, or PMP denied it). MTVAL holds the address.'],
  ['storeamoaddressmisaligned', 'RISC-V store used an address not aligned for its size.'],
  ['storeaddressmisaligned', 'RISC-V store used an address not aligned for its size.'],
  ['loadaddressmisaligned', 'RISC-V load used an address not aligned for its size.'],
  ['instructionaddressmisaligned', 'RISC-V jump or branch target is not 2- or 4-byte aligned (corrupted return address or function pointer).'],
  ['illegalinstruction', 'The CPU decoded an invalid opcode. Usually a corrupted return address, a jump into data, or a mismatched build.'],
  ['unhandleddebugexception', 'A debug exception (breakpoint or watchpoint) was hit with no debugger to take it.'],
  ['interruptwdt', 'An interrupt watchdog fired: a task or ISR held the CPU (or interrupts were disabled) for too long.'],
  ['taskwdt', 'The task watchdog fired: a subscribed task did not feed the watchdog in time.'],
  ['cachedisabled', 'Code or data in a cached region was accessed while the flash cache was disabled (typical during flash writes or from an ISR that runs from flash).'],
  ['stacksmashing', 'The stack canary was overwritten: a buffer on the stack overflowed. The backtrace may be partly corrupt.'],
  ['abort', 'abort() was called: the application or a library decided it could not continue. The backtrace shows the call chain to abort().'],
  ['assert', 'An assert() failed. The file, line and expression are printed by the assert message.'],
];

const normaliseName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Explanation text for a cause name, or ''. */
export function explainCause(name) {
  const key = normaliseName(name);
  if (!key) return '';
  for (const [prefix, text] of CAUSE_HELP) {
    if (text && key.startsWith(prefix)) return text;
  }
  return '';
}

/** Cause name table lookup helper (exported for tests / the UI). */
export const CAUSE_TABLES = { xtensa: XTENSA_EXCCAUSE, esp8266: ESP8266_EXCCAUSE, riscv: RISCV_MCAUSE };

const START_RE = /Guru Meditation Error|abort\(\) was called|Stack smashing protect failure|Fatal exception \(\d+\)|^Exception \(\d+\)|assert failed:|^stack>>>|register dump|^Backtrace:/gm;

/**
 * Pull the most recent panic block out of a serial text buffer. The block runs from the
 * first panic marker after the previous "Rebooting..." to the next "Rebooting..." (or the
 * end of the buffer).
 * @returns {{found:boolean, text:string}}
 */
export function extractLatestPanic(buffer) {
  const text = String(buffer || '').replace(/\r\n?/g, '\n');
  let last = -1;
  START_RE.lastIndex = 0;
  for (let m; (m = START_RE.exec(text)) !== null;) last = m.index;
  if (last < 0) return { found: false, text: '' };
  const prevReboot = text.lastIndexOf('Rebooting', last);
  START_RE.lastIndex = 0;
  let start = -1;
  for (let m; (m = START_RE.exec(text)) !== null;) {
    if (m.index > prevReboot) { start = m.index; break; }
  }
  if (start < 0) start = last;
  const reboot = text.indexOf('Rebooting', last);
  const end = reboot >= 0 ? reboot + 'Rebooting'.length : text.length;
  // Include the reset/boot banner lines directly after the panic, if any.
  return { found: true, text: text.slice(start, end).trim() };
}

const hexToNum = (h) => parseInt(h, 16) >>> 0;

function parseRegisters(text) {
  const regs = [];
  const seen = new Set();
  const add = (name, value) => {
    const key = name.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    regs.push({ name: key, value });
  };
  // ESP-IDF style: "PC      : 0x400d1234  PS      : 0x00060030 ..." (also MEPC, MTVAL ...)
  const re = /\b([A-Z][A-Z0-9]{0,9})\s*:\s*0x([0-9a-fA-F]{1,8})\b/g;
  for (let m; (m = re.exec(text)) !== null;) add(m[1], hexToNum(m[2]));
  // ESP8266 style: "epc1=0x40201234 epc2=0x00000000 excvaddr=0x00000000 depc=0x00000000"
  const re8 = /\b(epc[1-3]|excvaddr|depc)=0x([0-9a-fA-F]{1,8})\b/gi;
  for (let m; (m = re8.exec(text)) !== null;) add(m[1].toUpperCase(), hexToNum(m[2]));
  return regs;
}

function parseBacktrace(text) {
  const m = /^Backtrace:(.*)$/m.exec(text);
  if (!m) return { frames: [], corrupted: false, present: false };
  const pairs = [];
  const re = /0x([0-9a-fA-F]{1,8}):0x([0-9a-fA-F]{1,8})/g;
  for (let p; (p = re.exec(m[1])) !== null;) pairs.push({ pc: hexToNum(p[1]), sp: hexToNum(p[2]) });
  return { frames: pairs, corrupted: /CORRUPTED/i.test(m[1]), present: true };
}

/** Words from a stack memory dump. Handles "addr: 0x.. 0x.." (RISC-V) and "addr: .. .." (ESP8266). */
function parseStackWords(lines) {
  const words = [];
  for (const line of lines) {
    const m = /^\s*(?:[0-9a-fA-F]{6,8}):\s*(.*)$/.exec(line);
    if (!m) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      const t = tok.replace(/^0x/i, '');
      if (/^[0-9a-fA-F]{1,8}$/.test(t)) words.push(hexToNum(t));
    }
  }
  return words;
}

function stackDumpWords(text) {
  const lines = text.split('\n');
  const out = [];
  // ESP-IDF RISC-V: "Stack memory:" header followed by "addr: 0x.. 0x.." lines.
  const iStack = lines.findIndex((l) => /^Stack memory:/.test(l.trim()));
  if (iStack >= 0) {
    const block = [];
    for (let i = iStack + 1; i < lines.length; i++) {
      if (!/^\s*[0-9a-fA-F]{6,8}:/.test(lines[i])) break;
      block.push(lines[i]);
    }
    out.push(...parseStackWords(block));
  }
  // ESP8266 SDK: stack>>> ... <<<stack<<<
  const s = text.indexOf('stack>>>');
  if (s >= 0) {
    const e = text.indexOf('<<<stack<<<', s);
    const block = text.slice(s + 'stack>>>'.length, e >= 0 ? e : undefined).split('\n');
    out.push(...parseStackWords(block));
  }
  return out;
}

/**
 * Parse crash text into a structured panic record.
 * @param {string} input
 */
export function parsePanic(input) {
  const text = String(input || '').replace(/\r\n?/g, '\n');
  const warnings = [];
  const registers = parseRegisters(text);
  const regByName = Object.fromEntries(registers.map((r) => [r.name, r.value]));

  // Cause / kind
  let kind = 'unknown';
  let cause = null;
  let core = null;
  const guru = /Guru Meditation Error:\s*Core\s+(\d+)\s+panic.?ed\s*\(([^)]*)\)/i.exec(text);
  const fatal = /(?:Fatal exception|^Exception)\s*\((\d+)\)/m.exec(text);
  const abort = /abort\(\) was called at PC\s*0x([0-9a-fA-F]+)(?:\s+on core\s+(\d+))?/i.exec(text);
  const assertM = /assert failed:\s*(\S+)\s+(\S+?):(\d+)(?:\s+\((.*)\))?/i.exec(text);
  const smash = /Stack smashing protect failure/i.test(text);

  let arch = 'unknown';
  if ('MEPC' in regByName) arch = 'riscv';
  else if ('EPC1' in regByName || fatal) arch = 'esp8266';
  else if ('PC' in regByName || /^Backtrace:\s*0x[0-9a-f]+:0x/im.test(text)) arch = 'xtensa';

  if (guru) {
    kind = 'guru';
    core = Number(guru[1]);
    cause = { name: guru[2].trim(), code: null, source: 'banner' };
  } else if (fatal) {
    kind = 'fatal';
    const code = Number(fatal[1]);
    const name = ESP8266_EXCCAUSE[code] || `exception ${code}`;
    cause = { name, code, source: 'table' };
  } else if (abort) {
    kind = 'abort';
    core = abort[2] !== undefined ? Number(abort[2]) : null;
    cause = { name: 'abort()', code: null, source: 'banner' };
  } else if (assertM) {
    kind = 'assert';
    cause = { name: 'assert failed', code: null, source: 'banner' };
  } else if (smash) {
    kind = 'stack-smash';
    cause = { name: 'Stack smashing protect failure', code: null, source: 'banner' };
  }

  // Fill a missing cause from the numeric cause register.
  if (!cause || (kind === 'guru' && cause.name === '')) {
    if (arch === 'riscv' && 'MCAUSE' in regByName) {
      const mc = regByName.MCAUSE;
      const isIrq = (mc & 0x80000000) !== 0;
      const code = mc & 0x7fffffff;
      cause = { name: isIrq ? `interrupt ${code}` : (RISCV_MCAUSE[code] || `mcause ${code}`), code, source: 'table' };
    } else if (arch === 'xtensa' && 'EXCCAUSE' in regByName) {
      const code = regByName.EXCCAUSE;
      cause = { name: XTENSA_EXCCAUSE[code] || `EXCCAUSE ${code}`, code, source: 'table' };
    }
  }
  if (!cause && arch !== 'unknown') warnings.push('No exception cause found in the text.');

  if (kind === 'unknown' && arch !== 'unknown') kind = 'register-dump';

  // Fault address
  const faultReg = ['EXCVADDR', 'MTVAL'].find((n) => n in regByName);
  const faultAddress = faultReg ? regByName[faultReg] : null;

  // Backtrace and stack candidates
  const bt = parseBacktrace(text);
  const stackWords = stackDumpWords(text);

  // Reset / boot reason
  let reset = null;
  const rst = /rst:0x([0-9a-fA-F]+)\s*\(([A-Z0-9_]+)\)/.exec(text);
  const rst8 = /rst cause:\s*(\d+)/.exec(text);
  const boot = /boot:0x([0-9a-fA-F]+)\s*\(([A-Z0-9_]+)\)/.exec(text);
  if (rst) {
    const code = parseInt(rst[1], 16);
    reset = { code, name: rst[2], source: 'banner', boot: boot ? boot[2] : null };
  } else if (rst8) {
    const code = Number(rst8[1]);
    reset = { code, name: ESP8266_RESET_CAUSES[code] || `cause ${code}`, source: 'ESP8266 SDK', boot: null };
  }

  const chipM = /\b(ESP32(?:-[SC]\d|-H\d|-P\d)?|ESP8266)\b/.exec(text);

  // Abort PC when present (exact address, not a return address)
  const abortPc = abort ? hexToNum(abort[1]) : null;

  // Assert location
  const assertInfo = assertM
    ? { func: assertM[1], file: assertM[2], line: Number(assertM[3]), expr: assertM[4] || '' } : null;

  if (kind === 'unknown' && arch === 'unknown' && !bt.present) {
    warnings.push('No ESP panic markers were recognised in this text.');
  }
  if (arch === 'riscv' && !('MEPC' in regByName)) warnings.push('RISC-V dump without MEPC.');
  if (bt.corrupted) warnings.push('Backtrace is marked |<-CORRUPTED: frames after the marker are not trustworthy.');

  return {
    arch,
    kind,
    core,
    chip: chipM ? chipM[1] : null,
    cause,
    faultAddress,
    faultRegister: faultReg || null,
    registers,
    backtrace: bt.frames,
    backtraceCorrupted: bt.corrupted,
    hasBacktraceLine: bt.present,
    abortPc,
    assert: assertInfo,
    stackWords,
    reset,
    warnings,
  };
}
