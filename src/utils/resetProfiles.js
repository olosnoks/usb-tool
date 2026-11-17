/**
 * Reset / bootloader profiles for the Hardware tab, as data.
 *
 * A signal sequence is an array of steps `{ dtr, rts, waitMs }`:
 *   dtr / rts: true = asserted, false = de-asserted, undefined = leave unchanged
 *   waitMs:    how long to hold the state before the next step
 * "Asserted" is the Web Serial meaning (dataTerminalReady / requestToSend = true).
 * On most USB-UART adapters an asserted line drives the TTL pin LOW.
 *
 * Also: the sequence runner (with measured step durations), the 1200-baud touch,
 * auto-suggest from USB IDs, user-sequence import/export, and a prompt watcher /
 * spammer controller that matches prompts on partial lines.
 */

import { matchPrompt } from './consoleShortcuts';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const MAX_STEP_WAIT_MS = 5000;

// ---- Sequence helpers ----

export function normalizeSteps(input) {
  if (!Array.isArray(input)) throw new Error('A sequence must be an array of steps');
  if (input.length === 0) throw new Error('A sequence needs at least one step');
  if (input.length > 64) throw new Error('A sequence is limited to 64 steps');
  return input.map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`Step ${i + 1} must be an object`);
    const step = {};
    for (const k of ['dtr', 'rts']) {
      if (s[k] === undefined || s[k] === null) continue;
      if (typeof s[k] !== 'boolean') throw new Error(`Step ${i + 1}: ${k} must be true or false`);
      step[k] = s[k];
    }
    const w = s.waitMs === undefined ? 0 : Number(s.waitMs);
    if (!Number.isFinite(w) || w < 0 || w > MAX_STEP_WAIT_MS) throw new Error(`Step ${i + 1}: waitMs must be 0-${MAX_STEP_WAIT_MS}`);
    step.waitMs = Math.round(w);
    return step;
  });
}

/** Flip every defined DTR/RTS level (for adapters/circuits with the opposite polarity). */
export function invertSteps(steps) {
  return steps.map((s) => {
    const o = { waitMs: s.waitMs };
    if (s.dtr !== undefined) o.dtr = !s.dtr;
    if (s.rts !== undefined) o.rts = !s.rts;
    return o;
  });
}

export function serializeSequence(name, steps) {
  return JSON.stringify({ name: name || 'Custom sequence', version: 1, steps: normalizeSteps(steps) }, null, 2);
}

export function parseSequence(text) {
  let obj;
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }
  const steps = Array.isArray(obj) ? obj : obj && obj.steps;
  return { name: (obj && !Array.isArray(obj) && obj.name) || 'Imported sequence', steps: normalizeSteps(steps) };
}

function toSignals(step) {
  const payload = {};
  if (step.dtr !== undefined) payload.dataTerminalReady = step.dtr;
  if (step.rts !== undefined) payload.requestToSend = step.rts;
  return payload;
}

/**
 * Apply a sequence to a Web Serial port. Resolves to the measured timings:
 * [{ index, requestedMs, actualMs }] where actualMs is how long the step's
 * state was actually held (browser timers are not exact).
 */
export async function runSignalSequence(port, steps, { sleep = realSleep, now = realNow } = {}) {
  if (!port || typeof port.setSignals !== 'function') throw new Error('Port does not support setSignals()');
  const timings = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const t0 = now();
    await port.setSignals(toSignals(step));
    if (step.waitMs > 0) await sleep(step.waitMs);
    timings.push({ index: i, requestedMs: step.waitMs, actualMs: Math.round((now() - t0) * 10) / 10 });
  }
  return timings;
}

// ---- 1200-baud touch ----

/**
 * RP2040 / nRF52 / Adafruit / Teensy-style "touch": open the port at 1200 baud,
 * drop DTR, close. The board re-enumerates (often as a mass-storage bootloader
 * or under a new port), so the caller must pick the new port afterwards.
 *
 * deps: { open(baud), setSignals(obj), close(), sleep }. Use portTouchDeps(port)
 * for a plain SerialPort, or supply context-aware callbacks from the app.
 */
