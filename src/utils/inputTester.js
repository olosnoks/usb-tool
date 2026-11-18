/**
 * Gamepad & Mouse Tester: pure math and HID report decoders.
 * No DOM, no React, no device access. Everything here is unit-tested in
 * tests/inputTester.test.js.
 */

export const SONY_VENDOR_ID = 0x054c;
export const DS4_PRODUCT_IDS = [0x05c4, 0x09cc];
export const DUALSENSE_PRODUCT_IDS = [0x0ce6, 0x0df2];

// Names for the W3C "standard" gamepad mapping (index = button index).
export const STANDARD_BUTTON_NAMES = [
  'A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1',
  'LT / L2', 'RT / R2', 'Back / Share', 'Start / Options', 'L3', 'R3',
  'D-Pad Up', 'D-Pad Down', 'D-Pad Left', 'D-Pad Right', 'Guide / PS',
];

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Rates and intervals
// ---------------------------------------------------------------------------

/** Stats over a list of intervals in milliseconds. Jitter is the population standard deviation. */
export function intervalStats(intervalsMs) {
  const vals = intervalsMs.filter((v) => Number.isFinite(v) && v > 0);
  const n = vals.length;
  if (n === 0) {
    return { count: 0, minMs: null, avgMs: null, maxMs: null, jitterMs: null, avgHz: null, minHz: null, maxHz: null };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const avg = sum / n;
  let varSum = 0;
  for (const v of vals) varSum += (v - avg) ** 2;
  return {
    count: n,
    minMs: min,
    avgMs: avg,
    maxMs: max,
    jitterMs: Math.sqrt(varSum / n),
    avgHz: 1000 / avg,
    minHz: 1000 / max,
    maxHz: 1000 / min,
  };
}

/**
 * Gamepad report rate from the `timestamp` field of Gamepad objects.
 * Repeated timestamps (no new report) are ignored; the intervals between
 * distinct timestamps give the update period. Input must be in arrival order.
 */
export function updateRateFromTimestamps(timestamps) {
  const distinct = [];
  for (const t of timestamps) {
    if (!Number.isFinite(t)) continue;
    if (distinct.length === 0 || t !== distinct[distinct.length - 1]) distinct.push(t);
  }
  const intervals = [];
  for (let i = 1; i < distinct.length; i++) intervals.push(distinct[i] - distinct[i - 1]);
  return { reports: distinct.length, ...intervalStats(intervals) };
}

/**
 * Events per second inside the trailing window ending at nowMs.
 * `timestamps` must be sorted ascending (performance.now() values).
 */
export function eventsPerSecond(timestamps, nowMs, windowMs = 1000) {
  if (!(windowMs > 0)) return 0;
  let n = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const t = timestamps[i];
    if (t < nowMs - windowMs) break;
    if (t <= nowMs) n++;
  }
  return (n * 1000) / windowMs;
}

/** min / avg / max of a series of numbers, or null when empty. */
export function summarizeSeries(values) {
  const vals = values.filter(Number.isFinite);
  if (vals.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of vals) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { count: vals.length, min, avg: sum / vals.length, max };
}

/** Fixed-width histogram with an overflow/underflow count. */
export function histogram(values, { binWidth = 1, bins = 20, start = 0 } = {}) {
  const counts = new Array(bins).fill(0);
  let underflow = 0;
  let overflow = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < start) {
      underflow++;
      continue;
    }
    const idx = Math.floor((v - start) / binWidth);
    if (idx >= bins) overflow++;
    else counts[idx]++;
  }
  return { start, binWidth, counts, underflow, overflow, total: values.length };
}

// ---------------------------------------------------------------------------
// Mouse buttons and wheel
// ---------------------------------------------------------------------------

/** 'chatter' (< chatterMs: contact bounce), 'double' (within the double-click window) or 'separate'. */
export function classifyPress(dtMs, { chatterMs = 50, doubleClickMs = 500 } = {}) {
  if (dtMs < chatterMs) return 'chatter';
  if (dtMs <= doubleClickMs) return 'double';
  return 'separate';
}

