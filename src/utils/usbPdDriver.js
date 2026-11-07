/**
 * USB-PD (Power Delivery) Protocol Driver & VBUS Telemetry Engine
 * 
 * Supports:
 * - Standard fixed PDO (Power Data Object) contracts (5V, 9V, 12V, 15V, 20V)
 * - PPS (Programmable Power Supply) fine-grained voltage adjustments (3.3V - 21.0V in 20mV steps)
 * - E-Marker cable detection (3A vs 5A 100W/240W EPR, USB 2.0 / USB 3.2 / USB4)
 * - Real-time VBUS voltage, current, wattage, and energy (mAh, mWh) integration
 * - Simulated charger for trying the interface
 *
 * Real hardware: an STUSB4500 USB-PD sink controller (e.g. the SparkFun Power
 * Delivery Board) on I2C, through a Bus Pirate v3/v4. The STUSB4500 negotiates
 * fixed PDOs only (no PPS) and does not measure VBUS; the tool reads the
 * negotiated contract and rewrites the sink PDOs in RAM (not NVM) to request
 * another voltage.
 */

import { SerialLink } from './serialLink';
import { BusPirate } from './busExplorerDriver';

export const STUSB4500 = {
  ADDR: 0x28,
  PORT_STATUS_1: 0x0e,     // bit 0: a source is attached
  PD_COMMAND_CTRL: 0x1a,
  DEVICE_ID: 0x2f,         // 0x21 or 0x25
  TX_HEADER_LOW: 0x51,
  DPM_PDO_NUMB: 0x70,      // bits 2:0, number of sink PDOs (1-3)
  DPM_SNK_PDO1: 0x85,      // three 32-bit little-endian PDOs
  RDO_STATUS: 0x91         // 32-bit request data object of the current contract
};

/** Fixed-supply sink PDO -> { voltageV, currentA }. */
export function decodeSinkPdo(pdo) {
  return { voltageV: Math.round(((pdo >>> 10) & 0x3ff) * 5) / 100, currentA: (pdo & 0x3ff) / 100 };
}

/** Replace the voltage (50 mV units) and current (10 mA units) of a fixed PDO, keeping the flag bits. */
export function encodeSinkPdo(pdo, voltageV, currentA) {
  const v = Math.round(voltageV / 0.05) & 0x3ff;
  const i = Math.round(currentA / 0.01) & 0x3ff;
  return ((pdo & ~0xfffff) | (v << 10) | i) >>> 0;
}

/** Request Data Object -> which source PDO was taken and at what current. */
export function decodeRdo(rdo) {
  return {
    position: (rdo >>> 28) & 0x7,
    operatingCurrentA: ((rdo >>> 10) & 0x3ff) / 100,
    maxCurrentA: (rdo & 0x3ff) / 100,
    capabilityMismatch: !!(rdo & (1 << 26))
  };
}

const le32 = (b, o = 0) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const bytes32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export class Stusb4500 {
  constructor(bus, addr = STUSB4500.ADDR) {
    this.bus = bus; // anything with i2cReadRegisters(addr, reg, n) / i2cWriteRegister(addr, reg, bytes)
    this.addr = addr;
  }

  read(reg, n) { return this.bus.i2cReadRegisters(this.addr, reg, n); }
  write(reg, values) { return this.bus.i2cWriteRegister(this.addr, reg, values); }

  async identify() {
    const [id] = await this.read(STUSB4500.DEVICE_ID, 1);
    if (id !== 0x21 && id !== 0x25) throw new Error(`Device at 0x${this.addr.toString(16)} has ID 0x${id.toString(16)}, not an STUSB4500 (0x21 / 0x25).`);
    return id;
  }

  async readSinkPdos() {
    const [n] = await this.read(STUSB4500.DPM_PDO_NUMB, 1);
    const raw = await this.read(STUSB4500.DPM_SNK_PDO1, 12);
    const pdos = [0, 1, 2].map((i) => le32(raw, i * 4));
    return { count: n & 0x07, raw: pdos, pdos: pdos.map(decodeSinkPdo) };
  }

  async status() {
    const [port] = await this.read(STUSB4500.PORT_STATUS_1, 1);
    const rdoRaw = le32(await this.read(STUSB4500.RDO_STATUS, 4));
    const sink = await this.readSinkPdos();
    return { attached: !!(port & 1), rdo: rdoRaw ? decodeRdo(rdoRaw) : null, rdoRaw, sink };
  }

  /**
   * Request a fixed voltage: PDO1 stays 5 V (USB-PD requires it), PDO2 becomes
   * the request and the chip renegotiates. 5 V alone drops back to one PDO.
   */
  async requestVoltage(voltageV, currentA) {
    if (!(voltageV >= 5 && voltageV <= 20)) throw new Error('The STUSB4500 can request 5 V to 20 V.');
    if (!(currentA > 0 && currentA <= 5)) throw new Error('Current must be between 0 and 5 A.');
    const { raw } = await this.readSinkPdos();
    if (voltageV === 5) {
      await this.write(STUSB4500.DPM_SNK_PDO1, bytes32(encodeSinkPdo(raw[0], 5, currentA)));
      await this.write(STUSB4500.DPM_PDO_NUMB, [1]);
    } else {
      await this.write(STUSB4500.DPM_SNK_PDO1 + 4, bytes32(encodeSinkPdo(raw[1], voltageV, currentA)));
      await this.write(STUSB4500.DPM_PDO_NUMB, [2]);
    }
    await this.softReset();
  }

  /** Send a PD soft reset so the new sink PDOs are negotiated. */
  async softReset() {
    await this.write(STUSB4500.TX_HEADER_LOW, [0x0d]);
    await this.write(STUSB4500.PD_COMMAND_CTRL, [0x26]);
  }
}

