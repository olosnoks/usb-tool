/**
 * I2C & SPI Bus Explorer driver.
 *
 * Real hardware: a Bus Pirate v3/v4 in binary (BBIO) mode over Web Serial.
 * I2C address scan, register read/write, and SPI full-duplex transfers.
 * Simulation: five common sensors on a virtual I2C bus.
 */

import { SerialLink } from './serialLink';


export const I2C_CHIP_DATABASE = {
  0x18: { name: 'MCP9808', type: 'Temperature Sensor', mfr: 'Microchip', desc: 'High accuracy (+/-0.25C) digital temperature sensor' },
  0x19: { name: 'LSM303D / LIS3DH', type: 'Accelerometer / Magnetometer', mfr: 'STMicroelectronics', desc: '3-axis linear accelerometer & 3D compass' },
  0x1C: { name: 'MMA8452Q', type: 'Accelerometer', mfr: 'NXP / Freescale', desc: '14-bit digital accelerometer' },
  0x1D: { name: 'ADXL345 (Alt)', type: 'Accelerometer', mfr: 'Analog Devices', desc: 'Ultra-low power 3-axis accelerometer' },
  0x1E: { name: 'HMC5883L', type: 'Compass / Magnetometer', mfr: 'Honeywell', desc: '3-axis digital compass IC' },
  0x20: { name: 'PCF8574', type: 'GPIO Expander', mfr: 'NXP / TI', desc: '8-bit I2C parallel I/O port expander' },
  0x21: { name: 'PCF8574 (A0=1)', type: 'GPIO Expander', mfr: 'NXP / TI', desc: '8-bit I2C parallel I/O port expander' },
  0x23: { name: 'BH1750', type: 'Ambient Light Sensor', mfr: 'ROHM', desc: '16-bit digital ambient light sensor (Lux)' },
  0x27: { name: 'PCF8574T (LCD Backing)', type: 'I2C 1602 LCD Adapter', mfr: 'Generic', desc: 'Standard backpack for 16x2 and 20x4 character LCDs' },
  0x29: { name: 'VL53L0X / TSL2561', type: 'Time-of-Flight / Light', mfr: 'ST / AMS', desc: 'Laser ranging distance sensor (up to 2m)' },
  0x38: { name: 'AHT10 / AHT20', type: 'Temp & Humidity', mfr: 'Aosong', desc: 'Calibrated digital temperature & humidity sensor' },
  0x39: { name: 'APDS-9960', type: 'Gesture & Color', mfr: 'Broadcom', desc: 'RGB, ambient light, proximity and gesture sensor' },
  0x3C: { name: 'SSD1306 / SH1106', type: 'OLED Display (0.96")', mfr: 'Solomon Systech', desc: '128x64 or 128x32 monochrome dot-matrix OLED' },
  0x3D: { name: 'SSD1306 (Alt Address)', type: 'OLED Display', mfr: 'Solomon Systech', desc: '128x64 OLED display controller (SA0 high)' },
  0x40: { name: 'INA219 / SI7021', type: 'Current/Power Monitor', mfr: 'Texas Instruments', desc: 'Bidirectional high-side zero-drift I2C current/voltage monitor' },
  0x44: { name: 'SHT30 / SHT31', type: 'Temp & Humidity', mfr: 'Sensirion', desc: 'High accuracy +/-1.5% RH digital sensor' },
  0x48: { name: 'ADS1115 / LM75', type: '16-Bit ADC / Temp', mfr: 'Texas Instruments', desc: 'Ultra-compact 16-bit precision analog-to-digital converter' },
  0x49: { name: 'ADS1115 (Addr=VDD)', type: '16-Bit ADC', mfr: 'Texas Instruments', desc: '4-channel differential ADC' },
  0x50: { name: 'AT24C32 / 24C256', type: 'I2C Serial EEPROM', mfr: 'Atmel / Microchip', desc: '32Kb to 256Kb non-volatile memory (on RTC boards)' },
  0x51: { name: 'PCF8563 / 24C32 (A0=1)', type: 'Real-Time Clock / EEPROM', mfr: 'NXP', desc: 'Real-time clock / calendar' },
  0x53: { name: 'ADXL345', type: 'Accelerometer', mfr: 'Analog Devices', desc: '3-axis accelerometer with SPI/I2C' },
  0x57: { name: 'MAX30102 / 24C32 (A2=1)', type: 'Pulse Oximeter / Heart Rate', mfr: 'Maxim Integrated', desc: 'Optical heart-rate and SpO2 biometric sensor' },
  0x68: { name: 'MPU-6050 / DS3231', type: '6-DoF IMU / Precision RTC', mfr: 'InvenSense / Maxim', desc: '3-axis Gyroscope + 3-axis Accelerometer or TCXO RTC' },
  0x69: { name: 'MPU-6050 (AD0=1)', type: '6-DoF IMU', mfr: 'InvenSense', desc: '6-axis motion tracking sensor with motion processor' },
  0x76: { name: 'BMP280 / BME280', type: 'Barometric Pressure', mfr: 'Bosch Sensortec', desc: 'Digital pressure, temperature & humidity sensor' },
  0x77: { name: 'BME680 / BMP180', type: 'Gas & Environmental Sensor', mfr: 'Bosch Sensortec', desc: 'Air quality (VOC), pressure, humidity and temperature' }
};

