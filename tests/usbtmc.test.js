import { describe, it, expect } from 'vitest';
import {
  UsbTmcDevice, buildMsgOut, buildRequestIn, parseMsgIn, findUsbtmcInterface, createSimulatedUsbTmc, MSGID
} from '../src/utils/usbtmcDriver';

const td = new TextDecoder();

describe('USBTMC framing', () => {
  it('builds a DEV_DEP_MSG_OUT with a 4-byte-aligned payload and EOM', () => {
    const pkt = buildMsgOut(5, new TextEncoder().encode('*IDN?\n'));
    expect(pkt[0]).toBe(MSGID.DEV_DEP_MSG_OUT);
    expect(pkt[1]).toBe(5);
    expect(pkt[2]).toBe(0xfa); // ~5
    const dv = new DataView(pkt.buffer);
    expect(dv.getUint32(4, true)).toBe(6); // "*IDN?\n"
    expect(pkt[8]).toBe(0x01); // EOM
    expect(pkt.length).toBe(12 + 8); // 6 bytes padded to 8
  });

  it('builds a REQUEST_DEV_DEP_MSG_IN', () => {
    const pkt = buildRequestIn(9, 1024);
    expect(pkt[0]).toBe(MSGID.REQUEST_DEV_DEP_MSG_IN);
    expect(new DataView(pkt.buffer).getUint32(4, true)).toBe(1024);
  });

  it('parses a DEV_DEP_MSG_IN', () => {
    const body = new Uint8Array(12 + 4);
    body[0] = MSGID.DEV_DEP_MSG_IN; body[1] = 3; body[8] = 0x01;
    new DataView(body.buffer).setUint32(4, 3, true);
    body.set([65, 66, 67], 12); // "ABC"
    const m = parseMsgIn(body);
    expect(m.eom).toBe(true);
    expect(td.decode(m.data)).toBe('ABC');
  });

  it('rejects a short or wrong-id IN packet', () => {
    expect(() => parseMsgIn(new Uint8Array(4))).toThrow(/Short/);
    const wrong = new Uint8Array(12); wrong[0] = 9;
    expect(() => parseMsgIn(wrong)).toThrow(/MsgID/);
  });
});

describe('findUsbtmcInterface', () => {
  it('matches class FE / subclass 03', () => {
    const cfg = { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0xfe, interfaceSubclass: 0x03, endpoints: [
      { type: 'bulk', direction: 'out', endpointNumber: 2 }, { type: 'bulk', direction: 'in', endpointNumber: 1 }
    ] }] }] };
    expect(findUsbtmcInterface(cfg)).toMatchObject({ interfaceNumber: 0, epOut: 2, epIn: 1 });
  });
});

describe('UsbTmcDevice against a simulated instrument', () => {
  it('reads *IDN? and other queries', async () => {
    const inst = new UsbTmcDevice(createSimulatedUsbTmc());
    await inst.open();
    expect(await inst.identify()).toMatch(/SIM-SCOPE 1000/);
    expect(await inst.query('*OPC?')).toBe('1');
    expect(Number(await inst.query('MEAS:VOLT:DC?'))).toBeGreaterThan(3);
    expect(await inst.query('SYST:ERR?')).toMatch(/No error/);
  });

  it('records commands that have no response', async () => {
    const transport = createSimulatedUsbTmc();
    const inst = new UsbTmcDevice(transport);
    await inst.open();
    await inst.write('VOLT 5.0');
    expect(transport.state.lastWrite).toBe('VOLT 5.0');
  });

  it('cycles bTag and never uses 0', async () => {
    const inst = new UsbTmcDevice(createSimulatedUsbTmc());
    await inst.open();
    for (let i = 0; i < 300; i++) { inst._nextTag(); }
    expect(inst.bTag).toBeGreaterThanOrEqual(1);
    expect(inst.bTag).toBeLessThanOrEqual(255);
  });
});