export async function touch1200(deps, { baud = 1200, holdMs = 100, settleMs = 250 } = {}) {
  const sleep = deps.sleep || realSleep;
  const calls = [];
  await deps.open(baud);
  calls.push(`open(${baud})`);
  await deps.setSignals({ dataTerminalReady: false, requestToSend: false });
  calls.push('setSignals(dtr=false,rts=false)');
  await sleep(holdMs);
  await deps.close();
  calls.push('close()');
  await sleep(settleMs);
  return { needsNewPort: true, calls };
}

export function portTouchDeps(port, { sleep = realSleep } = {}) {
  return {
    sleep,
    open: async (baud) => {
      try { await port.close(); } catch { /* not open */ }
      await port.open({ baudRate: baud });
    },
    setSignals: (s) => port.setSignals(s),
    close: () => port.close()
  };
}

// ---- Profiles ----

// boot0: which signal drives BOOT0 ('dtr' | 'rts'); NRST uses the other one.
export const STM32_DEFAULTS = { boot0: 'dtr', invertBoot0: false, invertNrst: false };

/**
 * STM32 UART bootloader entry through BOOT0 + NRST wired to DTR/RTS.
 * Levels are the wanted TTL pin levels; "asserted" drives a pin LOW on a typical
 * adapter, and an invert flag flips that for adapters or circuits that re-invert.
 */
export function buildStm32Sequence(mode, o = {}, timing = {}) {
  const cfg = { ...STM32_DEFAULTS, ...o };
  const resetMs = timing.resetMs ?? 100;
  const settleMs = timing.bootHoldMs ?? 50;
  const asserted = (level, invert) => (level === 'low') !== !!invert;
  const step = (boot0Level, nrstLevel, waitMs) => {
    const s = { waitMs };
    s[cfg.boot0] = asserted(boot0Level, cfg.invertBoot0);
    // Never let both functions map to one signal line
    const other = cfg.boot0 === 'dtr' ? 'rts' : 'dtr';
    s[other] = asserted(nrstLevel, cfg.invertNrst);
    return s;
  };
  if (mode === 'bootloader') {
    // BOOT0 high, pulse NRST low, release NRST with BOOT0 still high (bootloader samples it)
    return [step('high', 'low', resetMs), step('high', 'high', settleMs)];
  }
  // Normal reset into flash: BOOT0 low, pulse NRST
  return [step('low', 'low', resetMs), step('low', 'high', settleMs)];
}

export const RESET_PROFILES = [
  {
    id: 'esp32-classic',
    label: 'ESP32 / ESP8266 (UART bridge, DTR=IO0 RTS=EN)',
    kind: 'signals',
    build: (mode, _o, t = {}) => (mode === 'bootloader'
      ? [
        { dtr: false, rts: true, waitMs: t.resetMs ?? 150 },
        { dtr: true, rts: false, waitMs: t.bootHoldMs ?? 50 },
        { dtr: false, rts: false, waitMs: 0 }
      ]
      : [
        { dtr: false, rts: true, waitMs: t.resetMs ?? 120 },
        { dtr: false, rts: false, waitMs: 50 }
      ])
  },
  {
    id: 'esp32-native',
    label: 'ESP32-S/C native USB (USB-Serial/JTAG)',
    kind: 'signals',
    build: (mode, _o, t = {}) => (mode === 'bootloader'
      ? [
        { dtr: false, rts: false, waitMs: 100 },
        { dtr: true, rts: false, waitMs: t.resetMs ?? 100 },
        { dtr: false, rts: true, waitMs: t.bootHoldMs ?? 100 },
        { dtr: false, rts: false, waitMs: 0 }
      ]
      : [
        { dtr: false, rts: true, waitMs: t.resetMs ?? 100 },
        { dtr: false, rts: false, waitMs: 50 }
      ])
  },
  {
    id: 'arduino',
    label: 'Arduino (DTR auto-reset, serial bootloader)',
    kind: 'signals',
    // The bootloader runs right after any reset, so both modes are the same pulse.
    build: (_mode, _o, t = {}) => [
      { dtr: false, rts: false, waitMs: 20 },
      { dtr: true, rts: false, waitMs: t.resetMs ?? 250 },
      { dtr: false, rts: false, waitMs: 50 }
    ]
  },
  {
    id: 'stm32',
    label: 'STM32 (BOOT0 + NRST on DTR/RTS)',
    kind: 'signals',
    configurable: 'stm32',
    build: (mode, o, t) => buildStm32Sequence(mode, o, t)
  },
  {
    id: 'touch1200',
    label: 'RP2040 / nRF52 / Adafruit / Teensy (1200-baud touch)',
    kind: 'touch1200',
    build: () => null
  }
];

