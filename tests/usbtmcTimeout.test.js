import { describe, it, expect, vi } from 'vitest';
import {
  UsbTmcDevice, UsbTmcUsbTransport, UsbTmcError, TMC_REQUEST, TMC_STATUS, MSGID, findUsbtmcInterface, parseCapabilities
} from '../src/utils/usbtmcDriver';
import { drainErrors } from '../src/utils/scpiTools';
import { createSimulatedUsbTmc } from './helpers/sim/usbtmc';

// FLB-3: timeouts, abort/clear and USB488 requests.

const IFACE = 3;
const EP_OUT = 2;
const EP_IN = 1;

/** Transport that answers like the simulator, but can be told to hang on reads. */
function makeHangingTransport({ withControl = true } = {}) {
  const sim = createSimulatedUsbTmc();
  const t = {
    sim,
    hang: false,
    controls: [],
    halts: [],
    interfaceNumber: IFACE,
    epOut: EP_OUT,
    epIn: EP_IN,
    open: async () => {},
    close: async () => {},
    write: (b) => sim.write(b),
    read: (n) => (t.hang ? new Promise(() => {}) : sim.read(n))
  };
  if (withControl) {
    t.controlTransfer = vi.fn(async (setup, length) => {
      t.controls.push({ ...setup, length });
      // Any abort / clear succeeds, and un-hangs the instrument.
      if (setup.request === TMC_REQUEST.INITIATE_ABORT_BULK_IN || setup.request === TMC_REQUEST.INITIATE_CLEAR) {
        t.hang = false;
        return Uint8Array.from([TMC_STATUS.SUCCESS, 0, 0, 0, 0, 0, 0, 0].slice(0, length));
      }
      return Uint8Array.from([TMC_STATUS.SUCCESS, 0, 0, 0, 0, 0, 0, 0].slice(0, length));
    });
    t.clearHalt = vi.fn(async (dir) => { t.halts.push(dir); });
  }
  return t;
}