/**
 * Classify press-to-press intervals per button.
 * presses: [{ button, time }] in time order (ms). Each press after the first press
 * of the same button yields one pair, classified by classifyPress().
 */
export function analyzeClicks(presses, opts = {}) {
  const last = new Map();
  const perButton = {};
  const pairs = [];
  let doubleClicks = 0;
  let chatter = 0;
  let doubleSum = 0;
  for (const p of presses) {
    perButton[p.button] = (perButton[p.button] || 0) + 1;
    if (last.has(p.button)) {
      const dt = p.time - last.get(p.button);
      const kind = classifyPress(dt, opts);
      pairs.push({ button: p.button, intervalMs: dt, kind, time: p.time });
      if (kind === 'double') {
        doubleClicks++;
        doubleSum += dt;
      } else if (kind === 'chatter') {
        chatter++;
      }
    }
    last.set(p.button, p.time);
  }
  return {
    total: presses.length,
    perButton,
    pairs,
    doubleClicks,
    chatter,
    avgDoubleIntervalMs: doubleClicks ? doubleSum / doubleClicks : null,
  };
}

/** Convert a wheel delta to CSS pixels. deltaMode: 0 pixels, 1 lines, 2 pages. */
export function normalizeWheelDelta(delta, deltaMode, { lineHeightPx = 16, pageHeightPx = 800 } = {}) {
  if (deltaMode === 1) return delta * lineHeightPx;
  if (deltaMode === 2) return delta * pageHeightPx;
  return delta;
}

/** Totals over logged wheel events shaped as { dx, dy } (already normalised to pixels). */
export function summarizeWheel(entries) {
  const s = { events: entries.length, sumX: 0, sumY: 0, up: 0, down: 0, left: 0, right: 0 };
  for (const e of entries) {
    s.sumX += e.dx;
    s.sumY += e.dy;
    if (e.dy < 0) s.up++;
    else if (e.dy > 0) s.down++;
    if (e.dx < 0) s.left++;
    else if (e.dx > 0) s.right++;
  }
  return s;
}

// ---------------------------------------------------------------------------
// DPI estimator
// ---------------------------------------------------------------------------

export function distanceToInches(distance, unit) {
  if (!(distance > 0)) throw new Error('Distance must be greater than zero.');
  if (unit === 'in') return distance;
  if (unit === 'cm') return distance / 2.54;
  throw new Error(`Unknown unit "${unit}" (use "cm" or "in").`);
}

/**
 * Total counts moved from pointer deltas shaped as { dx, dy }.
 * axis 'x' or 'y' sums the absolute movement on one axis; 'path' sums the
 * length of each step (hypot), for moves that are not axis-aligned.
 */
export function sumMovement(samples, axis = 'x') {
  let total = 0;
  for (const { dx, dy } of samples) {
    if (axis === 'x') total += Math.abs(dx);
    else if (axis === 'y') total += Math.abs(dy);
    else total += Math.hypot(dx, dy);
  }
  return total;
}

/**
 * Counts per inch for a move of a known physical distance.
 * Valid only when pointer acceleration / "enhance pointer precision" is off.
 */
export function dpiFromCounts(counts, distance, unit = 'in') {
  const inches = distanceToInches(distance, unit);
  if (!(counts > 0)) return null;
  const countsPerInch = counts / inches;
  return { counts, inches, countsPerInch, dpi: Math.round(countsPerInch) };
}

// ---------------------------------------------------------------------------
// Gamepad sticks, drift, circularity, triggers
// ---------------------------------------------------------------------------

/**
 * Radial deadzone. Inside the ring the stick reads zero; outside it the magnitude
 * is rescaled so it still goes from 0 to 1 at full deflection. Direction is kept.
 */