// ---- Bus Pirate binary mode (BBIO) ------------------------------------------
// Bus Pirate v3 / v4 firmware: 0x00 x20 enters binary mode ("BBIO1"),
// 0x02 selects raw I2C ("I2C1"), 0x01 raw SPI ("SPI1").

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const td = new TextDecoder();
const endsWith = (arr, text) => td.decode(Uint8Array.from(arr)).endsWith(text);

export const I2C_SPEEDS = [
  { value: 0, label: '5 kHz' }, { value: 1, label: '50 kHz' },
  { value: 2, label: '100 kHz' }, { value: 3, label: '400 kHz' }
];
export const SPI_SPEEDS = [
  { value: 0, label: '30 kHz' }, { value: 1, label: '125 kHz' }, { value: 2, label: '250 kHz' },
  { value: 3, label: '1 MHz' }, { value: 4, label: '2 MHz' }, { value: 5, label: '2.6 MHz' },
  { value: 6, label: '4 MHz' }, { value: 7, label: '8 MHz' }
];

export class BusPirate {
  constructor(link) {
    this.link = link;
    this.mode = null; // 'bbio' | 'i2c' | 'spi'
  }

  async _ok(cmd, what) {
    await this.link.write([cmd]);
    const r = (await this.link.read(1, 500, what))[0];
    if (r !== 0x01) throw new Error(`Bus Pirate refused ${what} (0x${r.toString(16)})`);
  }

  /** Leave the text console and enter binary mode. */
  async enterBinary() {
    await this.link.write([0x0d, 0x0a]); // finish any half-typed console command
    await this.link.drain(100);
    for (let i = 0; i < 25; i++) {
      await this.link.write([0x00]);
      try {
        await this.link.readUntil((b) => endsWith(b, 'BBIO1'), 60, 'BBIO1');
        await this.link.drain(20);
        this.mode = 'bbio';
        return true;
      } catch (e) { /* keep sending 0x00 */ }
    }
    throw new Error('No "BBIO1" reply: this does not look like a Bus Pirate in binary-capable firmware (v3/v4, 115200 baud).');
  }

  async _enterMode(cmd, tag, mode) {
    if (this.mode !== 'bbio') {
      await this.link.write([0x00]);
      await this.link.readUntil((b) => endsWith(b, 'BBIO1'), 300, 'BBIO1');
    }
    await this.link.write([cmd]);
    await this.link.readUntil((b) => endsWith(b, tag), 500, tag);
    this.mode = mode;
  }

  enterI2c() { return this._enterMode(0x02, 'I2C1', 'i2c'); }
  enterSpi() { return this._enterMode(0x01, 'SPI1', 'spi'); }

