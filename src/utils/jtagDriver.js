/**
 * JTAG chain scanner, SVF player and boundary-scan sampler.
 *
 * Hardware: any CMSIS-DAP probe with JTAG support (DAPLink, Raspberry Pi Debug
 * Probe, LPC-Link2, ...), driven through DAP_JTAG_Sequence. The TAP state
 * machine is tracked here; the probe only clocks TMS/TDI and captures TDO.
 */

import { DapProbe, DAP, PIN, requestDapTransport } from './dapLink';

export const JTAG_DEVICE_DATABASE = {
  0x03628093: { mfr: 'Xilinx', family: 'Spartan-6', part: 'XC6SLX9', package: 'TQG144', pins: 144, irlen: 6 },
  0x0362D093: { mfr: 'Xilinx', family: 'Artix-7', part: 'XC7A35T', package: 'various', pins: null, irlen: 6 },
  0x0364C093: { mfr: 'Xilinx', family: 'Artix-7', part: 'XC7A100T', package: 'various', pins: null, irlen: 6 },
  0x020F10DD: { mfr: 'Altera / Intel', family: 'Cyclone IV E', part: 'EP4CE6 / EP4CE10', package: 'various', pins: null, irlen: 10 },
  0x06410041: { mfr: 'STMicroelectronics', family: 'STM32', part: 'STM32F1 medium-density (boundary-scan TAP)', package: 'various', pins: null, irlen: 5 },
  0x06413041: { mfr: 'STMicroelectronics', family: 'STM32', part: 'STM32F405/407 (boundary-scan TAP)', package: 'various', pins: null, irlen: 5 },
  0x3BA00477: { mfr: 'ARM', family: 'CoreSight', part: 'Cortex-M3/M4 JTAG-DP', package: '-', pins: null, irlen: 4 },
  0x4BA00477: { mfr: 'ARM', family: 'CoreSight', part: 'Cortex-M7 / A-class JTAG-DP', package: '-', pins: null, irlen: 4 },
  0x120034E5: { mfr: 'Espressif', family: 'ESP32', part: 'ESP32 (Xtensa TAP)', package: '-', pins: null, irlen: 5 }
};

// JEDEC manufacturer codes as they appear in IDCODE bits 11:1 (bank << 7 | id).
const JEDEC = {
  0x049: 'Xilinx / AMD', 0x06e: 'Altera / Intel', 0x021: 'Lattice', 0x020: 'STMicroelectronics',
  0x23b: 'ARM', 0x01f: 'Microchip (Atmel)', 0x029: 'Microchip', 0x015: 'NXP (Philips)', 0x00e: 'NXP (Freescale)',
  0x017: 'Texas Instruments', 0x272: 'Espressif', 0x40d: 'Gowin', 0x0bf: 'Broadcom', 0x09: 'Intel'
};

/** Split an IDCODE into its fields and name it when known. */
export function decodeIdcode(idcode) {
  const v = idcode >>> 0;
  const known = JTAG_DEVICE_DATABASE[v] || JTAG_DEVICE_DATABASE[(v & 0x0fffffff) >>> 0];
  const mfrCode = (v >>> 1) & 0x7ff;
  return {
    idcode: v,
    version: v >>> 28,
    partNumber: (v >>> 12) & 0xffff,
    mfrCode,
    mfr: known?.mfr || JEDEC[mfrCode] || `JEDEC 0x${mfrCode.toString(16)}`,
    family: known?.family || 'unknown',
    part: known?.part || `part 0x${((v >>> 12) & 0xffff).toString(16).toUpperCase()}`,
    package: known?.package || '-',
    pins: known?.pins ?? null,
    irlen: known?.irlen ?? null,
    known: !!known
  };
}

/**
 * Parse the TDO bits read out of Shift-DR right after a TAP reset.
 * Devices with an IDCODE load it (LSB = 1); others load a 1-bit BYPASS (0).
 * The chain ends when the ones we shift in come back out (an all-ones word).
 */
