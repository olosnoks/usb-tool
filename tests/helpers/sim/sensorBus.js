// Test-only simulated I2C sensor bus (BME280, MPU-6050, ADS1115, INA219, SSD1306).
// Relocated from src/utils/sensorDrivers.js when sim was removed from the app; a
// fake I2C bus the real sensor drivers read/write against. Not imported by app code.
import { BOSCH_EXAMPLE } from '../../../src/utils/sensorDrivers.js';

export function createSimulatedSensorBus() {
  const regs = {};
  const dev = (a) => (regs[a] = regs[a] || new Uint8Array(256));
  // BME280 at 0x76: Bosch example calibration plus typical humidity trim.
  const bme = dev(0x76);
  bme[0xd0] = 0x60;
  BOSCH_EXAMPLE.calib.forEach((v, i) => { bme[0x88 + i * 2] = v & 0xff; bme[0x89 + i * 2] = (v >> 8) & 0xff; });
  bme[0xa1] = 75;
  bme.set([0x6f, 0x01, 0x00, 0x13, 0x2a, 0x03, 0x1e], 0xe1); // H2=367 H3=0 H4=314 H5=50 H6=30
  const { adcT, adcP } = BOSCH_EXAMPLE;
  bme.set([(adcP >> 12) & 0xff, (adcP >> 4) & 0xff, (adcP & 0xf) << 4, (adcT >> 12) & 0xff, (adcT >> 4) & 0xff, (adcT & 0xf) << 4, 0x6e, 0x40], 0xf7);
  // MPU-6050 at 0x68: flat on a desk.
  const mpu = dev(0x68);
  mpu[0x75] = 0x68; mpu[0x1c] = 0x08; mpu[0x1b] = 0x00;
  // ADS1115 and INA219 have 16-bit registers: register r lives at bytes 2r, 2r+1.
  const WORD = new Set([0x40, 0x48]);
  const setWord = (a, r, v) => { dev(a)[r * 2] = (v >> 8) & 0xff; dev(a)[r * 2 + 1] = v & 0xff; };
  const getWord = (a, r) => (dev(a)[r * 2] << 8) | dev(a)[r * 2 + 1];
  setWord(0x48, 0x01, 0x8583);
  // INA219 at 0x40: 5.0 V bus, 12.3 mV across 0.1 ohm
  setWord(0x40, 0x00, 0x399f);
  setWord(0x40, 0x01, 1230);
  setWord(0x40, 0x02, (1250 << 3) | 2);
  const oled = { frames: 0, fb: new Uint8Array(1024), cursor: 0 };
  let t = 0;
  return {
    oled,
    present: [0x3c, 0x40, 0x48, 0x50, 0x68, 0x76],
    async read(addr, reg, n) {
      if (!this.present.includes(addr)) throw new Error(`No ACK from 0x${addr.toString(16)}`);
      t++;
      if (addr === 0x68 && reg === 0x3b) {
        const noise = () => Math.round(Math.sin(t / 3) * 40);
        const words = [noise(), noise(), 8192 + noise(), (25 - 36.53) * 340, 30 + noise(), -12 + noise(), 5];
        return words.flatMap((w) => [(w >> 8) & 0xff, w & 0xff]).slice(0, n);
      }
      if (addr === 0x48 && reg === 0x00) {
        const ch = (getWord(0x48, 0x01) >> 12) & 3;
        const v = Math.round(([1.65, 3.3, 0.5, 2.5][ch] + Math.sin(t / 5) * 0.01) / 4.096 * 32768);
        return [(v >> 8) & 0xff, v & 0xff];
      }
      if (WORD.has(addr)) return [getWord(addr, reg) >> 8, getWord(addr, reg) & 0xff].slice(0, n);
      return Array.from(dev(addr).subarray(reg, reg + n));
    },
    async write(addr, reg, values) {
      if (!this.present.includes(addr)) throw new Error(`No ACK from 0x${addr.toString(16)}`);
      if (addr === 0x3c) {
        if (reg === 0x40) { values.forEach((v) => { oled.fb[oled.cursor] = v; oled.cursor = (oled.cursor + 1) % 1024; }); }
        else if (values[0] === 0x21) oled.cursor = 0;
        oled.frames++;
        return;
      }
      if (WORD.has(addr)) { setWord(addr, reg, ((values[0] << 8) | values[1]) & (addr === 0x48 && reg === 0x01 ? 0x7fff : 0xffff)); return; }
      dev(addr).set(values, reg);
    }
  };
}