  /** Power supplies, pull-ups, AUX and CS pins (bit flags). */
  configurePeripherals({ power = false, pullups = false, aux = false, cs = false } = {}) {
    return this._ok(0x40 | (power ? 8 : 0) | (pullups ? 4 : 0) | (aux ? 2 : 0) | (cs ? 1 : 0), 'the peripheral setting');
  }

  setSpeed(code) { return this._ok(0x60 | (code & 0x07), 'the bus speed'); }

  // -- I2C primitives
  i2cStart() { return this._ok(0x02, 'START'); }
  i2cStop() { return this._ok(0x03, 'STOP'); }

  /** Write up to 16 bytes; returns an array of booleans, true = ACK. */
  async i2cWrite(bytes) {
    const acks = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      await this.link.write([0x10 | (chunk.length - 1), ...chunk]);
      const r = await this.link.read(1 + chunk.length, 500, 'the I2C write');
      if (r[0] !== 0x01) throw new Error('Bus Pirate refused the I2C write');
      for (let j = 1; j < r.length; j++) acks.push(r[j] === 0x00);
    }
    return acks;
  }

  /** Read n bytes, ACKing all but the last. */
  async i2cRead(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      await this.link.write([0x04]);
      out.push((await this.link.read(1, 500, 'an I2C byte'))[0]);
      await this._ok(i === n - 1 ? 0x07 : 0x06, i === n - 1 ? 'NACK' : 'ACK');
    }
    return out;
  }

  /** True when a device ACKs its 7-bit write address. */
  async i2cProbe(addr) {
    await this.i2cStart();
    try {
      const [ack] = await this.i2cWrite([(addr << 1) & 0xfe]);
      return ack;
    } finally {
      await this.i2cStop();
    }
  }

  /** Register read: START addr+W reg, repeated START addr+R, n bytes, STOP. */
  async i2cReadRegisters(addr, reg, n) {
    await this.i2cStart();
    try {
      const acks = await this.i2cWrite([(addr << 1) & 0xfe, reg & 0xff]);
      if (!acks[0]) throw new Error(`No ACK from 0x${addr.toString(16)}`);
      if (!acks[1]) throw new Error(`0x${addr.toString(16)} did not ACK register 0x${reg.toString(16)}`);
      await this.i2cStart();
      const [ackR] = await this.i2cWrite([((addr << 1) | 1) & 0xff]);
      if (!ackR) throw new Error(`No ACK from 0x${addr.toString(16)} for the read`);
      return await this.i2cRead(n);
    } finally {
      await this.i2cStop();
    }
  }

  async i2cWriteRegister(addr, reg, values) {
    await this.i2cStart();
    try {
      const acks = await this.i2cWrite([(addr << 1) & 0xfe, reg & 0xff, ...values]);
      const nack = acks.findIndex((a) => !a);
      if (nack === 0) throw new Error(`No ACK from 0x${addr.toString(16)}`);
      if (nack > 0) throw new Error(`Byte ${nack} of the write was not acknowledged`);
    } finally {
      await this.i2cStop();
    }
  }

  // -- SPI primitives
  /** Output level (3.3 V push-pull vs open drain), clock polarity/phase, sample point. */
  spiConfigure({ push = true, idleHigh = false, edge = true, sampleEnd = false } = {}) {
    return this._ok(0x80 | (push ? 8 : 0) | (idleHigh ? 4 : 0) | (edge ? 2 : 0) | (sampleEnd ? 1 : 0), 'the SPI configuration');
  }

  spiCs(low) { return this._ok(low ? 0x02 : 0x03, low ? 'CS low' : 'CS high'); }

  /** Full-duplex transfer with CS held low for the whole exchange. */
  async spiTransfer(bytes) {
    const out = [];
    await this.spiCs(true);
    try {
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = bytes.slice(i, i + 16);
        await this.link.write([0x10 | (chunk.length - 1), ...chunk]);
        const r = await this.link.read(1 + chunk.length, 500, 'the SPI transfer');
        if (r[0] !== 0x01) throw new Error('Bus Pirate refused the SPI transfer');
        out.push(...r.slice(1));
      }
    } finally {
      await this.spiCs(false);
    }
    return out;
  }

  /** Leave binary mode: the Bus Pirate returns to its text console. */
  async reset() {
    try {
      await this.link.write([0x00]);
      await sleep(20);
      await this.link.write([0x0f]);
      await this.link.drain(50);
    } catch (e) { /* port may be gone */ }
    this.mode = null;
  }
}

