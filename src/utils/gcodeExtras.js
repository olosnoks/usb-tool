/**
 * gcodeExtras.js - pure helpers for the G-code Sender: toolpath analysis (bounds, length,
 * time estimate, preview segments), GRBL realtime overrides, Marlin M220/M221 overrides,
 * work coordinate systems, GRBL error/alarm descriptions and macro parsing.
 * No hardware access; everything is testable offline.
 */
import { prepareGcodeLines, fmtNum } from './gcodeSender';

// --- GRBL 1.1 realtime override bytes (sent alone, never queued) ---------------------------

export const GRBL_OVERRIDE = Object.freeze({
  FEED_RESET: 0x90, FEED_PLUS_10: 0x91, FEED_MINUS_10: 0x92, FEED_PLUS_1: 0x93, FEED_MINUS_1: 0x94,
  RAPID_100: 0x95, RAPID_50: 0x96, RAPID_25: 0x97,
  SPINDLE_RESET: 0x99, SPINDLE_PLUS_10: 0x9a, SPINDLE_MINUS_10: 0x9b, SPINDLE_PLUS_1: 0x9c, SPINDLE_MINUS_1: 0x9d,
  SPINDLE_STOP: 0x9e,
});

/** Label for a realtime override byte (for the console log). */
export function overrideLabel(byte) {
  const hex = `0x${byte.toString(16).toUpperCase()}`;
  const name = Object.entries(GRBL_OVERRIDE).find(([, v]) => v === byte)?.[0];
  return `override ${name ? name.toLowerCase().replace(/_/g, ' ') : 'byte'} (${hex})`;
}

/** Marlin feedrate (M220) or flow (M221) override, percent 10-500. */
export function marlinOverrideLine(kind, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 10 || p > 500) throw new Error('Override must be between 10 and 500 percent');
  if (kind === 'feed') return `M220 S${Math.round(p)}`;
  if (kind === 'flow') return `M221 S${Math.round(p)}`;
  throw new Error('Unknown override kind');
}

// --- Work coordinate systems -------------------------------------------------------------------

