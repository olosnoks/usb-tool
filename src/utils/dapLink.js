/**
 * CMSIS-DAP probe access over WebUSB (CMSIS-DAP v2, bulk endpoints) or WebHID
 * (CMSIS-DAP v1, 64-byte reports), plus the SWD debug-port / memory-AP layer
 * and JTAG sequences built on it.
 *
 * Works with DAPLink (micro:bit, NXP/Freedom boards), the Raspberry Pi Debug
 * Probe / picoprobe, Atmel EDBG, LPC-Link2/MCU-Link and WCH-Link in CMSIS-DAP
 * mode. ST-Link and J-Link speak their own protocols and are not CMSIS-DAP.
 */

export const DAP = {
  INFO: 0x00, HOST_STATUS: 0x01, CONNECT: 0x02, DISCONNECT: 0x03,
  TRANSFER_CONFIGURE: 0x04, TRANSFER: 0x05, TRANSFER_BLOCK: 0x06,
  RESET_TARGET: 0x0a, SWJ_PINS: 0x10, SWJ_CLOCK: 0x11, SWJ_SEQUENCE: 0x12,
  SWD_CONFIGURE: 0x13, JTAG_SEQUENCE: 0x14,
  OK: 0x00, ERROR: 0xff,
  PORT_SWD: 1, PORT_JTAG: 2,
  INFO_VENDOR: 0x01, INFO_PRODUCT: 0x02, INFO_SERIAL: 0x03, INFO_FW_VERSION: 0x04,
  INFO_CAPABILITIES: 0xf0, INFO_PACKET_COUNT: 0xfe, INFO_PACKET_SIZE: 0xff
};

// Transfer acknowledges (low 3 bits of the response ack byte).
export const ACK = { OK: 1, WAIT: 2, FAULT: 4, NO_ACK: 7 };

// SWJ_Pins bits.
export const PIN = { SWCLK_TCK: 0x01, SWDIO_TMS: 0x02, TDI: 0x04, TDO: 0x08, nTRST: 0x20, nRESET: 0x80 };

