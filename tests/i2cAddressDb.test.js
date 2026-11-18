import { describe, it, expect } from 'vitest';
import {
  I2C_DEVICES,
  I2C_CATEGORIES,
  reservedMeaning,
  devicesAtAddress,
  searchDevices,
  toWriteByte,
  toReadByte,
  fromEightBitByte,
  parseAddressInput,
  checkConflicts,
  parseI2cDetect,
  parseArduinoScan,
  parseHexList,
  parseScanText,
  analyzeScan,
} from '../src/utils/i2cAddressDb.js';

describe('i2c address database integrity', () => {
  it('has at least 150 devices', () => {
    expect(I2C_DEVICES.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique ids', () => {
    const all = I2C_DEVICES.map((d) => d.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps every address in 0x08-0x77 unless the part is flagged low', () => {
    for (const d of I2C_DEVICES) {
      expect(d.addr.length, `${d.id} has no addresses`).toBeGreaterThan(0);
      for (const a of d.addr) {
        expect(Number.isInteger(a), `${d.id} address ${a}`).toBe(true);
        if (d.low) {
          expect(a >= 0x00 && a <= 0x7F, `${d.id} ${a.toString(16)}`).toBe(true);
        } else {
          expect(a >= 0x08 && a <= 0x77, `${d.id} ${a.toString(16)}`).toBe(true);
        }
      }
    }
  });

  it('uses only known categories and sources', () => {
    for (const d of I2C_DEVICES) {
      expect(I2C_CATEGORIES, d.id).toContain(d.category);
      expect(['adafruit', 'datasheet']).toContain(d.src);
    }
  });

  it('has sane ID checks (register 0-255, expected value fits the width)', () => {
    for (const d of I2C_DEVICES) {
      if (!d.idCheck) continue;
      const { reg, expect: value, width = 1 } = d.idCheck;
      expect(reg >= 0 && reg <= 0xFF, d.id).toBe(true);
      expect([1, 2], d.id).toContain(width);
      expect(value >= 0 && value < (width === 2 ? 0x10000 : 0x100), d.id).toBe(true);
    }
  });

  it('keeps the brief-specified part addresses', () => {
    const at = (id) => I2C_DEVICES.find((d) => d.id === id);
    expect(at('bme280').addr).toEqual([0x76, 0x77]);
    expect(at('bme280').idCheck).toEqual({ reg: 0xD0, expect: 0x60 });
    expect(at('bmp280').idCheck).toEqual({ reg: 0xD0, expect: 0x58 });
    expect(at('mpu6050').idCheck).toMatchObject({ reg: 0x75, expect: 0x68 });
    expect(at('icm20948').idCheck).toMatchObject({ reg: 0x00, expect: 0xEA });
    expect(at('lis3dh').idCheck).toMatchObject({ reg: 0x0F, expect: 0x33 });
    expect(at('ssd1306').addr).toEqual([0x3C, 0x3D]);
    expect(at('pcf8574').addr).toEqual([0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]);
    expect(at('pcf8574a').addr).toEqual([0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F]);
    expect(at('ads1115').addr).toEqual([0x48, 0x49, 0x4A, 0x4B]);
    expect(at('ina219').addr).toHaveLength(16);
    expect(at('ds3231').addr).toEqual([0x68]);
    expect(at('at24cxx').addr).toEqual([0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57]);
    expect(at('mcp23017').addr).toEqual([0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]);
    expect(at('vl53l0x').addr).toEqual([0x29]);
    expect(at('tcs34725').addr).toEqual([0x29]);
    expect(at('bh1750').addr).toEqual([0x23, 0x5C]);
    expect(at('htu21d').addr).toEqual([0x40]);
    expect(at('si7021').addr).toEqual([0x40]);
    expect(at('ccs811').addr).toEqual([0x5A, 0x5B]);
    expect(at('sgp30').addr).toEqual([0x58]);
    expect(at('max30102').addr).toEqual([0x57]);
    expect(at('qmc5883l').addr).toEqual([0x0D]);
    expect(at('hmc5883l').addr).toEqual([0x1E]);
    expect(at('tca9548a').addr).toEqual([0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77]);
    expect(at('pca9685').addr[0]).toBe(0x40);
    expect(at('pca9685').addr.at(-1)).toBe(0x77);
  });

  it('never lists a reserved address as a device address', () => {
    for (const d of I2C_DEVICES) {
      for (const a of d.addr) expect(reservedMeaning(a), `${d.id} ${a.toString(16)}`).toBeNull();
    }
  });
});

describe('reserved addresses and lookups', () => {
  it('gives the I2C-spec meaning for reserved addresses', () => {
    expect(reservedMeaning(0x00)).toMatch(/General call/);
    expect(reservedMeaning(0x05)).toMatch(/high-speed/);
    expect(reservedMeaning(0x78)).toMatch(/10-bit/);
    expect(reservedMeaning(0x7F)).toMatch(/future/);
    expect(reservedMeaning(0x3C)).toBeNull();
  });

  it('finds candidate devices for an address', () => {
    const at3c = devicesAtAddress(0x3C).map((d) => d.id);
    expect(at3c).toContain('ssd1306');
    expect(devicesAtAddress(0x68).map((d) => d.id)).toContain('mpu6050');
    expect(devicesAtAddress(0x7E)).toEqual([]);
  });

  it('searches by part, function and address text', () => {
    expect(searchDevices('bme280').map((d) => d.id)).toContain('bme280');
    expect(searchDevices('oled').map((d) => d.id)).toContain('ssd1306');
    expect(searchDevices('0x3c').map((d) => d.id)).toContain('ssd1306');
    expect(searchDevices('')).toHaveLength(I2C_DEVICES.length);
  });
});

describe('7-bit / 8-bit address conversion', () => {
  it('converts 7-bit addresses to write and read bytes', () => {
    expect(toWriteByte(0x68)).toBe(0xD0);
    expect(toReadByte(0x68)).toBe(0xD1);
    expect(toWriteByte(0x3C)).toBe(0x78);
    expect(toReadByte(0x3C)).toBe(0x79);
    expect(toWriteByte(0x7F)).toBe(0xFE);
  });

  it('converts 8-bit bus bytes back to 7-bit with the R/W bit', () => {
    expect(fromEightBitByte(0xD0)).toEqual({ address7: 0x68, rw: 'write' });
    expect(fromEightBitByte(0xD1)).toEqual({ address7: 0x68, rw: 'read' });
    expect(fromEightBitByte(0xFF)).toEqual({ address7: 0x7F, rw: 'read' });
  });

  it('parses typed addresses as hex', () => {
    expect(parseAddressInput('0x3C')).toBe(0x3C);
    expect(parseAddressInput('3c')).toBe(0x3C);
    expect(parseAddressInput('$68')).toBe(0x68);
    expect(parseAddressInput('80')).toBeNull();
    expect(parseAddressInput('zz')).toBeNull();
    expect(parseAddressInput('')).toBeNull();
  });
});

describe('conflict checker', () => {
  it('reports no conflicts for parts on different addresses', () => {
    const r = checkConflicts(['ssd1306', 'ds3231', 'bme280']);
    expect(r.clean).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  it('reports the shared address and which parts can move', () => {
    const r = checkConflicts(['bme280', 'bmp280', 'ina219']);
    expect(r.clean).toBe(false);
    const addr = r.conflicts.find((c) => c.address === 0x76);
    expect(addr).toBeDefined();
    expect(addr.hex).toBe('0x76');
    expect(addr.devices.map((d) => d.id).sort()).toEqual(['bme280', 'bmp280']);
    expect(addr.devices.every((d) => d.adjustable)).toBe(true);
    // BME280 can move to 0x77 only when no other chosen part uses it (BMP280 does)
    expect(addr.devices.find((d) => d.id === 'bme280').freeAlternatives).toEqual([]);
    const moveable = checkConflicts(['bme280', 'ms5837']).conflicts.find((c) => c.address === 0x76);
    expect(moveable.devices.find((d) => d.id === 'bme280').freeAlternatives).toEqual(['0x77']);
    expect(moveable.devices.find((d) => d.id === 'ms5837').adjustable).toBe(false);
  });

  it('marks fixed-address parts as not adjustable', () => {
    const r = checkConflicts(['vl53l0x', 'tcs34725']);
    const c = r.conflicts.find((x) => x.address === 0x29);
    expect(c).toBeDefined();
    expect(c.devices.every((d) => !d.adjustable)).toBe(true);
    expect(r.chosen.find((x) => x.id === 'vl53l0x').adjustable).toBe(false);
  });

  it('ignores unknown ids', () => {
    const r = checkConflicts(['nope', 'ds3231']);
    expect(r.chosen.map((c) => c.id)).toEqual(['ds3231']);
  });
});

describe('i2cdetect parser', () => {
  const SAMPLE = `     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- 28 -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- 3c -- -- --
40: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
50: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- 77`;

  it('reads found addresses by column position, including blank cells', () => {
    const r = parseI2cDetect(SAMPLE);
    expect(r.format).toBe('i2cdetect');
    expect(r.rows).toBe(8);
    expect(r.found.map((f) => f.address)).toEqual([0x28, 0x3C, 0x77]);
    expect(r.found.every((f) => f.inUse === false)).toBe(true);
  });

  it('treats UU as present and in use', () => {
    const row = '00:' + ' --'.repeat(3) + ' UU' + ' --'.repeat(12);
    const r = parseI2cDetect(row);
    expect(r.found).toEqual([{ address: 0x03, inUse: true }]);
  });

  it('ignores the command line and header', () => {
    const r = parseI2cDetect('$ sudo i2cdetect -y 1\n     0  1\n40: -- -- 42 --');
    expect(r.found.map((f) => f.address)).toEqual([0x42]);
  });

  it('reads a fully populated row when cells are not blank', () => {
    const row = '60: 60 61 62 63 64 65 66 67 68 69 6a 6b 6c 6d 6e 6f';
    expect(parseI2cDetect(row).found.map((f) => f.address)).toEqual(range(0x60, 0x6F));
  });

  it('returns nothing for text with no rows', () => {
    expect(parseI2cDetect('hello').found).toEqual([]);
  });
});

describe('Arduino I2C scanner parser', () => {
  it('reads each "I2C device found" line', () => {
    const text = `Scanning...
I2C device found at address 0x3C  !
I2C device found at address 0x68  !
Unknown error at address 0x42
done`;
    const r = parseArduinoScan(text);
    expect(r.format).toBe('arduino');
    expect(r.found.map((f) => f.address)).toEqual([0x3C, 0x68]);
    expect(r.errors).toEqual([0x42]);
  });

  it('finds nothing in a no-device scan', () => {
    expect(parseArduinoScan('Scanning...\ndone\n').found).toEqual([]);
  });
});

describe('hex list parser', () => {
  it('accepts commas, spaces and 0x prefixes', () => {
    const r = parseHexList('0x3C, 68;  0x77 0x3c');
    expect(r.found.map((f) => f.address)).toEqual([0x3C, 0x68, 0x77]);
    expect(r.invalid).toEqual([]);
  });

  it('reports tokens that are not 7-bit addresses', () => {
    const r = parseHexList('0x3C xyz 0x80 123');
    expect(r.found.map((f) => f.address)).toEqual([0x3C]);
    expect(r.invalid).toEqual(['xyz', '0x80', '123']);
  });
});

describe('scan format detection', () => {
  it('detects each supported format', () => {
    expect(parseScanText('I2C device found at address 0x3C').format).toBe('arduino');
    expect(parseScanText('00:          -- 3c -- --').format).toBe('i2cdetect');
    expect(parseScanText('0x3C 0x68').format).toBe('hex-list');
    expect(parseScanText('   ').format).toBe('empty');
  });

  it('gives the same addresses from the same scan in each format', () => {
    const ard = parseScanText('I2C device found at address 0x3C\nI2C device found at address 0x68');
    const hex = parseScanText('0x3C 0x68');
    const grid = parseScanText('60: -- -- -- -- -- -- -- -- 68 -- -- -- -- -- -- --\n30: -- -- -- -- -- -- -- -- -- -- -- -- 3c -- -- --');
    expect(ard.found.map((f) => f.address)).toEqual(hex.found.map((f) => f.address));
    expect(grid.found.map((f) => f.address)).toEqual([0x3C, 0x68]);
  });
});

describe('scan analysis', () => {
  it('suggests an ID check for a single known candidate', () => {
    const [row] = analyzeScan([{ address: 0x77 }].map((f) => ({ ...f, inUse: false })))
      .filter((r) => r.candidates.length > 0 && r.candidates.length === 1);
    expect(row).toBeUndefined();
    const a = analyzeScan([{ address: 0x77, inUse: false }]);
    expect(a[0].candidates.length).toBeGreaterThan(1);
    expect(a[0].suggestion).toMatch(/share this address/);
  });

  it('lists the ID register to read when a candidate has one', () => {
    const [r] = analyzeScan([{ address: 0x68, inUse: false }]);
    const mpu = r.idChecks.find((c) => c.part === 'MPU-6050');
    expect(mpu).toMatchObject({ reg: 0x75, regHex: '0x75', expect: 0x68 });
    expect(r.candidates.map((c) => c.id)).toContain('mpu6050');
  });

  it('flags reserved and unknown addresses', () => {
    const [res, unknown] = analyzeScan([{ address: 0x7C }, { address: 0x2F }]);
    expect(res.reserved).toMatch(/future/);
    expect(res.suggestion).toMatch(/Reserved/);
    expect(unknown.candidates).toEqual([]);
    expect(unknown.suggestion).toMatch(/Not in this database/);
  });
});

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

