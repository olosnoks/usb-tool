/**
 * Electronics calculators — pure, offline formulas (no React, no hardware).
 *
 * Sections: SI value parsing/formatting, UART baud dividers (AVR, STM32, ESP32, generic),
 * I2C pull-up sizing (NXP UM10204), resistor tools (voltage divider, LED resistor, colour
 * code, E-series, series/parallel), RC/RLC, battery life, IPC-2221 trace width and Ohm's
 * law, and ADC LSB / code conversion.
 *
 * All functions take base SI units (ohms, farads, henries, hertz, volts, amps, seconds)
 * unless the parameter name says otherwise (e.g. capacityMah, widthMm, tempRiseC).
 */

// ---------------------------------------------------------------------------
// SI values
// ---------------------------------------------------------------------------

const SI_SCALE = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, R: 1, r: 1 };

/**
 * Parse a user-typed value into a base-unit number. Accepts "4.7k", "4k7", "100n", "10uF",
 * "1e3", "2.2 MHz", "3.3", "150 Ω". Returns NaN when it cannot read a number.
 */
export function parseSI(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const s = String(input ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  // 4k7 / 4R7 / 2M2 notation (the prefix sits where the decimal point would be)
  const mid = s.match(/^(\d+)([pnuµmkKMGRr])(\d+)$/);
  if (mid) return Number(`${mid[1]}.${mid[3]}`) * SI_SCALE[mid[2]];
  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuµmkKMGRr]?)[A-Za-zΩΩ%°]*$/);
  if (!m) return NaN;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return NaN;
  return v * (m[2] ? SI_SCALE[m[2]] : 1);
}

