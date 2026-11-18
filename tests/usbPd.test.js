import { describe, it, expect } from 'vitest';
import { SerialLink } from '../src/utils/serialLink';
import { UsbPdClient, STUSB4500, decodeSinkPdo, encodeSinkPdo, decodeRdo } from '../src/utils/usbPdDriver';
import { fakeBusPirate } from './helpers/fakeBusPirate';

const le = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const fixedPdo = (v, a, flags = 0) => (flags | (Math.round(v / 0.05) << 10) | Math.round(a / 0.01)) >>> 0;

// STUSB4500 register file as shipped on the SparkFun board: 5 V, 15 V, 20 V sink PDOs.
function stusbRegs({ id = 0x25, attached = true, rdo = (2 << 28) | (150 << 10) | 150 } = {}) {
  const regs = {};
  regs[STUSB4500.DEVICE_ID] = id;
  regs[STUSB4500.PORT_STATUS_1] = attached ? 0x01 : 0x00;
  regs[STUSB4500.DPM_PDO_NUMB] = 3;
  [fixedPdo(5, 1.5, 1 << 29), fixedPdo(15, 1.5), fixedPdo(20, 1)].forEach((p, i) => {
    le(p).forEach((b, k) => { regs[STUSB4500.DPM_SNK_PDO1 + i * 4 + k] = b; });
  });
  le(rdo).forEach((b, k) => { regs[STUSB4500.RDO_STATUS + k] = b; });
  return regs;
}

async function connected(regs = stusbRegs()) {
  const fake = fakeBusPirate({ devices: { 0x28: regs } });
  const link = new SerialLink(fake.port);
  await link.open({ baudRate: 115200 });
  const client = new UsbPdClient(() => {});
  await client.connectHardware({ link });
  return { client, regs, ...fake };
}

describe('STUSB4500 through a Bus Pirate', () => {
  it('encodes and decodes fixed PDOs and RDOs', () => {
    expect(decodeSinkPdo(fixedPdo(9, 3))).toEqual({ voltageV: 9, currentA: 3 });
    const kept = encodeSinkPdo(fixedPdo(5, 1.5, 1 << 29), 12, 2);
    expect(kept >>> 29 & 1).toBe(1); // flag bits preserved
    expect(decodeSinkPdo(kept)).toEqual({ voltageV: 12, currentA: 2 });
    expect(decodeRdo((3 << 28) | (200 << 10) | 250)).toMatchObject({ position: 3, operatingCurrentA: 2, maxCurrentA: 2.5 });
  });

  it('identifies the chip and reads the contract and sink PDOs', async () => {
    const { client } = await connected();
    expect(client.chipId).toBe(0x25);
    const st = await client.readHardwareStatus();
    expect(st.attached).toBe(true);
    expect(st.rdo).toMatchObject({ position: 2, operatingCurrentA: 1.5 });
    expect(st.sink.count).toBe(3);
    expect(st.sink.pdos.map((p) => p.voltageV)).toEqual([5, 15, 20]);
  });

  it('requests a voltage by rewriting PDO2 and sending a soft reset', async () => {
    const { client, regs } = await connected();
    await client.requestHardwareVoltage(9, 2);
    const st = await client.readHardwareStatus();
    expect(st.sink.count).toBe(2);
    expect(st.sink.pdos[1]).toEqual({ voltageV: 9, currentA: 2 });
    expect(regs[STUSB4500.TX_HEADER_LOW]).toBe(0x0d);
    expect(regs[STUSB4500.PD_COMMAND_CTRL]).toBe(0x26);
  });

  it('drops to a single 5 V PDO for 5 V', async () => {
    const { client } = await connected();
    await client.requestHardwareVoltage(5, 1);
    expect((await client.readHardwareStatus()).sink.count).toBe(1);
  });

  it('refuses out-of-range requests', async () => {
    const { client } = await connected();
    await expect(client.requestHardwareVoltage(24, 1)).rejects.toThrow(/5 V to 20 V/);
  });

  it('rejects a different chip at 0x28', async () => {
    await expect(connected(stusbRegs({ id: 0x99 }))).rejects.toThrow(/not an STUSB4500/);
  });

  it('reports no contract when nothing is attached', async () => {
    const { client } = await connected(stusbRegs({ attached: false, rdo: 0 }));
    const st = await client.readHardwareStatus();
    expect(st.attached).toBe(false);
    expect(st.rdo).toBe(null);
  });
});

import { validateRequest, watts, diffStatus, formatStatusReport, formatEventLog } from '../src/utils/usbPdTools';

describe('usbPdTools', () => {
  const st = (pos, a = 1.5, att = true, count = 2) => ({
    attached: att,
    rdo: pos ? { position: pos, operatingCurrentA: a, maxCurrentA: a } : null,
    sink: { count, pdos: [{ voltageV: 5, currentA: 1.5 }, { voltageV: 9, currentA: 1.5 }, { voltageV: 20, currentA: 1 }] }
  });
  it('computes watts', () => { expect(watts(20, 3)).toBe(60); expect(watts('x', 1)).toBe(0); });
  it('validates requests', () => {
    expect(validateRequest('9', '1.5')).toMatchObject({ ok: true, watts: 13.5 });
    expect(validateRequest('4', '1').ok).toBe(false);
    expect(validateRequest('21', '1').ok).toBe(false);
    expect(validateRequest('9', '0').ok).toBe(false);
    expect(validateRequest('', '1').ok).toBe(false);
    expect(validateRequest('20', '4').warnings.length).toBeGreaterThan(0);
    expect(validateRequest('20', '5').warnings.join()).toMatch(/e-marked/);
    expect(validateRequest('9', '1').warnings).toEqual([]);
  });
  it('diffs status', () => {
    expect(diffStatus(null, st(2))[0]).toMatch(/attached/);
    expect(diffStatus(st(2), st(2))).toEqual([]);
    expect(diffStatus(st(2), st(3)).join()).toMatch(/#2 to #3/);
    expect(diffStatus(st(2), st(2, 1.5, false)).join()).toMatch(/removed/);
    expect(diffStatus(st(null), st(1)).join()).toMatch(/Contract: source PDO #1/);
    expect(diffStatus(st(1), st(null)).join()).toMatch(/lost/);
    expect(diffStatus(st(1, 1.5), st(1, 3)).join()).toMatch(/3.00 A/);
    expect(diffStatus(st(1, 1.5, true, 2), st(1, 1.5, true, 3)).join()).toMatch(/Sink PDOs changed/);
  });
  it('formats reports', () => {
    expect(formatStatusReport(st(2), 0x25)).toMatch(/PDO3: 20.00 V \/ 1.00 A = 20 W \(off\)/);
    expect(formatStatusReport(null)).toBe('');
    expect(formatEventLog([{ t: 0, text: 'x' }])).toBe('1970-01-01T00:00:00.000Z  x');
  });
});