export function parseIdChain(bits) {
  if (bits.length && bits.every((b) => b === 0)) throw new Error('TDO is stuck low: check TDO wiring and target power.');
  const devices = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === 0) { devices.push({ bypass: true }); i++; continue; }
    if (i + 32 > bits.length) break;
    let v = 0;
    for (let k = 0; k < 32; k++) v |= bits[i + k] << k;
    v >>>= 0;
    if (v === 0xffffffff) break;
    devices.push({ idcode: v });
    i += 32;
  }
  return devices;
}

// ---------------------------------------------------------------------------
// TAP state machine
// ---------------------------------------------------------------------------

export const TAP = {
  RESET: 'RESET', IDLE: 'IDLE',
  DRSELECT: 'DRSELECT', DRCAPTURE: 'DRCAPTURE', DRSHIFT: 'DRSHIFT', DREXIT1: 'DREXIT1', DRPAUSE: 'DRPAUSE', DREXIT2: 'DREXIT2', DRUPDATE: 'DRUPDATE',
  IRSELECT: 'IRSELECT', IRCAPTURE: 'IRCAPTURE', IRSHIFT: 'IRSHIFT', IREXIT1: 'IREXIT1', IRPAUSE: 'IRPAUSE', IREXIT2: 'IREXIT2', IRUPDATE: 'IRUPDATE'
};

// next[state] = [state after TMS=0, state after TMS=1]
export const TAP_NEXT = {
  RESET: ['IDLE', 'RESET'], IDLE: ['IDLE', 'DRSELECT'],
  DRSELECT: ['DRCAPTURE', 'IRSELECT'], DRCAPTURE: ['DRSHIFT', 'DREXIT1'], DRSHIFT: ['DRSHIFT', 'DREXIT1'],
  DREXIT1: ['DRPAUSE', 'DRUPDATE'], DRPAUSE: ['DRPAUSE', 'DREXIT2'], DREXIT2: ['DRSHIFT', 'DRUPDATE'], DRUPDATE: ['IDLE', 'DRSELECT'],
  IRSELECT: ['IRCAPTURE', 'RESET'], IRCAPTURE: ['IRSHIFT', 'IREXIT1'], IRSHIFT: ['IRSHIFT', 'IREXIT1'],
  IREXIT1: ['IRPAUSE', 'IRUPDATE'], IRPAUSE: ['IRPAUSE', 'IREXIT2'], IREXIT2: ['IRSHIFT', 'IRUPDATE'], IRUPDATE: ['IDLE', 'DRSELECT']
};

const TAP_LABELS = {
  RESET: 'Test-Logic-Reset', IDLE: 'Run-Test/Idle', DRSHIFT: 'Shift-DR', IRSHIFT: 'Shift-IR',
  DRPAUSE: 'Pause-DR', IRPAUSE: 'Pause-IR'
};
export const tapLabel = (s) => TAP_LABELS[s] || s;

/** Shortest TMS sequence from one state to another (5 ones always reach RESET). */
export function tmsPath(from, to) {
  if (to === 'RESET') return [1, 1, 1, 1, 1];
  if (from === to) return [];
  const seen = new Map([[from, []]]);
  const queue = [from];
  while (queue.length) {
    const s = queue.shift();
    for (const tms of [0, 1]) {
      const n = TAP_NEXT[s][tms];
      if (seen.has(n)) continue;
      const path = [...seen.get(s), tms];
      if (n === to) return path;
      seen.set(n, path);
      queue.push(n);
    }
  }
  throw new Error(`No TAP path from ${from} to ${to}`);
}

