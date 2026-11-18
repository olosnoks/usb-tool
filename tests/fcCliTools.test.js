import { describe, it, expect } from 'vitest';
import { parseCliSettings, diffCliSettings, summarizeCliSettings, telemetryRow, telemetryToCsv, TELEMETRY_COLUMNS } from '../src/utils/fcCliTools';

const A = `# Betaflight / STM32F405 (S405) 4.4.2 Jan  1 2023 / 10:00:00 (abc) MSP API: 1.45
# diff all
# start the command batch
batch start
feature -GPS
feature AIRMODE
set gyro_lpf1_static_hz = 300
profile 0
set p_pitch = 45
rateprofile 0
set roll_rc_rate = 7
aux 0 0 0 1700 2100 0 0
save
`;
const B = `# Betaflight / STM32F405 (S405) 4.4.3 Jan  1 2024
feature GPS
feature AIRMODE
set gyro_lpf1_static_hz = 250
profile 0
set p_pitch = 45
set d_pitch = 30
rateprofile 0
aux 0 0 0 1600 2100 0 0
`;

describe('parseCliSettings', () => {
  it('reads header, scopes profile settings and normalises toggles', () => {
    const p = parseCliSettings(A);
    expect(p.header).toContain('Betaflight / STM32F405');
    expect(p.entries.get('set gyro_lpf1_static_hz').value).toBe('300');
    expect(p.entries.get('[profile 0] set p_pitch').value).toBe('45');
    expect(p.entries.get('[profile 0 / rateprofile 0] set roll_rc_rate').value).toBe('7');
    expect(p.entries.get('feature GPS').value).toBe('-');
    expect(p.entries.get('[profile 0 / rateprofile 0] aux 0').value).toBe('0 0 1700 2100 0 0');
    expect(p.skipped).toBe(2);
  });
  it('handles empty input', () => {
    expect(parseCliSettings('').count).toBe(0);
  });
  it('summarises by command', () => {
    expect(summarizeCliSettings(parseCliSettings(A))).toEqual({ feature: 2, set: 3, aux: 1 });
  });
});

describe('diffCliSettings', () => {
  it('finds added, removed and changed', () => {
    const d = diffCliSettings(parseCliSettings(A), parseCliSettings(B));
    expect(d.changed.map((c) => c.key)).toEqual(expect.arrayContaining(['feature GPS', 'set gyro_lpf1_static_hz']));
    expect(d.added.map((c) => c.key)).toEqual(['[profile 0] set d_pitch']);
    expect(d.removed.map((c) => c.key)).toContain('[profile 0 / rateprofile 0] set roll_rc_rate');
    expect(d.same).toBe(2);
  });
});

describe('telemetry csv', () => {
  it('aligns row with columns and leaves unknown cells empty', () => {
    const row = telemetryRow(12.4, { attitude: { rollDeg: 1.5, pitchDeg: -2, yawDeg: 90 }, rc: [1500, 1000], motors: [1000] });
    expect(row).toHaveLength(TELEMETRY_COLUMNS.length);
    expect(row[0]).toBe(12);
    expect(row[1]).toBe(1.5);
    expect(row[4]).toBe('');
    expect(row[TELEMETRY_COLUMNS.indexOf('rc2')]).toBe(1000);
    expect(row[TELEMETRY_COLUMNS.indexOf('motor1')]).toBe(1000);
    const csv = telemetryToCsv([row]);
    expect(csv.split('\n')[0]).toBe(TELEMETRY_COLUMNS.join(','));
    expect(csv.split('\n')).toHaveLength(3);
  });
});
