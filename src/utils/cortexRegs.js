// Pure decoders for Cortex-M core and fault registers, plus memory-view helpers.
// Layouts follow the Armv6-M / Armv7-M / Armv8-M Architecture Reference Manuals.

export const SCB = {
  CFSR: 0xe000ed28, HFSR: 0xe000ed2c, DFSR: 0xe000ed30, MMFAR: 0xe000ed34, BFAR: 0xe000ed38, SHCSR: 0xe000ed24
};

const h8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

const EXCEPTION_NAMES = {
  0: 'Thread mode', 1: 'Reset', 2: 'NMI', 3: 'HardFault', 4: 'MemManage', 5: 'BusFault', 6: 'UsageFault',
  7: 'SecureFault', 11: 'SVCall', 12: 'DebugMonitor', 14: 'PendSV', 15: 'SysTick'
};

export function exceptionName(n) {
  if (EXCEPTION_NAMES[n]) return EXCEPTION_NAMES[n];
  return n >= 16 ? `IRQ ${n - 16}` : `Exception ${n}`;
}

/** Decode xPSR: condition flags, Thumb bit, active exception number. */
export function decodeXpsr(v) {
  const x = v >>> 0;
  const exception = x & 0x1ff;
  return {
    N: !!(x & 0x80000000), Z: !!(x & 0x40000000), C: !!(x & 0x20000000), V: !!(x & 0x10000000), Q: !!(x & 0x08000000),
    thumb: !!(x & 0x01000000),
    exception,
    mode: exceptionName(exception)
  };
}

/** "NzCv Thread mode" style one-liner: capital letter = flag set. */
export function formatXpsr(v) {
  const d = decodeXpsr(v);
  const flags = ['N', 'Z', 'C', 'V'].map((f) => (d[f] ? f : f.toLowerCase())).join('');
  return `${flags}${d.Q ? ' Q' : ''}${d.thumb ? '' : ' (T bit clear!)'} ${d.mode}`;
}

/** The packed word the debugger reads as register 0x14: PRIMASK / BASEPRI / FAULTMASK / CONTROL. */
export function decodeSpecial(v) {
  const x = v >>> 0;
  const control = (x >>> 24) & 0xff;
  return {
    primask: x & 1,
    basepri: (x >>> 8) & 0xff,
    faultmask: (x >>> 16) & 1,
    control,
    privileged: !(control & 1),
    stack: control & 2 ? 'PSP' : 'MSP'
  };
}

const CFSR_BITS = [
  // MemManage (bits 0-7)
  [0, 'IACCVIOL', 'Instruction fetch from a no-execute or protected region (MPU)'],
  [1, 'DACCVIOL', 'Data access violated the MPU'],
  [3, 'MUNSTKERR', 'MemManage fault while unstacking on exception return'],
  [4, 'MSTKERR', 'MemManage fault while stacking for an exception'],
  [5, 'MLSPERR', 'MemManage fault during lazy FP state preservation'],
  [7, 'MMARVALID', 'MMFAR holds the faulting address'],
  // BusFault (8-15)
  [8, 'IBUSERR', 'Bus error on instruction fetch (jumped to an invalid address?)'],
  [9, 'PRECISERR', 'Precise data bus error; BFAR holds the address'],
  [10, 'IMPRECISERR', 'Imprecise data bus error (a buffered write failed; PC is later than the culprit)'],
  [11, 'UNSTKERR', 'Bus fault while unstacking on exception return'],
  [12, 'STKERR', 'Bus fault while stacking for an exception (bad or overflowed stack pointer?)'],
  [13, 'LSPERR', 'Bus fault during lazy FP state preservation'],
  [15, 'BFARVALID', 'BFAR holds the faulting address'],
  // UsageFault (16-25)
  [16, 'UNDEFINSTR', 'Undefined instruction'],
  [17, 'INVSTATE', 'Invalid EPSR state (branch to an address with bit 0 clear, i.e. ARM state)'],
  [18, 'INVPC', 'Invalid PC load by EXC_RETURN (corrupt stack frame)'],
  [19, 'NOCP', 'Coprocessor or FPU instruction with the unit disabled'],
  [20, 'STKOF', 'Stack overflow (Armv8-M stack limit)'],
  [24, 'UNALIGNED', 'Unaligned access with UNALIGN_TRP set'],
  [25, 'DIVBYZERO', 'Divide by zero with DIV_0_TRP set']
];

/** Names and meanings of the set bits in CFSR (MMFSR | BFSR << 8 | UFSR << 16). */
export function decodeCfsr(cfsr) {
  const x = cfsr >>> 0;
  return CFSR_BITS.filter(([bit]) => x & (1 << bit)).map(([bit, name, meaning]) => ({
    bit, name, meaning, group: bit < 8 ? 'MemManage' : bit < 16 ? 'BusFault' : 'UsageFault'
  }));
}

