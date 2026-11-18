/**
 * analysis.js: pure helpers on top of the usbPowerMeter sample records.
 * Alarm limits, time-weighted averages, battery runtime and formatting.
 */

import { SESSION_MAX_GAP_S } from '../usbPowerMeter';

// ---------------------------------------------------------------------------
// Alarm limits
// ---------------------------------------------------------------------------

export const ALARM_KINDS = Object.freeze([
  { key: 'maxAmps', label: 'Current above', unit: 'A', field: 'amps', over: true },
  { key: 'maxWatts', label: 'Power above', unit: 'W', field: 'watts', over: true },
  { key: 'minVolts', label: 'Voltage below', unit: 'V', field: 'volts', over: false },
  { key: 'maxTempC', label: 'Temperature above', unit: '°C', field: 'tempC', over: true },
]);

/** Parse a limit text field: blank or invalid means "off" (null). */
export function parseLimit(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Return the keys of the limits a sample violates. Unset limits are ignored. */
export function tripped(sample, limits) {
  const out = [];
  for (const k of ALARM_KINDS) {
    const lim = limits ? limits[k.key] : null;
    if (lim === null || lim === undefined) continue;
    const v = sample[k.field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (k.over ? v > lim : v < lim) out.push(k.key);
  }
  return out;
}

export function createAlarmState() {
  return { active: [], events: {}, firstAtMs: null, lastAtMs: null, total: 0 };
}

/**
 * Update the alarm state with one sample. An event is counted on the rising
 * edge (the limit was fine on the previous sample). Returns the newly tripped keys.
 */
export function updateAlarmState(state, sample, limits) {
  const now = tripped(sample, limits);
  const fresh = now.filter((k) => !state.active.includes(k));
  for (const k of fresh) {
    state.events[k] = (state.events[k] || 0) + 1;
    state.total++;
    if (state.firstAtMs === null) state.firstAtMs = sample.tMs;
    state.lastAtMs = sample.tMs;
  }
  state.active = now;
  return fresh;
}

// ---------------------------------------------------------------------------
// Time-weighted averages
// ---------------------------------------------------------------------------

export function createAverager() {
  return { lastMs: null, last: null, seconds: 0, sumV: 0, sumA: 0, sumW: 0, peakW: 0, peakA: 0 };
}

/** Trapezoid-weighted averages; gaps over SESSION_MAX_GAP_S are skipped. */
export function addAverage(avg, s) {
  if (avg.lastMs !== null) {
    const dt = (s.tMs - avg.lastMs) / 1000;
    if (dt > 0 && dt <= SESSION_MAX_GAP_S) {
      avg.seconds += dt;
      avg.sumV += ((avg.last.volts + s.volts) / 2) * dt;
      avg.sumA += ((avg.last.amps + s.amps) / 2) * dt;
      avg.sumW += ((avg.last.watts + s.watts) / 2) * dt;
    }
  }
  avg.lastMs = s.tMs;
  avg.last = { volts: s.volts, amps: s.amps, watts: s.watts };
  if (s.watts > avg.peakW) avg.peakW = s.watts;
  if (s.amps > avg.peakA) avg.peakA = s.amps;
}

export function averages(avg) {
  if (!avg.seconds) return { seconds: 0, volts: null, amps: null, watts: null, peakW: avg.peakW, peakA: avg.peakA };
  return {
    seconds: avg.seconds,
    volts: avg.sumV / avg.seconds,
    amps: avg.sumA / avg.seconds,
    watts: avg.sumW / avg.seconds,
    peakW: avg.peakW,
    peakA: avg.peakA,
  };
}

// ---------------------------------------------------------------------------
// Battery runtime estimate
// ---------------------------------------------------------------------------

/**
 * Estimate hours of runtime for a battery drained at `loadWatts`.
 * Capacity is given as Wh, or as mAh at a nominal cell voltage.
 * `efficiency` is 0..1 (converter losses). Returns null on bad input.
 */
export function batteryRuntimeHours({ capacityMah, nominalVolts, capacityWh, loadWatts, efficiency = 1 }) {
  let wh = capacityWh;
  if (!(wh > 0)) wh = capacityMah > 0 && nominalVolts > 0 ? (capacityMah * nominalVolts) / 1000 : NaN;
  if (!(wh > 0) || !(loadWatts > 0) || !(efficiency > 0) || efficiency > 1) return null;
  return (wh * efficiency) / loadWatts;
}

export function formatDuration(totalSeconds) {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

/** Load resistance V/I, null below 1 mA where it is meaningless. */
export function loadResistance(volts, amps) {
  if (!Number.isFinite(volts) || !Number.isFinite(amps) || amps < 0.001) return null;
  return volts / amps;
}