export class BusExplorerClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.isSimulated = false;
    this.busType = 'i2c'; // 'i2c' | 'spi'
    this.detectedDevices = [];
    this.activeAddress = 0x68;
    this.registers = new Uint8Array(256);
    this.link = null;
    this.bp = null;
    this.settings = { power: false, pullups: false, i2cSpeed: 2, spiSpeed: 3 };
    this._owner = { name: 'I2C / SPI Bus Explorer', release: () => this.disconnect() };
  }

  log(msg) { this.logger(`[BUS EXPLORER] ${msg}`); }

  connectSimulation() {
    this.isConnected = true;
    this.isSimulated = true;
    this.detectedDevices = [0x3C, 0x48, 0x50, 0x68, 0x76]; // OLED, ADC, EEPROM, MPU6050, BMP280
    this.initSimulatedRegisters(0x68);
    this.log('Simulated I2C bus with five sensors online.');
    return true;
  }

  /** Open a Bus Pirate (v3/v4) and put it in raw I2C mode. `link` is for tests. */
  async connectHardware({ link = null } = {}) {
    this.link = link || await SerialLink.request(this._owner, { baudRate: 115200 });
    this.bp = new BusPirate(this.link);
    try {
      await this.bp.enterBinary();
      await this.setBus('i2c');
      this.isConnected = true;
      this.isSimulated = false;
      this.detectedDevices = [];
      this.log('Bus Pirate in binary mode, raw I2C selected.');
      return true;
    } catch (e) {
      await this.link.close();
      this.link = null;
      this.bp = null;
      throw e;
    }
  }

  /** Switch between I2C and SPI, re-applying power / pull-up / speed settings. */
  async setBus(type) {
    this.busType = type;
    if (this.isSimulated || !this.bp) return;
    if (type === 'i2c') {
      await this.bp.enterI2c();
      await this.bp.setSpeed(this.settings.i2cSpeed);
    } else {
      await this.bp.enterSpi();
      await this.bp.spiConfigure({ push: true, idleHigh: false, edge: true, sampleEnd: false });
      await this.bp.setSpeed(this.settings.spiSpeed);
    }
    await this.bp.configurePeripherals({ power: this.settings.power, pullups: this.settings.pullups, cs: type === 'spi' });
  }

  /** Change power / pull-ups / speeds; applied to the live adapter. */
  async configure(changes) {
    this.settings = { ...this.settings, ...changes };
    if (this.isSimulated || !this.bp) return this.settings;
    if (this.busType === 'i2c' && 'i2cSpeed' in changes) await this.bp.setSpeed(this.settings.i2cSpeed);
    if (this.busType === 'spi' && 'spiSpeed' in changes) await this.bp.setSpeed(this.settings.spiSpeed);
    await this.bp.configurePeripherals({ power: this.settings.power, pullups: this.settings.pullups, cs: this.busType === 'spi' });
    return this.settings;
  }

  initSimulatedRegisters(addr) {
    this.activeAddress = addr;
    if (!this.isSimulated) return;
    this.registers.fill(0);

    // Realistic register defaults for MPU-6050 (0x68)
    if (addr === 0x68) {
      this.registers[0x75] = 0x68; // WHO_AM_I register
      this.registers[0x6B] = 0x00; // PWR_MGMT_1 (Awake)
      this.registers[0x1B] = 0x18; // GYRO_CONFIG (+/-2000 deg/s)
      this.registers[0x1C] = 0x08; // ACCEL_CONFIG (+/-4g)
      this.registers[0x3B] = 0x01; this.registers[0x3C] = 0x80;
      this.registers[0x3D] = 0x00; this.registers[0x3E] = 0x40;
      this.registers[0x3F] = 0x0F; this.registers[0x40] = 0xA0;
      this.registers[0x41] = 0x09; this.registers[0x42] = 0x24;
    } else if (addr === 0x76) {
      this.registers[0xD0] = 0x58; // BMP280 CHIP_ID
      this.registers[0xF4] = 0x27; this.registers[0xF5] = 0xA0;
      this.registers[0xF7] = 0x50; this.registers[0xF8] = 0x82; this.registers[0xFA] = 0x84;
    } else {
      for (let i = 0; i < 32; i++) this.registers[i] = (i * 7 + addr) & 0xFF;
    }
  }

  async disconnect() {
    const link = this.link;
    this.link = null;
    if (this.bp) {
      // Turn the supplies off before handing the Bus Pirate back to its console.
      try { await this.bp.configurePeripherals({}); } catch (e) { /* ignore */ }
      await this.bp.reset();
    }
    this.bp = null;
    if (link) await link.close();
    this.isConnected = false;
    this.isSimulated = false;
    this.detectedDevices = [];
    this.log('Disconnected.');
  }

  /** Probe every 7-bit address from 0x08 to 0x77. */
  async scanI2cBus(onProgress) {
    if (!this.isConnected) return [];
    if (this.isSimulated) {
      await sleep(200);
      this.detectedDevices = [0x3C, 0x48, 0x50, 0x68, 0x76];
    } else {
      if (this.busType !== 'i2c') await this.setBus('i2c');
      const found = [];
      for (let a = 0x08; a <= 0x77; a++) {
        if (await this.bp.i2cProbe(a)) found.push(a);
        onProgress?.(a);
      }
      this.detectedDevices = found;
      if (!found.length) this.log('No device ACKed. Check SDA/SCL wiring, a shared ground, and pull-ups (turn them on here if the board has none).');
    }
    this.log(`Scan complete: ${this.detectedDevices.length} device(s) ACKed.`);
    return this.detectedDevices;
  }

  /** Read `count` consecutive registers from the active device. */
  async readRegisters(start, count) {
    if (this.isSimulated) {
      const out = [];
      for (let r = start; r < start + count; r++) {
        if (this.activeAddress === 0x68 && r >= 0x3B && r <= 0x42) {
          this.registers[r] = (this.registers[r] + Math.floor(Math.random() * 3) - 1) & 0xFF;
        }
        out.push(this.registers[r & 0xff]);
      }
      return out;
    }
    if (this.busType !== 'i2c') await this.setBus('i2c');
    return this.bp.i2cReadRegisters(this.activeAddress, start, count);
  }

  async writeRegister(reg, val) {
    if (this.isSimulated) this.registers[reg & 0xff] = val & 0xFF;
    else {
      if (this.busType !== 'i2c') await this.setBus('i2c');
      await this.bp.i2cWriteRegister(this.activeAddress, reg, [val & 0xff]);
    }
    this.log(`Wrote 0x${(val & 0xFF).toString(16).padStart(2, '0').toUpperCase()} to reg 0x${reg.toString(16).padStart(2, '0').toUpperCase()} of 0x${this.activeAddress.toString(16)}`);
    return true;
  }

  /** SPI full-duplex exchange (CS held low). Returns the bytes clocked in. */
  async spiTransfer(bytes) {
    if (this.isSimulated) {
      // A simulated W25Q64 answers JEDEC ID; everything else reads 0xFF.
      if (bytes[0] === 0x9f) return [0xff, 0xef, 0x40, 0x17, ...bytes.slice(4).map(() => 0xff)].slice(0, bytes.length);
      return bytes.map(() => 0xff);
    }
    if (this.busType !== 'spi') await this.setBus('spi');
    return this.bp.spiTransfer(bytes);
  }
}
