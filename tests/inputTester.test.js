import { describe, it, expect } from 'vitest';
import {
  intervalStats, updateRateFromTimestamps, eventsPerSecond, summarizeSeries, histogram,
  classifyPress, analyzeClicks, normalizeWheelDelta, summarizeWheel,
  distanceToInches, sumMovement, dpiFromCounts,
  applyRadialDeadzone, driftStats, createCircularityTracker, addCirclePoint, circularityReport,
  triggerResponse, sonyFamily, decodeDs4UsbReport, decodeDualSenseUsbReport, decodeSonyReport, hexDump,
} from '../src/utils/inputTester.js';

const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('rate statistics', () => {
  it('computes min/avg/max Hz and zero jitter for a steady 100 Hz stream', () => {
    const s = intervalStats([10, 10, 10, 10]);
    expect(s.count).toBe(4);
    close(s.avgHz, 100);
    close(s.minHz, 100);
    close(s.maxHz, 100);
    close(s.jitterMs, 0);
  });

  it('reports min/max Hz from the longest and shortest intervals', () => {
    const s = intervalStats([8, 12]);
    close(s.avgMs, 10);
    close(s.minHz, 1000 / 12);
    close(s.maxHz, 1000 / 8);
    close(s.jitterMs, 2);
  });

  it('returns nulls for empty input', () => {
    const s = intervalStats([]);
    expect(s.count).toBe(0);
    expect(s.avgHz).toBeNull();
  });

  it('ignores repeated gamepad timestamps when estimating the report rate', () => {
    // Two distinct reports every 4 ms (250 Hz), with repeated timestamps in between.
    const r = updateRateFromTimestamps([1000, 1000, 1004, 1004, 1004, 1008, 1008]);
    expect(r.reports).toBe(3);
    close(r.avgHz, 250);
  });

  it('counts events inside the trailing window only', () => {
    const ts = [0, 100, 500, 900, 1000, 1500];
    // window [500, 1500]: 500, 900, 1000, 1500 (both ends inclusive)
    expect(eventsPerSecond(ts, 1500, 1000)).toBe(4);
    expect(eventsPerSecond(ts, 1500, 500)).toBe(4); // 2 events in [1000, 1500] = 4 per second
    expect(eventsPerSecond([], 1000, 1000)).toBe(0);
  });

  it('summarises a series as min / avg / max', () => {
    expect(summarizeSeries([])).toBeNull();
    const s = summarizeSeries([100, 200, 300, NaN]);
    expect(s).toEqual({ count: 3, min: 100, avg: 200, max: 300 });
  });

  it('builds a jitter histogram with overflow and underflow buckets', () => {
    const h = histogram([0.1, 0.6, 0.6, 1.2, 1.9, 2.9, 99, -1], { binWidth: 0.5, bins: 4, start: 0 });
    expect(h.counts).toEqual([1, 2, 1, 1]);
    expect(h.overflow).toBe(2); // 2.9 and 99 fall past the last bin
    expect(h.underflow).toBe(1);
    expect(h.total).toBe(8);
  });
});

describe('mouse clicks and chatter', () => {
  it('classifies press-to-press intervals', () => {
    expect(classifyPress(20)).toBe('chatter');
    expect(classifyPress(49.9)).toBe('chatter');
    expect(classifyPress(120)).toBe('double');
    expect(classifyPress(500)).toBe('double');
    expect(classifyPress(501)).toBe('separate');
  });

  it('flags accidental double clicks as chatter and real ones as double clicks, per button', () => {
    const presses = [
      { button: 0, time: 1000 },
      { button: 0, time: 1025 }, // 25 ms: chatter
      { button: 0, time: 1200 }, // 175 ms: double
      { button: 2, time: 1300 }, // first right press, no pair
      { button: 0, time: 2500 }, // 1300 ms: separate
    ];
    const a = analyzeClicks(presses);
    expect(a.total).toBe(5);
    expect(a.perButton).toEqual({ 0: 4, 2: 1 });
    expect(a.chatter).toBe(1);
    expect(a.doubleClicks).toBe(1);
    expect(a.avgDoubleIntervalMs).toBe(175);
    expect(a.pairs.map((p) => p.kind)).toEqual(['chatter', 'double', 'separate']);
  });

  it('honours custom chatter and double-click thresholds', () => {
    const presses = [{ button: 1, time: 0 }, { button: 1, time: 80 }];
    expect(analyzeClicks(presses).chatter).toBe(0);
    expect(analyzeClicks(presses, { chatterMs: 100 }).chatter).toBe(1);
    expect(analyzeClicks(presses, { doubleClickMs: 50 }).doubleClicks).toBe(0);
  });

  it('avgDoubleIntervalMs is null when there are no double clicks', () => {
    expect(analyzeClicks([{ button: 0, time: 0 }]).avgDoubleIntervalMs).toBeNull();
  });
});