export function applyRadialDeadzone(x, y, deadzone = 0.1) {
  const dz = clamp(Number(deadzone) || 0, 0, 0.99);
  const magnitude = Math.hypot(x, y);
  if (magnitude <= dz || magnitude === 0) {
    return { x: 0, y: 0, magnitude, scaled: 0, inside: true };
  }
  const scaled = clamp((magnitude - dz) / (1 - dz), 0, 1);
  const k = scaled / magnitude;
  return { x: x * k, y: y * k, magnitude, scaled, inside: false };
}

/**
 * Drift at rest from raw stick samples [{ x, y }] captured with the stick released.
 * Magnitudes are reported in percent of full deflection (1.0 = 100 %).
 */
export function driftStats(samples) {
  const n = samples.length;
  if (n === 0) return null;
  let sx = 0;
  let sy = 0;
  let sm = 0;
  let maxM = 0;
  let maxX = 0;
  let maxY = 0;
  for (const { x, y } of samples) {
    const m = Math.hypot(x, y);
    sx += x;
    sy += y;
    sm += m;
    if (m > maxM) maxM = m;
    if (Math.abs(x) > maxX) maxX = Math.abs(x);
    if (Math.abs(y) > maxY) maxY = Math.abs(y);
  }
  const avgMagnitude = sm / n;
  return {
    count: n,
    centerX: sx / n,
    centerY: sy / n,
    avgMagnitude,
    maxMagnitude: maxM,
    avgPct: avgMagnitude * 100,
    maxPct: maxM * 100,
    maxAxisPct: Math.max(maxX, maxY) * 100,
  };
}

export const CIRCLE_BINS = 360;

export function createCircularityTracker(bins = CIRCLE_BINS) {
  return { bins, maxR: new Float64Array(bins), hits: 0 };
}

/** Record one stick sample: keeps the largest radius seen in its 1-degree angle bin. */
export function addCirclePoint(tracker, x, y) {
  const r = Math.hypot(x, y);
  if (!(r > 0)) return;
  let a = Math.atan2(y, x);
  if (a < 0) a += 2 * Math.PI;
  const idx = Math.min(tracker.bins - 1, Math.floor((a / (2 * Math.PI)) * tracker.bins));
  if (r > tracker.maxR[idx]) tracker.maxR[idx] = r;
  tracker.hits++;
}

/**
 * Circularity from the max-extent polygon.
 * - coverage: share of the 360 angle bins that the user has reached.
 * - meanRadius: average of the visited bins (the "perfect circle" of equal mean size).
 * - errorPct: mean |r - meanRadius| / meanRadius over visited bins, in percent.
 *   0 % means a perfect circle; a square gate scores roughly 10-12 %.
 * - polygon: visited bins as {x, y} in stick units, for drawing.
 */
export function circularityReport(tracker) {
  const { bins, maxR } = tracker;
  const polygon = [];
  let visited = 0;
  let sum = 0;
  let minR = Infinity;
  let maxRad = 0;
  for (let i = 0; i < bins; i++) {
    const r = maxR[i];
    if (!(r > 0)) continue;
    visited++;
    sum += r;
    if (r < minR) minR = r;
    if (r > maxRad) maxRad = r;
    const theta = ((i + 0.5) / bins) * 2 * Math.PI;
    polygon.push({ x: r * Math.cos(theta), y: r * Math.sin(theta), r, theta });
  }
  const coverage = visited / bins;
  if (visited < 2) {
    return { coverage, visitedBins: visited, meanRadius: null, errorPct: null, minRadius: null, maxRadius: null, polygon };
  }
  const meanRadius = sum / visited;
  let errSum = 0;
  for (const p of polygon) errSum += Math.abs(p.r - meanRadius) / meanRadius;
  return {
    coverage,
    visitedBins: visited,
    meanRadius,
    errorPct: (errSum / visited) * 100,
    minRadius: minR,
    maxRadius: maxRad,
    polygon,
  };
}

