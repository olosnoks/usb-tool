/**
 * fcCliTools.js: pure helpers for Betaflight / INAV CLI text and telemetry recordings.
 * No React, no hardware access.
 */

const CONTEXT_CMDS = new Set(['profile', 'rateprofile', 'control_profile', 'battery_profile', 'mixer_profile']);
const SKIP_CMDS = new Set(['save', 'defaults', 'batch', 'exit', 'diff', 'dump', 'help']);
const TOGGLE_CMDS = new Set(['feature', 'beeper', 'blackbox', 'map']);

/**
 * Parse CLI `diff` / `dump` text into a list of settings.
 * Returns { header, entries: Map<key, { key, command, value, line }>, count, skipped }.
 * Keys include the active profile / rateprofile so the same name in two profiles stays distinct.
 * `feature -GPS` and `feature GPS` share one key (value '-' or '+'), so a toggle is a change.
 */
export function parseCliSettings(text) {
  const entries = new Map();
  let header = '';
  let skipped = 0;
  const ctx = {};
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const body = line.replace(/^#+\s*/, '');
      if (!header && /(betaflight|inav|cleanflight)\s*\//i.test(body)) header = body;
      continue;
    }
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (CONTEXT_CMDS.has(cmd) && parts.length === 2 && /^\d+$/.test(parts[1])) {
      ctx[cmd] = parts[1];
      continue;
    }
    if (SKIP_CMDS.has(cmd)) { skipped++; continue; }
    const scope = Object.keys(ctx).map((k) => `${k} ${ctx[k]}`).join(' / ');
    const prefix = scope ? `[${scope}] ` : '';
    let key;
    let value;
    if (cmd === 'set') {
      const m = line.match(/^set\s+(\S+)\s*=\s*(.*)$/i);
      if (!m) { skipped++; continue; }
      key = `${prefix}set ${m[1]}`;
      value = m[2].trim();
    } else if (TOGGLE_CMDS.has(cmd) && parts.length >= 2) {
      const arg = parts.slice(1).join(' ');
      const neg = arg.startsWith('-');
      key = `${prefix}${cmd} ${neg ? arg.slice(1) : arg}`;
      value = neg ? '-' : '+';
    } else if (parts.length >= 2) {
      key = `${prefix}${parts[0]} ${parts[1]}`;
      value = parts.slice(2).join(' ');
    } else {
      key = `${prefix}${line}`;
      value = '';
    }
    entries.set(key, { key, command: cmd, value, line });
  }
  return { header, entries, count: entries.size, skipped };
}

/** Compare two parsed settings. Returns sorted arrays of added, removed, changed and the unchanged count. */
export function diffCliSettings(a, b) {
  const added = [];
  const removed = [];
  const changed = [];
  let same = 0;
  for (const [key, eb] of b.entries) {
    const ea = a.entries.get(key);
    if (!ea) added.push({ key, value: eb.value });
    else if (ea.value !== eb.value) changed.push({ key, from: ea.value, to: eb.value });
    else same++;
  }
  for (const [key, ea] of a.entries) {
    if (!b.entries.has(key)) removed.push({ key, value: ea.value });
  }
  const byKey = (x, y) => x.key.localeCompare(y.key);
  added.sort(byKey);
  removed.sort(byKey);
  changed.sort(byKey);
  return { added, removed, changed, same };
}

/** Group counts of entries by command, e.g. { set: 120, feature: 4 }. */
export function summarizeCliSettings(parsed) {
  const out = {};
  for (const e of parsed.entries.values()) out[e.command] = (out[e.command] || 0) + 1;
  return out;
}

const RC_COLS = 8;
const MOTOR_COLS = 8;

export const TELEMETRY_COLUMNS = [
  't_ms', 'roll_deg', 'pitch_deg', 'yaw_deg',
  'acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z',
  'vbat_v', 'current_a', 'mah_drawn', 'rssi_raw',
  ...Array.from({ length: RC_COLS }, (_, i) => `rc${i + 1}`),
  ...Array.from({ length: MOTOR_COLS }, (_, i) => `motor${i + 1}`),
];

/** Flatten a telemetry snapshot into a row aligned with TELEMETRY_COLUMNS ('' where unknown). */
export function telemetryRow(tMs, snap) {
  const s = snap || {};
  const a = s.attitude;
  const imu = s.imu;
  const an = s.analog;
  const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : '');
  return [
    Math.round(tMs),
    cell(a && a.rollDeg), cell(a && a.pitchDeg), cell(a && a.yawDeg),
    ...[0, 1, 2].map((i) => cell(imu && imu.acc[i])),
    ...[0, 1, 2].map((i) => cell(imu && imu.gyro[i])),
    cell(an && an.voltageV), cell(an && an.currentA), cell(an && an.mahDrawn), cell(an && an.rssiRaw),
    ...Array.from({ length: RC_COLS }, (_, i) => cell(s.rc && s.rc[i])),
    ...Array.from({ length: MOTOR_COLS }, (_, i) => cell(s.motors && s.motors[i])),
  ];
}

/** Build CSV text from rows made by telemetryRow. */
export function telemetryToCsv(rows) {
  return `${[TELEMETRY_COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\n')}\n`;
}