describe('USBTMC timeouts', () => {
  it('rejects a query on an unanswered read with a timeout UsbTmcError, then recovers (no deadlock)', async () => {
    const t = makeHangingTransport({ withControl: false });
    const inst = new UsbTmcDevice(t, { timeoutMs: 60 });
    await inst.open();
    t.hang = true;
    const t0 = Date.now();
    const err = await inst.query('*IDN?').catch((e) => e);
    expect(err).toBeInstanceOf(UsbTmcError);
    expect(err.timeout).toBe(true);
    expect(err.message).toMatch(/timed out after 60 ms/);
    expect(Date.now() - t0).toBeLessThan(1000);
    t.hang = false;
    expect(await inst.query('*IDN?')).toMatch(/SIM-SCOPE/);
  });

  it('honors a per-call timeout and queued commands still run after a stuck one', async () => {
    const t = makeHangingTransport({ withControl: false });
    const inst = new UsbTmcDevice(t, { timeoutMs: 5000 });
    t.hang = true;
    const stuck = inst.query('*IDN?', { timeoutMs: 40 }).catch((e) => e);
    t.hang = true;
    const queued = inst.write('VOLT 1').then(() => 'ok');
    expect((await stuck).timeout).toBe(true);
    t.hang = false;
    expect(await queued).toBe('ok');
    expect(t.sim.state.lastWrite).toBe('VOLT 1');
  });

  it('on a read timeout issues INITIATE_ABORT_BULK_IN (endpoint, IN address, last bTag) then CHECK_ABORT_BULK_IN_STATUS', async () => {
    const t = makeHangingTransport();
    const inst = new UsbTmcDevice(t, { timeoutMs: 40, abortDrainMs: 5 });
    t.hang = true;
    await expect(inst.query('*IDN?')).rejects.toMatchObject({ timeout: true });
    const [init, check] = t.controls;
    expect(init).toMatchObject({ recipient: 'endpoint', request: TMC_REQUEST.INITIATE_ABORT_BULK_IN, index: 0x80 | EP_IN, value: inst.lastInTag, length: 2 });
    expect(check).toMatchObject({ recipient: 'endpoint', request: TMC_REQUEST.CHECK_ABORT_BULK_IN_STATUS, index: 0x80 | EP_IN, length: 8 });
    t.hang = false;
    expect(await inst.query('*OPC?')).toBe('1');
  });

  it('falls back to INITIATE_CLEAR / CHECK_CLEAR_STATUS plus clearHalt when the abort is refused', async () => {
    const t = makeHangingTransport();
    const base = t.controlTransfer.getMockImplementation();
    t.controlTransfer.mockImplementation(async (setup, length) => {
      if (setup.request === TMC_REQUEST.INITIATE_ABORT_BULK_IN) {
        t.controls.push({ ...setup, length });
        return Uint8Array.from([TMC_STATUS.FAILED, 0]);
      }
      return base(setup, length);
    });
    const inst = new UsbTmcDevice(t, { timeoutMs: 40, abortDrainMs: 5 });
    t.hang = true;
    await expect(inst.read()).rejects.toMatchObject({ timeout: true });
    expect(t.controls.map((c) => c.request)).toEqual([
      TMC_REQUEST.INITIATE_ABORT_BULK_IN, TMC_REQUEST.INITIATE_CLEAR, TMC_REQUEST.CHECK_CLEAR_STATUS
    ]);
    const clear = t.controls[1];
    expect(clear).toMatchObject({ recipient: 'interface', index: IFACE });
    expect(t.halts).toEqual(['out', 'in']);
  });

  it('write timeout aborts bulk-OUT on the OUT endpoint address', async () => {
    const t = makeHangingTransport();
    t.write = () => new Promise(() => {});
    const inst = new UsbTmcDevice(t, { timeoutMs: 30 });
    await expect(inst.write('*RST')).rejects.toMatchObject({ timeout: true });
    expect(t.controls[0]).toMatchObject({ recipient: 'endpoint', request: TMC_REQUEST.INITIATE_ABORT_BULK_OUT, index: EP_OUT });
    expect(t.controls[1]).toMatchObject({ request: TMC_REQUEST.CHECK_ABORT_BULK_OUT_STATUS });
    expect(t.halts).toContain('out');
  });

  it('abortAndClear runs abort-in, abort-out then clear in spec order', async () => {
    const t = makeHangingTransport();
    const inst = new UsbTmcDevice(t);
    const ok = await inst.abortAndClear();
    expect(ok).toBe(true);
    expect(t.controls.map((c) => c.request)).toEqual([
      TMC_REQUEST.INITIATE_ABORT_BULK_IN, TMC_REQUEST.CHECK_ABORT_BULK_IN_STATUS,
      TMC_REQUEST.INITIATE_ABORT_BULK_OUT, TMC_REQUEST.CHECK_ABORT_BULK_OUT_STATUS,
      TMC_REQUEST.INITIATE_CLEAR, TMC_REQUEST.CHECK_CLEAR_STATUS
    ]);
  });
});

