import { describe, it, expect } from 'vitest';
import {
  FEND, FESC, TFEND, TFESC, CMD, kissEscape, kissFrame, KissDecoder, decodeFrame,
  buildDetect, buildSetRadio, buildRadioState, validateRadioParams, parseRssi, parseSnr,
  parseChannelStats, decodeEeprom, ROM, timeOnAir, bitRateBps, sensitivityDbm, linkBudget,
  dutyCycleAllowance, ldroAuto, symbolTimeMs, toHex,
} from '../src/utils/rnodeLora.js';
import { md5Hex } from '../src/utils/md5.js';

const bytesOf = (...xs) => Uint8Array.from(xs);

describe('KISS escaping', () => {
  it('escapes FEND and FESC in payloads', () => {
    expect(kissEscape([0x01, FEND, FESC, 0x02])).toEqual([0x01, FESC, TFEND, FESC, TFESC, 0x02]);
  });

  it('builds a frame as FEND, command, escaped payload, FEND', () => {
    expect(Array.from(kissFrame(CMD.FREQUENCY, [0xc0, 0x00]))).toEqual([FEND, 0x01, FESC, TFEND, 0x00, FEND]);
  });
});

describe('KissDecoder', () => {
  it('decodes a frame fed one byte at a time', () => {
    const dec = new KissDecoder();
    const wire = kissFrame(CMD.STAT_RSSI, [0xc0, 0xdb, 0x10]);
    const frames = [];
    for (const b of wire) frames.push(...dec.push(bytesOf(b)));
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(CMD.STAT_RSSI);
    expect(Array.from(frames[0].payload)).toEqual([0xc0, 0xdb, 0x10]);
  });

  it('keeps an escape sequence intact when it is split across chunks', () => {
    const dec = new KissDecoder();
    const a = dec.push(bytesOf(FEND, CMD.DATA, 0x41, FESC));
    expect(a).toEqual([]);
    const b = dec.push(bytesOf(TFEND, 0x42, FEND));
    expect(b).toHaveLength(1);
    expect(Array.from(b[0].payload)).toEqual([0x41, FEND, 0x42]);
  });

  it('emits several frames from one chunk and tolerates back-to-back FENDs', () => {
    const dec = new KissDecoder();
    const wire = new Uint8Array([...kissFrame(CMD.PLATFORM, [0]), ...kissFrame(CMD.MCU, [0]), FEND, FEND]);
    const frames = dec.push(wire);
    expect(frames.map((f) => f.cmd)).toEqual([CMD.PLATFORM, CMD.MCU]);
  });

  it('drops frames whose payload exceeds the cap', () => {
    const dec = new KissDecoder({ maxPayload: 4 });
    const frames = dec.push(kissFrame(CMD.ROM_READ, [1, 2, 3, 4, 5, 6]));
    expect(frames).toEqual([]);
    // The decoder recovers for the next frame.
    expect(dec.push(kissFrame(CMD.READY, [])).map((f) => f.cmd)).toEqual([CMD.READY]);
  });
});

describe('command builders', () => {
  it('builds the RNS detect sequence', () => {
    expect(toHex(buildDetect(), ' ')).toBe('C0 08 73 C0 C0 50 00 C0 C0 48 00 C0 C0 49 00 C0');
  });

  it('builds radio state frames', () => {
    expect(toHex(buildRadioState(true), ' ')).toBe('C0 06 01 C0');
    expect(toHex(buildRadioState(false), ' ')).toBe('C0 06 00 C0');
  });

  it('builds radio parameter frames in RNS order with big-endian 32-bit values', () => {
    const out = buildSetRadio({ freqHz: 868000000, bwHz: 125000, sf: 7, cr: 5, txPowerDbm: 17 });
    // 868000000 = 0x33BCA100, 125000 = 0x0001E848
    expect(toHex(out, ' ')).toBe('C0 01 33 BC A1 00 C0 C0 02 00 01 E8 48 C0 C0 03 11 C0 C0 04 07 C0 C0 05 05 C0');
  });

  it('rejects out-of-range radio parameters', () => {
    expect(() => buildSetRadio({ freqHz: 2.4e9, bwHz: 125000, sf: 7, cr: 5, txPowerDbm: 17 })).toThrow(/Frequency/);
    expect(validateRadioParams({ freqHz: 868e6, bwHz: 123, sf: 13, cr: 9, txPowerDbm: 30 })).toHaveLength(4);
    expect(validateRadioParams({ freqHz: 868e6, bwHz: 125000, sf: 12, cr: 8, txPowerDbm: 22 })).toEqual([]);
  });
});

