import { describe, it, expect } from 'vitest';
import {
  parseDbc, decodeFrame, extractBits, signalFits, compileIdFilter, toCandumpLog, parseCandumpLog, toCsv, replayFrames,
  IsoTpChannel, UdsClient, UdsError, SimulatedEcu, formatDidValue, decodeSupportedPids, OBD_PID_TABLE
} from '../src/utils/canTools';
import { ObdOverSlcan, parseSlcanFrame } from '../src/utils/canBusDriver';

const DBC = `VERSION ""

BO_ 476 ENGINE: 8 ECM
 SG_ RPM : 7|16@0+ (1,0) [0|8000] "rpm" DASH
 SG_ Speed : 23|8@0+ (1,0) [0|255] "km/h" DASH
 SG_ Gear : 35|4@0+ (1,0) [0|8] "" DASH
 SG_ Temp : 40|8@1- (0.5,-10) [-50|100] "degC" DASH

BO_ 2566844160 J1939_EXT: 8 ECU
 SG_ Mode M : 0|8@1+ (1,0) [0|255] "" X
 SG_ ValA m1 : 8|16@1+ (0.1,0) [0|6553.5] "V" X
 SG_ ValB m2 : 8|8@1+ (1,0) [0|255] "%" X

CM_ SG_ 476 RPM "Engine speed";
VAL_ 476 Gear 0 "Park" 1 "Reverse" 2 "Neutral" 3 "Drive" ;
`;

describe('DBC', () => {
  const dbc = parseDbc(DBC);

  it('parses messages, extended IDs, comments and value tables', () => {
    expect(dbc.messages.size).toBe(2);
    const eng = dbc.messages.get('476');
    expect(eng.signals.map((s) => s.name)).toEqual(['RPM', 'Speed', 'Gear', 'Temp']);
    expect(eng.signals[0].comment).toBe('Engine speed');
    expect(eng.signals[2].values).toEqual({ 0: 'Park', 1: 'Reverse', 2: 'Neutral', 3: 'Drive' });
    const ext = dbc.messages.get(`x${0x18feef00}`);
    expect(ext.isExtended).toBe(true);
  });

  it('decodes Motorola, Intel, signed, scaled and enumerated signals', () => {
    const f = { id: 476, isExtended: false, data: Uint8Array.from([0x1a, 0xf8, 0x2a, 0x00, 0x03, 0xfc, 0, 0]) };
    const d = decodeFrame(dbc, f);
    const by = Object.fromEntries(d.signals.map((s) => [s.name, s]));
    expect(by.RPM.value).toBe(0x1af8);
    expect(by.Speed.value).toBe(42);
    expect(by.Gear).toMatchObject({ raw: 3, text: 'Drive' });
    expect(by.Temp.value).toBe(-12); // raw -4 * 0.5 - 10
  });

  it('honours multiplexing', () => {
    const one = decodeFrame(dbc, { id: 0x18feef00, isExtended: true, data: Uint8Array.from([1, 0x10, 0x27, 0, 0, 0, 0, 0]) });
    expect(one.signals.map((s) => [s.name, s.value])).toEqual([['Mode', 1], ['ValA', 1000]]);
    const two = decodeFrame(dbc, { id: 0x18feef00, isExtended: true, data: Uint8Array.from([2, 77, 0, 0, 0, 0, 0, 0]) });
    expect(two.signals.map((s) => s.name)).toEqual(['Mode', 'ValB']);
  });

  it('skips signals beyond a short frame and ignores unknown IDs', () => {
    const d = decodeFrame(dbc, { id: 476, isExtended: false, data: Uint8Array.from([1, 2]) });
    expect(d.signals.map((s) => s.name)).toEqual(['RPM']);
    expect(decodeFrame(dbc, { id: 0x123, isExtended: false, data: new Uint8Array(8) })).toBeNull();
    expect(signalFits({ littleEndian: false, startBit: 7, length: 16 }, 2)).toBe(true);
    expect(signalFits({ littleEndian: false, startBit: 7, length: 17 }, 2)).toBe(false);
  });

  it('walks Motorola bits across bytes', () => {
    // 12 bits starting at bit 3 of byte 0: low nibble of byte 0 then all of byte 1
    expect(Number(extractBits(Uint8Array.from([0x0a, 0xbc]), 3, 12, false))).toBe(0xabc);
  });
});

describe('filters and logs', () => {
  it('filters by IDs, ranges and exclusions', () => {
    const f = compileIdFilter('1DC, 200-2FF, !250');
    expect([0x1dc, 0x200, 0x250, 0x2ff, 0x300].map(f)).toEqual([true, true, false, true, false]);
    expect(compileIdFilter('')(0x7ff)).toBe(true);
    expect(compileIdFilter('!7DF')(0x7df)).toBe(false);
    expect(() => compileIdFilter('xyz')).toThrow(/not an ID/);
  });

  it('round-trips candump logs and writes CSV with decoded signals', () => {
    const frames = [
      { t: 1000, id: 0x1dc, isExtended: false, dlc: 8, data: Uint8Array.from([0x1a, 0xf8, 0x2a, 0, 3, 0xfc, 0, 0]) },
      { t: 1012.5, id: 0x18daf110, isExtended: true, dlc: 2, data: Uint8Array.from([0x02, 0x10]) }
    ];
    const log = toCandumpLog(frames);
    expect(log.split('\n')[0]).toBe('(1.000000) can0 1DC#1AF82A0003FC0000');
    const back = parseCandumpLog(log);
    expect(back.map((f) => [f.id, f.isExtended, Array.from(f.data)])).toEqual(frames.map((f) => [f.id, f.isExtended, Array.from(f.data)]));
    expect(back[1].t).toBeCloseTo(1012.5, 3);
    const csv = toCsv(back, parseDbc(DBC));
    expect(csv).toContain('ENGINE: RPM=6904 rpm');
  });

  it('replays with the original spacing', async () => {
    const sent = [];
    const frames = [{ t: 0, id: 1 }, { t: 30, id: 2 }, { t: 60, id: 3 }];
    await new Promise((done) => replayFrames(frames, (f) => sent.push([f.id, Date.now()]), { speed: 2, onDone: done }));
    expect(sent.map((s) => s[0])).toEqual([1, 2, 3]);
    expect(sent[2][1] - sent[0][1]).toBeGreaterThanOrEqual(25);
  });
});

