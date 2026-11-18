/**
 * Pure helpers for the Hardware Controls tool:
 *  - esptool "custom reset sequence" string <-> our step arrays
 *  - input-signal (CTS/DSR/DCD/RI) change detection and event log
 *  - single-line pulse helper
 *
 * Steps use the same shape as resetProfiles.js: { dtr, rts, waitMs }
 * where true = asserted (Web Serial dataTerminalReady / requestToSend = true).
 */

import { normalizeSteps, MAX_STEP_WAIT_MS } from './resetProfiles';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- esptool custom reset sequence ("D0|R1|W0.1|D1|R0|W0.05|D0") ----
// D = DTR, R = RTS (0/1), W = wait in seconds. Same format as esptool's
// custom reset sequence strings and esptool-js. esptool applies D and R
// one after another; this tool applies the D/R values before a wait together.

/** Parse an esptool-style sequence string into steps. Throws a readable Error. */
export function parseEsptoolSequence(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a sequence such as D0|R1|W0.1|D1|R0|W0.05|D0');
  const steps = [];
  let cur = {};
  const flush = (waitMs) => { steps.push({ ...cur, waitMs }); cur = {}; };
  const tokens = text.split('|').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error('The sequence has no commands');
  for (const tok of tokens) {
    const cmd = tok[0].toUpperCase();
    const arg = tok.slice(1).trim();
    if (cmd === 'D' || cmd === 'R') {
      if (arg !== '0' && arg !== '1') throw new Error(`"${tok}": ${cmd} must be followed by 0 or 1`);
      cur[cmd === 'D' ? 'dtr' : 'rts'] = arg === '1';
    } else if (cmd === 'W') {
      const sec = Number(arg);
      if (arg === '' || !Number.isFinite(sec) || sec < 0) throw new Error(`"${tok}": W must be followed by seconds, e.g. W0.1`);
      const ms = Math.round(sec * 1000);
      if (ms > MAX_STEP_WAIT_MS) throw new Error(`"${tok}": waits are limited to ${MAX_STEP_WAIT_MS / 1000} s`);
      flush(ms);
    } else {
      throw new Error(`"${tok}": unknown command (use D, R or W)`);
    }
  }
  if (Object.keys(cur).length) flush(0);
  if (steps.length === 0) throw new Error('The sequence has no D or R commands');
  return normalizeSteps(steps);
}

const fmtSeconds = (ms) => String(Math.round(ms) / 1000);

/** Serialise steps to an esptool-style sequence string. */
export function toEsptoolSequence(steps) {
  const out = [];
  for (const s of normalizeSteps(steps)) {
    if (s.dtr !== undefined) out.push(`D${s.dtr ? 1 : 0}`);
    if (s.rts !== undefined) out.push(`R${s.rts ? 1 : 0}`);
    if (s.waitMs > 0) out.push(`W${fmtSeconds(s.waitMs)}`);
  }
  return out.join('|');
}

// ---- Input signal change log ----

export const INPUT_SIGNALS = ['cts', 'dsr', 'dcd', 'ri'];
export const MAX_SIGNAL_EVENTS = 200;

/** Compare two signal snapshots; returns [{ name, level }] for each input that changed. */
export function diffInputSignals(prev, next) {
  if (!prev || !next) return [];
  const changes = [];
  for (const name of INPUT_SIGNALS) {
    const a = !!prev[name];
    const b = !!next[name];
    if (a !== b) changes.push({ name, level: b });
  }
  return changes;
}

/** Append change events (newest last, capped) and bump per-signal transition counts. */
export function recordSignalEvents(state, changes, timeMs) {
  const events = state?.events || [];
  const counts = { ...(state?.counts || { cts: 0, dsr: 0, dcd: 0, ri: 0 }) };
  if (!changes.length) return { events, counts };
  const added = changes.map((c) => ({ t: timeMs, name: c.name, level: c.level }));
  for (const c of changes) counts[c.name] = (counts[c.name] || 0) + 1;
  return { events: [...events, ...added].slice(-MAX_SIGNAL_EVENTS), counts };
}

/** Plain-text export of the log: "+1.250s CTS -> HIGH" with times relative to startMs. */
export function formatSignalEvents(events, startMs = events[0]?.t ?? 0) {
  return events
    .map((e) => `+${((e.t - startMs) / 1000).toFixed(3)}s ${e.name.toUpperCase()} -> ${e.level ? 'HIGH' : 'LOW'}`)
    .join('\n');
}

// ---- Single-line pulse ----

/**
 * Assert one output line for durationMs, then put it back to `restore` (default released).
 * Resolves to the measured hold time in ms.
 */
export async function pulseSignal(port, name, durationMs, { restore = false, sleep = realSleep, now } = {}) {
  if (!port || typeof port.setSignals !== 'function') throw new Error('Port does not support setSignals()');
  if (name !== 'dtr' && name !== 'rts') throw new Error('Only DTR and RTS can be pulsed');
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 1 || ms > MAX_STEP_WAIT_MS) throw new Error(`Pulse length must be 1-${MAX_STEP_WAIT_MS} ms`);
  const key = name === 'dtr' ? 'dataTerminalReady' : 'requestToSend';
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = clock();
  await port.setSignals({ [key]: true });
  await sleep(ms);
  const held = clock() - t0;
  await port.setSignals({ [key]: !!restore });
  return Math.round(held * 10) / 10;
}