describe('response decoding', () => {
  it('decodes RSSI with the 157 offset and signed SNR at 0.25 dB steps', () => {
    expect(parseRssi(bytesOf(100))).toBe(-57);
    expect(parseSnr(bytesOf(0xfc))).toBe(-1); // -4 * 0.25
    expect(parseSnr(bytesOf(0x14))).toBe(5); // 20 * 0.25
  });

  it('decodes channel statistics', () => {
    const s = parseChannelStats(bytesOf(0x00, 0x64, 0x01, 0x2c, 0x00, 0x0a, 0x00, 0x14, 100, 60, 0xff));
    expect(s.shortAirtimePct).toBe(1);
    expect(s.longAirtimePct).toBe(3);
    expect(s.shortLoadPct).toBeCloseTo(0.1);
    expect(s.currentRssi).toBe(-57);
    expect(s.noiseFloor).toBe(-97);
    expect(s.interference).toBeNull();
  });

  it('maps frames to typed results', () => {
    expect(decodeFrame({ cmd: CMD.DETECT, payload: bytesOf(0x46) })).toEqual({ type: 'detect', detected: true });
    expect(decodeFrame({ cmd: CMD.DETECT, payload: bytesOf(0x00) }).detected).toBe(false);
    expect(decodeFrame({ cmd: CMD.FW_VERSION, payload: bytesOf(1, 74) }).value).toBe('1.74');
    expect(decodeFrame({ cmd: CMD.PLATFORM, payload: bytesOf(0x80) }).value).toEqual({ code: 0x80, name: 'ESP32' });
    expect(decodeFrame({ cmd: CMD.ERROR, payload: bytesOf(0x02) }).value.name).toBe('TX failed');
    expect(decodeFrame({ cmd: CMD.FREQUENCY, payload: bytesOf(0x33, 0xbc, 0xa1, 0x00) }).value).toBe(868000000);
  });
});

function syntheticRom() {
  const rom = new Uint8Array(256);
  rom[ROM.PRODUCT] = 0xe0; // T-Beam
  rom[ROM.MODEL] = 0xe4;
  rom[ROM.HW_REV] = 0x01;
  rom.set([0x00, 0x00, 0x12, 0x34], ROM.SERIAL);
  rom.set([0x65, 0x00, 0x00, 0x01], ROM.MADE);
  rom.set(md5Hex(rom.slice(0, 11)).match(/../g).map((h) => parseInt(h, 16)), ROM.CHKSUM);
  rom.fill(0x5a, ROM.SIGNATURE, ROM.SIGNATURE + 128);
  rom[ROM.INFO_LOCK] = 0x73;
  rom[ROM.CONF_SF] = 9;
  rom[ROM.CONF_CR] = 6;
  rom[ROM.CONF_TXP] = 14;
  rom.set([0x00, 0x03, 0xd0, 0x90], ROM.CONF_BW); // 250000
  rom.set([0x33, 0xbc, 0xa1, 0x00], ROM.CONF_FREQ);
  rom[ROM.CONF_OK] = 0x73;
  return rom;
}

