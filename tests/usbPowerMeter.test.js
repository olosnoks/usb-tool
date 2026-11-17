import { describe, it, expect } from 'vitest';
import {
  parseRuiDengDump,
  extractRuiDengFrames,
  crc8Fnirsi,
  fnirsiCommand,
  decodeFnirsiPacket,
  fnirsiSamples,
  createSessionStats,
  addSessionSample,
  samplesToCsv,
  RUIDENG_FRAME_LEN,
  RUIDENG_MODELS,
} from '../src/utils/usbPowerMeter';

// Build a RuiDeng 130-byte dump from the documented layout (big-endian).
function ruiDengDump(f = {}) {
  const b = new Uint8Array(RUIDENG_FRAME_LEN);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, f.id ?? 0x09c9);
  dv.setUint16(2, f.voltRaw ?? 5123);
  dv.setUint16(4, f.ampRaw ?? 12345);
  dv.setUint32(6, f.powerRaw ?? 6321);
  dv.setUint16(10, f.tempC ?? 31);
  dv.setUint16(12, f.tempF ?? 88);
  dv.setUint16(14, f.group ?? 3);
  const groups = f.groups ?? [];
  for (let i = 0; i < 10; i++) {
    const g = groups[i] ?? [0, 0];
    dv.setUint32(16 + 8 * i, g[0]);
    dv.setUint32(20 + 8 * i, g[1]);
  }
  dv.setUint16(96, f.dPlusRaw ?? 330);
  dv.setUint16(98, f.dMinusRaw ?? 12);
  dv.setUint16(100, f.mode ?? 2);
  dv.setUint32(102, f.recMah ?? 0);
  dv.setUint32(106, f.recMwh ?? 0);
  dv.setUint16(110, f.thresholdRaw ?? 50);
  dv.setUint32(112, f.recSeconds ?? 0);
  dv.setUint16(116, f.recording ?? 0);
  dv.setUint16(118, f.timeout ?? 5);
  dv.setUint16(120, f.backlight ?? 3);
  dv.setUint32(122, f.resistanceRaw ?? 0);
  dv.setUint16(126, f.screen ?? 1);
  return b;
}

describe('RuiDeng UM25C / UM24C / UM34C dump', () => {
  it('decodes a UM25C dump with mV volts and 0.1 mA current', () => {
    const d = parseRuiDengDump(ruiDengDump({ id: 0x09c9, voltRaw: 5123, ampRaw: 12345, powerRaw: 6321 }));
    expect(d.model).toBe('UM25C');
    expect(d.volts).toBeCloseTo(5.123, 6);
    expect(d.amps).toBeCloseTo(1.2345, 6);
    expect(d.watts).toBeCloseTo(6.321, 6);
    expect(d.tempC).toBe(31);
    expect(d.tempF).toBe(88);
  });

  it('decodes a UM24C dump with cV volts and mA current', () => {
    const d = parseRuiDengDump(ruiDengDump({ id: 0x0963, voltRaw: 512, ampRaw: 1234, powerRaw: 6321 }));
    expect(d.model).toBe('UM24C');
    expect(d.volts).toBeCloseTo(5.12, 6);
    expect(d.amps).toBeCloseTo(1.234, 6);
  });

  it('decodes a UM34C dump with the same divisors as UM24C', () => {
    const d = parseRuiDengDump(ruiDengDump({ id: 0x0d4c, voltRaw: 2000, ampRaw: 250 }));
    expect(d.model).toBe('UM34C');
    expect(d.volts).toBeCloseTo(20, 6);
    expect(d.amps).toBeCloseTo(0.25, 6);
  });

  it('reads D+/D-, charging mode, resistance, threshold and recording fields', () => {
    const d = parseRuiDengDump(ruiDengDump({
      dPlusRaw: 330, dMinusRaw: 12, mode: 2, thresholdRaw: 50, recMah: 12345, recMwh: 60000,
      recSeconds: 3600, recording: 1, timeout: 5, backlight: 3, resistanceRaw: 1234, screen: 1,
    }));
    expect(d.dPlus).toBeCloseTo(3.3, 6);
    expect(d.dMinus).toBeCloseTo(0.12, 6);
    expect(d.chargingModeName).toBe('QC3');
    expect(d.thresholdA).toBeCloseTo(0.5, 6);
    expect(d.recordMah).toBeCloseTo(12.345, 6);
    expect(d.recordMwh).toBeCloseTo(60, 6);
    expect(d.recordSeconds).toBe(3600);
    expect(d.recording).toBe(true);
    expect(d.screenTimeout).toBe(5);
    expect(d.backlight).toBe(3);
    expect(d.resistanceOhms).toBeCloseTo(123.4, 6);
    expect(d.screenSelected).toBe(1);
  });

  it('reports the selected data group accumulated mAh and mWh (raw units are 1/1000)', () => {
    const groups = [];
    groups[3] = [1500000, 7500000]; // 1500 mAh, 7500 mWh
    const d = parseRuiDengDump(ruiDengDump({ group: 3, groups }));
    expect(d.selectedGroup).toBe(3);
    expect(d.deviceMah).toBeCloseTo(1500, 6);
    expect(d.deviceMwh).toBeCloseTo(7500, 6);
    expect(d.groups).toHaveLength(10);
    expect(d.groups[3].mAh).toBeCloseTo(1500, 6);
  });

  it('keeps large 32-bit values positive', () => {
    const groups = [];
    groups[0] = [0xfffffff0, 0x80000000];
    const d = parseRuiDengDump(ruiDengDump({ group: 0, groups }));
    expect(d.groups[0].mAh).toBeCloseTo(0xfffffff0 / 1000, 3);
    expect(d.groups[0].mWh).toBeCloseTo(0x80000000 / 1000, 3);
  });

  it('rejects wrong length and unknown model IDs', () => {
    expect(() => parseRuiDengDump(new Uint8Array(129))).toThrow(/130 bytes/);
    expect(() => parseRuiDengDump(ruiDengDump({ id: 0x1234 }))).toThrow(/Unknown RuiDeng model id 0x1234/);
  });

  it('exposes the three verified model IDs', () => {
    expect(Object.values(RUIDENG_MODELS).map((m) => m.name).sort()).toEqual(['UM24C', 'UM25C', 'UM34C']);
  });

  it('resyncs past leading junk such as the power-on 0xFF and keeps a partial tail', () => {
    const a = ruiDengDump({ id: 0x09c9, voltRaw: 5000 });
    const b = ruiDengDump({ id: 0x0963, voltRaw: 510 });
    const stream = new Uint8Array(1 + 130 + 130 + 40);
    stream[0] = 0xff;
    stream.set(a, 1);
    stream.set(b, 131);
    stream.set(a.subarray(0, 40), 261);
    const { frames, rest } = extractRuiDengFrames(stream);
    expect(frames).toHaveLength(2);
    expect(parseRuiDengDump(frames[0]).volts).toBeCloseTo(5, 6);
    expect(parseRuiDengDump(frames[1]).volts).toBeCloseTo(5.1, 6);
    expect(rest.length).toBe(40);
  });
});