describe('wheel', () => {
  it('normalises line and page delta modes to pixels', () => {
    expect(normalizeWheelDelta(3, 0)).toBe(3);
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(1, 2, { pageHeightPx: 600 })).toBe(600);
  });

  it('summarises wheel entries', () => {
    const s = summarizeWheel([{ dx: 0, dy: -100 }, { dx: 0, dy: -100 }, { dx: 20, dy: 100 }]);
    expect(s).toEqual({ events: 3, sumX: 20, sumY: -100, up: 2, down: 1, left: 0, right: 1 });
  });
});

describe('DPI estimator', () => {
  it('converts cm and inches', () => {
    close(distanceToInches(2.54, 'cm'), 1);
    expect(distanceToInches(3, 'in')).toBe(3);
    expect(() => distanceToInches(0, 'in')).toThrow();
    expect(() => distanceToInches(1, 'mm')).toThrow();
  });

  it('sums absolute x movement, absolute y movement, or path length', () => {
    const moves = [{ dx: 10, dy: 0 }, { dx: -4, dy: 3 }];
    expect(sumMovement(moves, 'x')).toBe(14);
    expect(sumMovement(moves, 'y')).toBe(3);
    close(sumMovement(moves, 'path'), 10 + 5);
  });

  it('computes counts per inch: 800 counts over 1 inch is 800 DPI', () => {
    const r = dpiFromCounts(800, 1, 'in');
    expect(r.dpi).toBe(800);
    close(r.countsPerInch, 800);
  });

  it('computes DPI for a 2.54 cm move of 1600 counts', () => {
    const r = dpiFromCounts(1600, 2.54, 'cm');
    close(r.inches, 1);
    expect(r.dpi).toBe(1600);
  });

  it('returns null when no counts were measured', () => {
    expect(dpiFromCounts(0, 2, 'in')).toBeNull();
  });
});

