import { describe, it, expect } from 'vitest';
import { SlcanLineReader, parseSlcanFrame, buildSlcanFrame, decodeDtc, ObdOverSlcan } from '../src/utils/canBusDriver';

// Fake car behind an SLCAN adapter: engine ECU (7E8) with 4 DTCs (needs a
// multi-frame ISO-TP reply), transmission ECU (7E9) with 1 DTC.
function makeFakeCar({ engineDtcs = [[0x03, 0x00], [0x01, 0x71], [0x04, 0x20], [0xc1, 0x00]], tcuDtcs = [[0x07, 0x00]] } = {}) {
  const sent = [];
  let obd;
  let pendingFF = null;
  const deliver = (id, data) => setTimeout(() => {
    const f = parseSlcanFrame(buildSlcanFrame(id, Uint8Array.from([...data, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8))));
    obd.onFrame(f);
  }, 3);
  const send = (line) => {
    sent.push(line);
    const f = parseSlcanFrame(line);
    if (!f) return;
    if (f.id === 0x7df && f.data[1] === 0x03) {
      // engine: 0x43, count, 4 pairs = 10 bytes -> first frame + 1 consecutive
      const payload = [0x43, engineDtcs.length, ...engineDtcs.flat()];
      deliver(0x7e8, [0x10, payload.length, ...payload.slice(0, 6)]);
      pendingFF = payload.slice(6);
      const t = [0x43, tcuDtcs.length, ...tcuDtcs.flat()];
      deliver(0x7e9, [t.length, ...t]);
    } else if (f.id === 0x7e0 && f.data[0] === 0x30 && pendingFF) {
      deliver(0x7e8, [0x21, ...pendingFF]);
      pendingFF = null;
    } else if (f.id === 0x7df && f.data[1] === 0x04) {
      deliver(0x7e8, [0x01, 0x44]);
      deliver(0x7e9, [0x03, 0x7f, 0x04, 0x22]);   // negative response: conditions not correct
    }
  };
  obd = new ObdOverSlcan(send, { timeoutMs: 800, quietMs: 60 });
  return { obd, sent };
}

describe('SLCAN and OBD-II', () => {
  it('reassembles SLCAN lines split across chunks', () => {
    const r = new SlcanLineReader();
    expect(r.push('t12381122')).toEqual([]);
    expect(r.push('334455667788\rt7E8')).toEqual(['t12381122334455667788']);
    expect(r.push('20143\r\n')).toEqual(['t7E820143']);
  });

  it('decodes DTC bytes', () => {
    expect(decodeDtc(0x03, 0x00)).toBe('P0300');
    expect(decodeDtc(0x01, 0x71)).toBe('P0171');
    expect(decodeDtc(0xc1, 0x00)).toBe('U0100');
    expect(decodeDtc(0x41, 0x23)).toBe('C0123');
  });

  it('reads DTCs from several ECUs, including a multi-frame reply', async () => {
    const { obd, sent } = makeFakeCar();
    const { dtcs, ecus } = await obd.readDtcs();
    expect(dtcs).toEqual(['P0300', 'P0171', 'P0420', 'U0100', 'P0700']);
    expect(ecus.sort()).toEqual([0x7e8, 0x7e9]);
    expect(sent[0]).toBe('t7DF80103000000000000\r');
    expect(sent).toContain('t7E083000000000000000\r');   // flow control to the engine ECU
  });

  it('reports a car with no codes as empty, not as invented codes', async () => {
    const { obd } = makeFakeCar({ engineDtcs: [], tcuDtcs: [] });
    const { dtcs } = await obd.readDtcs();
    expect(dtcs).toEqual([]);
  });

  it('clearing reports which ECUs confirmed and which refused', async () => {
    const { obd } = makeFakeCar();
    const r = await obd.clearDtcs();
    expect(r.confirmed).toEqual([0x7e8]);
    expect(r.refused).toEqual([0x7e9]);
  });

  it('no answer means no ECUs, not success', async () => {
    const obd = new ObdOverSlcan(() => {}, { timeoutMs: 100, quietMs: 20 });
    expect(await obd.readDtcs()).toEqual({ dtcs: [], ecus: [] });
    expect(await obd.clearDtcs()).toEqual({ confirmed: [], refused: [] });
  });
});

describe('OBD-II live PIDs', () => {
  function makePidCar(values) {
    let obd;
    const send = (line) => {
      const f = parseSlcanFrame(line);
      if (!f || f.id !== 0x7df || f.data[1] !== 0x01) return;
      const pid = f.data[2];
      if (!(pid in values)) return;                       // unsupported: no reply
      const d = [0x41, pid, ...values[pid]];
      setTimeout(() => obd.onFrame(parseSlcanFrame(buildSlcanFrame(0x7e8, Uint8Array.from([d.length, ...d, 0, 0, 0, 0, 0, 0, 0].slice(0, 8))))), 3);
    };
    obd = new ObdOverSlcan(send, { timeoutMs: 300, quietMs: 30 });
    return obd;
  }

  it('reads PIDs and returns null for unsupported ones', async () => {
    const obd = makePidCar({ 0x0c: [0x1a, 0xf8], 0x0d: [0x3c] });
    expect(Array.from(await obd.readPid(0x0c))).toEqual([0x1a, 0xf8]);   // 1726 rpm
    expect(Array.from(await obd.readPid(0x0d))).toEqual([0x3c]);
    expect(await obd.readPid(0x42)).toBe(null);
  });

  it('queues overlapping requests instead of rejecting them', async () => {
    const obd = makePidCar({ 0x0c: [0x0f, 0xa0], 0x05: [0x7b] });
    const [rpm, temp] = await Promise.all([obd.readPid(0x0c), obd.readPid(0x05)]);
    expect(Array.from(rpm)).toEqual([0x0f, 0xa0]);
    expect(Array.from(temp)).toEqual([0x7b]);
  });
});