export const FIXED_PDO_PROFILES = [
  { id: 1, voltageV: 5.0, maxCurrentA: 3.0, maxPowerW: 15.0, label: '5V @ 3.0A (15W Fixed)' },
  { id: 2, voltageV: 9.0, maxCurrentA: 3.0, maxPowerW: 27.0, label: '9V @ 3.0A (27W Fixed)' },
  { id: 3, voltageV: 12.0, maxCurrentA: 3.0, maxPowerW: 36.0, label: '12V @ 3.0A (36W Fixed)' },
  { id: 4, voltageV: 15.0, maxCurrentA: 3.0, maxPowerW: 45.0, label: '15V @ 3.0A (45W Fixed)' },
  { id: 5, voltageV: 20.0, maxCurrentA: 5.0, maxPowerW: 100.0, label: '20V @ 5.0A (100W Fixed EPR)' }
];

export const PPS_PROFILE = {
  id: 6,
  minVoltageV: 3.3,
  maxVoltageV: 21.0,
  maxCurrentA: 5.0,
  stepVoltageV: 0.02, // 20mV
  label: 'PPS 3.3V - 21V (5A Variable)'
};

export const SAMPLE_CABLE_EMARKERS = [
  {
    manufacturer: 'Apple Inc.',
    type: 'USB-C to USB-C (Thunderbolt 4 / USB4)',
    maxCurrent: '5A (240W EPR Supported)',
    maxVoltage: '48V (EPR)',
    speed: '40 Gbps (Thunderbolt 4 / USB4 Gen 3x2)',
    vdo: '0x1A2B3C4D',
    hwVersion: 'v2.1'
  },
  {
    manufacturer: 'Anker Innovations',
    type: 'USB-C to USB-C (High Power Braided)',
    maxCurrent: '5A (100W Standard)',
    maxVoltage: '20V (SPR)',
    speed: '480 Mbps (USB 2.0 High-Speed)',
    vdo: '0x21901104',
    hwVersion: 'v1.4'
  },
  {
    manufacturer: 'Generic Unmarked Cable',
    type: 'Standard USB-C Charging Cable',
    maxCurrent: '3A (60W Non-E-Marked)',
    maxVoltage: '20V (SPR)',
    speed: '480 Mbps (USB 2.0)',
    vdo: '0x00000000',
    hwVersion: 'v1.0'
  }
];