describe('deadzone', () => {
  it('reads zero inside the deadzone', () => {
    const r = applyRadialDeadzone(0.05, -0.05, 0.1);
    expect(r.inside).toBe(true);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('rescales the outside of the ring so full deflection still reads 1', () => {
    const r = applyRadialDeadzone(1, 0, 0.2);
    expect(r.inside).toBe(false);
    close(r.scaled, 1);
    close(r.x, 1);
    close(r.y, 0);
  });

  it('keeps direction while rescaling a diagonal', () => {
    const x = 0.6;
    const y = 0.8; // magnitude 1
    const r = applyRadialDeadzone(x, y, 0.5);
    close(r.scaled, 1);
    close(r.x, 0.6);
    close(r.y, 0.8);
  });

  it('treats a zero vector as inside', () => {
    expect(applyRadialDeadzone(0, 0, 0.1).inside).toBe(true);
  });
});

describe('drift at rest', () => {
  it('reports average and max magnitude in percent', () => {
    const d = driftStats([{ x: 0.01, y: 0 }, { x: 0, y: 0.03 }, { x: -0.02, y: 0 }]);
    expect(d.count).toBe(3);
    close(d.avgMagnitude, (0.01 + 0.03 + 0.02) / 3);
    close(d.avgPct, (0.06 / 3) * 100);
    close(d.maxPct, 3);
    close(d.maxAxisPct, 3);
    close(d.centerX, -0.01 / 3);
  });

  it('returns null without samples', () => {
    expect(driftStats([])).toBeNull();
  });
});

describe('circularity', () => {
  function feedCircle(tracker, radius, steps = 720) {
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      addCirclePoint(tracker, radius * Math.cos(t), radius * Math.sin(t));
    }
  }

  it('scores a perfect unit circle as 0 % error with full coverage', () => {
    const tr = createCircularityTracker();
    feedCircle(tr, 1);
    const r = circularityReport(tr);
    expect(r.coverage).toBe(1);
    expect(r.visitedBins).toBe(360);
    close(r.meanRadius, 1, 1e-9);
    close(r.errorPct, 0, 1e-9);
  });

  it('scores a square gate (max extent at the corners) with a positive error', () => {
    const tr = createCircularityTracker();
    // Walk the boundary of a square with corners at (+-1, +-1); radius goes from 1 to sqrt(2).
    for (let i = 0; i < 4000; i++) {
      const t = (i / 4000) * 2 * Math.PI;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const k = 1 / Math.max(Math.abs(c), Math.abs(s));
      addCirclePoint(tr, c * k, s * k);
    }
    const r = circularityReport(tr);
    expect(r.errorPct).toBeGreaterThan(5);
    expect(r.errorPct).toBeLessThan(15);
    expect(r.maxRadius).toBeGreaterThan(r.minRadius);
  });

  it('reports partial coverage when only part of the rotation was made', () => {
    const tr = createCircularityTracker();
    for (let i = 0; i < 900; i++) {
      const t = (i / 900) * Math.PI; // upper half only, 0.2 degree steps
      addCirclePoint(tr, Math.cos(t), Math.sin(t));
    }
    const r = circularityReport(tr);
    expect(r.coverage).toBeLessThan(0.6);
    expect(r.coverage).toBeGreaterThan(0.4);
  });

  it('ignores the centre and returns null metrics with fewer than two bins', () => {
    const tr = createCircularityTracker();
    addCirclePoint(tr, 0, 0);
    addCirclePoint(tr, 0.5, 0);
    const r = circularityReport(tr);
    expect(r.visitedBins).toBe(1);
    expect(r.errorPct).toBeNull();
  });
});

describe('triggers', () => {
  it('remaps low/high thresholds to 0..1', () => {
    expect(triggerResponse(0.2, { low: 0.2, high: 0.8 })).toBe(0);
    close(triggerResponse(0.5, { low: 0.2, high: 0.8 }), 0.5);
    expect(triggerResponse(0.95, { low: 0.2, high: 0.8 })).toBe(1);
    expect(triggerResponse(0.5, { low: 0.5, high: 0.5 })).toBe(0);
  });
});

// Build a 64-byte USB 0x01 report with the given (offset -> value) writes.
function report(id, writes) {
  const b = new Uint8Array(64);
  b[0] = id;
  for (const [off, v] of Object.entries(writes)) b[Number(off)] = v;
  return b;
}

describe('Sony HID decoders', () => {
  it('maps product IDs to families', () => {
    expect(sonyFamily(0x05c4)).toBe('DS4');
    expect(sonyFamily(0x09cc)).toBe('DS4');
    expect(sonyFamily(0x0ce6)).toBe('DualSense');
    expect(sonyFamily(0x0df2)).toBe('DualSense');
    expect(sonyFamily(0x1234)).toBeNull();
  });

  it('decodes DS4 USB 0x01: sticks, buttons, dpad, triggers, gyro and accel', () => {
    const b = report(0x01, {
      1: 255, 2: 128, 3: 0, 4: 127, // LX=+0.99, LY~0, RX=-1, RY~0
      5: 0x20 | 0x03,              // cross + dpad value 3 (SE)
      6: 0x01 | 0x40,              // L1 + L3
      7: 0x01,                     // PS
      8: 255, 9: 0,                // L2 analog full, R2 released
      13: 0x00, 14: 0x04,          // gyro X = 1024 -> 1 deg/s
      19: 0x00, 20: 0x20,          // accel X = 8192 -> 1 g
      21: 0x00, 22: 0xe0,          // accel Y = -8192 -> -1 g
    });
    const d = decodeDs4UsbReport(b);
    expect(d.family).toBe('DS4');
    close(d.sticks.left.x, 1, 0.01);
    close(d.sticks.right.x, -1, 0.01);
    expect(d.dpad).toBe('SE');
    expect(d.buttons.cross).toBe(true);
    expect(d.buttons.square).toBe(false);
    expect(d.buttons.l1).toBe(true);
    expect(d.buttons.l3).toBe(true);
    expect(d.buttons.ps).toBe(true);
    close(d.triggers.l2, 1);
    expect(d.triggers.r2).toBe(0);
    expect(d.gyroRaw[0]).toBe(1024);
    close(d.gyroDps[0], 1);
    expect(d.accelRaw[0]).toBe(8192);
    close(d.accelG[0], 1);
    expect(d.accelRaw[1]).toBe(-8192);
    close(d.accelG[1], -1);
  });

  it('reads DS4 dpad 8 as released and rejects reports with the wrong ID', () => {
    expect(decodeDs4UsbReport(report(0x01, { 5: 0x08 })).dpad).toBe('released');
    expect(decodeDs4UsbReport(report(0x11, {}))).toBeNull();
    expect(decodeDs4UsbReport(new Uint8Array(10))).toBeNull();
  });

  it('decodes DualSense USB 0x01: face/shoulder/system bits, triggers, gyro and accel', () => {
    const b = report(0x01, {
      1: 0, 2: 0, 3: 128, 4: 128,
      5: 255, 6: 128,              // L2 analog full, R2 half
      8: 0x10 | 0x02,              // square + dpad value 2 (E)
      9: 0x10 | 0x20,              // create + options
      10: 0x04,                    // mute
      16: 0x00, 17: 0x08,          // gyro X = 2048 -> 2 deg/s
      22: 0x00, 23: 0x40,          // accel X = 16384 -> 2 g
      28: 0x78, 29: 0x56, 30: 0x34, 31: 0x12,
    });
    const d = decodeDualSenseUsbReport(b);
    expect(d.family).toBe('DualSense');
    expect(d.dpad).toBe('E');
    expect(d.buttons.square).toBe(true);
    expect(d.buttons.create).toBe(true);
    expect(d.buttons.options).toBe(true);
    expect(d.buttons.mute).toBe(true);
    expect(d.buttons.ps).toBe(false);
    close(d.triggers.l2, 1);
    close(d.triggers.r2, 128 / 255);
    close(d.gyroDps[0], 2);
    close(d.accelG[0], 2);
    expect(d.sensorTimestamp).toBe(0x12345678);
  });

  it('dispatches by family and returns null for an unknown family', () => {
    const b = report(0x01, {});
    expect(decodeSonyReport('DS4', b).family).toBe('DS4');
    expect(decodeSonyReport('DualSense', b).family).toBe('DualSense');
    expect(decodeSonyReport(null, b)).toBeNull();
  });

  it('dumps bytes as hex lines with offsets', () => {
    const txt = hexDump(new Uint8Array([1, 0xab, 0xff, 0, 2]), 4);
    expect(txt).toBe('0000  01 ab ff 00\n0004  02');
  });
});

import {
  createButtonTracker, updateButtonTracker, buttonTrackerSummary, createAxisTracker, updateAxisTracker,
  axisRangeReport, suggestDeadzone, buildGamepadReport, formatGamepadReport,
} from '../src/utils/inputTester.js';

describe('gamepad button and axis trackers', () => {
  it('counts rising edges and flags chatter', () => {
    const t = createButtonTracker();
    const dn = [{ pressed: true }, { pressed: false }];
    const up = [{ pressed: false }, { pressed: false }];
    updateButtonTracker(t, dn, 0);
    updateButtonTracker(t, dn, 16); // still held: no new press
    updateButtonTracker(t, up, 32);
    updateButtonTracker(t, dn, 48); // 48 ms after first press: chatter
    updateButtonTracker(t, up, 64);
    updateButtonTracker(t, dn, 500);
    expect(t.counts[0]).toBe(3);
    expect(t.chatter[0]).toBe(1);
    expect(t.minGap[0]).toBe(48);
    expect(buttonTrackerSummary(t, 2)).toEqual({ tested: 1, buttonCount: 2, totalPresses: 3, totalChatter: 1 });
  });
  it('reports axis range', () => {
    const t = createAxisTracker();
    updateAxisTracker(t, [-1, 0.5]);
    updateAxisTracker(t, [1, 0.6]);
    const r = axisRangeReport(t, 3);
    expect(r[0].fullRange).toBe(true);
    expect(r[1].fullRange).toBe(false);
    expect(r[2].min).toBeNull();
  });
  it('suggests a deadzone with margin, floor and cap', () => {
    expect(suggestDeadzone({ maxMagnitude: 0.1 })).toBe(0.12);
    expect(suggestDeadzone({ maxMagnitude: 0 })).toBe(0.05);
    expect(suggestDeadzone({ maxMagnitude: 0.9 })).toBe(0.5);
    expect(suggestDeadzone(null)).toBeNull();
  });
  it('builds and formats a report', () => {
    const r = buildGamepadReport({
      pad: { id: 'X', mapping: 'standard', buttons: 17, axes: 4 },
      drift: { stick: 'left', avgPct: 1, maxPct: 3, centerX: 0.01, centerY: 0, maxMagnitude: 0.03 },
      buttons: { tested: 2, buttonCount: 17, totalPresses: 4, totalChatter: 0 },
    });
    expect(r.suggestedDeadzone).toBe(0.05);
    const txt = formatGamepadReport(r);
    expect(txt).toContain('Pad: X');
    expect(txt).toContain('Suggested deadzone: 0.05');
    expect(txt).toContain('Buttons tested: 2/17');
  });
});
