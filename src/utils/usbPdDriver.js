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
    this.isSimulated = false;
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
      this.isConnected = true;
      this.isSimulated = false;
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

  connectSimulation() {
    this.isConnected = true;
    this.isSimulated = true;
    this.activeVoltageV = 5.0;
    this.targetVoltageV = 5.0;
    this.currentA = 0.42;
    this.activePdoId = 1;
    this.isPps = false;
    this.cableInfo = SAMPLE_CABLE_EMARKERS[0];
    this.lastTimestamp = Date.now();
    this.logger('[USB-PD] Virtual USB-PD Charger simulation online (100W GaN PD 3.0 / PPS).');
    return true;
  }

  async disconnect() {
    await this._closeHardware();
    this.isConnected = false;
    this.isSimulated = false;
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

  // Poll live VBUS measurements (smoothly steps toward target voltage with load noise)
  readTelemetry() {
    const now = Date.now();
    const deltaHours = (now - this.lastTimestamp) / (1000 * 3600);
    this.lastTimestamp = now;

    if (!this.isConnected) {
      return {
        voltageV: 0,
        currentA: 0,
        powerW: 0,
        tempC: 25.0,
        accumulatedMah: this.accumulatedMah,
        accumulatedMwh: this.accumulatedMwh
      };
    }

    // Step active voltage toward target
    const step = (this.targetVoltageV - this.activeVoltageV) * 0.35;
    this.activeVoltageV += step;
    if (Math.abs(this.targetVoltageV - this.activeVoltageV) < 0.02) {
      this.activeVoltageV = this.targetVoltageV;
    }

    // Jitter/noise for realistic multimeter reading
    const vNoise = (Math.random() - 0.5) * 0.015;
    const finalV = Math.max(0, this.activeVoltageV + vNoise);

    // Dynamic current draw based on requested voltage (simulated 15 ohm load)
    const baseCurrent = finalV / 18.0;
    const iNoise = (Math.random() - 0.5) * 0.025;
    const finalI = Math.max(0.05, Number((baseCurrent + iNoise).toFixed(3)));

    const finalW = Number((finalV * finalI).toFixed(2));
    const tempC = Number((28.0 + finalW * 0.22).toFixed(1));

    // Integrate energy
    this.accumulatedMah += finalI * 1000 * deltaHours;
    this.accumulatedMwh += finalW * 1000 * deltaHours;

    return {
      voltageV: Number(finalV.toFixed(3)),
      currentA: finalI,
      powerW: finalW,
      tempC: tempC,
      accumulatedMah: Math.round(this.accumulatedMah * 10) / 10,
      accumulatedMwh: Math.round(this.accumulatedMwh * 10) / 10
    };
  }

  resetEnergyCounter() {
    this.accumulatedMah = 0;
    this.accumulatedMwh = 0;
    this.lastTimestamp = Date.now();
    this.logger('[USB-PD] Accumulated mAh / mWh counters reset to 0.');
  }
}
