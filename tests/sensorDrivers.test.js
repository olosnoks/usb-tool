import { describe, it, expect } from 'vitest';
import {
  bmeCompensate, parseBmeCalibration, BOSCH_EXAMPLE, SENSOR_DRIVERS, detectSensor, createSimulatedSensorBus,
  ads1115Config, decodeDs3231, encodeDs3231, ssd1306Fill, SSD1306_INIT
} from '../src/utils/sensorDrivers';
import { BusExplorerClient } from '../src/utils/busExplorerDriver';

const calibBytes = () => {
  const b = new Uint8Array(26);
  BOSCH_EXAMPLE.calib.forEach((v, i) => { b[i * 2] = v & 0xff; b[i * 2 + 1] = (v >> 8) & 0xff; });
  return b;
};

describe('BME280 / BMP280', () => {
  it('matches the Bosch datasheet worked example', () => {
    const cal = parseBmeCalibration(calibBytes());
    expect(cal).toMatchObject({ T1: 27504, T2: 26435, T3: -1000, P1: 36477, P9: 6000 });
    const r = bmeCompensate(cal, BOSCH_EXAMPLE.adcT, BOSCH_EXAMPLE.adcP);
    expect(r.temperature).toBeCloseTo(25.08, 2);
    expect(r.pressure).toBeCloseTo(100653.27, 0);
  });

  it('unpacks the 12-bit humidity trims', () => {
    const cal = parseBmeCalibration(calibBytes(), Uint8Array.from([0x6f, 0x01, 0x00, 0x13, 0x2a, 0x03, 0x1e]));
    expect(cal).toMatchObject({ H2: 367, H3: 0, H4: 314, H5: 50, H6: 30 });
  });

  it('reads temperature, pressure, humidity and altitude from the simulated sensor', async () => {
    const bus = createSimulatedSensorBus();
    const r = await SENSOR_DRIVERS.bme280.read(bus, 0x76);
    const by = Object.fromEntries(r.map((x) => [x.name, x.value]));
    expect(by.Temperature).toBeCloseTo(25.08, 2);
    expect(by.Pressure).toBeCloseTo(1006.53, 1);
    expect(by.Humidity).toBeGreaterThan(0);
    expect(by.Humidity).toBeLessThanOrEqual(100);
    expect(by['Altitude (std)']).toBeGreaterThan(50);
  });
});

describe('other sensors', () => {
  it('scales MPU-6050 accelerometer and temperature', async () => {
    const r = await SENSOR_DRIVERS.mpu6050.read(createSimulatedSensorBus(), 0x68);
    const by = Object.fromEntries(r.map((x) => [x.name, x.value]));
    expect(by['Accel Z']).toBeCloseTo(1, 1);
    expect(by.Temperature).toBeCloseTo(25, 0);
  });

  it('builds ADS1115 single-shot configs and reads four channels', async () => {
    expect(ads1115Config(0)).toBe(0xc383);
    expect(ads1115Config(3)).toBe(0xf383);
    const r = await SENSOR_DRIVERS.ads1115.read(createSimulatedSensorBus(), 0x48);
    expect(r.map((x) => Math.round(x.value * 10) / 10)).toEqual([1.7, 3.3, 0.5, 2.5]);
  });

  it('reads INA219 bus voltage and current', async () => {
    const r = await SENSOR_DRIVERS.ina219.read(createSimulatedSensorBus(), 0x40);
    expect(r[0].value).toBeCloseTo(5.0, 2);
    expect(r[2].value).toBeCloseTo(123, 0);
  });

  it('round-trips DS3231 BCD time, including 12-hour mode', () => {
    const d = new Date(Date.UTC(2026, 9, 31, 23, 59, 58));
    expect(decodeDs3231(encodeDs3231(d)).toISOString()).toBe(d.toISOString());
    expect(decodeDs3231([0x00, 0x30, 0x40 | 0x20 | 0x11, 1, 0x05, 0x06, 0x24]).toISOString()).toBe('2024-06-05T23:30:00.000Z');
  });

  it('detects devices by their ID registers', async () => {
    const bus = createSimulatedSensorBus();
    expect(await detectSensor(bus, 0x76)).toBe('bme280');
    expect(await detectSensor(bus, 0x68)).toBe('mpu6050');
    expect(await detectSensor(bus, 0x48)).toBe('ads1115');
    expect(await detectSensor(bus, 0x40)).toBe('ina219');
    expect(await detectSensor(bus, 0x3c)).toBe('ssd1306');
    expect(await detectSensor(bus, 0x50)).toBeNull();
  });

  it('initialises an SSD1306 and fills its frame buffer', async () => {
    const bus = createSimulatedSensorBus();
    const fb = await ssd1306Fill(bus, 0x3c, 'checker');
    expect(fb[0]).toBe(0x0f);
    expect(fb[8]).toBe(0xf0);
    expect(Array.from(bus.oled.fb.subarray(0, 16))).toEqual(Array.from(fb.subarray(0, 16)));
    expect(SSD1306_INIT[SSD1306_INIT.length - 1]).toBe(0xaf);
  });
});

describe('Bus Explorer client', () => {
  it('reads SPI flash ID and contents in simulation', async () => {
    const c = new BusExplorerClient(() => {});
    c.connectSimulation();
    expect((await c.spiFlashId()).toString(16)).toBe('ef4017');
    const data = await c.spiFlashRead(0, 5000);
    expect(new TextDecoder().decode(data.subarray(0, 27))).toBe('BUS PIRATE SIMULATED W25Q64');
    expect(data[4999]).toBe((4999 * 7) & 0xff);
    const bus = c.sensorBus();
    expect(await detectSensor(bus, 0x76)).toBe('bme280');
  });
});