describe('decodeEeprom', () => {
  it('decodes a provisioned image and verifies the checksum', () => {
    const e = decodeEeprom(syntheticRom());
    expect(e.provisioned).toBe(true);
    expect(e.productName).toBe('LilyGO T-Beam');
    expect(e.serialHex).toBe('00 00 12 34');
    expect(e.checksumOk).toBe(true);
    expect(e.signaturePresent).toBe(true);
    expect(e.config).toEqual({ sf: 9, cr: 6, txPowerDbm: 14, bwHz: 250000, freqHz: 868000000 });
    expect(e.configValid).toBe(true);
  });

  it('reports a checksum mismatch and an unprovisioned image', () => {
    const rom = syntheticRom();
    rom[ROM.SERIAL + 3] ^= 0xff;
    rom[ROM.INFO_LOCK] = 0xff;
    const e = decodeEeprom(rom);
    expect(e.checksumOk).toBe(false);
    expect(e.provisioned).toBe(false);
  });

  it('rejects a short read', () => {
    expect(() => decodeEeprom(new Uint8Array(10))).toThrow(/ROM read/);
  });
});

describe('LoRa time-on-air (Semtech AN1200.13)', () => {
  it('SF7 BW125 CR4/5, 20 bytes, preamble 8, explicit header, CRC on = 56.6 ms', () => {
    const r = timeOnAir({ payloadBytes: 20, sf: 7, bwHz: 125000, cr: 5, preamble: 8 });
    expect(r.symbolTimeMs).toBeCloseTo(1.024, 6);
    expect(r.payloadSymbols).toBe(43);
    expect(r.totalMs).toBeCloseTo(56.576, 3);
    expect(r.ldro).toBe(false);
  });

  it('SF10 BW125 CR4/5, 20 bytes = 370.7 ms (LDRO off)', () => {
    expect(timeOnAir({ payloadBytes: 20, sf: 10, bwHz: 125000 }).totalMs).toBeCloseTo(370.688, 3);
  });

  it('SF12 BW125 CR4/5, 20 bytes = 1318.9 ms (LDRO on)', () => {
    const r = timeOnAir({ payloadBytes: 20, sf: 12, bwHz: 125000 });
    expect(r.ldro).toBe(true);
    expect(r.totalMs).toBeCloseTo(1318.912, 3);
  });

  it('auto LDRO switches on when symbol time exceeds 16 ms', () => {
    expect(ldroAuto(11, 125000)).toBe(true); // 16.384 ms
    expect(ldroAuto(10, 125000)).toBe(false); // 8.192 ms
    expect(symbolTimeMs(12, 125000)).toBeCloseTo(32.768, 6);
  });

  it('implicit header and CRC off shorten the payload', () => {
    const explicit = timeOnAir({ payloadBytes: 20, sf: 7, bwHz: 125000 }).payloadSymbols;
    const implicit = timeOnAir({ payloadBytes: 20, sf: 7, bwHz: 125000, implicitHeader: true, crc: false }).payloadSymbols;
    expect(implicit).toBeLessThanOrEqual(explicit);
  });

  it('zero-byte payload: 13 symbols with CRC on, 8 with CRC off (AN1200.13 formula)', () => {
    expect(timeOnAir({ payloadBytes: 0, sf: 7, bwHz: 125000 }).payloadSymbols).toBe(13);
    expect(timeOnAir({ payloadBytes: 0, sf: 7, bwHz: 125000, crc: false }).payloadSymbols).toBe(8);
  });

  it('rejects invalid inputs', () => {
    expect(() => timeOnAir({ payloadBytes: 20, sf: 13, bwHz: 125000 })).toThrow();
    expect(() => timeOnAir({ payloadBytes: 300, sf: 7, bwHz: 125000 })).toThrow();
    expect(() => timeOnAir({ payloadBytes: 20, sf: 7, bwHz: 1000 })).toThrow();
  });
});

