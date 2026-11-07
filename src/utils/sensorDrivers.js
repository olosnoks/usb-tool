/**
 * sensorDrivers.js — live readouts for common I2C parts, on a register bus:
 *   bus.read(addr, reg, n) -> bytes      bus.write(addr, reg, bytes)
 * (the Bus Pirate's register read/write, or the simulated bus below).
 *
 * BME280 / BMP280 compensation is the double-precision code from the Bosch
 * datasheet; the other parts are plain register maps.
 */

const s16 = (hi, lo) => { const v = (hi << 8) | lo; return v & 0x8000 ? v - 0x10000 : v; };
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const s16le = (b, o) => { const v = u16le(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bcd = (b) => (b >> 4) * 10 + (b & 0x0f);
const toBcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xff;

// ---------------------------------------------------------------------------
// BME280 / BMP280
// ---------------------------------------------------------------------------

export function parseBmeCalibration(c, h = null) {
  const cal = {
    T1: u16le(c, 0), T2: s16le(c, 2), T3: s16le(c, 4),
    P1: u16le(c, 6), P2: s16le(c, 8), P3: s16le(c, 10), P4: s16le(c, 12), P5: s16le(c, 14),
    P6: s16le(c, 16), P7: s16le(c, 18), P8: s16le(c, 20), P9: s16le(c, 22)
  };
  if (h) {
    cal.H1 = c[25];
    cal.H2 = s16le(h, 0);
    cal.H3 = h[2];
    const h4 = (h[3] << 4) | (h[4] & 0x0f);
    const h5 = (h[5] << 4) | (h[4] >> 4);
    cal.H4 = h4 & 0x800 ? h4 - 0x1000 : h4;
    cal.H5 = h5 & 0x800 ? h5 - 0x1000 : h5;
    cal.H6 = h[6] > 127 ? h[6] - 256 : h[6];
  }
  return cal;
}

export function bmeCompensate(cal, adcT, adcP, adcH = null) {
  let var1 = (adcT / 16384 - cal.T1 / 1024) * cal.T2;
  let var2 = (adcT / 131072 - cal.T1 / 8192) ** 2 * cal.T3;
  const tFine = var1 + var2;
  const temperature = tFine / 5120;

  var1 = tFine / 2 - 64000;
  var2 = (var1 * var1 * cal.P6) / 32768;
  var2 += var1 * cal.P5 * 2;
  var2 = var2 / 4 + cal.P4 * 65536;
  var1 = ((cal.P3 * var1 * var1) / 524288 + cal.P2 * var1) / 524288;
  var1 = (1 + var1 / 32768) * cal.P1;
  let pressure = null;
  if (var1 !== 0) {
    let p = 1048576 - adcP;
    p = ((p - var2 / 4096) * 6250) / var1;
    const v1 = (cal.P9 * p * p) / 2147483648;
    const v2 = (p * cal.P8) / 32768;
    pressure = p + (v1 + v2 + cal.P7) / 16;
  }

  let humidity = null;
  if (adcH !== null && cal.H1 !== undefined) {
    let h = tFine - 76800;
    h = (adcH - (cal.H4 * 64 + (cal.H5 / 16384) * h)) * ((cal.H2 / 65536) * (1 + (cal.H6 / 67108864) * h * (1 + (cal.H3 / 67108864) * h)));
    h *= 1 - (cal.H1 * h) / 524288;
    humidity = Math.min(100, Math.max(0, h));
  }
  return { temperature, pressure, humidity };
}

async function readBme(bus, addr) {
  const id = (await bus.read(addr, 0xd0, 1))[0];
  const isBme = id === 0x60;
  const c = await bus.read(addr, 0x88, 26);
  const h = isBme ? await bus.read(addr, 0xe1, 7) : null;
  if (isBme) await bus.write(addr, 0xf2, [0x01]); // humidity x1
  await bus.write(addr, 0xf4, [0x25]); // temp x1, pressure x1, forced mode
  await sleep(12);
  const d = await bus.read(addr, 0xf7, isBme ? 8 : 6);
  const adcP = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  const adcT = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4);
  const adcH = isBme ? (d[6] << 8) | d[7] : null;
  const r = bmeCompensate(parseBmeCalibration(c, h), adcT, adcP, adcH);
  const out = [
    { name: 'Temperature', value: r.temperature, unit: '°C', digits: 2 },
    { name: 'Pressure', value: r.pressure / 100, unit: 'hPa', digits: 2 }
  ];
  if (isBme) out.push({ name: 'Humidity', value: r.humidity, unit: '%RH', digits: 1 });
  // Barometric altitude against standard sea-level pressure.
  out.push({ name: 'Altitude (std)', value: 44330 * (1 - (r.pressure / 101325) ** 0.1903), unit: 'm', digits: 1 });
  return out;
}

// ---------------------------------------------------------------------------
// MPU-6050 family
// ---------------------------------------------------------------------------

async function readMpu(bus, addr) {
  await bus.write(addr, 0x6b, [0x00]); // wake up
  const [gyroCfg] = await bus.read(addr, 0x1b, 1);
  const [accelCfg] = await bus.read(addr, 0x1c, 1);
  const aScale = [16384, 8192, 4096, 2048][(accelCfg >> 3) & 3];
  const gScale = [131, 65.5, 32.8, 16.4][(gyroCfg >> 3) & 3];
  const d = await bus.read(addr, 0x3b, 14);
  const v = (i) => s16(d[i], d[i + 1]);
  return [
    { name: 'Accel X', value: v(0) / aScale, unit: 'g', digits: 3 },
    { name: 'Accel Y', value: v(2) / aScale, unit: 'g', digits: 3 },
    { name: 'Accel Z', value: v(4) / aScale, unit: 'g', digits: 3 },
    { name: 'Temperature', value: v(6) / 340 + 36.53, unit: '°C', digits: 1 },
    { name: 'Gyro X', value: v(8) / gScale, unit: '°/s', digits: 1 },
    { name: 'Gyro Y', value: v(10) / gScale, unit: '°/s', digits: 1 },
    { name: 'Gyro Z', value: v(12) / gScale, unit: '°/s', digits: 1 }
  ];
}

// ---------------------------------------------------------------------------
// ADS1115, INA219, DS3231
// ---------------------------------------------------------------------------

/** ADS1115 single-shot config for AINn vs GND at ±4.096 V, 128 SPS. */
export function ads1115Config(channel) {
  return 0x8000 | ((4 + channel) << 12) | (1 << 9) | 0x0100 | (4 << 5) | 0x0003;
}

async function readAds1115(bus, addr) {
  const out = [];
  for (let ch = 0; ch < 4; ch++) {
    const cfg = ads1115Config(ch);
    await bus.write(addr, 0x01, [cfg >> 8, cfg & 0xff]);
    await sleep(9);
    const r = await bus.read(addr, 0x00, 2);
    out.push({ name: `AIN${ch}`, value: (s16(r[0], r[1]) * 4.096) / 32768, unit: 'V', digits: 4 });
  }
  return out;
}

async function readIna219(bus, addr, shuntOhms = 0.1) {
  const sh = await bus.read(addr, 0x01, 2);
  const bu = await bus.read(addr, 0x02, 2);
  const shuntV = s16(sh[0], sh[1]) * 10e-6;
  const busV = (((bu[0] << 8) | bu[1]) >> 3) * 0.004;
  const current = shuntV / shuntOhms;
  return [
    { name: 'Bus voltage', value: busV, unit: 'V', digits: 3 },
    { name: 'Shunt voltage', value: shuntV * 1000, unit: 'mV', digits: 3 },
    { name: `Current (${shuntOhms} Ω shunt)`, value: current * 1000, unit: 'mA', digits: 1 },
    { name: 'Power', value: busV * current * 1000, unit: 'mW', digits: 1 },
    ...(((bu[1] & 1) ? [{ name: 'Overflow', value: 1, unit: 'math overflow flag', digits: 0 }] : []))
  ];
}

export function decodeDs3231(r) {
  const h = r[2];
  const hour = h & 0x40 ? (bcd(h & 0x1f) % 12) + (h & 0x20 ? 12 : 0) : bcd(h & 0x3f);
  return new Date(Date.UTC(2000 + bcd(r[6]) + (r[5] & 0x80 ? 100 : 0), bcd(r[5] & 0x1f) - 1, bcd(r[4] & 0x3f), hour, bcd(r[1] & 0x7f), bcd(r[0] & 0x7f)));
}

export function encodeDs3231(date) {
  return [toBcd(date.getUTCSeconds()), toBcd(date.getUTCMinutes()), toBcd(date.getUTCHours()), date.getUTCDay() + 1, toBcd(date.getUTCDate()), toBcd(date.getUTCMonth() + 1), toBcd(date.getUTCFullYear() % 100)];
}

async function readDs3231(bus, addr) {
  const r = await bus.read(addr, 0x00, 7);
  const t = await bus.read(addr, 0x11, 2);
  const temp = (t[0] > 127 ? t[0] - 256 : t[0]) + (t[1] >> 6) * 0.25;
  return [
    { name: 'Time (UTC as stored)', value: decodeDs3231(r).toISOString().replace('T', ' ').slice(0, 19), unit: '' },
    { name: 'Temperature', value: temp, unit: '°C', digits: 2 }
  ];
}

// ---------------------------------------------------------------------------
// SSD1306 OLED
// ---------------------------------------------------------------------------

export const SSD1306_INIT = [0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40, 0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12, 0x81, 0xcf, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf];

export async function ssd1306Fill(bus, addr, pattern = 'checker') {
  for (let i = 0; i < SSD1306_INIT.length; i += 8) await bus.write(addr, 0x00, SSD1306_INIT.slice(i, i + 8));
  await bus.write(addr, 0x00, [0x21, 0, 127, 0x22, 0, 7]);
  const fb = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const col = i % 128;
    fb[i] = pattern === 'clear' ? 0 : pattern === 'full' ? 0xff : (col >> 3) % 2 ? 0xf0 : 0x0f;
  }
  for (let i = 0; i < fb.length; i += 16) await bus.write(addr, 0x40, Array.from(fb.subarray(i, i + 16)));
  return fb;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export const SENSOR_DRIVERS = {
  bme280: { label: 'BME280 / BMP280', addresses: [0x76, 0x77], read: readBme, probe: async (bus, a) => [0x60, 0x58, 0x56, 0x57].includes((await bus.read(a, 0xd0, 1))[0]) },
  mpu6050: { label: 'MPU-6050 / 6500 / 9250', addresses: [0x68, 0x69], read: readMpu, probe: async (bus, a) => [0x68, 0x70, 0x71, 0x73].includes((await bus.read(a, 0x75, 1))[0]) },
  ds3231: { label: 'DS3231 RTC', addresses: [0x68], read: readDs3231, probe: async (bus, a) => { const r = await bus.read(a, 0x00, 7); return bcd(r[0] & 0x7f) < 60 && bcd(r[1] & 0x7f) < 60 && (r[5] & 0x1f) >= 1 && bcd(r[5] & 0x1f) <= 12; } },
  ads1115: { label: 'ADS1115 ADC', addresses: [0x48, 0x49, 0x4a, 0x4b], read: readAds1115, probe: async (bus, a) => { const r = await bus.read(a, 0x01, 2); return (((r[0] << 8) | r[1]) & 0x01e3) === 0x0183; } }, // single-shot, 128 SPS, comparator off (power-on default or our config)
  ina219: { label: 'INA219 power monitor', addresses: [0x40, 0x41, 0x44, 0x45], read: readIna219, probe: async (bus, a) => { const r = await bus.read(a, 0x00, 2); return ((r[0] << 8) | r[1]) === 0x399f; } },
  ssd1306: { label: 'SSD1306 OLED', addresses: [0x3c, 0x3d], read: null, probe: async () => true }
};

/** The drivers that recognise the device at `addr`, best first. */
export async function detectSensor(bus, addr) {
  for (const [id, d] of Object.entries(SENSOR_DRIVERS)) {
    if (!d.addresses.includes(addr)) continue;
    try { if (await d.probe(bus, addr)) return id; } catch (e) { /* not this one */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simulated sensor bus
// ---------------------------------------------------------------------------

/** Bosch's BMP280 datasheet example: adc_T 519888 -> 25.08 °C, adc_P 415148 -> 100653.27 Pa. */
export const BOSCH_EXAMPLE = {
  calib: [27504, 26435, -1000, 36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000],
  adcT: 519888,
  adcP: 415148
};