describe('FNIRSI HID command frames and CRC-8', () => {
  // The init and poll frames published in yeckel/OpenFNB58 and baryluk's logger
  // end in these checksum bytes, so a match confirms the CRC parameters.
  it('reproduces the published command checksums', () => {
    expect(fnirsiCommand(0x81)[63]).toBe(0x8e);
    expect(fnirsiCommand(0x82)[63]).toBe(0x96);
    expect(fnirsiCommand(0x83)[63]).toBe(0x9e);
  });

  it('builds 64-byte frames with 0xAA header and zero padding', () => {
    const f = fnirsiCommand(0x83);
    expect(f.length).toBe(64);
    expect(f[0]).toBe(0xaa);
    expect(f[1]).toBe(0x83);
    expect([...f.subarray(2, 63)].every((x) => x === 0)).toBe(true);
    expect(crc8Fnirsi(f.subarray(1, 63))).toBe(f[63]);
  });
});

// Build a type-0x04 FNIRSI packet: four 15-byte little-endian samples at offset 2.
function fnirsiPacket(samples, { badCrc = false, type = 0x04 } = {}) {
  const b = new Uint8Array(64);
  const dv = new DataView(b.buffer);
  b[0] = 0xaa;
  b[1] = type;
  samples.forEach((s, i) => {
    const o = 2 + 15 * i;
    dv.setUint32(o, Math.round(s.volts * 100000), true);
    dv.setUint32(o + 4, Math.round(s.amps * 100000), true);
    dv.setUint16(o + 8, Math.round(s.dPlus * 1000), true);
    dv.setUint16(o + 10, Math.round(s.dMinus * 1000), true);
    dv.setUint16(o + 13, Math.round(s.tempC * 10), true);
  });
  b[63] = crc8Fnirsi(b.subarray(1, 63)) ^ (badCrc ? 0xff : 0);
  return b;
}