/** Analog trigger (0..1) remapped so `low` reads 0 and `high` reads 1. */
export function triggerResponse(value, { low = 0, high = 1 } = {}) {
  if (!(high > low)) return 0;
  return clamp((value - low) / (high - low), 0, 1);
}

// ---------------------------------------------------------------------------
// Sony HID input reports (best-effort, USB report 0x01 only)
// ---------------------------------------------------------------------------

/**
 * Byte offsets for USB input report 0x01. Offsets include the report ID at byte 0.
 * Best-effort: taken from community documentation of the Linux hid-sony and
 * hid-playstation drivers, not verified against every firmware revision.
 */
export const DS4_USB_OFFSETS = {
  reportId: 0, lx: 1, ly: 2, rx: 3, ry: 4,
  buttons0: 5, buttons1: 6, buttons2: 7, l2Analog: 8, r2Analog: 9,
  sensorTimestamp: '10-11 (u16 LE)', gyro: '13-18 (3 x s16 LE: X, Y, Z)', accel: '19-24 (3 x s16 LE: X, Y, Z)',
};

export const DUALSENSE_USB_OFFSETS = {
  reportId: 0, lx: 1, ly: 2, rx: 3, ry: 4,
  l2Analog: 5, r2Analog: 6, sequence: 7,
  buttons0: 8, buttons1: 9, buttons2: 10,
  gyro: '16-21 (3 x s16 LE: X, Y, Z)', accel: '22-27 (3 x s16 LE: X, Y, Z)', sensorTimestamp: '28-31 (u32 LE)',
};

// Approximate scale factors (uncalibrated): raw / 1024 deg/s and raw / 8192 g.
export const SONY_GYRO_LSB_PER_DPS = 1024;
export const SONY_ACCEL_LSB_PER_G = 8192;

const DPAD_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function sonyFamily(productId) {
  if (DS4_PRODUCT_IDS.includes(productId)) return 'DS4';
  if (DUALSENSE_PRODUCT_IDS.includes(productId)) return 'DualSense';
  return null;
}