export function getProfile(id) {
  return RESET_PROFILES.find((p) => p.id === id) || null;
}

/** Steps a profile will run for `mode` ('bootloader' | 'reset'); null for touch profiles. */
export function buildProfileSteps(id, mode, { invert = false, stm32 = {}, timing = {} } = {}) {
  const p = getProfile(id);
  if (!p) throw new Error(`Unknown reset profile "${id}"`);
  const steps = p.build(mode, stm32, timing);
  if (!steps) return null;
  return invert ? invertSteps(steps) : steps;
}

/**
 * Suggest a profile from Web Serial port info ({ usbVendorId, usbProductId }).
 * Only a suggestion: the UI never runs it on its own.
 */
export function suggestProfile(info) {
  const vid = info && info.usbVendorId;
  const pid = info && info.usbProductId;
  if (vid === undefined || vid === null) return null;
  switch (vid) {
    case 0x303A: return pid === 0x1001 ? 'esp32-native' : 'touch1200'; // Espressif: USB-JTAG vs TinyUSB CDC (Arduino-style touch)
    case 0x2E8A: return 'touch1200'; // Raspberry Pi (RP2040 / RP2350)
    case 0x239A: return 'touch1200'; // Adafruit
    case 0x1915: return 'touch1200'; // Nordic
    case 0x16C0: return 'touch1200'; // PJRC Teensy
    case 0x2341: case 0x2A03: return 'arduino';
    case 0x1B4F: return 'arduino'; // SparkFun
    case 0x0483: return 'stm32';
    case 0x10C4: case 0x1A86: case 0x0403: return 'esp32-classic'; // generic UART bridges: most often ESP boards
    default: return null;
  }
}

// ---- Prompt catching ----

/**
 * Accumulates received bytes (one persistent streaming decoder) and reports the
 * first prompt seen. Matches on the partial current line, so `=>` without a
 * trailing newline is caught, and across chunk boundaries. Latches after the
 * first hit so it fires exactly once.
 */
export function createPromptWatcher(prompts, { maxTail = 256 } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let tail = '';
  let fired = false;
  return {
    push(bytes) {
      if (fired || !bytes || bytes.length === 0) return null;
      tail += decoder.decode(bytes, { stream: true });
      if (tail.length > maxTail) tail = tail.slice(tail.length - maxTail);
      const p = matchPrompt(tail, prompts);
      if (p) {
        fired = true;
        return p;
      }
      return null;
    },
    get fired() { return fired; },
    reset() { tail = ''; fired = false; }
  };
}

/**
 * Interrupt spammer: sends `payload` every `intervalMs` until a prompt arrives
 * (via subscribeRx) or stop() is called. Never sends after the catch.
 */
export function createSpammer({
  send,
  subscribeRx,
  prompts,
  payload,
  intervalMs = 25,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onCatch = () => {},
  onCount = () => {},
  onError = () => {}
}) {
  let stopped = true;
  let timer = null;
  let unsub = null;
  let count = 0;
  let watcher = null;

  const stop = () => {
    stopped = true;
    if (timer !== null) { clearIntervalFn(timer); timer = null; }
    if (unsub) { unsub(); unsub = null; }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      count = 0;
      watcher = createPromptWatcher(prompts);
      unsub = subscribeRx((chunk) => {
        if (stopped) return;
        const p = watcher.push(chunk);
        if (p) {
          stop();
          onCatch(p);
        }
      });
      timer = setIntervalFn(async () => {
        if (stopped) return;
        try {
          await send(payload);
          if (stopped) return;
          count++;
          onCount(count);
        } catch (err) {
          stop();
          onError(err);
        }
      }, intervalMs);
    },
    stop,
    get running() { return !stopped; },
    get count() { return count; }
  };
}
