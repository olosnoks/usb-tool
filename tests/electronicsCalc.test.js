import { describe, it, expect } from 'vitest';
import {
  parseSI, formatSI, classifyBaudError, uartAvr, uartStm32, uartEsp32, uartGeneric, uartBaudTable,
  eSeriesBase, eSeriesValues, nearestESeries, i2cPullup, solveDivider, dividerPairs, ledResistor,
  decodeResistor, encodeResistor, seriesTotal, parallelTotal, resistorCombos,
  rcTimeConstant, chargeTimeToPercent, lcResonance, rlcSeries, batteryLife,
  traceWidth, traceCurrent, traceTempRise, solveOhm, adcLsb, voltageToCode, codeToVoltage,
  dividerAdcVoltage, dividerFullScaleInput,
} from '../src/utils/electronicsCalc.js';

describe('SI parsing and formatting', () => {
  it('parses prefixes, 4k7 notation, units and exponents', () => {
    expect(parseSI('4.7k')).toBeCloseTo(4700, 6);
    expect(parseSI('4k7')).toBeCloseTo(4700, 6);
    expect(parseSI('2M2')).toBeCloseTo(2.2e6, 3);
    expect(parseSI('100n')).toBeCloseTo(1e-7, 15);
    expect(parseSI('10uF')).toBeCloseTo(1e-5, 15);
    expect(parseSI('2.2 MHz')).toBeCloseTo(2.2e6, 3);
    expect(parseSI('150Ω')).toBe(150);
    expect(parseSI('1e3')).toBe(1000);
    expect(parseSI('3.3')).toBe(3.3);
    expect(Number.isNaN(parseSI('abc'))).toBe(true);
    expect(Number.isNaN(parseSI(''))).toBe(true);
  });

  it('formats with an SI prefix', () => {
    expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSI(0.0000047, 'F')).toBe('4.7 µF');
    expect(formatSI(150, 'Ω')).toBe('150 Ω');
    expect(formatSI(NaN, 'Ω')).toBe('—');
  });
});

describe('UART baud dividers', () => {
  it('classifies errors at the 2% and 3.5% limits', () => {
    expect(classifyBaudError(1.9)).toBe('ok');
    expect(classifyBaudError(-2)).toBe('ok');
    expect(classifyBaudError(3)).toBe('marginal');
    expect(classifyBaudError(-3.5)).toBe('marginal');
    expect(classifyBaudError(3.6)).toBe('bad');
    expect(classifyBaudError(NaN)).toBe('bad');
  });

  it('AVR 16 MHz / 115200 matches the datasheet (UBRR 8, -3.5 %; U2X UBRR 16, +2.1 %)', () => {
    const n = uartAvr({ fosc: 16e6, baud: 115200 });
    expect(n.ubrr).toBe(8);
    expect(n.errorPct).toBeCloseTo(-3.55, 1);
    expect(n.status).toBe('bad');
    const u = uartAvr({ fosc: 16e6, baud: 115200, u2x: true });
    expect(u.ubrr).toBe(16);
    expect(u.errorPct).toBeCloseTo(2.12, 1);
    expect(u.status).toBe('marginal');
  });

  it('AVR 16 MHz / 9600 normal gives UBRR 103 at about +0.2 %', () => {
    const r = uartAvr({ fosc: 16e6, baud: 9600 });
    expect(r.ubrr).toBe(103);
    expect(r.errorPct).toBeCloseTo(0.16, 1);
    expect(r.status).toBe('ok');
  });

  it('AVR rejects UBRR outside 12 bits', () => {
    const r = uartAvr({ fosc: 16e6, baud: 1 });
    expect(r.ok).toBe(false);
  });

  it('STM32 72 MHz / 9600 OVER16 gives BRR 0x1D4C (7500) exactly', () => {
    const r = uartStm32({ fck: 72e6, baud: 9600, oversample: 16 });
    expect(r.brr).toBe(0x1d4c);
    expect(r.mantissa).toBe(468);
    expect(r.fraction).toBe(12);
    expect(r.errorPct).toBeCloseTo(0, 6);
  });

  it('STM32 16 MHz / 115200 gives BRR 0x8B with OVER16 and an equal error with OVER8', () => {
    const r16 = uartStm32({ fck: 16e6, baud: 115200 });
    expect(r16.brr).toBe(0x8b);
    expect(r16.errorPct).toBeCloseTo(-0.08, 1);
    const r8 = uartStm32({ fck: 16e6, baud: 115200, oversample: 8 });
    expect(r8.mantissa).toBe(17);
    expect(r8.fraction).toBe(3);
    expect(r8.brr).toBe(0x113);
    expect(r8.errorPct).toBeCloseTo(r16.errorPct, 2);
  });

  it('ESP32 80 MHz APB at 115200 is within 0.01 %', () => {
    const r = uartEsp32({ clockHz: 80e6, baud: 115200 });
    expect(r.clkdiv).toBe(694);
    expect(r.frag).toBe(7);
    expect(Math.abs(r.errorPct)).toBeLessThan(0.01);
  });

  it('generic divider is exact for a 1.8432 MHz clock at 115200 with 16x sampling', () => {
    const r = uartGeneric({ fclk: 1843200, baud: 115200, oversample: 16 });
    expect(r.divider).toBe(1);
    expect(r.actualBaud).toBeCloseTo(115200, 6);
    expect(r.errorPct).toBeCloseTo(0, 9);
  });

  it('builds a standard-baud table with unreachable cells as null', () => {
    const rows = uartBaudTable({ fcpu: 16e6 });
    expect(rows.length).toBeGreaterThan(5);
    const row9600 = rows.find((r) => r.baud === 9600);
    expect(row9600.avrNormal.status).toBe('ok');
    expect(row9600.stm32).not.toBeNull();
    const row921600 = rows.find((r) => r.baud === 921600);
    expect(row921600.avrNormal.status).toBe('bad');
    const hugeClock = uartBaudTable({ fcpu: 1e9, bauds: [300] })[0];
    expect(hugeClock.avrNormal).toBeNull();
  });
});