export function hexDump(bytes, perLine = 16) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const slice = Array.from(bytes.slice(i, i + perLine));
    lines.push(`${i.toString(16).padStart(4, '0')}  ${slice.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
  return lines.join('\n');
}

const toAxis = (v) => (v - 127.5) / 127.5;
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const s16le = (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function sensors(b, gyroOff, accelOff) {
  const gyroRaw = [s16le(b, gyroOff), s16le(b, gyroOff + 2), s16le(b, gyroOff + 4)];
  const accelRaw = [s16le(b, accelOff), s16le(b, accelOff + 2), s16le(b, accelOff + 4)];
  return {
    gyroRaw,
    accelRaw,
    gyroDps: gyroRaw.map((v) => v / SONY_GYRO_LSB_PER_DPS),
    accelG: accelRaw.map((v) => v / SONY_ACCEL_LSB_PER_G),
  };
}

/** Decode DS4 USB input report 0x01 (64 bytes, report ID at byte 0). Returns null for other data. */
export function decodeDs4UsbReport(bytes) {
  const b = bytes;
  if (!b || b.length < 25 || b[0] !== 0x01) return null;
  const face = b[5];
  const shoulders = b[6];
  const system = b[7];
  return {
    family: 'DS4',
    sticks: {
      left: { x: toAxis(b[1]), y: toAxis(b[2]) },
      right: { x: toAxis(b[3]), y: toAxis(b[4]) },
    },
    triggers: { l2: b[8] / 255, r2: b[9] / 255 },
    dpad: (face & 0x0f) < 8 ? DPAD_DIRS[face & 0x0f] : 'released',
    buttons: {
      square: !!(face & 0x10), cross: !!(face & 0x20), circle: !!(face & 0x40), triangle: !!(face & 0x80),
      l1: !!(shoulders & 0x01), r1: !!(shoulders & 0x02), l2Digital: !!(shoulders & 0x04), r2Digital: !!(shoulders & 0x08),
      share: !!(shoulders & 0x10), options: !!(shoulders & 0x20), l3: !!(shoulders & 0x40), r3: !!(shoulders & 0x80),
      ps: !!(system & 0x01), touchpad: !!(system & 0x02),
    },
    sensorTimestamp: u16le(b, 10),
    ...sensors(b, 13, 19),
  };
}

/** Decode DualSense USB input report 0x01 (report ID at byte 0). Returns null for other data. */
export function decodeDualSenseUsbReport(bytes) {
  const b = bytes;
  if (!b || b.length < 32 || b[0] !== 0x01) return null;
  const face = b[8];
  const shoulders = b[9];
  const system = b[10];
  return {
    family: 'DualSense',
    sticks: {
      left: { x: toAxis(b[1]), y: toAxis(b[2]) },
      right: { x: toAxis(b[3]), y: toAxis(b[4]) },
    },
    triggers: { l2: b[5] / 255, r2: b[6] / 255 },
    sequence: b[7],
    dpad: (face & 0x0f) < 8 ? DPAD_DIRS[face & 0x0f] : 'released',
    buttons: {
      square: !!(face & 0x10), cross: !!(face & 0x20), circle: !!(face & 0x40), triangle: !!(face & 0x80),
      l1: !!(shoulders & 0x01), r1: !!(shoulders & 0x02), l2Digital: !!(shoulders & 0x04), r2Digital: !!(shoulders & 0x08),
      create: !!(shoulders & 0x10), options: !!(shoulders & 0x20), l3: !!(shoulders & 0x40), r3: !!(shoulders & 0x80),
      ps: !!(system & 0x01), touchpad: !!(system & 0x02), mute: !!(system & 0x04),
    },
    sensorTimestamp: u32le(b, 28),
    ...sensors(b, 16, 22),
  };
}

/** Decode a report for a known Sony family, or null when that report ID is not decoded. */
export function decodeSonyReport(family, bytes) {
  if (family === 'DS4') return decodeDs4UsbReport(bytes);
  if (family === 'DualSense') return decodeDualSenseUsbReport(bytes);
  return null;
}

// ---------------------------------------------------------------------------
// Gamepad button tracker, axis range tracker, deadzone suggestion, report
// ---------------------------------------------------------------------------

/** Tracks press counts, press-to-press chatter and which buttons were ever pressed. */
export function createButtonTracker() {
  return { prev: [], counts: {}, lastPress: {}, chatter: {}, minGap: {}, everPressed: {} };
}

/**
 * Feed one frame of button states [{ pressed }] taken at nowMs. Rising edges count as presses.
 * A press within chatterMs of the previous press of the same button counts as chatter.
 */
export function updateButtonTracker(t, buttons, nowMs, { chatterMs = 50 } = {}) {
  for (let i = 0; i < buttons.length; i++) {
    const down = !!buttons[i]?.pressed;
    const was = !!t.prev[i];
    if (down) t.everPressed[i] = true;
    if (down && !was) {
      t.counts[i] = (t.counts[i] || 0) + 1;
      if (t.lastPress[i] !== undefined) {
        const dt = nowMs - t.lastPress[i];
        if (t.minGap[i] === undefined || dt < t.minGap[i]) t.minGap[i] = dt;
        if (dt < chatterMs) t.chatter[i] = (t.chatter[i] || 0) + 1;
      }
      t.lastPress[i] = nowMs;
    }
    t.prev[i] = down;
  }
  return t;
}

/** Summary of a button tracker for a pad with buttonCount buttons. */
export function buttonTrackerSummary(t, buttonCount) {
  let tested = 0;
  let totalPresses = 0;
  let totalChatter = 0;
  for (let i = 0; i < buttonCount; i++) {
    if (t.everPressed[i]) tested++;
    totalPresses += t.counts[i] || 0;
    totalChatter += t.chatter[i] || 0;
  }
  return { tested, buttonCount, totalPresses, totalChatter };
}

/** Per-axis min/max seen so far. */
export function createAxisTracker() {
  return { min: [], max: [] };
}

export function updateAxisTracker(t, axes) {
  for (let i = 0; i < axes.length; i++) {
    const v = axes[i];
    if (!Number.isFinite(v)) continue;
    if (t.min[i] === undefined || v < t.min[i]) t.min[i] = v;
    if (t.max[i] === undefined || v > t.max[i]) t.max[i] = v;
  }
  return t;
}

/** Report per axis; fullRange is true when both ends reached at least threshold (default 0.95). */
export function axisRangeReport(t, axisCount, threshold = 0.95) {
  const out = [];
  for (let i = 0; i < axisCount; i++) {
    const min = t.min[i];
    const max = t.max[i];
    out.push({
      axis: i,
      min: min ?? null,
      max: max ?? null,
      fullRange: min !== undefined && max !== undefined && min <= -threshold && max >= threshold,
    });
  }
  return out;
}

/**
 * Suggest a radial deadzone from a driftStats() result: the worst resting magnitude plus a
 * 2 % margin, rounded up to the next 1 %, never below 5 % and capped at 50 %.
 */
export function suggestDeadzone(drift, { margin = 0.02, floor = 0.05, cap = 0.5 } = {}) {
  if (!drift || !Number.isFinite(drift.maxMagnitude)) return null;
  const v = Math.ceil((drift.maxMagnitude + margin) * 100 - 1e-9) / 100;
  return Math.min(cap, Math.max(floor, v));
}

/** Plain-object report of a gamepad session, ready for JSON.stringify or formatGamepadReport(). */
export function buildGamepadReport({ pad, drift, circularity, rate, buttons, axes, deadzone }) {
  return {
    generatedBy: 'Skon USB Tool input tester',
    pad: pad ? { id: pad.id, mapping: pad.mapping || 'non-standard', buttons: pad.buttons, axes: pad.axes } : null,
    drift: drift || null,
    suggestedDeadzone: drift ? suggestDeadzone(drift) : null,
    deadzoneInUse: deadzone ?? null,
    circularity: circularity || null,
    reportRate: rate || null,
    buttons: buttons || null,
    axes: axes || null,
  };
}

export function formatGamepadReport(r) {
  const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));
  const lines = ['Gamepad test report'];
  if (r.pad) lines.push(`Pad: ${r.pad.id} (mapping ${r.pad.mapping}, ${r.pad.buttons} buttons, ${r.pad.axes} axes)`);
  if (r.drift) {
    lines.push(`Drift (${r.drift.stick || '?'} stick): avg ${f(r.drift.avgPct)}%, max ${f(r.drift.maxPct)}%, centre x ${f(r.drift.centerX, 3)} y ${f(r.drift.centerY, 3)}`);
    if (r.suggestedDeadzone !== null) lines.push(`Suggested deadzone: ${r.suggestedDeadzone.toFixed(2)}`);
  }
  if (r.circularity) lines.push(`Circularity: coverage ${f(r.circularity.coverage * 100, 0)}%, error ${f(r.circularity.errorPct)}%`);
  if (r.reportRate) lines.push(`Report rate: avg ${f(r.reportRate.avgHz, 1)} Hz, jitter ${f(r.reportRate.jitterMs)} ms`);
  if (r.buttons) lines.push(`Buttons tested: ${r.buttons.tested}/${r.buttons.buttonCount}, presses ${r.buttons.totalPresses}, chatter ${r.buttons.totalChatter}`);
  if (r.axes) lines.push('Axis range: ' + r.axes.map((a) => `[${a.axis}] ${f(a.min, 2)}..${f(a.max, 2)}${a.fullRange ? '' : ' (partial)'}`).join('  '));
  return lines.join('\n');
}