const FORMAT_PREFIXES = [['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12]];

/** Format a base-unit number with an SI prefix, 4 significant figures, e.g. 4700 -> "4.7 k". */
export function formatSI(x, unit = '') {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return `0 ${unit}`.trim();
  const a = Math.abs(x);
  for (const [prefix, scale] of FORMAT_PREFIXES) {
    if (a >= scale * 0.9999995) {
      return `${Number((x / scale).toPrecision(4))} ${prefix}${unit}`.trim();
    }
  }
  return `${x.toExponential(3)} ${unit}`.trim();
}

/** Human duration from seconds: "1.23 ms", "4.5 s", "3.2 h", "17 d". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 1e-3) return formatSI(seconds, 's');
  if (seconds < 1) return `${Number((seconds * 1e3).toPrecision(4))} ms`;
  if (seconds < 120) return `${Number(seconds.toPrecision(4))} s`;
  if (seconds < 7200) return `${Number((seconds / 60).toPrecision(4))} min`;
  if (seconds < 2 * 86400) return `${Number((seconds / 3600).toPrecision(4))} h`;
  return `${Number((seconds / 86400).toPrecision(4))} d`;
}

// ---------------------------------------------------------------------------
// UART baud dividers
// ---------------------------------------------------------------------------

export const STD_BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/** Colour bucket for a baud error: |err| <= 2% ok, <= 3.5% marginal, else bad. */
export function classifyBaudError(errorPct) {
  if (!Number.isFinite(errorPct)) return 'bad';
  const a = Math.abs(errorPct);
  if (a <= 2) return 'ok';
  if (a <= 3.5) return 'marginal';
  return 'bad';
}

function baudResult({ clockHz, divider, factor, target, extra = {} }) {
  const actualBaud = clockHz / (factor * divider);
  const errorPct = ((actualBaud - target) / target) * 100;
  return { actualBaud, errorPct, status: classifyBaudError(errorPct), ...extra };
}

/**
 * AVR USART (megaAVR/tinyAVR style): UBRR = fosc/(16*baud) - 1 (normal), fosc/(8*baud) - 1 (U2X).
 * UBRR is a 12-bit register, so the valid range is 0..4095.
 */
export function uartAvr({ fosc, baud, u2x = false }) {
  const factor = u2x ? 8 : 16;
  const ubrr = Math.round(fosc / (factor * baud) - 1);
  if (!(ubrr >= 0 && ubrr <= 4095)) {
    return { ok: false, reason: `UBRR ${ubrr} is outside 0..4095`, ubrr, status: 'bad', errorPct: NaN, actualBaud: NaN };
  }
  const r = baudResult({ clockHz: fosc, divider: ubrr + 1, factor, target: baud, extra: { ubrr } });
  return { ok: true, ...r };
}

/**
 * STM32 USART baud generator. USARTDIV = fck / (oversample * baud). The BRR register holds
 * mantissa in bits 15:4 and the fraction in bits 3:0 (OVER8=0, fraction in 1/16) or bits 2:0
 * (OVER8=1, fraction in 1/8, bit 3 must stay clear). Either way BRR = (mantissa << 4) | fraction.
 */
export function uartStm32({ fck, baud, oversample = 16 }) {
  const os = oversample === 8 ? 8 : 16;
  const d = fck / (os * baud);
  let mantissa = Math.floor(d);
  let fraction = Math.round((d - mantissa) * os);
  if (fraction === os) { mantissa += 1; fraction = 0; }
  const brr = mantissa * 16 + fraction;
  if (mantissa < 1 || brr > 0xffff) {
    return { ok: false, reason: 'USARTDIV out of range (needs mantissa 1..4095)', brr, status: 'bad', errorPct: NaN, actualBaud: NaN };
  }
  const r = baudResult({ clockHz: fck, divider: mantissa + fraction / os, factor: os, target: baud, extra: { brr, mantissa, fraction, oversample: os } });
  return { ok: true, ...r };
}

/**
 * ESP32 UART (APB clock, default 80 MHz). Divider = clk / baud with a 4-bit fraction:
 * baud = clk / (CLKDIV + FRAG/16). The integer part is 20 bits wide.
 */
export function uartEsp32({ clockHz = 80e6, baud }) {
  const d = clockHz / baud;
  let intPart = Math.floor(d);
  let frag = Math.round((d - intPart) * 16);
  if (frag === 16) { intPart += 1; frag = 0; }
  if (intPart < 1 || intPart > 0xfffff) {
    return { ok: false, reason: 'CLKDIV outside 1..0xFFFFF', status: 'bad', errorPct: NaN, actualBaud: NaN };
  }
  const r = baudResult({ clockHz, divider: intPart + frag / 16, factor: 1, target: baud, extra: { clkdiv: intPart, frag } });
  return { ok: true, ...r };
}

/** Generic integer divider: divider = round(fclk / (oversample * baud)). */
export function uartGeneric({ fclk, baud, oversample = 16 }) {
  const divider = Math.round(fclk / (oversample * baud));
  if (divider < 1) return { ok: false, reason: 'divider < 1', status: 'bad', errorPct: NaN, actualBaud: NaN };
  const r = baudResult({ clockHz: fclk, divider, factor: oversample, target: baud, extra: { divider } });
  return { ok: true, ...r };
}

/** Rows of standard bauds with every supported method side by side (null cell = not reachable). */
export function uartBaudTable({ fcpu, esp32Clock = 80e6, bauds = STD_BAUDS }) {
  return bauds.map((baud) => {
    const cell = (r) => (r.ok ? { errorPct: r.errorPct, status: r.status } : null);
    return {
      baud,
      avrNormal: cell(uartAvr({ fosc: fcpu, baud })),
      avrU2x: cell(uartAvr({ fosc: fcpu, baud, u2x: true })),
      stm32: cell(uartStm32({ fck: fcpu, baud })),
      esp32: cell(uartEsp32({ clockHz: esp32Clock, baud })),
    };
  });
}

// ---------------------------------------------------------------------------
// E-series
// ---------------------------------------------------------------------------

const E_BASE = {
  E6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  E24: [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1],
};

// E48/E96/E192 follow the IEC 60063 geometric rule: 10^(i/N) rounded to 3 significant figures.
// (E96 spot checks in the tests: 1.00, 1.02, 4.99, 9.76.)
function generatedSeries(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = Number((10 ** (i / n)).toPrecision(3));
    if (v < 10) out.push(v);
  }
  return out;
}

export const E_SERIES_NAMES = ['E6', 'E12', 'E24', 'E48', 'E96', 'E192'];

/** Base mantissas of a series, 1 <= v < 10. */
export function eSeriesBase(name) {
  switch (name) {
    case 'E6': case 'E12': case 'E24': return E_BASE[name];
    case 'E48': return generatedSeries(48);
    case 'E96': return generatedSeries(96);
    case 'E192': return generatedSeries(192);
    default: throw new Error(`Unknown series ${name}`);
  }
}

const valueCache = new Map();
/** Sorted list of every value in a series across decades 1e-3 .. 1e8 ohm/farad/etc. */
export function eSeriesValues(name = 'E24', { minDecade = -3, maxDecade = 8 } = {}) {
  const key = `${name}:${minDecade}:${maxDecade}`;
  if (valueCache.has(key)) return valueCache.get(key);
  const base = eSeriesBase(name);
  const out = [];
  for (let k = minDecade; k <= maxDecade; k++) {
    for (const b of base) out.push(Number((b * 10 ** k).toPrecision(6)));
  }
  out.sort((a, b) => a - b);
  valueCache.set(key, out);
  return out;
}

/** Index of the first element >= x in a sorted array. */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Nearest standard value to x (smallest relative error).
 * mode 'nearest' | 'up' (smallest standard value >= x) | 'down' (largest <= x).
 */
export function nearestESeries(x, name = 'E24', mode = 'nearest') {
  if (!(x > 0) || !Number.isFinite(x)) return null;
  const vals = eSeriesValues(name);
  const i = lowerBound(vals, x);
  let v;
  if (mode === 'up') v = vals[i] ?? null;
  else if (mode === 'down') v = vals[i] === x ? vals[i] : (vals[i - 1] ?? null);
  else {
    const cands = [vals[i - 1], vals[i]].filter((c) => c !== undefined);
    v = cands.reduce((best, c) => (Math.abs(c / x - 1) < Math.abs(best / x - 1) ? c : best));
  }
  if (v == null) return null;
  return { value: v, errorPct: ((v - x) / x) * 100 };
}

// ---------------------------------------------------------------------------
// I2C pull-up resistors (NXP UM10204)
// ---------------------------------------------------------------------------

export const I2C_MODES = {
  '100k': { label: 'Standard mode (100 kHz)', tr: 1000e-9, cbMax: 400e-12, iol: 3e-3, vol: 0.4 },
  '400k': { label: 'Fast mode (400 kHz)', tr: 300e-9, cbMax: 400e-12, iol: 3e-3, vol: 0.4 },
  '1M': { label: 'Fast-mode Plus (1 MHz)', tr: 120e-9, cbMax: 550e-12, iol: 20e-3, vol: 0.4 },
};

/**
 * Pull-up window. Rp min = (Vdd - VOL) / IOL keeps the sink current within spec.
 * Rp max = tr / (0.8473 * Cb) keeps the 30%->70% rise time within tr.
 * The recommended value is the E-series value inside the window nearest its geometric mean.
 */
export function i2cPullup({ vdd, cb, mode = '400k', series = 'E24', vol, iol }) {
  const m = I2C_MODES[mode];
  if (!m) throw new Error(`Unknown I2C mode ${mode}`);
  const v = vol ?? m.vol;
  const i = iol ?? m.iol;
  const rpMin = (vdd - v) / i;
  const rpMax = m.tr / (0.8473 * cb);
  const feasible = Number.isFinite(rpMin) && Number.isFinite(rpMax) && rpMin <= rpMax;
  const warnings = [];
  if (cb > m.cbMax) warnings.push(`Cb ${formatSI(cb, 'F')} is above the ${formatSI(m.cbMax, 'F')} bus limit for ${mode}.`);
  if (!feasible) warnings.push('No pull-up satisfies both limits: lower Cb, use a stronger driver, or a lower Vdd.');
  let recommended = null;
  if (feasible) {
    const geo = Math.sqrt(rpMin * rpMax);
    const cands = eSeriesValues(series, { minDecade: 0, maxDecade: 6 }).filter((r) => r >= rpMin && r <= rpMax);
    if (cands.length) {
      recommended = cands.reduce((best, c) => (Math.abs(Math.log(c / geo)) < Math.abs(Math.log(best / geo)) ? c : best));
    } else {
      warnings.push(`No ${series} value falls inside the window; pick any resistor between the limits.`);
    }
  }
  return { rpMin, rpMax, feasible, recommended, warnings, mode, vol: v, iol: i, tr: m.tr, cbMax: m.cbMax };
}

// ---------------------------------------------------------------------------
// Resistors
// ---------------------------------------------------------------------------

/**
 * Voltage divider Vout = Vin * R2 / (R1 + R2), R1 on top, R2 to ground.
 * Give exactly three of { vin, r1, r2, vout }; the fourth is solved.
 */
export function solveDivider({ vin = null, r1 = null, r2 = null, vout = null }) {
  const given = { vin, r1, r2, vout };
  const known = Object.entries(given).filter(([, x]) => x !== null && x !== undefined && x !== '');
  if (known.length !== 3) throw new Error('Give exactly three of Vin, R1, R2, Vout.');
  for (const [k, x] of known) {
    if (!Number.isFinite(x) || x <= 0) throw new Error(`${k} must be a positive number.`);
  }
  let V = vin, A = r1, B = r2, O = vout;
  if (V == null) V = O * (A + B) / B;
  else if (A == null) {
    if (O >= V) throw new Error('Vout must be lower than Vin.');
    A = B * (V / O - 1);
  } else if (B == null) {
    if (O >= V) throw new Error('Vout must be lower than Vin.');
    B = A * O / (V - O);
  } else O = V * B / (A + B);
  return { vin: V, r1: A, r2: B, vout: O, ratio: O / V };
}

/**
 * Best E-series (R1, R2) pairs for a target ratio. For every standard R2 the ideal R1 is
 * solved and the two nearest standard R1 values are tried. Returns the best `count` pairs.
 */
export function dividerPairs({ vin, vout, series = 'E24', count = 8, rMin = 10, rMax = 1e6 }) {
  if (!(vin > vout && vout > 0)) throw new Error('Need Vin > Vout > 0.');
  const ratioR = vin / vout - 1; // R1 / R2
  const vals = eSeriesValues(series, { minDecade: 0, maxDecade: 6 }).filter((r) => r >= rMin && r <= rMax);
  const seen = new Set();
  const out = [];
  for (const r2 of vals) {
    const ideal = r2 * ratioR;
    const i = lowerBound(vals, ideal);
    for (const r1 of [vals[i - 1], vals[i], vals[i + 1]]) {
      if (r1 === undefined) continue;
      const key = `${r1}/${r2}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const vo = vin * r2 / (r1 + r2);
      out.push({ r1, r2, vout: vo, errorPct: ((vo - vout) / vout) * 100 });
    }
  }
  out.sort((a, b) => Math.abs(a.errorPct) - Math.abs(b.errorPct) || (a.r1 + a.r2) - (b.r1 + b.r2));
  return out.slice(0, count);
}

export const STD_WATTS = [0.125, 0.25, 0.5, 1, 2, 5];

/**
 * LED series resistor. R = (Vs - Vf) / I, rounded UP to the next standard value so the
 * current never exceeds the target. Power is I^2 R for the chosen value.
 */
export function ledResistor({ vs, vf, currentA, series = 'E24' }) {
  if (!(vs > vf && vf >= 0 && currentA > 0)) throw new Error('Need Vs > Vf >= 0 and current > 0.');
  const rIdeal = (vs - vf) / currentA;
  const std = nearestESeries(rIdeal, series, 'up');
  const rStd = std.value;
  const iActual = (vs - vf) / rStd;
  const power = iActual * iActual * rStd;
  const rating = STD_WATTS.find((w) => w >= 2 * power) ?? null;
  return { rIdeal, rStd, iActual, power, recommendedWatt: rating, minWatt: power };
}

const COLOURS = [
  { name: 'black', digit: 0, mult: 0, tol: null, tempco: 250 },
  { name: 'brown', digit: 1, mult: 1, tol: 1, tempco: 100 },
  { name: 'red', digit: 2, mult: 2, tol: 2, tempco: 50 },
  { name: 'orange', digit: 3, mult: 3, tol: null, tempco: 15 },
  { name: 'yellow', digit: 4, mult: 4, tol: null, tempco: 25 },
  { name: 'green', digit: 5, mult: 5, tol: 0.5, tempco: null },
  { name: 'blue', digit: 6, mult: 6, tol: 0.25, tempco: 10 },
  { name: 'violet', digit: 7, mult: 7, tol: 0.1, tempco: 5 },
  { name: 'grey', digit: 8, mult: 8, tol: 0.05, tempco: null },
  { name: 'white', digit: 9, mult: 9, tol: null, tempco: null },
  { name: 'gold', digit: null, mult: -1, tol: 5, tempco: null },
  { name: 'silver', digit: null, mult: -2, tol: 10, tempco: null },
];
const COLOUR_BY_NAME = Object.fromEntries(COLOURS.map((c) => [c.name, c]));
export const RESISTOR_COLOURS = COLOURS.map((c) => c.name);

/**
 * Decode resistor bands (array of colour names, left to right as printed).
 * 4 bands: d d x tol. 5 bands: d d d x tol. 6 bands: d d d x tol tempco.
 */
export function decodeResistor(bands) {
  const n = bands.length;
  if (![4, 5, 6].includes(n)) throw new Error('Resistor must have 4, 5 or 6 bands.');
  const cs = bands.map((b) => {
    const c = COLOUR_BY_NAME[String(b).toLowerCase()];
    if (!c) throw new Error(`Unknown colour "${b}".`);
    return c;
  });
  const digitCount = n === 4 ? 2 : 3;
  const digits = cs.slice(0, digitCount);
  if (digits.some((c) => c.digit === null)) throw new Error('Gold and silver are not valid digit bands.');
  const multC = cs[digitCount];
  const tolC = cs[digitCount + 1];
  const tcC = n === 6 ? cs[5] : null;
  const digitStr = digits.map((c) => c.digit).join('');
  const ohms = Number(digitStr) * 10 ** multC.mult;
  return {
    ohms,
    tolerancePct: tolC.tol ?? 20,
    tempco: tcC ? tcC.tempco : null,
    text: formatSI(ohms, 'Ω'),
  };
}

/**
 * Encode a resistance into bands. Returns the bands and the exact value they represent;
 * `exact` is false when the value needed rounding to the band resolution.
 */
export function encodeResistor({ ohms, bands = 4, tolerancePct = 5, tempco = 100 }) {
  if (!(ohms > 0) || !Number.isFinite(ohms)) throw new Error('Resistance must be positive.');
  if (![4, 5, 6].includes(bands)) throw new Error('Bands must be 4, 5 or 6.');
  const n = bands === 4 ? 2 : 3;
  let e = Math.floor(Math.log10(ohms)) - (n - 1);
  let digits = Math.round(ohms / 10 ** e);
  if (digits >= 10 ** n) { e += 1; digits = Math.round(ohms / 10 ** e); }
  if (e < -2 || e > 9) throw new Error('Value is outside the colour-code multiplier range (0.01 to 9e9 ohm).');
  const digitStr = String(digits).padStart(n, '0');
  const multName = e >= 0 ? COLOURS.find((c) => c.digit === e).name : (e === -1 ? 'gold' : 'silver');
  const tolName = COLOURS.find((c) => c.tol === tolerancePct)?.name ?? (tolerancePct === 10 ? 'silver' : 'gold');
  const tcName = bands === 6 ? COLOURS.find((c) => c.tempco === tempco)?.name ?? 'brown' : null;
  const out = [...digitStr].map((d) => COLOURS[Number(d)].name);
  out.push(multName);
  out.push(tolName);
  if (tcName) out.push(tcName);
  const exactValue = digits * 10 ** e;
  return { bands: out, exactValue, exact: Math.abs(exactValue - ohms) / ohms < 1e-9 };
}

/** Series / parallel totals for a list of resistances (or capacitances in parallel-sum form). */
export function seriesTotal(values) {
  return values.reduce((s, x) => s + x, 0);
}
export function parallelTotal(values) {
  if (values.some((x) => x === 0)) return 0;
  return 1 / values.reduce((s, x) => s + 1 / x, 0);
}

/**
 * Standard-value combinations that land near a target: single values and pairs of E-series
 * values combined in series or in parallel. Returns the best `count` by error.
 */
export function resistorCombos({ target, series = 'E24', count = 10 }) {
  if (!(target > 0)) throw new Error('Target must be positive.');
  const vals = eSeriesValues(series, { minDecade: 0, maxDecade: 6 });
  const out = [];
  const add = (parts, mode, total) => out.push({ parts, mode, total, errorPct: ((total - target) / target) * 100 });
  for (const a of vals) {
    add([a], 'single', a);
    for (const b of vals) {
      if (b < a) continue;
      add([a, b], 'series', a + b);
      add([a, b], 'parallel', (a * b) / (a + b));
    }
  }
  out.sort((x, y) => Math.abs(x.errorPct) - Math.abs(y.errorPct) || x.parts.length - y.parts.length);
  return out.slice(0, count);
}

// ---------------------------------------------------------------------------
// RC / RLC
// ---------------------------------------------------------------------------

/** RC low-pass: tau = RC, fc = 1 / (2 pi RC), time to 5 tau. */
export function rcTimeConstant({ r, c }) {
  const tau = r * c;
  return { tau, fc: 1 / (2 * Math.PI * tau), t5: 5 * tau };
}

/** Time for an RC charge (from 0 toward Vs) to reach `percent` of the final value: t = -RC ln(1 - p). */
export function chargeTimeToPercent({ r, c, percent }) {
  const p = percent / 100;
  if (!(p > 0 && p < 1)) throw new Error('Percent must be between 0 and 100 (exclusive).');
  return -r * c * Math.log(1 - p);
}

/** Time for an RC charge to reach voltage v from a source vs: t = -RC ln(1 - v/vs). */
export function chargeTimeToVoltage({ r, c, vs, v }) {
  if (!(v > 0 && v < vs)) throw new Error('Need 0 < V < Vs.');
  return -r * c * Math.log(1 - v / vs);
}

/** LC tank: f0 = 1 / (2 pi sqrt(LC)), characteristic impedance Z0 = sqrt(L/C). */
export function lcResonance({ l, c }) {
  const w0 = 1 / Math.sqrt(l * c);
  return { w0, f0: w0 / (2 * Math.PI), z0: Math.sqrt(l / c) };
}

/** Series RLC: damping ratio zeta = (R/2) sqrt(C/L); damped frequency when underdamped. */
export function rlcSeries({ r, l, c }) {
  const { w0, f0 } = lcResonance({ l, c });
  const zeta = (r / 2) * Math.sqrt(c / l);
  let kind;
  if (zeta < 1 - 1e-9) kind = 'underdamped';
  else if (zeta > 1 + 1e-9) kind = 'overdamped';
  else kind = 'critically damped';
  const fd = zeta < 1 ? (w0 * Math.sqrt(1 - zeta * zeta)) / (2 * Math.PI) : null;
  return { w0, f0, zeta, kind, fd };
}

// ---------------------------------------------------------------------------
// Battery life
// ---------------------------------------------------------------------------

/**
 * Runtime from a duty-cycled load. Average current I = d * Iact + (1 - d) * Isleep,
 * usable capacity = capacity * (1 - derate). Currents in amps, capacity in mAh.
 */
export function batteryLife({ capacityMah, activeA, sleepA = 0, dutyPct, deratePct = 0 }) {
  const d = dutyPct / 100;
  const derate = deratePct / 100;
  if (!(capacityMah > 0)) throw new Error('Capacity must be positive.');
  if (!(d >= 0 && d <= 1)) throw new Error('Duty cycle must be 0..100 %.');
  if (!(derate >= 0 && derate < 1)) throw new Error('Derating must be 0..100 %.');
  const avgA = d * activeA + (1 - d) * sleepA;
  if (!(avgA > 0)) throw new Error('Average current is zero; runtime is unbounded.');
  const usableMah = capacityMah * (1 - derate);
  const hours = usableMah / (avgA * 1000);
  return { avgA, usableMah, hours, days: hours / 24 };
}

// ---------------------------------------------------------------------------
// PCB trace width (IPC-2221)
// ---------------------------------------------------------------------------

export const MIL_PER_MM = 1 / 0.0254;
const COPPER_MIL_PER_OZ = 1.37; // 1 oz/ft^2 copper is 34.8 um = 1.37 mil
export const IPC_K = { external: 0.048, internal: 0.024 };
const IPC_B = 0.44;
const IPC_C = 0.725;

/** IPC-2221: I = k * dT^0.44 * A^0.725, A in mil^2. Returns the solved quantity. */
function ipcArea(currentA, tempRiseC, layer) {
  const k = IPC_K[layer];
  return (currentA / (k * tempRiseC ** IPC_B)) ** (1 / IPC_C);
}

/** Minimum trace width for a current and allowed temperature rise. */
export function traceWidth({ currentA, tempRiseC, copperOz = 1, layer = 'external' }) {
  if (!(currentA > 0 && tempRiseC > 0 && copperOz > 0)) throw new Error('Current, temperature rise and copper weight must be positive.');
  const areaMil2 = ipcArea(currentA, tempRiseC, layer);
  const thicknessMil = copperOz * COPPER_MIL_PER_OZ;
  const widthMil = areaMil2 / thicknessMil;
  return { areaMil2, widthMil, widthMm: widthMil * 0.0254, thicknessMil };
}

/** Current a given trace width carries at a given temperature rise. */
export function traceCurrent({ widthMm, tempRiseC, copperOz = 1, layer = 'external' }) {
  if (!(widthMm > 0 && tempRiseC > 0 && copperOz > 0)) throw new Error('Width, temperature rise and copper weight must be positive.');
  const areaMil2 = (widthMm * MIL_PER_MM) * (copperOz * COPPER_MIL_PER_OZ);
  return IPC_K[layer] * tempRiseC ** IPC_B * areaMil2 ** IPC_C;
}

/** Temperature rise of a given trace width carrying a given current. */
export function traceTempRise({ currentA, widthMm, copperOz = 1, layer = 'external' }) {
  if (!(widthMm > 0 && currentA > 0 && copperOz > 0)) throw new Error('Current, width and copper weight must be positive.');
  const areaMil2 = (widthMm * MIL_PER_MM) * (copperOz * COPPER_MIL_PER_OZ);
  return (currentA / (IPC_K[layer] * areaMil2 ** IPC_C)) ** (1 / IPC_B);
}

// ---------------------------------------------------------------------------
// Ohm's law / power
// ---------------------------------------------------------------------------

/**
 * Solve V, I, R, P from any two. Pass the known pair; leave the others null.
 * V = I R, P = V I, P = I^2 R, P = V^2 / R.
 */
export function solveOhm({ V = null, I = null, R = null, P = null }) {
  const vals = { V, I, R, P };
  const known = Object.entries(vals).filter(([, x]) => x !== null && x !== undefined && x !== '');
  if (known.length !== 2) throw new Error('Give exactly two of V, I, R, P.');
  for (const [k, x] of known) {
    if (!Number.isFinite(x) || x <= 0) throw new Error(`${k} must be a positive number.`);
  }
  let v, i, r, p;
  if (V != null && I != null) { v = V; i = I; r = V / I; p = V * I; }
  else if (V != null && R != null) { v = V; r = R; i = V / R; p = V * V / R; }
  else if (V != null && P != null) { v = V; p = P; i = P / V; r = V * V / P; }
  else if (I != null && R != null) { i = I; r = R; v = I * R; p = I * I * R; }
  else if (I != null && P != null) { i = I; p = P; v = P / I; r = P / (I * I); }
  else { r = R; p = P; i = Math.sqrt(P / R); v = Math.sqrt(P * R); }
  return { V: v, I: i, R: r, P: p };
}

// ---------------------------------------------------------------------------
// ADC
// ---------------------------------------------------------------------------

/** LSB = Vref / 2^N; full-scale code = 2^N - 1. */
export function adcLsb({ bits, vref }) {
  if (!(bits >= 1 && bits <= 32 && vref > 0)) throw new Error('Need 1..32 bits and Vref > 0.');
  const levels = 2 ** bits;
  return { lsb: vref / levels, levels, maxCode: levels - 1, fullScale: vref };
}

/** Ideal truncating ADC: code = floor(V / LSB), clamped to 0..2^N-1. */
export function voltageToCode({ voltage, bits, vref }) {
  const { lsb, maxCode } = adcLsb({ bits, vref });
  const raw = Math.floor(voltage / lsb);
  const code = Math.min(maxCode, Math.max(0, raw));
  return { code, clipped: raw < 0 || raw > maxCode, lsb };
}

/** Voltage a code represents: code * LSB (bottom of the bin), or the bin centre when centre = true. */
export function codeToVoltage({ code, bits, vref, centre = false }) {
  const { lsb, maxCode } = adcLsb({ bits, vref });
  if (!(code >= 0 && code <= maxCode && Number.isInteger(code))) throw new Error(`Code must be an integer 0..${maxCode}.`);
  return (code + (centre ? 0.5 : 0)) * lsb;
}

/** Voltage at the ADC pin for an input through a divider (R1 top, R2 to ground). */
export function dividerAdcVoltage({ vin, r1, r2 }) {
  return vin * r2 / (r1 + r2);
}

/** Input voltage that makes the ADC pin reach Vref (full-scale input through the divider). */
export function dividerFullScaleInput({ vref, r1, r2 }) {
  return vref * (r1 + r2) / r2;
}