// Hex as written in SVF (most significant digit first) -> bits, LSB (first shifted) first.
export function hexToBits(hexText, length) {
  const h = String(hexText || '').replace(/[\s_]/g, '');
  const bits = new Array(length).fill(0);
  for (let i = 0; i < length; i++) {
    const digit = h.length - 1 - (i >> 2);
    if (digit < 0) break;
    const v = parseInt(h[digit], 16);
    if (Number.isNaN(v)) throw new Error(`Bad hex digit "${h[digit]}" in SVF data.`);
    bits[i] = (v >> (i & 3)) & 1;
  }
  return bits;
}

export function bitsToHex(bits) {
  let out = '';
  for (let i = Math.ceil(bits.length / 4) - 1; i >= 0; i--) {
    let v = 0;
    for (let k = 0; k < 4; k++) v |= (bits[i * 4 + k] || 0) << k;
    out += v.toString(16).toUpperCase();
  }
  return out || '0';
}

/** Queues TMS/TDI activity and sends it to the probe in as few packets as possible. */
export class JtagEngine {
  constructor(probe) {
    this.probe = probe;
    this.state = 'RESET';
    this.pending = []; // { tms, bits, capture, sink }
  }

  _push(tms, bits, capture = false, sink = null) {
    for (let i = 0; i < bits.length; i += 64) {
      const chunk = bits.slice(i, i + 64);
      const last = this.pending[this.pending.length - 1];
      // Merge plain clocking with the same TMS level to keep packets short.
      if (!capture && last && !last.capture && last.tms === tms && last.bits.length + chunk.length <= 64) {
        last.bits.push(...chunk);
      } else {
        this.pending.push({ tms, bits: chunk, capture, sink });
      }
    }
  }

  clockTms(tmsBits) {
    for (const t of tmsBits) {
      this._push(t, [1]);
      this.state = TAP_NEXT[this.state][t];
    }
  }

  goto(state) {
    this.clockTms(tmsPath(this.state, state));
  }

  /** Clock `count` cycles in the current state (TMS held at the level that stays put). */
  idleClocks(count) {
    const tms = this.state === 'RESET' ? 1 : 0;
    if (TAP_NEXT[this.state][tms] !== this.state) throw new Error(`Can't clock in place in ${this.state}.`);
    let left = count;
    while (left > 0) { const n = Math.min(left, 4096); this._push(tms, new Array(n).fill(0)); left -= n; }
  }

  /**
   * Shift `tdi` through IR or DR, ending in `endState`. Resolves to the TDO bits
   * when `capture` is set. The last bit leaves the shift state (TMS=1).
   */
  shift(reg, tdi, { capture = false, endState = 'IDLE' } = {}) {
    if (!tdi.length) { this.goto(endState); return Promise.resolve([]); }
    this.goto(reg === 'IR' ? 'IRSHIFT' : 'DRSHIFT');
    const tdo = [];
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const sink = capture ? (bits) => tdo.push(...bits) : null;
    if (tdi.length > 1) this._push(0, tdi.slice(0, -1), capture, sink);
    this._push(1, [tdi[tdi.length - 1]], capture, sink);
    this.state = reg === 'IR' ? 'IREXIT1' : 'DREXIT1';
    this.goto(endState);
    this.pending.push({ marker: () => resolve(tdo) });
    return done;
  }

  /** Send everything queued; resolves once all captured data has been delivered. */
  async flush() {
    const queue = this.pending;
    this.pending = [];
    const max = this.probe.packetSize || 64;
    let batch = [];
    let outLen = 2;
    let inLen = 2;
    const send = async () => {
      if (!batch.length) return;
      const seqs = batch.filter((s) => !s.marker);
      const tdo = seqs.length ? await this.probe.jtagSequence(seqs) : [];
      let off = 0;
      for (const s of batch) {
        if (s.marker) { s.marker(); continue; }
        if (!s.capture) continue;
        s.sink?.(tdo.slice(off, off + s.bits.length));
        off += s.bits.length;
      }
      batch = []; outLen = 2; inLen = 2;
    };
    for (const s of queue) {
      if (s.marker) { batch.push(s); continue; }
      const bytes = Math.ceil(s.bits.length / 8);
      const seqCount = batch.filter((b) => !b.marker).length;
      if (outLen + 1 + bytes > max || (s.capture && inLen + bytes > max) || seqCount >= 255) await send();
      batch.push(s);
      outLen += 1 + bytes;
      if (s.capture) inLen += bytes;
    }
    await send();
  }
}

