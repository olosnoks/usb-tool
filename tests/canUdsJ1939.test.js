import { describe, it, expect } from 'vitest';
import {
  UdsClient, UdsError, UdsDeclinedError, decodeJ1939Id, buildJ1939Id, buildJ1939Request, j1939PgnName,
  decodeJ1939Pgn, decodeJ1939Frame, decodeJ1939Name, decodeJ1939Dtc, J1939_PGNS
} from '../src/utils/canTools';

// A transport that records every request and answers from a script.
function fakeTp(answers) {
  const sent = [];
  const queue = [...answers];
  return {
    sent,
    request: async (bytes) => { sent.push(Array.from(bytes)); return Uint8Array.from(queue.shift()); },
    receive: async () => Uint8Array.from(queue.shift())
  };
}
const hexOf = (a) => a.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

describe('UDS service requests (exact bytes)', () => {
  it('SecurityAccess: seed request, then the key the user supplies', async () => {
    const tp = fakeTp([[0x67, 0x01, 0xde, 0xad, 0xbe, 0xef], [0x67, 0x02]]);
    const uds = new UdsClient(tp, { confirm: () => true });
    const seen = [];
    const r = await uds.securityAccess(0x01, (seed, level) => { seen.push([Array.from(seed), level]); return [0x01, 0x02, 0x03, 0x04]; });
    expect(tp.sent.map(hexOf)).toEqual(['27 01', '27 02 01 02 03 04']);
    expect(seen).toEqual([[[0xde, 0xad, 0xbe, 0xef], 1]]);
    expect(r.accepted).toBe(true);
  });

  it('SecurityAccess does not send a key when none is given, and treats a zero seed as unlocked', async () => {
    const tp = fakeTp([[0x67, 0x01, 0xaa, 0xbb]]);
    const uds = new UdsClient(tp, { confirm: () => true });
    await expect(uds.securityAccess(1, () => [])).rejects.toThrow(/Enter the key/);
    expect(tp.sent).toEqual([[0x27, 0x01]]);

    const tp2 = fakeTp([[0x67, 0x03, 0, 0, 0, 0]]);
    const r = await new UdsClient(tp2, { confirm: () => true }).securityAccess(3, () => { throw new Error('should not be asked'); });
    expect(r).toMatchObject({ alreadyUnlocked: true, accepted: true });
    expect(tp2.sent).toEqual([[0x27, 0x03]]);
  });

  it('SecurityAccess rejects even seed levels and maps a wrong key to NRC 0x35', async () => {
    const uds = new UdsClient(fakeTp([]), { confirm: () => true });
    await expect(uds.requestSeed(2)).rejects.toThrow(RangeError);
    const tp = fakeTp([[0x7f, 0x27, 0x35]]);
    await expect(new UdsClient(tp, { confirm: () => true }).sendKey(1, [1, 2])).rejects.toThrow(/invalid key/);
  });

  it('RoutineControl 31 01 FF00', async () => {
    const tp = fakeTp([[0x71, 0x01, 0xff, 0x00, 0xaa]]);
    const r = await new UdsClient(tp, { confirm: () => true }).routineControl(1, 0xff00);
    expect(hexOf(tp.sent[0])).toBe('31 01 FF 00');
    expect(r.routineId).toBe(0xff00);
    expect(Array.from(r.status)).toEqual([0xaa]);
  });

  it('RoutineControl with option record; results request is not gated', async () => {
    const tp = fakeTp([[0x71, 0x01, 0x02, 0x03], [0x71, 0x03, 0x02, 0x03, 0x00]]);
    const uds = new UdsClient(tp, { confirm: () => true });
    await uds.routineControl(1, 0x0203, [0x01, 0x02]);
    expect(hexOf(tp.sent[0])).toBe('31 01 02 03 01 02');
    let asked = 0;
    const uds2 = new UdsClient(fakeTp([[0x71, 0x03, 0x02, 0x03, 0x00]]), { confirm: () => { asked++; return true; } });
    await uds2.routineControl(3, 0x0203);
    expect(asked).toBe(0);
  });

  it('WriteDataByIdentifier 2E F190 ...', async () => {
    const tp = fakeTp([[0x6e, 0xf1, 0x90]]);
    const vin = Array.from('WVWZZZ1KZDM900001').map((c) => c.charCodeAt(0));
    await new UdsClient(tp, { confirm: () => true }).writeDid(0xf190, vin);
    expect(hexOf(tp.sent[0]).startsWith('2E F1 90 57 56 57')).toBe(true);
    expect(tp.sent[0]).toHaveLength(3 + 17);
  });

  it('CommunicationControl 28 00 01 and ControlDTCSetting 85 02', async () => {
    const tp = fakeTp([[0x68, 0x00], [0xc5, 0x02]]);
    const uds = new UdsClient(tp, { confirm: () => true });
    await uds.communicationControl(0x00, 0x01);
    await uds.controlDtcSetting(0x02);
    expect(tp.sent.map(hexOf)).toEqual(['28 00 01', '85 02']);
  });

  it('ReadMemoryByAddress 23 with address and size length format', async () => {
    const tp = fakeTp([[0x63, 1, 2, 3, 4]]);
    const r = await new UdsClient(tp).readMemory(0x20001000, 4);
    expect(hexOf(tp.sent[0])).toBe('23 24 20 00 10 00 00 04');
    expect(Array.from(r)).toEqual([1, 2, 3, 4]);
    await expect(new UdsClient(fakeTp([])).readMemory(0x100000000, 4)).rejects.toThrow(RangeError);
  });

  it('every write service refuses to send without confirmation', async () => {
    const tp = fakeTp([]);
    const none = new UdsClient(tp);
    const no = new UdsClient(tp, { confirm: () => false });
    for (const c of [none, no]) {
      await expect(c.writeDid(0xf190, [1])).rejects.toBeInstanceOf(UdsDeclinedError);
      await expect(c.routineControl(1, 0xff00)).rejects.toBeInstanceOf(UdsDeclinedError);
      await expect(c.communicationControl(3, 1)).rejects.toBeInstanceOf(UdsDeclinedError);
      await expect(c.controlDtcSetting(2)).rejects.toBeInstanceOf(UdsDeclinedError);
      await expect(c.sendKey(1, [1])).rejects.toBeInstanceOf(UdsDeclinedError);
    }
    expect(tp.sent).toEqual([]);
  });

  it('maps negative responses via UDS_NRC and waits through 0x78 response pending', async () => {
    const tp = fakeTp([[0x7f, 0x2e, 0x33]]);
    await expect(new UdsClient(tp, { confirm: () => true }).writeDid(0xf190, [1])).rejects.toThrow(/security access denied/);

    const tp2 = fakeTp([[0x7f, 0x31, 0x78], [0x7f, 0x31, 0x78], [0x71, 0x01, 0xff, 0x00]]);
    const r = await new UdsClient(tp2, { confirm: () => true }).routineControl(1, 0xff00);
    expect(r.routineId).toBe(0xff00);

    const tp3 = fakeTp([[0x7f, 0x31, 0x22]]);
    const err = await new UdsClient(tp3, { confirm: () => true }).routineControl(1, 1).catch((e) => e);
    expect(err).toBeInstanceOf(UdsError);
    expect(err.nrc).toBe(0x22);
  });
});