export const WCS_LIST = Object.freeze(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']);

/** G10 L20 P<n> zero line for a work coordinate system (G54 = P1 ... G59 = P6). */
export function wcsZeroLine(wcs, axes) {
  const idx = WCS_LIST.indexOf(String(wcs).toUpperCase());
  if (idx < 0) throw new Error(`Unknown work coordinate system "${wcs}"`);
  const list = (Array.isArray(axes) ? axes : [axes]).map((a) => String(a).toUpperCase());
  if (list.length === 0 || list.some((a) => !['X', 'Y', 'Z'].includes(a))) throw new Error('Invalid axes');
  return `G10 L20 P${idx + 1} ${list.map((a) => `${a}0`).join(' ')}`;
}

// --- GRBL 1.1 error and alarm descriptions ---------------------------------------------------------

export const GRBL_ERRORS = Object.freeze({
  1: 'G-code letter not found (a word has no command letter)',
  2: 'Numeric value missing or badly formatted',
  3: 'Unsupported or invalid $ system command',
  4: 'Negative value for a setting that must be positive',
  5: 'Homing is not enabled in settings ($22)',
  6: 'Minimum step pulse must be at least 3 microseconds',
  7: 'EEPROM read failed; defaults restored',
  8: 'Command needs the controller to be idle (not running a job)',
  9: 'G-code locked out during alarm or jog',
  10: 'Soft limits need homing enabled first',
  11: 'Line is longer than the controller allows',
  12: 'Step rate in the setting is too high',
  13: 'Safety door detected as open',
  14: 'Build info or startup line exceeds the EEPROM line length',
  15: 'Jog target exceeds machine travel; jog ignored',
  16: 'Jog command is missing "=" or has forbidden G-code',
  17: 'Laser mode needs PWM output',
  20: 'Unsupported or invalid G-code command',
  21: 'More than one G-code command from the same modal group in one line',
  22: 'Feed rate has not been set or is undefined',
  23: 'G-code command needs an integer value',
  24: 'Two commands in one line both need axis words',
  25: 'A G-code word was repeated in the line',
  26: 'No axis words found where a command needs them',
  27: 'Line number value is invalid',
  28: 'A command is missing a required value word',
  29: 'G59.x work coordinate systems are not supported',
  30: 'G53 only works with G0 and G1',
  31: 'Axis words found in a block that does not use them',
  32: 'G2/G3 arcs need at least one axis word in the selected plane',
  33: 'Motion target is invalid',
  34: 'Arc radius value is invalid',
  35: 'G2/G3 arcs need at least one offset word in the selected plane',
  36: 'Unused value words found in the block',
  37: 'Tool length offset (G43.1) cannot apply to a non-configured axis',
  38: 'Tool number is greater than the maximum supported',
});

export const GRBL_ALARMS = Object.freeze({
  1: 'Hard limit triggered; position may be lost, re-home',
  2: 'Soft limit: the target exceeds machine travel',
  3: 'Reset while in motion; position may be lost, re-home',
  4: 'Probe fail: probe was not in the expected state at the start',
  5: 'Probe fail: probe did not contact the workpiece',
  6: 'Homing fail: reset during the homing cycle',
  7: 'Homing fail: safety door opened during homing',
  8: 'Homing fail: pull-off did not clear the limit switch',
  9: 'Homing fail: could not find the limit switch',
});

/** Human text for a GRBL `error:N` or `ALARM:N` code, or null if unknown. */
export function describeGrblCode(kind, code) {
  const table = kind === 'alarm' ? GRBL_ALARMS : GRBL_ERRORS;
  return table[Number(code)] ?? null;
}

// --- Macros ---------------------------------------------------------------------------------------

export const MAX_MACROS = 12;
export const MAX_MACRO_LINES = 200;

/** Validate a macro definition. Returns { ok, name, commands, error }. */
export function parseMacro(name, body) {
  const n = String(name ?? '').trim().slice(0, 24);
  if (!n) return { ok: false, error: 'Give the macro a name' };
  const { commands } = prepareGcodeLines(body);
  if (commands.length === 0) return { ok: false, error: 'The macro has no commands' };
  if (commands.length > MAX_MACRO_LINES) return { ok: false, error: `A macro can have at most ${MAX_MACRO_LINES} commands` };
  return { ok: true, name: n, commands };
}

// --- Toolpath analysis ------------------------------------------------------------------------------------

const WORD_RE = /([A-Z])\s*(-?\d*\.?\d+(?:e-?\d+)?)/gi;

function parseWords(cmd) {
  const words = [];
  for (const m of String(cmd).matchAll(WORD_RE)) words.push([m[1].toUpperCase(), Number(m[2])]);
  return words;
}

/**
 * Walk prepared commands and compute what the file will do. Handles G0/G1, G2/G3 (I/J/R arcs
 * in the XY plane), G17-G19, G20/G21, G90/G91, G4 dwell and F. Cutting moves use the programmed
 * feed; rapids use `rapidFeed` (mm/min) because the real rapid rate is a machine setting.
 * Arcs outside the XY plane are counted as straight chords. Canned cycles and subprograms are
 * not interpreted. The time is an estimate that ignores acceleration.
 * @param {string[]} commands
 * @param {{ rapidFeed?: number, firmware?: 'grbl'|'marlin', maxSegments?: number }} [opts]
 */
export function analyzeGcode(commands, { rapidFeed = 3000, firmware = 'grbl', maxSegments = 20000 } = {}) {
  let abs = true;
  let mm = true;
  let plane = 17;
  let motion = null;
  let feed = 0;
  const pos = { X: 0, Y: 0, Z: 0 };
  const min = { X: Infinity, Y: Infinity, Z: Infinity };
  const max = { X: -Infinity, Y: -Infinity, Z: -Infinity };
  const segments = [];   // [x0, y0, x1, y1, kind] kind: 0 rapid, 1 cut
  let seconds = 0;
  let cutLength = 0;
  let rapidLength = 0;
  let maxFeed = 0;
  let spindleOn = false;
  let toolChanges = 0;
  let noFeedMoves = 0;
  let dropped = 0;
  const warnings = new Set();

  const touch = (p) => {
    for (const a of ['X', 'Y', 'Z']) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  };
  touch(pos);
  let touched = false;

  const addSeg = (from, to, kind) => {
    if (segments.length < maxSegments) segments.push([from.X, from.Y, to.X, to.Y, kind]);
    else dropped++;
  };

  commands.forEach((cmd) => {
    const words = parseWords(cmd);
    const val = {};
    const gs = [];
    const ms = [];
    for (const [l, v] of words) {
      if (l === 'G') gs.push(v);
      else if (l === 'M') ms.push(v);
      else val[l] = v;
    }
    for (const g of gs) {
      if (g === 90) abs = true;
      else if (g === 91) { abs = false; warnings.add('Relative mode (G91) is used'); }
      else if (g === 20) { mm = false; warnings.add('The file uses inches (G20); values are converted to mm'); }
      else if (g === 21) mm = true;
      else if (g === 17 || g === 18 || g === 19) plane = g;
      else if (g === 0 || g === 1 || g === 2 || g === 3) motion = g;
      else if (g === 4) {
        const p = val.P ?? val.S ?? 0;
        // GRBL: P is seconds. Marlin: P is milliseconds, S is seconds.
        seconds += firmware === 'marlin' && val.P !== undefined ? p / 1000 : p;
      }
    }
    for (const m of ms) {
      if (m === 3 || m === 4) spindleOn = true;
      else if (m === 5) spindleOn = false;
      else if (m === 6) toolChanges++;
    }
    const k = mm ? 1 : 25.4;
    if (val.F !== undefined) { feed = val.F * k; maxFeed = Math.max(maxFeed, feed); }

    const hasAxis = 'X' in val || 'Y' in val || 'Z' in val;
    const moving = hasAxis && (gs.some((g) => g <= 3) || (motion !== null && !gs.some((g) => [10, 28, 30, 53, 92].includes(g))));
    if (!moving) return;
    const target = { ...pos };
    for (const a of ['X', 'Y', 'Z']) {
      if (val[a] === undefined) continue;
      target[a] = abs ? val[a] * k : pos[a] + val[a] * k;
    }
    const mode = gs.find((g) => g <= 3) ?? motion;
    if (mode === 0) {
      const d = Math.hypot(target.X - pos.X, target.Y - pos.Y, target.Z - pos.Z);
      rapidLength += d;
      seconds += (d / rapidFeed) * 60;
      addSeg(pos, target, 0);
    } else if (mode === 1) {
      const d = Math.hypot(target.X - pos.X, target.Y - pos.Y, target.Z - pos.Z);
      cutLength += d;
      if (feed > 0) seconds += (d / feed) * 60; else if (d > 0) noFeedMoves++;
      addSeg(pos, target, 1);
    } else if (mode === 2 || mode === 3) {
      const cw = mode === 2;
      let arcOk = plane === 17;
      let cx = 0; let cy = 0; let r = 0;
      if (arcOk) {
        if ('I' in val || 'J' in val) {
          cx = pos.X + (val.I ?? 0) * k;
          cy = pos.Y + (val.J ?? 0) * k;
          r = Math.hypot(pos.X - cx, pos.Y - cy);
        } else if ('R' in val) {
          const R = val.R * k;
          const dx = target.X - pos.X; const dy = target.Y - pos.Y;
          const chord = Math.hypot(dx, dy);
          if (chord === 0 || Math.abs(R) < chord / 2 - 1e-9) arcOk = false;
          else {
            const h = Math.sqrt(Math.max(0, R * R - (chord / 2) ** 2));
            const sign = (cw ? 1 : -1) * (R < 0 ? -1 : 1);
            const mx = (pos.X + target.X) / 2; const my = (pos.Y + target.Y) / 2;
            // CW with a positive R: centre lies right of the direction of travel
            cx = mx + sign * (h * dy) / chord;
            cy = my - sign * (h * dx) / chord;
            r = Math.abs(R);
          }
        } else arcOk = false;
        if (r === 0) arcOk = false;
      }
      if (!arcOk) {
        const d = Math.hypot(target.X - pos.X, target.Y - pos.Y, target.Z - pos.Z);
        cutLength += d;
        if (feed > 0) seconds += (d / feed) * 60; else if (d > 0) noFeedMoves++;
        addSeg(pos, target, 1);
        if (plane !== 17) warnings.add('Arcs outside the XY plane are treated as straight lines');
      } else {
        const a0 = Math.atan2(pos.Y - cy, pos.X - cx);
        const a1 = Math.atan2(target.Y - cy, target.X - cx);
        let sweep = a1 - a0;
        if (cw) { while (sweep >= 0) sweep -= 2 * Math.PI; } else { while (sweep <= 0) sweep += 2 * Math.PI; }
        if (Math.abs(target.X - pos.X) < 1e-9 && Math.abs(target.Y - pos.Y) < 1e-9) sweep = cw ? -2 * Math.PI : 2 * Math.PI;
        const steps = Math.max(2, Math.min(90, Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
        let prev = { ...pos };
        let len = 0;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const a = a0 + sweep * t;
          const pt = { X: cx + r * Math.cos(a), Y: cy + r * Math.sin(a), Z: pos.Z + (target.Z - pos.Z) * t };
          if (i === steps) { pt.X = target.X; pt.Y = target.Y; }
          len += Math.hypot(pt.X - prev.X, pt.Y - prev.Y, pt.Z - prev.Z);
          addSeg(prev, pt, 1);
          touch(pt);
          prev = pt;
        }
        cutLength += len;
        if (feed > 0) seconds += (len / feed) * 60; else if (len > 0) noFeedMoves++;
      }
    }
    pos.X = target.X; pos.Y = target.Y; pos.Z = target.Z;
    touch(pos);
    touched = true;
  });

  if (noFeedMoves > 0) warnings.add(`${noFeedMoves} cutting move(s) have no feed rate (F) set; their time is not counted`);
  if (dropped > 0) warnings.add(`Preview shows the first ${segments.length} segments only`);
  const bounds = touched ? { min: { ...min }, max: { ...max } } : null;
  return {
    bounds,
    size: bounds ? { X: max.X - min.X, Y: max.Y - min.Y, Z: max.Z - min.Z } : null,
    cutLength, rapidLength, maxFeed,
    seconds: Math.round(seconds),
    spindleLeftOn: spindleOn,
    toolChanges,
    segments,
    warnings: [...warnings],
  };
}

/** `1h 02m 03s` style duration; '-' for non-finite. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/**
 * Compare file bounds against GRBL max travel ($130-$132 from a `$$` dump). Work offsets are
 * unknown here, so this only compares the file's own size with the travel of each axis.
 * @returns {string[]} warning texts
 */
export function travelWarnings(size, settings) {
  if (!size || !Array.isArray(settings)) return [];
  const out = [];
  for (const [axis, id] of [['X', 130], ['Y', 131], ['Z', 132]]) {
    const s = settings.find((x) => x.id === id);
    const travel = s ? Number(s.value) : NaN;
    if (Number.isFinite(travel) && travel > 0 && size[axis] > travel) {
      out.push(`File is ${fmtNum(size[axis])} mm along ${axis}, but $${id} max travel is ${fmtNum(travel)} mm`);
    }
  }
  return out;
}