// ---------------------------------------------------------------------------
// SVF
// ---------------------------------------------------------------------------

/** Split SVF text into statements: { cmd, text, line }. */
export function parseSvf(text) {
  const out = [];
  let buf = '';
  let startLine = 1;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    let line = raw;
    const c1 = line.indexOf('!');
    const c2 = line.indexOf('//');
    const cut = [c1, c2].filter((x) => x >= 0);
    if (cut.length) line = line.slice(0, Math.min(...cut));
    if (!buf.trim()) startLine = idx + 1;
    buf += ` ${line}`;
    let semi;
    while ((semi = buf.indexOf(';')) >= 0) {
      const stmt = buf.slice(0, semi).trim();
      buf = buf.slice(semi + 1);
      if (stmt) out.push({ cmd: stmt.split(/\s+/)[0].toUpperCase(), text: stmt, line: startLine });
      startLine = idx + 1;
    }
  });
  if (buf.trim()) throw new Error(`SVF ends without a ';' after "${buf.trim().slice(0, 40)}".`);
  return out;
}

const SVF_STATES = {
  RESET: 'RESET', IDLE: 'IDLE', DRSELECT: 'DRSELECT', DRCAPTURE: 'DRCAPTURE', DRSHIFT: 'DRSHIFT', DREXIT1: 'DREXIT1',
  DRPAUSE: 'DRPAUSE', DREXIT2: 'DREXIT2', DRUPDATE: 'DRUPDATE', IRSELECT: 'IRSELECT', IRCAPTURE: 'IRCAPTURE',
  IRSHIFT: 'IRSHIFT', IREXIT1: 'IREXIT1', IRPAUSE: 'IRPAUSE', IREXIT2: 'IREXIT2', IRUPDATE: 'IRUPDATE'
};
const STABLE = new Set(['RESET', 'IDLE', 'DRPAUSE', 'IRPAUSE']);

function svfState(name, line) {
  const s = SVF_STATES[String(name).toUpperCase()];
  if (!s) throw new Error(`Line ${line}: unknown TAP state "${name}".`);
  return s;
}

// "SDR 32 TDI (00) TDO (12) MASK (FF)" -> { length: 32, TDI: '00', TDO: '12', MASK: 'FF' }
function scanArgs(text, line) {
  const m = text.match(/^\w+\s+(\d+)\s*(.*)$/s);
  if (!m) throw new Error(`Line ${line}: expected a bit length in "${text.slice(0, 40)}".`);
  const args = { length: Number(m[1]) };
  const re = /(TDI|TDO|MASK|SMASK)\s*\(([^)]*)\)/gi;
  let p;
  while ((p = re.exec(m[2]))) args[p[1].toUpperCase()] = p[2];
  return args;
}

/**
 * Run SVF statements on a JtagEngine. Checks TDO against MASK and stops at the
 * first mismatch. Returns { statements, checks }.
 */