export class UsbPdClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.link = null;
    this.bp = null;
    this.pd = null;
    this._owner = { name: 'USB-PD', release: () => this.disconnect() };
    this.isConnected = false;
    this.activeVoltageV = 5.0;
    this.targetVoltageV = 5.0;
    this.currentA = 0.45;
    this.activePdoId = 1;
    this.isPps = false;
    this.ppsVoltageV = 5.0;
    this.cableInfo = SAMPLE_CABLE_EMARKERS[0];

    // Cumulative energy metrics
    this.accumulatedMah = 0;
    this.accumulatedMwh = 0;
    this.lastTimestamp = Date.now();
  }

  /**
   * Connect an STUSB4500 through a Bus Pirate (binary I2C mode). `link` is for
   * tests. The Bus Pirate's supplies stay off: the PD board is powered by VBUS.
   */
  async connectHardware({ link = null, addr = STUSB4500.ADDR } = {}) {
    this.link = link || await SerialLink.request(this._owner, { baudRate: 115200 });
    try {
      this.bp = new BusPirate(this.link);
      await this.bp.enterBinary();
      await this.bp.enterI2c();
      await this.bp.setSpeed(2); // 100 kHz
      await this.bp.configurePeripherals({ power: false, pullups: true });
      this.pd = new Stusb4500(this.bp, addr);
      this.chipId = await this.pd.identify();
      // The PDOs in RAM right now came from NVM at power-up: keep them to check the NVM layout against.
      this.bootSink = await this.pd.readSinkPdos();
      this.isConnected = true;
      this.logger(`[USB-PD] STUSB4500 (ID 0x${this.chipId.toString(16)}) found at 0x${addr.toString(16)} through the Bus Pirate.`);
      return true;
    } catch (e) {
      await this._closeHardware();
      throw e;
    }
  }

  async _closeHardware() {
    const link = this.link;
    this.link = null;
    if (this.bp) { try { await this.bp.reset(); } catch (e) { /* ignore */ } }
    this.bp = null;
    this.pd = null;
    if (link) { try { await link.close(); } catch (e) { /* ignore */ } }
  }

  /** Contract and sink settings read from the STUSB4500. */
  async readHardwareStatus() {
    if (!this.pd) throw new Error('No STUSB4500 connected.');
    return this.pd.status();
  }

  /** Ask the charger for a fixed voltage (rewrites PDO2 in RAM, then renegotiates). */
  async requestHardwareVoltage(voltageV, currentA = 1.5) {
    if (!this.pd) throw new Error('No STUSB4500 connected.');
    await this.pd.requestVoltage(voltageV, currentA);
    this.logger(`[USB-PD] Requested ${voltageV} V at up to ${currentA} A; renegotiating.`);
  }

  /** NVM sectors, their decoded PDOs, and whether that decoding matches the power-up PDOs. */
  async readNvm() {
    if (!this.pd) throw new Error('No STUSB4500 connected.');
    const sectors = await new Stusb4500Nvm(this.pd).read();
    const decoded = decodeNvm(sectors);
    return { sectors, decoded, match: this.bootSink ? nvmMatchesRam(decoded, this.bootSink) : { ok: false, reason: 'No power-up PDOs recorded.' } };
  }

  /** Write new PDO settings to NVM; refused unless the layout was verified on this chip. */
  async writeNvmPdos(config) {
    const { sectors, match } = await this.readNvm();
    if (!match.ok) throw new Error(`NVM layout not verified on this chip (${match.reason}). Writing is disabled.`);
    await new Stusb4500Nvm(this.pd).write(encodeNvmPdos(sectors, config));
    this.logger('[USB-PD] NVM written and verified. The new PDOs apply after the board is power-cycled.');
  }

  /** Write a full backup image back (layout-independent). */
  async restoreNvm(sectors) {
    if (!this.pd) throw new Error('No STUSB4500 connected.');
    await new Stusb4500Nvm(this.pd).write(sectors);
  }

  async disconnect() {
    await this._closeHardware();
    this.isConnected = false;
    this.activeVoltageV = 0.0;
    this.currentA = 0.0;
    this.logger('[USB-PD] Disconnected.');
  }

  // Request Fixed PDO Profile
  requestFixedPdo(pdoId) {
    const pdo = FIXED_PDO_PROFILES.find(p => p.id === pdoId);
    if (!pdo) return;

    this.activePdoId = pdoId;
    this.isPps = false;
    this.targetVoltageV = pdo.voltageV;
    this.logger(`[USB-PD] Contract renegotiated: ${pdo.label}`);
  }

  // Request PPS Variable Voltage
  requestPpsVoltage(voltageV) {
    const clamped = Math.max(PPS_PROFILE.minVoltageV, Math.min(PPS_PROFILE.maxVoltageV, voltageV));
    this.activePdoId = 6;
    this.isPps = true;
    this.ppsVoltageV = Number(clamped.toFixed(2));
    this.targetVoltageV = this.ppsVoltageV;
    this.logger(`[USB-PD] PPS Voltage set to ${this.ppsVoltageV}V`);
  }

  resetEnergyCounter() {
    this.accumulatedMah = 0;
    this.accumulatedMwh = 0;
    this.lastTimestamp = Date.now();
    this.logger('[USB-PD] Accumulated mAh / mWh counters reset to 0.');
  }
}