// Two ISO-TP endpoints wired back to back.
function pair(opts = {}) {
  let a, b;
  a = new IsoTpChannel((f) => setTimeout(() => b.onFrame(f), 0), { txId: 0x7e0, rxId: 0x7e8, ...opts });
  b = new IsoTpChannel((f) => setTimeout(() => a.onFrame(f), 0), { txId: 0x7e8, rxId: 0x7e0, ...opts });
  return { a, b };
}

describe('ISO-TP', () => {
  it('sends single and multi-frame messages with flow control', async () => {
    const { a, b } = pair({ blockSize: 2 });
    const big = Uint8Array.from({ length: 100 }, (_, i) => i);
    const got = b.receive(2000);
    await a.sendMessage(big);
    expect(Array.from(await got)).toEqual(Array.from(big));
    const small = b.receive();
    await a.sendMessage([0x3e, 0x00]);
    expect(Array.from(await small)).toEqual([0x3e, 0x00]);
  });

  it('times out when nobody answers', async () => {
    const lone = new IsoTpChannel(() => {}, { txId: 1, rxId: 2, timeoutMs: 30 });
    await expect(lone.request([0x22, 0xf1, 0x90])).rejects.toThrow(/No answer/);
    await expect(lone.sendMessage(new Uint8Array(20))).rejects.toThrow(/No flow control/);
  });
});

function testerWithEcu() {
  let ecu;
  const tp = new IsoTpChannel((f) => ecu.onFrame(f), { txId: 0x7e0, rxId: 0x7e8 });
  ecu = new SimulatedEcu((f) => tp.onFrame(f));
  return { uds: new UdsClient(tp), ecu, tp };
}

describe('UDS against the simulated ECU', () => {
  it('reads identification including the multi-frame VIN', async () => {
    const { uds } = testerWithEcu();
    expect(Array.from(await uds.readDid(0xf190)).length).toBe(17);
    const ident = await uds.readIdentification([0xf190, 0xf18c, 0xf1a0]);
    expect(ident.map((i) => [i.name, i.value])).toEqual([['VIN', 'WVWZZZ1KZDM900001'], ['ECU serial number', 'SN00012345']]);
  });

  it('switches session, reads and clears DTCs', async () => {
    const { uds } = testerWithEcu();
    expect(await uds.sessionControl(0x03)).toEqual({ p2Ms: 50, p2StarMs: 5000 });
    const { dtcs } = await uds.readDtcs();
    expect(dtcs.map((d) => d.code)).toEqual(['P0420-00', 'P0171-00']);
    expect(dtcs[0].flags).toContain('confirmed');
    await uds.clearDtcs();
    expect((await uds.readDtcs()).dtcs).toEqual([]);
  });

  it('turns negative responses into UdsError and waits through response-pending', async () => {
    const { uds, ecu } = testerWithEcu();
    await expect(uds.readDid(0x1234)).rejects.toThrow(/request out of range/);
    await expect(uds.request([0x27, 0x01])).rejects.toBeInstanceOf(UdsError);
    const orig = ecu.answer.bind(ecu);
    let pending = true;
    ecu.answer = (req) => {
      if (pending) { pending = false; setTimeout(() => ecu.tx.sendMessage(orig(req)), 20); return [0x7f, req[0], 0x78]; }
      return orig(req);
    };
    expect((await uds.testerPresent())[0]).toBe(0x7e);
  });
});

describe('OBD-II extras', () => {
  it('reads the VIN and supported PIDs over SLCAN framing', async () => {
    let ecu;
    const obd = new ObdOverSlcan((line) => ecu.onFrame(parseSlcanFrame(line)), { quietMs: 30, timeoutMs: 300 });
    ecu = new SimulatedEcu((f) => obd.onFrame(f));
    expect(await obd.readVin()).toBe('WVWZZZ1KZDM900001');
    expect(await obd.supportedPids()).toEqual([0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x1c]);
  });

  it('decodes bitmaps and table formulas', () => {
    expect(decodeSupportedPids(0x20, [0x80, 0, 0, 1])).toEqual([0x21, 0x40]);
    expect(OBD_PID_TABLE[0x0c][2]([0x1a, 0xf8])).toBe(1726);
    expect(formatDidValue(Uint8Array.from([0x41, 0x42, 0, 0]))).toBe('AB');
    expect(formatDidValue(Uint8Array.from([1, 2]))).toBe('01 02');
  });
});