describe('E-series', () => {
  it('has the expected sizes and spot values', () => {
    expect(eSeriesBase('E6')).toHaveLength(6);
    expect(eSeriesBase('E12')).toHaveLength(12);
    expect(eSeriesBase('E24')).toHaveLength(24);
    expect(eSeriesBase('E48')).toHaveLength(48);
    expect(eSeriesBase('E96')).toHaveLength(96);
    expect(eSeriesBase('E192')).toHaveLength(192);
    const e96 = eSeriesBase('E96');
    expect(e96[0]).toBe(1);
    expect(e96[1]).toBe(1.02);
    expect(e96).toContain(4.99);
    expect(e96[95]).toBe(9.76);
  });

  it('finds the nearest value and direction-specific neighbours', () => {
    expect(nearestESeries(4000, 'E24').value).toBe(3900);
    expect(nearestESeries(4000, 'E24', 'up').value).toBe(4300);
    expect(nearestESeries(4000, 'E24', 'down').value).toBe(3900);
    expect(nearestESeries(4700, 'E12').errorPct).toBeCloseTo(0, 9);
    expect(nearestESeries(150, 'E24', 'up').value).toBe(150);
    expect(eSeriesValues('E24')).toContain(1000);
  });
});

describe('I2C pull-up (UM10204)', () => {
  it('computes the 3.3 V / 100 pF / 400 kHz window and picks 1.8 k', () => {
    const r = i2cPullup({ vdd: 3.3, cb: 100e-12, mode: '400k' });
    expect(r.rpMin).toBeCloseTo(966.67, 1);
    expect(r.rpMax).toBeCloseTo(3540.9, 0);
    expect(r.feasible).toBe(true);
    expect(r.recommended).toBe(1800);
    expect(r.warnings).toEqual([]);
  });

  it('standard mode allows a slower edge, so Rp max is larger than fast mode', () => {
    const std = i2cPullup({ vdd: 3.3, cb: 400e-12, mode: '100k' });
    expect(std.rpMax).toBeCloseTo(1000e-9 / (0.8473 * 400e-12), 3);
    expect(std.feasible).toBe(true);
  });

  it('warns when Cb exceeds the bus limit and when no pull-up fits', () => {
    const over = i2cPullup({ vdd: 3.3, cb: 500e-12, mode: '400k' });
    expect(over.warnings.some((w) => w.includes('bus limit'))).toBe(true);
    const bad = i2cPullup({ vdd: 3.3, cb: 2000e-12, mode: '1M' });
    expect(bad.feasible).toBe(false);
    expect(bad.recommended).toBeNull();
  });
});

