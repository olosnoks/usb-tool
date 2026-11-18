// Pure helpers for the Modbus RTU workbench: request-frame preview, mbpoll
// command export, per-register trend history and change detection.
import { buildRequest } from './modbusDriver';

export const HISTORY_LEN = 60;

const hexBytes = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Hex string (with CRC) of the read request the workbench would send. */
export function readRequestHex(slaveId, fc, addr, qty) {
  try {
    return hexBytes(buildRequest(Number(slaveId), fc, Number(addr), Number(qty)).frame);
  } catch (err) {
    return `invalid: ${err.message}`;
  }
}

// mbpoll -t codes: 0 coil, 1 discrete input, 3 input register, 4 holding register
const MBPOLL_TYPE = { coils: '0', discrete: '1', input: '3', holding: '4' };

/**
 * Command line for the open-source mbpoll CLI that reproduces the current read.
 * mbpoll addresses are 1-based unless -0 is given, so -0 keeps our 0-based start.
 */
export function mbpollCommand({ port = '/dev/ttyUSB0', slaveId, baud, parity, stopBits, table, start, qty, once = true }) {
  const t = MBPOLL_TYPE[table];
  if (!t) return '';
  const p = { none: 'none', even: 'even', odd: 'odd' }[parity] || 'none';
  const parts = ['mbpoll', '-m rtu', `-a ${slaveId}`, `-b ${baud}`, `-P ${p}`, `-s ${stopBits}`, `-t ${t}`, '-0', `-r ${start}`, `-c ${qty}`];
  if (once) parts.push('-1');
  parts.push(port);
  return parts.join(' ');
}

/** Append a numeric sample to a per-key history map (immutable). Non-numeric samples are ignored. */
export function pushHistory(history, samples, max = HISTORY_LEN) {
  const next = { ...history };
  for (const [key, value] of Object.entries(samples)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const arr = (next[key] || []).concat(value);
    next[key] = arr.length > max ? arr.slice(arr.length - max) : arr;
  }
  return next;
}

/** SVG polyline points string scaled into width x height; flat series draw a centred line. */
export function sparklinePoints(values, width = 60, height = 14) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Set of addresses whose raw hex differs from the previous poll (empty on first poll). */
export function changedAddresses(prevRows, nextRows) {
  const changed = new Set();
  if (!prevRows || prevRows.length === 0) return changed;
  const prev = new Map(prevRows.map((r) => [r.address, r.hex]));
  for (const r of nextRows) {
    if (prev.has(r.address) && prev.get(r.address) !== r.hex) changed.add(r.address);
  }
  return changed;
}