describe('USB488 / capability requests', () => {
  it('GET_CAPABILITIES is decoded', async () => {
    const t = makeHangingTransport();
    const caps = new Uint8Array(24);
    caps[0] = TMC_STATUS.SUCCESS; caps[2] = 0x00; caps[3] = 0x01; caps[4] = 0x04; caps[5] = 0x01;
    caps[12] = 0x00; caps[13] = 0x01; caps[14] = 0x06; caps[15] = 0x0f;
    t.controlTransfer.mockResolvedValueOnce(caps);
    const inst = new UsbTmcDevice(t);
    const c = await inst.getCapabilities();
    expect(t.controls).toHaveLength(0); // mockResolvedValueOnce bypasses the recorder
    expect(c).toMatchObject({ indicatorPulse: true, termChar: true, usb488: { is488_2: true, remoteLocal: true, scpi: true } });
    expect(() => parseCapabilities(new Uint8Array(4))).toThrow(/Short/);
  });

  it('indicatorPulse, readStatusByte and goToLocal use class/interface requests', async () => {
    const t = makeHangingTransport();
    t.controlTransfer.mockImplementation(async (setup, length) => {
      t.controls.push({ ...setup, length });
      if (setup.request === TMC_REQUEST.READ_STATUS_BYTE) return Uint8Array.from([TMC_STATUS.SUCCESS, setup.value, 0x50]);
      return Uint8Array.from([TMC_STATUS.SUCCESS]);
    });
    const inst = new UsbTmcDevice(t);
    expect(await inst.indicatorPulse()).toBe(true);
    expect(await inst.readStatusByte()).toBe(0x50);
    await inst.remoteEnable(true);
    await inst.goToLocal();
    const byReq = (r) => t.controls.find((c) => c.request === r);
    expect(byReq(TMC_REQUEST.INDICATOR_PULSE)).toMatchObject({ recipient: 'interface', index: IFACE });
    const sb = byReq(TMC_REQUEST.READ_STATUS_BYTE);
    expect(sb.value).toBeGreaterThanOrEqual(2);
    expect(sb.value).toBeLessThanOrEqual(127);
    expect(byReq(TMC_REQUEST.REN_CONTROL)).toMatchObject({ value: 1, recipient: 'interface' });
    expect(byReq(TMC_REQUEST.GO_TO_LOCAL)).toMatchObject({ recipient: 'interface' });
  });

  it('close() returns the instrument to local before closing', async () => {
    const t = makeHangingTransport();
    const closed = vi.fn(async () => {});
    t.close = closed;
    const inst = new UsbTmcDevice(t);
    await inst.close();
    expect(t.controls.some((c) => c.request === TMC_REQUEST.GO_TO_LOCAL)).toBe(true);
    expect(closed).toHaveBeenCalled();
  });

  it('control features throw a clear error on a transport without them', async () => {
    const inst = new UsbTmcDevice(makeHangingTransport({ withControl: false }));
    await expect(inst.readStatusByte()).rejects.toThrow(/control requests/);
  });
});

describe('UsbTmcUsbTransport control plumbing', () => {
  it('sends requestType class with the claimed interface and endpoint indexes', async () => {
    const calls = [];
    const device = {
      opened: true,
      configuration: {
        interfaces: [{ interfaceNumber: 5, alternates: [{ interfaceClass: 0xfe, interfaceSubclass: 3, endpoints: [
          { type: 'bulk', direction: 'out', endpointNumber: 4 },
          { type: 'bulk', direction: 'in', endpointNumber: 6 },
          { type: 'interrupt', direction: 'in', endpointNumber: 7 }
        ] }] }]
      },
      claimInterface: vi.fn(async () => {}),
      controlTransferIn: vi.fn(async (setup, len) => {
        calls.push({ setup, len });
        return { status: 'ok', data: new DataView(Uint8Array.from([TMC_STATUS.SUCCESS, 0]).buffer) };
      }),
      clearHalt: vi.fn(async () => {})
    };
    expect(findUsbtmcInterface(device.configuration)).toMatchObject({ interfaceNumber: 5, epOut: 4, epIn: 6, epInt: 7 });
    const transport = new UsbTmcUsbTransport(device);
    await transport.open();
    const inst = new UsbTmcDevice(transport, { abortDrainMs: 1 });
    await inst._abortBulkIn();
    expect(calls[0].setup).toMatchObject({
      requestType: 'class', recipient: 'endpoint', request: TMC_REQUEST.INITIATE_ABORT_BULK_IN, index: 0x86
    });
    await inst._clear();
    const clear = calls.find((c) => c.setup.request === TMC_REQUEST.INITIATE_CLEAR);
    expect(clear.setup).toMatchObject({ requestType: 'class', recipient: 'interface', index: 5 });
    expect(device.clearHalt).toHaveBeenCalledWith('out', 4);
    expect(device.clearHalt).toHaveBeenCalledWith('in', 6);
  });
});

describe('drainErrors', () => {
  it('collects errors until the queue reports 0', async () => {
    const answers = ['-113,"Undefined header"', '-102,"Syntax error"', '0,"No error"'];
    const inst = { query: vi.fn(async () => answers.shift()) };
    expect(await drainErrors(inst)).toEqual(['-113,"Undefined header"', '-102,"Syntax error"']);
    expect(MSGID.DEV_DEP_MSG_OUT).toBe(1);
  });
});