export const DAP_USB_FILTERS = [
  { vendorId: 0x0d28 }, // ARM mbed / DAPLink
  { vendorId: 0x2e8a }, // Raspberry Pi Debug Probe / picoprobe
  { vendorId: 0x03eb }, // Microchip / Atmel EDBG, nEDBG
  { vendorId: 0x1fc9 }, // NXP LPC-Link2, MCU-Link
  { vendorId: 0xc251 }, // Keil ULINK / CMSIS-DAP reference
  { vendorId: 0x1a86 }, // WCH-Link (CMSIS-DAP mode)
  { vendorId: 0x239a }, // Adafruit DAP boards
  { vendorId: 0x1209 }  // pid.codes open-hardware probes
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u32le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const hex = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

export class DapError extends Error {}

// ---------------------------------------------------------------------------
// Transports: each has open(), transfer(bytes) -> Uint8Array, close(), packetSize
// ---------------------------------------------------------------------------

/** CMSIS-DAP v2: vendor interface with a bulk OUT and a bulk IN endpoint. */
export class DapUsbTransport {
  constructor(device) {
    this.device = device;
    this.packetSize = 64;
    this.kind = 'usb';
  }

  static findInterface(configuration) {
    const candidates = [];
    for (const iface of configuration?.interfaces || []) {
      const alt = iface.alternates?.[0];
      if (!alt || alt.interfaceClass !== 0xff) continue;
      const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      if (!out || !inn) continue;
      const named = /CMSIS-DAP/i.test(alt.interfaceName || '');
      candidates.push({ iface, alt, out, inn, named });
    }
    return candidates.find((c) => c.named) || candidates[0] || null;
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = DapUsbTransport.findInterface(d.configuration);
    if (!found) throw new DapError('No CMSIS-DAP v2 (bulk) interface on this device. Try the HID connection instead.');
    this.interfaceNumber = found.iface.interfaceNumber;
    this.epOut = found.out.endpointNumber;
    this.epIn = found.inn.endpointNumber;
    this.packetSize = found.out.packetSize || 64;
    await d.claimInterface(this.interfaceNumber);
  }

  async transfer(bytes) {
    const r = await this.device.transferOut(this.epOut, Uint8Array.from(bytes));
    if (r.status !== 'ok') throw new DapError(`USB OUT ${r.status}`);
    // Ask for exactly one probe packet: a longer read would wait for more
    // data when a reply fills the packet exactly.
    const back = await this.device.transferIn(this.epIn, this.readSize || this.packetSize);
    if (back.status !== 'ok') throw new DapError(`USB IN ${back.status}`);
    return new Uint8Array(back.data.buffer, back.data.byteOffset, back.data.byteLength);
  }

  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

/** CMSIS-DAP v1: fixed-size HID reports (64 bytes on full-speed probes). */
export class DapHidTransport {
  constructor(device) {
    this.device = device;
    this.kind = 'hid';
    this.packetSize = 64;
    this.queue = [];
    this.waiters = [];
    this._onReport = (e) => {
      const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const w = this.waiters.shift();
      if (w) w(data); else this.queue.push(data);
    };
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    const report = this.device.collections?.[0]?.outputReports?.[0];
    const count = report?.items?.[0]?.reportCount;
    if (count) this.packetSize = count;
    this.device.addEventListener('inputreport', this._onReport);
  }

  _next(timeoutMs) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        reject(new DapError('Probe did not answer (HID timeout).'));
      }, timeoutMs);
      const done = (d) => { clearTimeout(t); resolve(d); };
      this.waiters.push(done);
    });
  }

  async transfer(bytes) {
    const buf = new Uint8Array(this.packetSize);
    buf.set(bytes.slice(0, this.packetSize));
    await this.device.sendReport(0, buf);
    return this._next(2000);
  }

  async close() {
    this.device.removeEventListener('inputreport', this._onReport);
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export async function requestDapTransport(kind = 'usb') {
  if (kind === 'hid') {
    if (typeof navigator === 'undefined' || !navigator.hid) throw new DapError('WebHID needs Chrome or Edge.');
    const [dev] = await navigator.hid.requestDevice({ filters: DAP_USB_FILTERS });
    if (!dev) throw new DapError('No probe selected.');
    return new DapHidTransport(dev);
  }
  if (typeof navigator === 'undefined' || !navigator.usb) throw new DapError('WebUSB needs Chrome or Edge.');
  return new DapUsbTransport(await navigator.usb.requestDevice({ filters: DAP_USB_FILTERS }));
}

// ---------------------------------------------------------------------------
// Probe command layer
// ---------------------------------------------------------------------------

export class DapProbe {
  constructor(transport) {
    this.transport = transport;
    this.packetSize = 64;
    this.chain = Promise.resolve();
  }

  // Commands are strictly one at a time.
  cmd(bytes) {
    const run = this.chain.then(async () => {
      const resp = await this.transport.transfer(bytes);
      if (resp[0] !== bytes[0]) throw new DapError(`Probe answered command 0x${resp[0]?.toString(16)} to 0x${bytes[0].toString(16)}.`);
      return resp;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async open() {
    await this.transport.open();
    const size = await this.info(DAP.INFO_PACKET_SIZE);
    const reported = size?.length >= 2 ? size[0] | (size[1] << 8) : 0;
    // HID reports can't exceed the report size; bulk probes report their own limit.
    this.packetSize = this.transport.kind === 'hid'
      ? Math.min(reported || 64, this.transport.packetSize)
      : (reported || 64);
    this.transport.readSize = this.packetSize;
    const caps = await this.info(DAP.INFO_CAPABILITIES);
    this.capabilities = { swd: !!(caps?.[0] & 1), jtag: !!(caps?.[0] & 2) };
    const str = async (id) => {
      const b = await this.info(id);
      return b ? new TextDecoder().decode(b).replace(/\0+$/, '') : '';
    };
    this.product = (await str(DAP.INFO_PRODUCT)) || this.transport.device?.productName || 'CMSIS-DAP probe';
    this.firmware = await str(DAP.INFO_FW_VERSION);
    return this;
  }

  /** DAP_Info: returns the data bytes, or null when the probe has none. */
  async info(id) {
    const r = await this.cmd([DAP.INFO, id]);
    const len = r[1];
    return len ? r.slice(2, 2 + len) : null;
  }

  async _status(bytes, what) {
    const r = await this.cmd(bytes);
    if (r[1] !== DAP.OK) throw new DapError(`${what} failed on the probe.`);
    return r;
  }

  async connect(port) {
    const r = await this.cmd([DAP.CONNECT, port]);
    if (r[1] !== port) throw new DapError(`Probe would not enter ${port === DAP.PORT_SWD ? 'SWD' : 'JTAG'} mode.`);
  }

  disconnect() { return this.cmd([DAP.DISCONNECT]); }
  hostStatus(type, on) { return this.cmd([DAP.HOST_STATUS, type, on ? 1 : 0]); }
  setClock(hz) { return this._status([DAP.SWJ_CLOCK, ...u32le(hz)], 'SWJ_Clock'); }
  configureTransfer(idle = 0, waitRetry = 128, matchRetry = 0) {
    return this._status([DAP.TRANSFER_CONFIGURE, idle, waitRetry & 0xff, waitRetry >> 8, matchRetry & 0xff, matchRetry >> 8], 'TransferConfigure');
  }
  configureSwd(cfg = 0) { return this._status([DAP.SWD_CONFIGURE, cfg], 'SWD_Configure'); }

  /** Clock out `bitCount` bits of SWDIO/TMS, LSB of data[0] first. */
  swjSequence(bitCount, data) {
    return this._status([DAP.SWJ_SEQUENCE, bitCount & 0xff, ...data], 'SWJ_Sequence');
  }

  /** Drive the pins in `select` to the levels in `output`; returns the pin input levels. */
  async swjPins(output, select, waitUs = 0) {
    const r = await this.cmd([DAP.SWJ_PINS, output, select, ...u32le(waitUs)]);
    return r[1];
  }

  async resetTarget() {
    const r = await this.cmd([DAP.RESET_TARGET]);
    return { ok: r[1] === DAP.OK, implemented: r[2] === 1 };
  }

  /**
   * DAP_Transfer. `requests`: [{ ap, read, reg (0,4,8,0xC), value }].
   * Returns the values of the read requests, in order.
   */
  async transfer(requests) {
    const out = [DAP.TRANSFER, 0, requests.length];
    for (const q of requests) {
      out.push((q.ap ? 1 : 0) | (q.read ? 2 : 0) | (q.reg & 0x0c));
      if (!q.read) out.push(...u32le(q.value >>> 0));
    }
    const r = await this.cmd(out);
    const done = r[1];
    const ack = r[2] & 0x07;
    if (done !== requests.length || ack !== ACK.OK) {
      throw new DapError(ackMessage(ack, requests[done] || requests[requests.length - 1]));
    }
    const vals = [];
    for (let i = 0, off = 3; i < requests.length; i++) {
      if (requests[i].read) { vals.push(rd32(r, off)); off += 4; }
    }
    return vals;
  }

  /** DAP_TransferBlock: `count` reads (or writes of `values`) to one register. */
  async transferBlock({ ap, reg, count, values }) {
    const read = !values;
    const n = read ? count : values.length;
    const out = [DAP.TRANSFER_BLOCK, 0, n & 0xff, n >> 8, (ap ? 1 : 0) | (read ? 2 : 0) | (reg & 0x0c)];
    if (!read) for (const v of values) out.push(...u32le(v >>> 0));
    const r = await this.cmd(out);
    const done = r[1] | (r[2] << 8);
    const ack = r[3] & 0x07;
    if (done !== n || ack !== ACK.OK) throw new DapError(ackMessage(ack, { ap, reg, read }));
    if (!read) return [];
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(rd32(r, 4 + i * 4));
    return vals;
  }

  /**
   * DAP_JTAG_Sequence. `seqs`: [{ tms, bits: [0|1...], capture }], each at
   * most 64 bits. Returns the captured TDO bits of the capturing sequences, concatenated.
   */
  async jtagSequence(seqs) {
    const out = [DAP.JTAG_SEQUENCE, seqs.length];
    for (const s of seqs) {
      const n = s.bits.length;
      out.push((n === 64 ? 0 : n) | (s.tms ? 0x40 : 0) | (s.capture ? 0x80 : 0));
      const bytes = new Array(Math.ceil(n / 8)).fill(0);
      s.bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 1 << (i & 7); });
      out.push(...bytes);
    }
    const r = await this.cmd(out);
    if (r[1] !== DAP.OK) throw new DapError('JTAG_Sequence failed on the probe.');
    const tdo = [];
    let off = 2;
    for (const s of seqs) {
      if (!s.capture) continue;
      const n = s.bits.length;
      for (let i = 0; i < n; i++) tdo.push((r[off + (i >> 3)] >> (i & 7)) & 1);
      off += Math.ceil(n / 8);
    }
    return tdo;
  }

  close() { return this.transport.close(); }
}

function ackMessage(ack, q) {
  const what = q ? `${q.ap ? 'AP' : 'DP'} ${q.read ? 'read' : 'write'} 0x${(q.reg || 0).toString(16)}` : 'transfer';
  if (ack === ACK.WAIT) return `${what}: target kept answering WAIT.`;
  if (ack === ACK.FAULT) return `${what}: target answered FAULT (bad address, or the bus is powered down).`;
  if (ack === ACK.NO_ACK || ack === 0) return `${what}: no answer from the target. Check wiring, target power and that the pins are not reassigned by firmware.`;
  return `${what}: SWD protocol error (ack ${ack}).`;
}

// ---------------------------------------------------------------------------
// SWD debug port, MEM-AP and Cortex-M core
// ---------------------------------------------------------------------------

export const DP = { IDCODE: 0x0, ABORT: 0x0, CTRL_STAT: 0x4, SELECT: 0x8, RDBUFF: 0xc };
export const AP = { CSW: 0x00, TAR: 0x04, DRW: 0x0c, IDR: 0xfc };
const CSW_WORD = 0x23000052; // 32-bit, auto-increment, debug access enabled

export const CORTEX = {
  CPUID: 0xe000ed00, AIRCR: 0xe000ed0c,
  DHCSR: 0xe000edf0, DCRSR: 0xe000edf4, DCRDR: 0xe000edf8, DEMCR: 0xe000edfc,
  DBGKEY: 0xa05f0000, C_DEBUGEN: 1, C_HALT: 2, C_STEP: 4, C_MASKINTS: 8,
  S_REGRDY: 1 << 16, S_HALT: 1 << 17, S_SLEEP: 1 << 18, S_LOCKUP: 1 << 19, S_RESET_ST: 1 << 25,
  VC_CORERESET: 1
};

const CORE_NAMES = {
  0xc20: 'Cortex-M0', 0xc60: 'Cortex-M0+', 0xc21: 'Cortex-M1', 0xc23: 'Cortex-M3', 0xc24: 'Cortex-M4',
  0xc27: 'Cortex-M7', 0xd20: 'Cortex-M23', 0xd21: 'Cortex-M33', 0xd22: 'Cortex-M55', 0xd23: 'Cortex-M85'
};

export function describeCpuid(cpuid) {
  const part = (cpuid >>> 4) & 0xfff;
  const name = (cpuid >>> 24) === 0x41 ? CORE_NAMES[part] : null;
  return name ? `${name} r${(cpuid >>> 20) & 0xf}p${cpuid & 0xf}` : `unknown core (CPUID ${hex(cpuid)})`;
}

// DCRSR register selectors for the 20 registers the debugger shows; the last
// one is the CONTROL/FAULTMASK/BASEPRI/PRIMASK word (PRIMASK in bits 7:0).
export const CORE_REG_SELECT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0x14];

export class SwdTarget {
  constructor(probe) {
    this.probe = probe;
    this.select = null;
    this.cswValid = false;
  }

  async connect({ clockHz = 1_000_000 } = {}) {
    const p = this.probe;
    await p.connect(DAP.PORT_SWD);
    await p.setClock(clockHz);
    await p.configureTransfer(0, 128, 0);
    await p.configureSwd(0);
    // Line reset, JTAG-to-SWD switch (0xE79E), line reset, idle.
    const ones = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    await p.swjSequence(51, ones);
    await p.swjSequence(16, [0x9e, 0xe7]);
    await p.swjSequence(51, ones);
    await p.swjSequence(8, [0x00]);
    const [dpidr] = await p.transfer([{ ap: false, read: true, reg: DP.IDCODE }]);
    this.dpidr = dpidr;
    // Clear sticky errors, then power up the debug and system domains.
    await p.transfer([{ ap: false, read: false, reg: DP.ABORT, value: 0x1e }]);
    await this._selectRaw(0);
    await p.transfer([{ ap: false, read: false, reg: DP.CTRL_STAT, value: 0x50000000 }]);
    for (let i = 0; ; i++) {
      const [cs] = await p.transfer([{ ap: false, read: true, reg: DP.CTRL_STAT }]);
      if (((cs & 0xa0000000) >>> 0) === 0xa0000000) break; // CDBGPWRUPACK + CSYSPWRUPACK
      if (i > 50) throw new DapError('Target did not power up its debug domain (CTRL/STAT ACKs never set).');
      await sleep(10);
    }
    this.apIdr = await this.readApRegister(0, AP.IDR);
    this.cswValid = false;
    return { dpidr, apIdr: this.apIdr };
  }

  async _selectRaw(value) {
    if (this.select === value) return;
    await this.probe.transfer([{ ap: false, read: false, reg: DP.SELECT, value }]);
    this.select = value;
  }

  async readApRegister(apsel, addr) {
    await this._selectRaw(((apsel & 0xff) << 24) | (addr & 0xf0));
    const [v] = await this.probe.transfer([{ ap: true, read: true, reg: addr & 0x0c }]);
    return v;
  }

  async _memAp() {
    await this._selectRaw(0);
    if (!this.cswValid) {
      await this.probe.transfer([{ ap: true, read: false, reg: AP.CSW, value: CSW_WORD }]);
      this.cswValid = true;
    }
  }

  async readWord(addr) {
    await this._memAp();
    const [v] = await this.probe.transfer([
      { ap: true, read: false, reg: AP.TAR, value: addr },
      { ap: true, read: true, reg: AP.DRW }
    ]);
    return v;
  }

  async writeWord(addr, value) {
    await this._memAp();
    await this.probe.transfer([
      { ap: true, read: false, reg: AP.TAR, value: addr },
      { ap: true, read: false, reg: AP.DRW, value }
    ]);
  }

  /** Read `count` words from `addr` (word aligned), honouring the 1 KB TAR auto-increment wrap. */
  async readWords(addr, count) {
    await this._memAp();
    const perBlock = Math.max(1, Math.floor((this.probe.packetSize - 4) / 4));
    const out = [];
    let a = addr >>> 0;
    while (out.length < count) {
      const toBoundary = (0x400 - (a & 0x3ff)) / 4;
      const n = Math.min(count - out.length, toBoundary, perBlock);
      await this.probe.transfer([{ ap: true, read: false, reg: AP.TAR, value: a }]);
      out.push(...await this.probe.transferBlock({ ap: true, reg: AP.DRW, count: n }));
      a = (a + n * 4) >>> 0;
    }
    return out;
  }

  async writeWords(addr, values) {
    await this._memAp();
    const perBlock = Math.max(1, Math.floor((this.probe.packetSize - 5) / 4));
    let a = addr >>> 0;
    let i = 0;
    while (i < values.length) {
      const toBoundary = (0x400 - (a & 0x3ff)) / 4;
      const n = Math.min(values.length - i, toBoundary, perBlock);
      await this.probe.transfer([{ ap: true, read: false, reg: AP.TAR, value: a }]);
      await this.probe.transferBlock({ ap: true, reg: AP.DRW, values: values.slice(i, i + n) });
      i += n;
      a = (a + n * 4) >>> 0;
    }
  }

  // --- Cortex-M core ------------------------------------------------------

  async coreStatus() {
    const dhcsr = await this.readWord(CORTEX.DHCSR);
    return {
      dhcsr,
      halted: !!(dhcsr & CORTEX.S_HALT),
      sleeping: !!(dhcsr & CORTEX.S_SLEEP),
      lockup: !!(dhcsr & CORTEX.S_LOCKUP)
    };
  }

  async _waitHalt(what) {
    for (let i = 0; i < 100; i++) {
      if ((await this.readWord(CORTEX.DHCSR)) & CORTEX.S_HALT) return;
      await sleep(5);
    }
    throw new DapError(`Core did not halt after ${what}.`);
  }

  async halt() {
    await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN | CORTEX.C_HALT);
    await this._waitHalt('the halt request');
  }

  async resume() {
    await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN);
  }

  /** One instruction, with interrupts masked so the step doesn't land in a handler. */
  async step() {
    await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN | CORTEX.C_HALT | CORTEX.C_MASKINTS);
    await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN | CORTEX.C_STEP | CORTEX.C_MASKINTS);
    await this._waitHalt('the step');
    await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN | CORTEX.C_HALT);
  }

  async readCoreRegister(sel) {
    await this.writeWord(CORTEX.DCRSR, sel);
    for (let i = 0; i < 50; i++) {
      if ((await this.readWord(CORTEX.DHCSR)) & CORTEX.S_REGRDY) return this.readWord(CORTEX.DCRDR);
    }
    throw new DapError(`Core register ${sel} never became ready (is the core halted?).`);
  }

  async writeCoreRegister(sel, value) {
    await this.writeWord(CORTEX.DCRDR, value);
    await this.writeWord(CORTEX.DCRSR, sel | 0x10000);
    for (let i = 0; i < 50; i++) {
      if ((await this.readWord(CORTEX.DHCSR)) & CORTEX.S_REGRDY) return;
    }
    throw new DapError(`Core register ${sel} write did not complete.`);
  }

  async readCoreRegisters() {
    const out = [];
    for (const sel of CORE_REG_SELECT) {
      const v = await this.readCoreRegister(sel);
      out.push(sel === 0x14 ? v & 0xff : v);
    }
    return out;
  }

  /** System reset through AIRCR.SYSRESETREQ; optionally halt at the reset vector. */
  async reset({ halt = false } = {}) {
    const demcr = await this.readWord(CORTEX.DEMCR);
    if (halt) {
      await this.writeWord(CORTEX.DHCSR, CORTEX.DBGKEY | CORTEX.C_DEBUGEN | CORTEX.C_HALT);
      await this.writeWord(CORTEX.DEMCR, demcr | CORTEX.VC_CORERESET);
    }
    try {
      await this.writeWord(CORTEX.AIRCR, 0x05fa0004);
    } catch (e) { /* the write is often lost as the system resets */ }
    await sleep(50);
    // The reset drops the debug port's sticky state; reconnect it.
    this.select = null;
    this.cswValid = false;
    await this.probe.transfer([{ ap: false, read: false, reg: DP.ABORT, value: 0x1e }]);
    if (halt) {
      await this._waitHalt('reset');
      await this.writeWord(CORTEX.DEMCR, demcr & ~CORTEX.VC_CORERESET);
    }
  }
}

export { hex as hex32 };