export async function runSvf(engine, text, { onProgress, setClock, setTrst, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const stmts = parseSvf(text);
  const regs = { SIR: {}, SDR: {}, HIR: {}, HDR: {}, TIR: {}, TDR: {} };
  let endIr = 'IDLE';
  let endDr = 'IDLE';
  let runState = 'IDLE';
  let checks = 0;

  const pattern = (name, a, line) => {
    const prev = regs[name];
    const same = prev.length === a.length;
    const cur = {
      length: a.length,
      TDI: a.TDI ?? (same ? prev.TDI : undefined),
      MASK: a.MASK ?? (same ? prev.MASK : undefined),
      TDO: a.TDO // only checked when given on this statement
    };
    if (cur.length && cur.TDI === undefined) {
      if (name[0] === 'S') throw new Error(`Line ${line}: ${name} ${a.length} needs TDI (no earlier value of that length).`);
      cur.TDI = 'F'.repeat(Math.ceil(a.length / 4)); // header/trailer default: BYPASS ones
    }
    regs[name] = cur;
    return cur;
  };

  for (let i = 0; i < stmts.length; i++) {
    const { cmd, text: t, line } = stmts[i];
    const words = t.split(/\s+/).slice(1);
    switch (cmd) {
      case 'FREQUENCY': {
        const hz = words[0] ? Number(words[0]) : null;
        if (hz && setClock) { await engine.flush(); await setClock(Math.min(hz, 10_000_000)); }
        break;
      }
      case 'TRST': {
        const mode = (words[0] || '').toUpperCase();
        if (setTrst && (mode === 'ON' || mode === 'OFF')) { await engine.flush(); await setTrst(mode === 'ON'); }
        break;
      }
      case 'ENDIR': endIr = svfState(words[0], line); if (!STABLE.has(endIr)) throw new Error(`Line ${line}: ENDIR must be a stable state.`); break;
      case 'ENDDR': endDr = svfState(words[0], line); if (!STABLE.has(endDr)) throw new Error(`Line ${line}: ENDDR must be a stable state.`); break;
      case 'STATE':
        for (const w of words) engine.goto(svfState(w, line));
        break;
      case 'HIR': case 'HDR': case 'TIR': case 'TDR':
        pattern(cmd, scanArgs(t, line), line);
        break;
      case 'SIR': case 'SDR': {
        const a = scanArgs(t, line);
        const body = pattern(cmd, a, line);
        const isIr = cmd === 'SIR';
        const head = regs[isIr ? 'HIR' : 'HDR'];
        const tail = regs[isIr ? 'TIR' : 'TDR'];
        const headBits = head.length ? hexToBits(head.TDI, head.length) : [];
        const tailBits = tail.length ? hexToBits(tail.TDI, tail.length) : [];
        const tdi = [...headBits, ...hexToBits(body.TDI, body.length), ...tailBits];
        const check = body.TDO !== undefined;
        const p = engine.shift(isIr ? 'IR' : 'DR', tdi, { capture: check, endState: isIr ? endIr : endDr });
        if (check) {
          await engine.flush();
          const got = (await p).slice(headBits.length, headBits.length + body.length);
          const want = hexToBits(body.TDO, body.length);
          const mask = body.MASK !== undefined ? hexToBits(body.MASK, body.length) : new Array(body.length).fill(1);
          const bad = want.findIndex((w, k) => mask[k] && got[k] !== w);
          checks++;
          if (bad >= 0) {
            const e = new Error(`Line ${line}: ${cmd} TDO mismatch at bit ${bad}. Expected ${bitsToHex(want.map((w, k) => (mask[k] ? w : 0)))}, got ${bitsToHex(got.map((g, k) => (mask[k] ? g : 0)))} (masked).`);
            e.svfLine = line;
            throw e;
          }
        }
        break;
      }
      case 'RUNTEST': {
        // RUNTEST [run_state] [count TCK|SCK] [min SEC [MAXIMUM max SEC]] [ENDSTATE end]
        let k = 0;
        if (words[k] && SVF_STATES[words[k].toUpperCase()]) runState = svfState(words[k++], line);
        let clocks = 0;
        let seconds = 0;
        let end = runState;
        while (k < words.length) {
          const w = words[k].toUpperCase();
          if (w === 'ENDSTATE') { end = svfState(words[k + 1], line); k += 2; continue; }
          if (w === 'MAXIMUM') { k += 3; continue; }
          const n = Number(words[k]);
          const unit = (words[k + 1] || '').toUpperCase();
          if (Number.isNaN(n)) throw new Error(`Line ${line}: can't read RUNTEST "${t}".`);
          if (unit === 'TCK' || unit === 'SCK') clocks = n;
          else if (unit === 'SEC') seconds = n;
          k += 2;
        }
        engine.goto(runState);
        if (clocks) engine.idleClocks(clocks);
        if (seconds) { await engine.flush(); await sleep(Math.ceil(seconds * 1000)); }
        engine.goto(end);
        break;
      }
      case 'PIOMAP': case 'PIO':
        throw new Error(`Line ${line}: ${cmd} (parallel I/O) is not supported.`);
      default:
        throw new Error(`Line ${line}: unknown SVF command "${cmd}".`);
    }
    if (onProgress && (i % 20 === 0 || i === stmts.length - 1)) {
      await engine.flush();
      onProgress({ current: i + 1, total: stmts.length, percent: Math.round(((i + 1) / stmts.length) * 100), lastCmd: t.slice(0, 30) });
    }
  }
  await engine.flush();
  return { statements: stmts.length, checks };
}

// ---------------------------------------------------------------------------
// Client used by the workbench
// ---------------------------------------------------------------------------

export class JtagClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.tapState = 'Test-Logic-Reset';
    this.detectedDevices = [];
    this.pins = [];
    this.probe = null;
    this.engine = null;
  }

  log(m) { this.logger(`[JTAG] ${m}`); }

  async connectHardware({ kind = 'usb', probe = null, clockHz = 1_000_000 } = {}) {
    const p = probe || await new DapProbe(await requestDapTransport(kind)).open();
    try {
      if (p.capabilities && !p.capabilities.jtag) throw new Error(`${p.product} does not support JTAG (SWD only).`);
      await p.connect(DAP.PORT_JTAG);
      await p.setClock(clockHz);
      this.probe = p;
      this.engine = new JtagEngine(p);
      this.isConnected = true;
      this.detectedDevices = [];
      this.pins = [];
      this.log(`Connected to ${p.product}${p.firmware ? ` (firmware ${p.firmware})` : ''} in JTAG mode at ${clockHz / 1e6} MHz.`);
      return { product: p.product, firmware: p.firmware };
    } catch (e) {
      try { await p.close(); } catch (x) { /* ignore */ }
      throw e;
    }
  }

  async disconnect() {
    if (this.probe) {
      try { await this.probe.disconnect(); } catch (e) { /* ignore */ }
      try { await this.probe.close(); } catch (e) { /* ignore */ }
    }
    this.probe = null;
    this.engine = null;
    this.isConnected = false;
    this.detectedDevices = [];
    this.pins = [];
    this.log('Disconnected.');
  }

  _syncState() { this.tapState = tapLabel(this.engine.state); }

  /** Reset the TAPs and read every IDCODE in the chain (up to 32 devices). */
  async scanChain() {
    if (!this.isConnected) return [];
    const e = this.engine;
    e.goto('RESET');
    e.goto('IDLE');
    const p = e.shift('DR', new Array(32 * 32 + 32).fill(1), { capture: true });
    await e.flush();
    const raw = parseIdChain(await p);
    this._syncState();
    if (!raw.length) throw new Error('No devices answered: TDO reads all ones. Check TDO wiring, target power and that JTAG is enabled.');
    this.detectedDevices = raw.map((d, index) => (d.bypass
      ? { index, bypass: true, idcode: null, mfr: 'No IDCODE', family: 'BYPASS after reset', part: '-', package: '-', pins: null, irlen: null }
      : { index, ...decodeIdcode(d.idcode) }));
    this.log(`Chain scan: ${raw.length} device(s), listed from the TDO end.`);
    return this.detectedDevices;
  }

  async playSvf(svfText, onProgress) {
    if (!this.isConnected) throw new Error('JTAG interface not connected.');
    try {
      const r = await runSvf(this.engine, svfText, {
        onProgress,
        setClock: (hz) => this.probe.setClock(hz),
        setTrst: (on) => this.probe.swjPins(on ? 0 : PIN.nTRST, PIN.nTRST)
      });
      this.log(`SVF finished: ${r.statements} statements, ${r.checks} TDO check(s) passed.`);
      return r;
    } finally {
      this._syncState();
    }
  }

  /** Levels on the probe's JTAG pins (TCK, TMS, TDI, TDO, nTRST, nRESET). */
  async readProbePins() {
    if (!this.probe) return null;
    const v = await this.probe.swjPins(0, 0);
    return {
      TCK: !!(v & PIN.SWCLK_TCK), TMS: !!(v & PIN.SWDIO_TMS), TDI: !!(v & PIN.TDI),
      TDO: !!(v & PIN.TDO), nTRST: !!(v & PIN.nTRST), nRESET: !!(v & PIN.nRESET)
    };
  }

  /**
   * Capture the boundary-scan register of one device with SAMPLE/PRELOAD.
   * `irLengths` lists every device's IR length in chain order (TDO end first);
   * the others get BYPASS (all ones). Cell names need the device's BSDL file,
   * so the raw cells are returned by number.
   */
  async sampleBoundary({ target, irLengths, opcode, bsrLength }) {
    if (!this.isConnected) throw new Error('Connect a probe first.');
    const n = irLengths.length;
    if (target < 0 || target >= n) throw new Error('Pick a device in the chain.');
    // The first bits shifted in travel furthest and end up in the device
    // nearest TDO (index 0), so the IR vector starts with that device.
    const ir = [];
    for (let d = 0; d < n; d++) {
      ir.push(...(d === target ? hexToBits(opcode.toString(16), irLengths[d]) : new Array(irLengths[d]).fill(1)));
    }
    const e = this.engine;
    e.shift('IR', ir, { endState: 'IDLE' });
    // DR: one BYPASS bit per other device. TDO comes out nearest-to-TDO first.
    const total = bsrLength + (n - 1);
    const p = e.shift('DR', new Array(total).fill(0), { capture: true, endState: 'IDLE' });
    await e.flush();
    const tdo = await p;
    this._syncState();
    return tdo.slice(target, target + bsrLength);
  }

  /**
   * Drive pins with EXTEST: preload the boundary register with SAMPLE/PRELOAD,
   * switch to EXTEST (the pins take the preloaded values), then shift the vector
   * again, which also captures the pins. vector[n] is boundary cell n.
   * The chip stays in EXTEST until resetTap().
   */
  async extest({ target, irLengths, preloadOp, extestOp, vector }) {
    if (!this.isConnected) throw new Error('Connect a probe first.');
    const n = irLengths.length;
    if (target < 0 || target >= n) throw new Error('Pick a device in the chain.');
    const irFor = (op) => {
      const ir = [];
      for (let d = 0; d < n; d++) ir.push(...(d === target ? hexToBits(op.toString(16), irLengths[d]) : new Array(irLengths[d]).fill(1)));
      return ir;
    };
    const dr = [];
    for (let d = 0; d < n; d++) { if (d === target) dr.push(...vector); else dr.push(0); }
    const e = this.engine;
    e.shift('IR', irFor(preloadOp), { endState: 'IDLE' });
    e.shift('DR', dr, { endState: 'IDLE' });
    e.shift('IR', irFor(extestOp), { endState: 'IDLE' });
    const p = e.shift('DR', dr, { capture: true, endState: 'IDLE' });
    await e.flush();
    const tdo = await p;
    this._syncState();
    return tdo.slice(target, target + vector.length);
  }

  /** Test-Logic-Reset: every device leaves EXTEST and goes back to normal operation. */
  async resetTap() {
    if (!this.engine) return;
    this.engine.goto('RESET');
    this.engine.goto('IDLE');
    await this.engine.flush();
    this._syncState();
  }
}