describe('FNIRSI sample packet', () => {
  const samples = [
    { volts: 5.1, amps: 1.2, dPlus: 2.7, dMinus: 2.6, tempC: 31.5 },
    { volts: 5.0, amps: 2.0, dPlus: 0.6, dMinus: 0.0, tempC: 31.6 },
    { volts: 9.0, amps: 0.5, dPlus: 3.3, dMinus: 3.3, tempC: 32.0 },
    { volts: 12.0, amps: 3.0, dPlus: 0, dMinus: 0, tempC: 30.2 },
  ];

  it('decodes four samples with volts, amps, power, D+/D- and temperature', () => {
    const r = decodeFnirsiPacket(fnirsiPacket(samples));
    expect(r.ok).toBe(true);
    expect(r.samples).toHaveLength(4);
    expect(r.samples[0].volts).toBeCloseTo(5.1, 5);
    expect(r.samples[0].amps).toBeCloseTo(1.2, 5);
    expect(r.samples[0].watts).toBeCloseTo(6.12, 5);
    expect(r.samples[0].dPlus).toBeCloseTo(2.7, 5);
    expect(r.samples[0].dMinus).toBeCloseTo(2.6, 5);
    expect(r.samples[0].tempC).toBeCloseTo(31.5, 5);
    expect(r.samples[3].volts).toBeCloseTo(12, 5);
    expect(r.samples[3].watts).toBeCloseTo(36, 4);
  });

  it('rejects a packet whose CRC does not match', () => {
    expect(decodeFnirsiPacket(fnirsiPacket(samples, { badCrc: true }))).toMatchObject({ ok: false, reason: 'crc' });
    expect(decodeFnirsiPacket(fnirsiPacket(samples, { badCrc: true }), { checkCrc: false }).ok).toBe(true);
  });

  it('ignores non-sample packet types and bad headers', () => {
    expect(decodeFnirsiPacket(fnirsiPacket(samples, { type: 0x07 }))).toMatchObject({ ok: false, type: 0x07 });
    const bad = fnirsiPacket(samples);
    bad[0] = 0x00;
    expect(decodeFnirsiPacket(bad).ok).toBe(false);
    expect(decodeFnirsiPacket(new Uint8Array(63)).ok).toBe(false);
  });

  it('stamps the four samples 10 ms apart, ending at the packet time', () => {
    const rows = fnirsiSamples(decodeFnirsiPacket(fnirsiPacket(samples)).samples, 1000);
    expect(rows.map((r) => r.tMs)).toEqual([970, 980, 990, 1000]);
    expect(rows[0].deviceMah).toBeNull();
  });
});

describe('session accumulation', () => {
  it('integrates a steady 1 A load into 1000 mAh over one hour (1 Hz samples)', () => {
    const s = createSessionStats();
    let last;
    for (let t = 0; t <= 3600; t++) {
      last = addSessionSample(s, { tMs: t * 1000, volts: 5, amps: 1, watts: 5, tempC: 30 });
    }
    expect(last.computedMah).toBeCloseTo(1000, 6);
    expect(s.mWh).toBeCloseTo(5000, 6);
    expect(s.count).toBe(3601);
  });

  it('tracks min and max per quantity and skips non-numeric values', () => {
    const s = createSessionStats();
    addSessionSample(s, { tMs: 0, volts: 5, amps: 1, watts: 5, tempC: 30 });
    addSessionSample(s, { tMs: 1000, volts: 4.9, amps: 2, watts: 9.8, tempC: 35 });
    addSessionSample(s, { tMs: 2000, volts: 5.1, amps: 0.5, watts: null, tempC: null });
    expect(s.min.volts).toBeCloseTo(4.9, 6);
    expect(s.max.volts).toBeCloseTo(5.1, 6);
    expect(s.max.amps).toBe(2);
    expect(s.max.watts).toBe(9.8);
    expect(s.max.tempC).toBe(35);
  });

  it('does not integrate across a gap longer than 5 s', () => {
    const s = createSessionStats();
    addSessionSample(s, { tMs: 0, volts: 5, amps: 1, watts: 5, tempC: 30 });
    addSessionSample(s, { tMs: 60000, volts: 5, amps: 1, watts: 5, tempC: 30 });
    expect(s.mAh).toBe(0);
    expect(s.gaps).toBe(1);
  });
});

describe('CSV export', () => {
  it('writes the header and one row per sample with empty cells for unknown values', () => {
    const s = createSessionStats();
    const rows = [
      { tMs: Date.UTC(2026, 0, 1, 0, 0, 0), source: 'fnirsi', volts: 5.1, amps: 1.2, watts: 6.12, tempC: 31.5, dPlus: 2.7, dMinus: 2.6, deviceMah: null, deviceMwh: null },
      { tMs: Date.UTC(2026, 0, 1, 0, 0, 1), source: 'ruideng', volts: 5.1, amps: 1.2, watts: 6.12, tempC: 31, dPlus: 2.7, dMinus: 2.6, deviceMah: 12.5, deviceMwh: 64.25 },
    ];
    rows.forEach((r) => Object.assign(r, addSessionSample(s, r)));
    const csv = samplesToCsv(rows);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time_iso,elapsed_s,source,volts,amps,watts,temp_c,d_plus_v,d_minus_v,device_mah,device_mwh,computed_mah,computed_mwh');
    expect(lines[1]).toBe('2026-01-01T00:00:00.000Z,0.000,fnirsi,5.1000,1.20000,6.1200,31.5,2.70,2.60,,,0.0000,0.0000');
    expect(lines[2]).toMatch(/^2026-01-01T00:00:01\.000Z,1\.000,ruideng,5\.1000,1\.20000,6\.1200,31\.0,2\.70,2\.60,12\.500,64\.250,/);
  });
});