/** Names and meanings of the set bits in HFSR. */
export function decodeHfsr(hfsr) {
  const x = hfsr >>> 0;
  const out = [];
  if (x & 2) out.push({ bit: 1, name: 'VECTTBL', meaning: 'Bus fault reading the vector table' });
  if (x & 0x40000000) out.push({ bit: 30, name: 'FORCED', meaning: 'Escalated from a configurable fault: see CFSR' });
  if (x & 0x80000000) out.push({ bit: 31, name: 'DEBUGEVT', meaning: 'Debug event with debug disabled' });
  return out;
}

/**
 * Turn raw SCB fault registers into a report.
 * `{ cfsr, hfsr, mmfar, bfar }` in, `{ faulted, items, hfsrItems, addresses, lines }` out.
 */
export function summariseFaults({ cfsr = 0, hfsr = 0, mmfar = 0, bfar = 0 }) {
  const items = decodeCfsr(cfsr);
  const hfsrItems = decodeHfsr(hfsr);
  const addresses = [];
  if ((cfsr >>> 0) & 0x80) addresses.push({ name: 'MMFAR', value: mmfar >>> 0 });
  if ((cfsr >>> 0) & 0x8000) addresses.push({ name: 'BFAR', value: bfar >>> 0 });
  const lines = [
    ...hfsrItems.map((i) => `HFSR.${i.name}: ${i.meaning}`),
    ...items.filter((i) => !i.name.endsWith('VALID')).map((i) => `${i.group}: ${i.name}: ${i.meaning}`),
    ...addresses.map((a) => `${a.name} = ${h8(a.value)}`)
  ];
  return { faulted: items.length > 0 || hfsrItems.length > 0, items, hfsrItems, addresses, lines };
}

/** Where the core stacked its registers on exception entry, from EXC_RETURN in LR; null if LR is not an EXC_RETURN. */
export function decodeExcReturn(lr) {
  const x = lr >>> 0;
  if (((x & 0xffffff00) >>> 0) !== 0xffffff00) return null;
  const low = x & 0xff;
  return {
    value: x,
    returnTo: low & 8 ? 'Thread mode' : 'Handler mode',
    stack: low & 4 ? 'PSP' : 'MSP',
    fpFrame: !(low & 0x10)
  };
}

/** Name the words of a basic exception frame (R0-R3, R12, LR, PC, xPSR). */
export function labelStackFrame(words) {
  const names = ['R0', 'R1', 'R2', 'R3', 'R12', 'LR', 'PC', 'xPSR'];
  return names.map((name, i) => ({ name, value: words[i] >>> 0 }));
}

// ---------------------------------------------------------------------------
// Memory view helpers
// ---------------------------------------------------------------------------

/** Parse an address: 0x-prefixed hex, plain decimal, or hex containing a-f. Null on garbage. */
export function parseAddress(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^[0-9a-f]+$/i.test(t) && /[a-f]/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10) >>> 0;
  return null;
}

/**
 * Resolve a watch expression: a number, or a symbol name from a symbol table
 * (`[{ name, addr }]`), optionally followed by +offset. Returns the address or null.
 */
export function resolveWatch(expr, table) {
  const t = String(expr ?? '').trim();
  const direct = parseAddress(t);
  if (direct !== null) return direct;
  const m = /^([A-Za-z_.$][\w.$]*)\s*(?:\+\s*(0x[0-9a-f]+|\d+))?$/i.exec(t);
  if (!m || !table) return null;
  const sym = table.find((s) => s.name === m[1]);
  if (!sym) return null;
  return (sym.addr + (m[2] ? parseAddress(m[2]) : 0)) >>> 0;
}

/** Split little-endian words into bytes. */
export function wordsToBytes(words) {
  const out = [];
  for (const w of words) out.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff);
  return out;
}

/**
 * Format `[{address, value}]` words as hex-dump rows, `width` bits per cell
 * (8, 16 or 32), 16 bytes per row by default.
 */
export function formatMemoryRows(words, width = 32, bytesPerRow = 16) {
  const bytes = wordsToBytes(words.map((w) => w.value));
  const base = words.length ? words[0].address : 0;
  const size = width / 8;
  const rows = [];
  for (let off = 0; off < bytes.length; off += bytesPerRow) {
    const chunk = bytes.slice(off, off + bytesPerRow);
    const cells = [];
    for (let i = 0; i + size <= chunk.length; i += size) {
      let v = 0;
      for (let k = size - 1; k >= 0; k--) v = (v * 256) + chunk[i + k];
      cells.push(v.toString(16).toUpperCase().padStart(size * 2, '0'));
    }
    rows.push({
      address: (base + off) >>> 0,
      cells,
      ascii: chunk.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('')
    });
  }
  return rows;
}

/** Plain-text hex dump (address, cells, ASCII) for copying. */
export function memoryDumpText(words, width = 32, bytesPerRow = 16) {
  return formatMemoryRows(words, width, bytesPerRow)
    .map((r) => `${h8(r.address).slice(2)}  ${r.cells.join(' ')}  |${r.ascii}|`)
    .join('\n');
}