// ---------------------------------------------------------------------------
// STUSB4500 NVM (5 sectors x 8 bytes): backup, decode, verified write
// Sequence from ST's STUSB4500 NVM flasher; PDO field layout as used by the
// SparkFun STUSB4500 library. Writing is only offered once the decoded NVM
// matches the PDOs the chip loaded at power-up, which proves the layout.
// ---------------------------------------------------------------------------

export const NVM = {
  PASSWORD_REG: 0x95, PASSWORD: 0x47,
  CTRL_0: 0x96, CTRL_1: 0x97, RW_BUFFER: 0x53,
  PWR: 0x80, RST_N: 0x40, REQ: 0x10, SECT: 0x07, SER: 0xf8, OPCODE: 0x07,
  READ: 0x00, WRITE_PL: 0x01, WRITE_SER: 0x02, ERASE_SECTOR: 0x05, PROG_SECTOR: 0x06, SOFT_PROG_SECTOR: 0x07
};

/** Sink current table used by the NVM's 4-bit current fields (index 0 = "flex current"). */
export const NVM_CURRENTS = [null, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5, 4.0, 4.5, 5.0];

/** PDO settings stored in the NVM sectors (an array of five 8-byte arrays). */
export function decodeNvm(sectors) {
  const s3 = sectors[3];
  const s4 = sectors[4];
  const cur = (idx) => ({ index: idx, currentA: NVM_CURRENTS[idx] });
  return {
    pdoCount: (s3[2] & 0x06) >> 1,
    pdos: [
      { voltageV: 5, ...cur(s3[2] >> 4) },
      { voltageV: ((s4[1] << 2) | (s4[0] >> 6)) / 20, ...cur(s3[4] & 0x0f) },
      { voltageV: (((s4[3] & 0x03) << 8) | s4[2]) / 20, ...cur(s3[5] >> 4) }
    ]
  };
}

/** New NVM sectors with PDO count, PDO2/3 voltage and the three currents changed; everything else kept. */
export function encodeNvmPdos(sectors, { pdoCount, pdos }) {
  const out = sectors.map((s) => Uint8Array.from(s));
  const idx = (a) => {
    const i = NVM_CURRENTS.findIndex((c) => c !== null && Math.abs(c - a) < 1e-6);
    if (i < 0) throw new Error(`${a} A is not one of the NVM current steps (${NVM_CURRENTS.filter(Boolean).join(', ')} A).`);
    return i;
  };
  if (![1, 2, 3].includes(pdoCount)) throw new Error('PDO count must be 1, 2 or 3.');
  for (const p of pdos.slice(1)) if (!(p.voltageV >= 5 && p.voltageV <= 20)) throw new Error('PDO2 and PDO3 must be 5-20 V.');
  const s3 = out[3];
  const s4 = out[4];
  s3[2] = (s3[2] & 0x09) | (idx(pdos[0].currentA) << 4) | ((pdoCount & 3) << 1);
  s3[4] = (s3[4] & 0xf0) | idx(pdos[1].currentA);
  s3[5] = (s3[5] & 0x0f) | (idx(pdos[2].currentA) << 4);
  const v2 = Math.round(pdos[1].voltageV * 20);
  const v3 = Math.round(pdos[2].voltageV * 20);
  s4[0] = (s4[0] & 0x3f) | ((v2 & 0x03) << 6);
  s4[1] = (v2 >> 2) & 0xff;
  s4[2] = v3 & 0xff;
  s4[3] = (s4[3] & 0xfc) | ((v3 >> 8) & 0x03);
  return out;
}

/**
 * Does the NVM decode to the PDOs the chip is using after power-up? Only then
 * is the field layout known to be right for this chip. Currents of "flex"
 * (index 0) entries are not compared.
 */