describe('resistors', () => {
  it('solves each unknown of a voltage divider', () => {
    expect(solveDivider({ r1: 10e3, r2: 10e3, vin: 5 }).vout).toBeCloseTo(2.5, 9);
    expect(solveDivider({ vin: 12, r2: 1e3, vout: 3 }).r1).toBeCloseTo(3e3, 6);
    expect(solveDivider({ vin: 12, r1: 3e3, vout: 3 }).r2).toBeCloseTo(1e3, 6);
    expect(solveDivider({ r1: 10e3, r2: 10e3, vout: 2.5 }).vin).toBeCloseTo(5, 9);
  });

  it('rejects bad divider input', () => {
    expect(() => solveDivider({ vin: 5, r1: 1e3 })).toThrow();
    expect(() => solveDivider({ vin: 3, r1: 1e3, r2: 1e3, vout: 4 })).toThrow();
    expect(() => solveDivider({ vin: 5, r1: -1, r2: 1e3, vout: 2 })).toThrow();
  });

  it('finds E24 divider pairs closest to the target ratio', () => {
    const pairs = dividerPairs({ vin: 5, vout: 3.3, series: 'E24', count: 5 });
    expect(pairs).toHaveLength(5);
    expect(Math.abs(pairs[0].errorPct)).toBeLessThan(0.5);
    for (let i = 1; i < pairs.length; i++) {
      expect(Math.abs(pairs[i].errorPct)).toBeGreaterThanOrEqual(Math.abs(pairs[i - 1].errorPct));
    }
  });

  it('sizes an LED resistor and its power (5 V, 2 V LED, 20 mA)', () => {
    const r = ledResistor({ vs: 5, vf: 2, currentA: 0.02 });
    expect(r.rIdeal).toBeCloseTo(150, 9);
    expect(r.rStd).toBe(150);
    expect(r.power).toBeCloseTo(0.06, 9);
    expect(r.recommendedWatt).toBe(0.125);
  });

  it('rounds the LED resistor up to a standard value so current does not exceed target', () => {
    const r = ledResistor({ vs: 5, vf: 2, currentA: 0.009 });
    expect(r.rIdeal).toBeCloseTo(333.33, 1);
    expect(r.rStd).toBe(360);
    expect(r.iActual).toBeLessThanOrEqual(0.009);
  });

  it('decodes 4, 5 and 6 band codes', () => {
    expect(decodeResistor(['yellow', 'violet', 'red', 'gold']).ohms).toBe(4700);
    expect(decodeResistor(['yellow', 'violet', 'red', 'gold']).tolerancePct).toBe(5);
    expect(decodeResistor(['brown', 'black', 'red', 'gold']).ohms).toBe(1000);
    expect(decodeResistor(['brown', 'black', 'black', 'red', 'brown']).ohms).toBe(10000);
    expect(decodeResistor(['brown', 'black', 'black', 'red', 'brown']).tolerancePct).toBe(1);
    const six = decodeResistor(['brown', 'black', 'black', 'red', 'brown', 'red']);
    expect(six.ohms).toBe(10000);
    expect(six.tempco).toBe(50);
    expect(decodeResistor(['yellow', 'violet', 'gold', 'gold']).ohms).toBeCloseTo(4.7, 9);
    expect(() => decodeResistor(['purple', 'red', 'red', 'gold'])).toThrow();
    expect(() => decodeResistor(['red', 'red', 'red'])).toThrow();
  });

  it('encodes values into bands and round-trips through decode', () => {
    const e4 = encodeResistor({ ohms: 4700, bands: 4, tolerancePct: 5 });
    expect(e4.bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(e4.exact).toBe(true);
    expect(encodeResistor({ ohms: 4.7, bands: 4 }).bands).toEqual(['yellow', 'violet', 'gold', 'gold']);
    const e5 = encodeResistor({ ohms: 10000, bands: 5, tolerancePct: 1 });
    expect(e5.bands).toEqual(['brown', 'black', 'black', 'red', 'brown']);
    expect(decodeResistor(e5.bands).ohms).toBe(10000);
    expect(encodeResistor({ ohms: 1230, bands: 5 }).exact).toBe(true);
    expect(encodeResistor({ ohms: 1234, bands: 5 }).exact).toBe(false);
    expect(encodeResistor({ ohms: 1234, bands: 5 }).exactValue).toBe(1230);
    expect(() => encodeResistor({ ohms: 0 })).toThrow();
  });

  it('computes series and parallel totals', () => {
    expect(seriesTotal([100, 200])).toBe(300);
    expect(parallelTotal([100, 100])).toBeCloseTo(50, 9);
    expect(parallelTotal([1e3, 1e3, 1e3])).toBeCloseTo(333.333, 2);
  });

  it('finds E24 combinations, preferring an exact single value', () => {
    const top = resistorCombos({ target: 330, series: 'E24', count: 5 });
    expect(top[0].parts).toEqual([330]);
    expect(top[0].errorPct).toBeCloseTo(0, 9);
    const combos = resistorCombos({ target: 1000, series: 'E12', count: 3 });
    expect(combos.length).toBe(3);
  });
});

describe('RC / RLC', () => {
  it('RC 1 k / 1 uF: tau = 1 ms, fc = 159.15 Hz', () => {
    const r = rcTimeConstant({ r: 1e3, c: 1e-6 });
    expect(r.tau).toBeCloseTo(1e-3, 12);
    expect(r.fc).toBeCloseTo(159.155, 2);
    expect(r.t5).toBeCloseTo(5e-3, 12);
  });

  it('charge reaches 63.2 % at one tau and 99.3 % at about 4.96 tau', () => {
    expect(chargeTimeToPercent({ r: 1e3, c: 1e-6, percent: 63.2121 })).toBeCloseTo(1e-3, 6);
    expect(chargeTimeToPercent({ r: 1e3, c: 1e-6, percent: 99.3 }) / 1e-3).toBeCloseTo(4.9618, 3);
    expect(() => chargeTimeToPercent({ r: 1, c: 1, percent: 100 })).toThrow();
  });

  it('LC resonance: 1 mH and 1 uF give 5.03 kHz', () => {
    const r = lcResonance({ l: 1e-3, c: 1e-6 });
    expect(r.f0).toBeCloseTo(5032.92, 1);
    expect(r.z0).toBeCloseTo(31.62, 1);
  });

  it('series RLC damping classification', () => {
    const under = rlcSeries({ r: 10, l: 1e-3, c: 1e-6 });
    expect(under.kind).toBe('underdamped');
    expect(under.zeta).toBeCloseTo(0.158, 3);
    expect(under.fd).toBeCloseTo(4969.9, 0);
    const over = rlcSeries({ r: 200, l: 1e-3, c: 1e-6 });
    expect(over.kind).toBe('overdamped');
    expect(over.fd).toBeNull();
  });
});

describe('battery life', () => {
  it('1000 mAh, 20 mA active at 10 % duty gives 500 h, 400 h with 20 % derating', () => {
    const r = batteryLife({ capacityMah: 1000, activeA: 0.02, sleepA: 0, dutyPct: 10 });
    expect(r.avgA).toBeCloseTo(0.002, 12);
    expect(r.hours).toBeCloseTo(500, 6);
    const d = batteryLife({ capacityMah: 1000, activeA: 0.02, sleepA: 0, dutyPct: 10, deratePct: 20 });
    expect(d.hours).toBeCloseTo(400, 6);
    expect(d.days).toBeCloseTo(400 / 24, 6);
  });

  it('includes sleep current in the average', () => {
    const r = batteryLife({ capacityMah: 1000, activeA: 0.02, sleepA: 10e-6, dutyPct: 0 });
    expect(r.hours).toBeCloseTo(1000 / 0.01, 3);
  });

  it('rejects impossible inputs', () => {
    expect(() => batteryLife({ capacityMah: 0, activeA: 0.01, dutyPct: 10 })).toThrow();
    expect(() => batteryLife({ capacityMah: 100, activeA: 0.01, dutyPct: 120 })).toThrow();
  });
});

describe('PCB trace width (IPC-2221)', () => {
  it('1 A, 10 C rise, 1 oz external: about 11.9 mil (0.30 mm)', () => {
    const r = traceWidth({ currentA: 1, tempRiseC: 10, copperOz: 1, layer: 'external' });
    expect(r.areaMil2).toBeCloseTo(16.29, 1);
    expect(r.widthMil).toBeCloseTo(11.9, 1);
    expect(r.widthMm).toBeCloseTo(0.302, 2);
  });

  it('internal layers need about 2.6x the area of external', () => {
    const ext = traceWidth({ currentA: 1, tempRiseC: 10, copperOz: 1, layer: 'external' });
    const int = traceWidth({ currentA: 1, tempRiseC: 10, copperOz: 1, layer: 'internal' });
    expect(int.areaMil2 / ext.areaMil2).toBeCloseTo(2 ** (1 / 0.725), 3);
  });

  it('current, width and temperature rise round-trip', () => {
    const w = traceWidth({ currentA: 2.5, tempRiseC: 20, copperOz: 2, layer: 'external' });
    expect(traceCurrent({ widthMm: w.widthMm, tempRiseC: 20, copperOz: 2 })).toBeCloseTo(2.5, 6);
    expect(traceTempRise({ currentA: 2.5, widthMm: w.widthMm, copperOz: 2 })).toBeCloseTo(20, 6);
  });
});

describe("Ohm's law and power", () => {
  it('solves every two-of-four combination', () => {
    const cases = [
      [{ V: 12, I: 2 }, { V: 12, I: 2, R: 6, P: 24 }],
      [{ V: 12, R: 6 }, { V: 12, I: 2, R: 6, P: 24 }],
      [{ V: 5, P: 10 }, { V: 5, I: 2, R: 2.5, P: 10 }],
      [{ I: 2, R: 6 }, { V: 12, I: 2, R: 6, P: 24 }],
      [{ I: 2, P: 24 }, { V: 12, I: 2, R: 6, P: 24 }],
      [{ R: 6, P: 24 }, { V: 12, I: 2, R: 6, P: 24 }],
    ];
    for (const [input, expected] of cases) {
      const r = solveOhm(input);
      for (const k of ['V', 'I', 'R', 'P']) expect(r[k]).toBeCloseTo(expected[k], 9);
    }
  });

  it('needs exactly two inputs', () => {
    expect(() => solveOhm({ V: 12 })).toThrow();
    expect(() => solveOhm({ V: 12, I: 2, R: 6 })).toThrow();
  });
});

describe('ADC', () => {
  it('12-bit, 3.3 V: LSB = 805.66 uV, full-scale code 4095', () => {
    const r = adcLsb({ bits: 12, vref: 3.3 });
    expect(r.lsb).toBeCloseTo(3.3 / 4096, 12);
    expect(r.maxCode).toBe(4095);
  });

  it('maps voltage to code and back', () => {
    expect(voltageToCode({ voltage: 1.65, bits: 12, vref: 3.3 }).code).toBe(2048);
    const clipped = voltageToCode({ voltage: 5, bits: 12, vref: 3.3 });
    expect(clipped.code).toBe(4095);
    expect(clipped.clipped).toBe(true);
    expect(codeToVoltage({ code: 2048, bits: 12, vref: 3.3 })).toBeCloseTo(1.65, 9);
    expect(codeToVoltage({ code: 2048, bits: 12, vref: 3.3, centre: true })).toBeCloseTo(1.65 + (3.3 / 4096) / 2, 9);
    expect(() => codeToVoltage({ code: 4096, bits: 12, vref: 3.3 })).toThrow();
  });

  it('scales an input through a divider (10k/10k: 12 V in gives 6 V at the pin, 6.6 V full scale)', () => {
    expect(dividerAdcVoltage({ vin: 12, r1: 10e3, r2: 10e3 })).toBeCloseTo(6, 9);
    expect(dividerFullScaleInput({ vref: 3.3, r1: 10e3, r2: 10e3 })).toBeCloseTo(6.6, 9);
  });
});

import {
  timer555Astable, timer555Monostable, timer555Design, regulatorVout, regulatorRtop, regulatorPairs,
  capReactance, indReactance, seriesImpedance, dividerTolerance, REGULATOR_PRESETS,
} from '../src/utils/electronicsCalc.js';

describe('555 timer', () => {
  it('astable 1k/10k/100n is about 686 Hz at 52.4 % duty', () => {
    const r = timer555Astable({ r1: 1e3, r2: 10e3, c: 100e-9 });
    expect(r.freq).toBeCloseTo(1 / (Math.LN2 * 21e3 * 100e-9), 6);
    expect(r.freq).toBeGreaterThan(680);
    expect(r.freq).toBeLessThan(690);
    expect(r.dutyPct).toBeCloseTo((11 / 21) * 100, 6);
  });
  it('monostable is ln3 RC', () => {
    expect(timer555Monostable({ r: 100e3, c: 10e-6 }).width).toBeCloseTo(1.0986, 3);
  });
  it('design round-trips and rejects duty <= 50', () => {
    const d = timer555Design({ freq: 1000, c: 100e-9, dutyPct: 60 });
    expect(timer555Astable({ r1: d.r1, r2: d.r2, c: 100e-9 }).freq).toBeCloseTo(1000, 6);
    expect(d.actual.freq / 1000).toBeGreaterThan(0.9);
    expect(d.actual.freq / 1000).toBeLessThan(1.1);
    expect(() => timer555Design({ freq: 1000, c: 1e-7, dutyPct: 50 })).toThrow();
    expect(() => timer555Astable({ r1: 0, r2: 1, c: 1 })).toThrow();
  });
});

describe('regulator feedback', () => {
  it('LM317 240/720 style gives 5 V with Iadj ignored', () => {
    expect(regulatorVout({ vref: 1.25, rtop: 720, rbot: 240 })).toBeCloseTo(5, 6);
  });
  it('adds the adjust-pin current term', () => {
    expect(regulatorVout({ vref: 1.25, rtop: 720, rbot: 240, iadj: 50e-6 })).toBeCloseTo(5.036, 6);
  });
  it('regulatorRtop inverts regulatorVout', () => {
    const rtop = regulatorRtop({ vref: 0.8, vout: 3.3, rbot: 10e3, iadj: 0 });
    expect(regulatorVout({ vref: 0.8, rtop, rbot: 10e3 })).toBeCloseTo(3.3, 9);
  });
  it('E96 pairs land within 1 % of the target', () => {
    const list = regulatorPairs({ vref: REGULATOR_PRESETS.fb08.vref, vout: 3.3, iadj: 0 });
    expect(list.length).toBe(6);
    expect(Math.abs(list[0].errorPct)).toBeLessThan(1);
    expect(() => regulatorPairs({ vref: 1.25, vout: 1, iadj: 0 })).toThrow();
  });
});

describe('reactance and tolerance', () => {
  it('reactances at 1 kHz', () => {
    expect(capReactance({ f: 1000, c: 1e-6 })).toBeCloseTo(159.155, 2);
    expect(indReactance({ f: 1000, l: 1e-3 })).toBeCloseTo(6.2832, 3);
  });
  it('series impedance magnitude and phase', () => {
    const z = seriesImpedance({ r: 100, x: -100 });
    expect(z.mag).toBeCloseTo(141.42, 2);
    expect(z.phaseDeg).toBeCloseTo(-45, 6);
  });
  it('divider worst case brackets nominal', () => {
    const t = dividerTolerance({ vin: 5, r1: 10e3, r2: 10e3, tolPct: 1 });
    expect(t.nominal).toBeCloseTo(2.5, 9);
    expect(t.min).toBeLessThan(2.5);
    expect(t.max).toBeGreaterThan(2.5);
    expect(t.max).toBeCloseTo(2.5 * 1.01 / 1, 1);
    expect(dividerTolerance({ vin: 5, r1: 1, r2: 1, tolPct: 0 }).min).toBeCloseTo(2.5, 9);
  });
});