describe('J1939', () => {
  it('splits an identifier: 0x18FEF100 is priority 6, PGN 65265 (CCVS), SA 0', () => {
    expect(decodeJ1939Id(0x18fef100)).toMatchObject({ priority: 6, pgn: 65265, sa: 0, pdu1: false, da: 0xff });
    expect(j1939PgnName(65265)).toEqual({ acronym: 'CCVS', name: 'Cruise Control/Vehicle Speed' });
  });

  it('handles PDU1 (destination specific) identifiers', () => {
    // Request (PGN 59904) from SA 0xF9 to DA 0x00, priority 6
    const d = decodeJ1939Id(0x18ea00f9);
    expect(d).toMatchObject({ priority: 6, pgn: 59904, sa: 0xf9, da: 0x00, pdu1: true });
    // Address claimed, global destination
    expect(decodeJ1939Id(0x18eeff00)).toMatchObject({ pgn: 60928, da: 0xff, sa: 0 });
  });

  it('builds identifiers and PGN requests that decode back', () => {
    expect(buildJ1939Id({ priority: 6, pgn: 65265, sa: 0 })).toBe(0x18fef100);
    const f = buildJ1939Request(65262, { da: 0x00, sa: 0xf9 });
    expect(f.id).toBe(0x18ea00f9);
    expect(f.isExtended).toBe(true);
    expect(Array.from(f.data)).toEqual([0xee, 0xfe, 0x00]);
    expect(decodeJ1939Id(f.id).pgn).toBe(59904);
    expect(() => buildJ1939Request(0x40000)).toThrow(RangeError);
  });

  it('decodes an EEC1 sample: engine speed and torque', () => {
    // byte 4-5 = 0x1F40 -> 8000 * 0.125 = 1000 rpm; torque bytes 0x7D = 0 %, 0x8C = 15 %
    const data = Uint8Array.from([0xf0, 0x7d, 0x8c, 0x40, 0x1f, 0x00, 0xf0, 0x7d]);
    const f = decodeJ1939Frame({ id: 0x0cf00400, isExtended: true, data });
    expect(f).toMatchObject({ pgn: 61444, acronym: 'EEC1', priority: 3, sa: 0 });
    const by = Object.fromEntries(f.signals.map((s) => [s.spn, s]));
    expect(by[190]).toMatchObject({ name: 'Engine speed', value: 1000, unit: 'rpm' });
    expect(by[512].value).toBe(0);
    expect(by[513].value).toBe(15);
  });

  it('reports not-available and error values instead of numbers', () => {
    const s = decodeJ1939Pgn(61444, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(s.every((x) => x.value === null && x.text === 'not available')).toBe(true);
    const e = decodeJ1939Pgn(65262, Uint8Array.from([0xfe, 0x5a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(e[0]).toMatchObject({ spn: 110, value: null, text: 'error' });
    expect(e[1]).toMatchObject({ spn: 174, value: 50, unit: '°C' });
  });

  it('decodes CCVS vehicle speed, ET1 coolant and VEP1 voltage', () => {
    // 0x6400 / 256 = 100 km/h
    expect(decodeJ1939Pgn(65265, Uint8Array.from([0, 0x00, 0x64, 0, 0, 0, 0, 0]))[0]).toMatchObject({ spn: 84, value: 100 });
    expect(decodeJ1939Pgn(65262, Uint8Array.from([130, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))[0].value).toBe(90);
    // 0x0258 * 0.05 = 30 V... 0x0118 = 280 * 0.05 = 14 V
    const vep = decodeJ1939Pgn(65271, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x18, 0x01, 0xff, 0xff]));
    expect(vep.find((x) => x.spn === 168).value).toBe(14);
  });

  it('decodes Address Claimed NAME and a DM1 trouble code', () => {
    const name = decodeJ1939Name(Uint8Array.from([0x39, 0x05, 0x40, 0x0f, 0x00, 0x11, 0x28, 0x90]));
    expect(name.identityNumber).toBe(0x0539);
    expect(name.manufacturerCode).toBe((0x40 >> 5) | (0x0f << 3));
    expect(name.func).toBe(0x11);
    expect(name.vehicleSystem).toBe(0x14);
    expect(name.industryGroup).toBe(1);
    expect(name.arbitraryAddressCapable).toBe(true);
    // SPN 190, FMI 2, occurrence 1: bytes 0xBE 0x00 0x02 0x01
    expect(decodeJ1939Dtc(0xbe, 0x00, 0x02, 0x01)).toMatchObject({ spn: 190, fmi: 2, occurrences: 1 });
    const dm1 = decodeJ1939Pgn(65226, Uint8Array.from([0x04, 0xff, 0xbe, 0x00, 0x02, 0x01, 0xff, 0xff]));
    expect(dm1[1]).toMatchObject({ spn: 190, name: 'DTC SPN 190 FMI 2' });
  });

  it('decodes a PGN request and ignores 11-bit frames', () => {
    expect(decodeJ1939Pgn(59904, Uint8Array.from([0xee, 0xfe, 0x00]))[0].value).toBe(65262);
    expect(decodeJ1939Frame({ id: 0x123, isExtended: false, data: new Uint8Array(8) })).toBeNull();
  });

  it('has a PGN name table of 50+ common entries', () => {
    expect(Object.keys(J1939_PGNS).length).toBeGreaterThanOrEqual(50);
    expect(j1939PgnName(65280)).toMatchObject({ acronym: 'PROPB' });
    expect(j1939PgnName(1)).toEqual({ acronym: null, name: null });
  });
});