export function nvmMatchesRam(decoded, ram) {
  if (decoded.pdoCount !== ram.count) return { ok: false, reason: `NVM says ${decoded.pdoCount} PDOs, the chip uses ${ram.count}.` };
  for (let i = 0; i < ram.count; i++) {
    const n = decoded.pdos[i];
    const r = ram.pdos[i];
    if (Math.abs(n.voltageV - r.voltageV) > 0.05) return { ok: false, reason: `PDO${i + 1}: NVM ${n.voltageV} V, chip ${r.voltageV} V.` };
    if (n.currentA !== null && Math.abs(n.currentA - r.currentA) > 0.011) return { ok: false, reason: `PDO${i + 1}: NVM ${n.currentA} A, chip ${r.currentA} A.` };
  }
  return { ok: true };
}

export class Stusb4500Nvm {
  constructor(pd) { this.pd = pd; }

  async _waitReq() {
    for (let i = 0; i < 100; i++) {
      const [c] = await this.pd.read(NVM.CTRL_0, 1);
      if (!(c & NVM.REQ)) return;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error('The STUSB4500 NVM controller did not finish the command.');
  }

  async _op(opcode, ctrl0Extra = 0) {
    await this.pd.write(NVM.CTRL_1, [opcode & NVM.OPCODE]);
    await this.pd.write(NVM.CTRL_0, [NVM.PWR | NVM.RST_N | NVM.REQ | ctrl0Extra]);
    await this._waitReq();
  }

  async _enter() {
    await this.pd.write(NVM.PASSWORD_REG, [NVM.PASSWORD]);
    await this.pd.write(NVM.RW_BUFFER, [0x00]);
    await this.pd.write(NVM.CTRL_0, [0x00]);
    await this.pd.write(NVM.CTRL_0, [NVM.PWR | NVM.RST_N]);
  }

  async _exit() {
    await this.pd.write(NVM.CTRL_0, [NVM.RST_N, 0x00]);
    await this.pd.write(NVM.PASSWORD_REG, [0x00]);
  }

  /** All five sectors. */
  async read() {
    await this._enter();
    try {
      const out = [];
      for (let s = 0; s < 5; s++) {
        await this.pd.write(NVM.CTRL_0, [NVM.PWR | NVM.RST_N]);
        await this._op(NVM.READ, s & NVM.SECT);
        out.push(Uint8Array.from(await this.pd.read(NVM.RW_BUFFER, 8)));
      }
      return out;
    } finally {
      await this._exit();
    }
  }

  /** Erase all sectors and program the five given sectors, then read back and compare. */
  async write(sectors) {
    if (sectors.length !== 5 || sectors.some((s) => s.length !== 8)) throw new Error('The NVM image is five 8-byte sectors.');
    await this._enter();
    try {
      await this.pd.write(NVM.CTRL_1, [((0x1f << 3) & NVM.SER) | (NVM.WRITE_SER & NVM.OPCODE)]);
      await this.pd.write(NVM.CTRL_0, [NVM.PWR | NVM.RST_N | NVM.REQ]);
      await this._waitReq();
      await this._op(NVM.SOFT_PROG_SECTOR);
      await this._op(NVM.ERASE_SECTOR);
      for (let s = 0; s < 5; s++) {
        await this.pd.write(NVM.RW_BUFFER, Array.from(sectors[s]));
        await this.pd.write(NVM.CTRL_0, [NVM.PWR | NVM.RST_N]);
        await this._op(NVM.WRITE_PL);
        await this._op(NVM.PROG_SECTOR, s & NVM.SECT);
      }
    } finally {
      await this._exit();
    }
    const back = await this.read();
    for (let s = 0; s < 5; s++) {
      for (let i = 0; i < 8; i++) {
        if (back[s][i] !== sectors[s][i]) throw new Error(`NVM verify failed at sector ${s} byte ${i}: wrote 0x${sectors[s][i].toString(16)}, read 0x${back[s][i].toString(16)}.`);
      }
    }
  }
}

/** Backup file format: five lines of 16 hex digits. */
export const nvmToText = (sectors) => sectors.map((s) => Array.from(s, (b) => b.toString(16).padStart(2, '0')).join(' ')).join('\n') + '\n';
export function nvmFromText(text) {
  const lines = String(text).trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map((h) => parseInt(h, 16)));
  if (lines.length !== 5 || lines.some((l) => l.length !== 8 || l.some((b) => Number.isNaN(b) || b < 0 || b > 255))) throw new Error('An NVM backup is five lines of eight hex bytes.');
  return lines.map((l) => Uint8Array.from(l));
}