describe('bit rate, sensitivity, link budget, duty cycle', () => {
  it('bit rate SF7 BW125 CR4/5 = 5468.75 bps', () => {
    expect(bitRateBps({ sf: 7, bwHz: 125000, cr: 5 })).toBeCloseTo(5468.75, 6);
  });

  it('sensitivity estimate SF7 BW125 NF 6 dB = -124.5 dBm', () => {
    expect(sensitivityDbm({ bwHz: 125000, sf: 7 })).toBeCloseTo(-124.53, 1);
  });

  it('range inverts free-space path loss', () => {
    const sens = sensitivityDbm({ bwHz: 125000, sf: 7 });
    const lb = linkBudget({ txPowerDbm: 14, freqMhz: 868, sensitivity: sens, fadeMarginDb: 0 });
    // At the computed range the free-space loss equals the allowed loss.
    const fspl = 20 * Math.log10(lb.rangeKm) + 20 * Math.log10(868) + 32.44;
    expect(fspl).toBeCloseTo(lb.maxPathLossDb, 6);
    expect(lb.fsplAt1kmDb).toBeCloseTo(91.21, 1);
  });

  it('EU868 1% duty cycle: 36 s per hour, 636 messages of 56.6 ms', () => {
    const d = dutyCycleAllowance({ toaMs: 56.576, dutyFraction: 0.01 });
    expect(d.allowedMsPerHour).toBe(36000);
    expect(d.maxMessagesPerHour).toBe(636);
    expect(d.minOffTimeMs).toBeCloseTo(56.576 * 99, 3);
  });
});

import {
  regionCheck, rnodeconfCommand, reticulumInterfaceConfig, sampleStats, sparklinePoints, maxPayloadForToa,
} from '../src/utils/rnodeLora.js';

describe('regional checks and exports', () => {
  it('passes 868.1 MHz at 14 dBm in EU868 and flags 20 dBm', () => {
    expect(regionCheck('eu868', 868.1, 14).ok).toBe(true);
    const r = regionCheck('eu868', 868.1, 20);
    expect(r.ok).toBe(false);
    expect(r.duty).toBe(0.01);
  });
  it('allows 27 dBm only in the 869.4-869.65 sub-band', () => {
    expect(regionCheck('eu868', 869.5, 27)).toMatchObject({ ok: true, duty: 0.1 });
    expect(regionCheck('eu868', 868.1, 27).ok).toBe(false);
  });
  it('flags frequencies outside the region and ignores "none"', () => {
    expect(regionCheck('us915', 868, 10).ok).toBe(false);
    expect(regionCheck('eu868', 868.65, 10).ok).toBe(false);
    expect(regionCheck('none', 144, 22).ok).toBe(true);
  });
  it('builds rnodeconf and Reticulum config text', () => {
    const p = { freqHz: 868000000, bwHz: 125000, sf: 8, cr: 5, txPowerDbm: 14 };
    expect(rnodeconfCommand(p, 'COM3')).toBe('rnodeconf COM3 --freq 868000000 --bw 125000 --txp 14 --sf 8 --cr 5');
    const cfg = reticulumInterfaceConfig(p);
    expect(cfg).toContain('type = RNodeInterface');
    expect(cfg).toContain('spreadingfactor = 8');
    expect(() => rnodeconfCommand({ ...p, sf: 4 })).toThrow();
  });
  it('computes sample stats and sparkline points', () => {
    expect(sampleStats([])).toBeNull();
    expect(sampleStats([-100, -90, -80])).toEqual({ min: -100, max: -80, mean: -90, count: 3 });
    expect(sparklinePoints([1])).toBe('');
    expect(sparklinePoints([0, 10], 100, 20)).toBe('0.0,20.0 100.0,0.0');
  });
  it('finds the largest payload that fits a time-on-air budget', () => {
    const o = { sf: 7, bwHz: 125000, cr: 5 };
    const n = maxPayloadForToa(100, o);
    expect(timeOnAir({ ...o, payloadBytes: n }).totalMs).toBeLessThanOrEqual(100);
    expect(n === 255 || timeOnAir({ ...o, payloadBytes: n + 1 }).totalMs > 100).toBe(true);
    expect(maxPayloadForToa(1, o)).toBe(-1);
  });
});
