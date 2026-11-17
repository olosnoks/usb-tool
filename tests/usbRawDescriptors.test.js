import { describe, it, expect } from 'vitest';
import {
  describeDevice, parseConfigDescriptor, parseBos, parseStringDescriptor, parseLangIds,
  parseDeviceDescriptor, parseHubDescriptor, walkDescriptors, hexDump, formatUuid,
  fetchRawDescriptors, toLsusbText, WEBUSB_UUID, MS_OS_20_UUID
} from '../src/utils/usbDescriptors';

// ---- byte builders -------------------------------------------------------
const d = (type, ...body) => [body.length + 2, type, ...body];
const w = (n) => [n & 0xff, (n >> 8) & 0xff];
const dw = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const uuidBytes = (s) => {
  const h = s.replace(/-/g, '').match(/../g).map((x) => parseInt(x, 16));
  return [...h.slice(0, 4).reverse(), ...h.slice(4, 6).reverse(), ...h.slice(6, 8).reverse(), ...h.slice(8)];
};
const config = (value, attrs, maxPower, ...parts) => {
  const body = parts.flat();
  const ifaces = new Set();
  for (let i = 0; i + 8 < body.length;) {
    if (body[i + 1] === 4) ifaces.add(body[i + 2]);
    i += body[i] || 1;
  }
  const total = 9 + body.length;
  return Uint8Array.from([9, 2, ...w(total), ifaces.size, value, 0, attrs, maxPower, ...body]);
};
const iface = (n, alt, neps, c, s, p, str = 0) => d(4, n, alt, neps, c, s, p, str);
const ep = (addr, attrs, mps, interval) => d(5, addr, attrs, ...w(mps), interval);

// A Leonardo-style composite: CDC (IAD) + HID keyboard.
const leonardoConfig = () => config(1, 0xa0, 50,
  d(0x0b, 0, 2, 2, 2, 0, 0),
  iface(0, 0, 1, 2, 2, 0),
  d(0x24, 0x00, ...w(0x0110)),
  d(0x24, 0x01, 0x01, 0x01),
  d(0x24, 0x02, 0x06),
  d(0x24, 0x06, 0, 1),
  ep(0x82, 3, 16, 64),
  iface(1, 0, 2, 0x0a, 0, 0),
  ep(0x04, 2, 64, 0),
  ep(0x83, 2, 64, 0),
  iface(2, 0, 1, 3, 1, 1),
  d(0x21, ...w(0x0111), 0, 1, 0x22, ...w(63)),
  ep(0x81, 3, 8, 10)
);

// Pi Pico style: CDC + MSC.
const picoConfig = () => config(1, 0x80, 125,
  d(0x0b, 0, 2, 2, 2, 0, 4),
  iface(0, 0, 1, 2, 2, 0, 4),
  d(0x24, 0x00, ...w(0x0120)),
  d(0x24, 0x02, 0x02),
  d(0x24, 0x06, 0, 1),
  ep(0x81, 3, 8, 16),
  iface(1, 0, 2, 0x0a, 0, 0),
  ep(0x02, 2, 64, 0),
  ep(0x82, 2, 64, 0),
  iface(2, 0, 2, 8, 6, 0x50),
  ep(0x03, 2, 64, 0),
  ep(0x83, 2, 64, 0)
);

describe('parseConfigDescriptor', () => {
  it('decodes a CDC + HID composite with IAD, CDC functionals and HID report length', () => {
    const c = parseConfigDescriptor(leonardoConfig());
    expect(c.notes).toEqual([]);
    expect(c.configurationValue).toBe(1);
    expect(c.numInterfaces).toBe(3);
    expect(c.maxPowerMa).toBe(100);
    expect(c.selfPowered).toBe(false);
    expect(c.remoteWakeup).toBe(true);
    expect(c.iads).toHaveLength(1);
    expect(c.iads[0]).toMatchObject({ firstInterface: 0, interfaceCount: 2, class: 2, subclass: 2 });

    const cdc = c.interfaces[0].alternates[0].classSpecific;
    expect(cdc.map((x) => x.name)).toEqual([
      'CDC Header', 'CDC Call Management', 'CDC Abstract Control Management', 'CDC Union'
    ]);
    expect(cdc[0].bcdCDC).toBe('1.10');
    expect(cdc[1].dataInterface).toBe(1);
    expect(cdc[2]).toMatchObject({ lineCoding: true, sendBreak: true });
    expect(cdc[3]).toMatchObject({ controlInterface: 0, subordinateInterfaces: [1] });

    const hid = c.interfaces[2].alternates[0].classSpecific[0];
    expect(hid.kind).toBe('hid');
    expect(hid.bcdHID).toBe('1.11');
    expect(hid.reportDescriptorLength).toBe(63);
  });

  it('returns the same interface/endpoint tree as describeDevice', () => {
    const raw = parseConfigDescriptor(picoConfig());
    const dev = describeDevice({
      vendorId: 0x2e8a, productId: 0x000a, deviceClass: 0xef,
      configurations: [{
        configurationValue: 1,
        interfaces: [
          { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 2, interfaceSubclass: 2, interfaceProtocol: 0, endpoints: [{ endpointNumber: 1, direction: 'in', type: 'interrupt', packetSize: 8 }] }] },
          { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 10, interfaceSubclass: 0, interfaceProtocol: 0, endpoints: [{ endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 64 }, { endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }] }] },
          { interfaceNumber: 2, alternates: [{ alternateSetting: 0, interfaceClass: 8, interfaceSubclass: 6, interfaceProtocol: 0x50, endpoints: [{ endpointNumber: 3, direction: 'out', type: 'bulk', packetSize: 64 }, { endpointNumber: 3, direction: 'in', type: 'bulk', packetSize: 64 }] }] }
        ]
      }]
    });
    const pick = (ifaces) => ifaces.map((i) => ({
      number: i.number,
      alternates: i.alternates.map((a) => ({
        setting: a.setting, class: a.class, subclass: a.subclass, protocol: a.protocol, className: a.className, detail: a.detail,
        endpoints: a.endpoints.map((e) => ({ address: e.address, number: e.number, direction: e.direction, type: e.type, packetSize: e.packetSize }))
      }))
    }));
    expect(pick(raw.interfaces)).toEqual(pick(dev.configurations[0].interfaces));
    expect(raw.interfaces[2].alternates[0].detail).toMatch(/Bulk-Only/);
  });

  it('decodes bmAttributes self-powered / remote wakeup and SS bMaxPower units', () => {
    const cfg = config(1, 0xc0, 150, iface(0, 0, 0, 0xff, 0, 0));
    const c = parseConfigDescriptor(cfg);
    expect(c.selfPowered).toBe(true);
    expect(c.remoteWakeup).toBe(false);
    expect(c.maxPowerMa).toBe(300);
    expect(parseConfigDescriptor(cfg, { superSpeed: true }).maxPowerMa).toBe(1200);
  });

  it('attaches a SuperSpeed endpoint companion to its endpoint', () => {
    const cfg = config(1, 0x80, 112, iface(0, 0, 1, 0xff, 0, 0), ep(0x81, 2, 1024, 0), d(0x30, 15, 0, ...w(0)));
    const e = parseConfigDescriptor(cfg, { superSpeed: true }).interfaces[0].alternates[0].endpoints[0];
    expect(e.companion).toEqual({ maxBurst: 15, attributes: 0, bytesPerInterval: 0 });
  });

  it('decodes a DFU functional descriptor and a UVC header', () => {
    const cfg = config(1, 0x80, 50,
      iface(0, 0, 0, 0xfe, 1, 2),
      d(0x21, 0x0b, ...w(255), ...w(2048), ...w(0x0110)),
      iface(1, 0, 0, 0x0e, 1, 0),
      d(0x24, 0x01, ...w(0x0100), ...w(0x30), ...dw(48000000), 1, 2));
    const c = parseConfigDescriptor(cfg);
    const dfu = c.interfaces[0].alternates[0].classSpecific[0];
    expect(dfu).toMatchObject({ kind: 'dfu', canDownload: true, canUpload: true, willDetach: true, manifestationTolerant: false, transferSize: 2048, bcdDFUVersion: '1.10' });
    const uvc = c.interfaces[1].alternates[0].classSpecific[0];
    expect(uvc).toMatchObject({ kind: 'uvc', name: 'UVC VC_HEADER', bcdUVC: '1.00', clockFrequencyHz: 48000000, interfaceCollection: [2] });
  });

  it('never throws on garbage and reports "malformed at offset N"', () => {
    const zeroLen = Uint8Array.from([9, 2, 25, 0, 1, 1, 0, 0x80, 50, 0, 4, 0]);
    expect(() => parseConfigDescriptor(zeroLen)).not.toThrow();
    expect(parseConfigDescriptor(zeroLen).notes.join('|')).toMatch(/malformed at offset 9: bLength 0/);

    const overrun = Uint8Array.from([9, 2, 30, 0, 1, 1, 0, 0x80, 50, 9, 4, 0, 0, 0, 0xff, 0, 0, 0, 40, 5, 0x81]);
    const c = parseConfigDescriptor(overrun);
    expect(c.interfaces).toHaveLength(1);
    expect(c.notes.join('|')).toMatch(/malformed at offset 18: bLength 40 overruns/);

    for (const junk of [[], [0], [1], [9], [2, 2], Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff)]) {
      expect(() => parseConfigDescriptor(Uint8Array.from(junk))).not.toThrow();
      expect(() => parseBos(Uint8Array.from(junk))).not.toThrow();
      expect(() => parseStringDescriptor(Uint8Array.from(junk))).not.toThrow();
    }
    expect(parseConfigDescriptor([]).notes[0]).toMatch(/malformed at offset 0/);
  });
});

describe('parseBos', () => {
  const bos = () => {
    const ext = d(0x10, 0x02, ...dw(0x06));
    const ss = d(0x10, 0x03, 0x00, ...w(0x000e), 0x02, 0x0a, ...w(0x00ff));
    const webusb = d(0x10, 0x05, 0, ...uuidBytes(WEBUSB_UUID), ...w(0x0100), 0x21, 1);
    const msos = d(0x10, 0x05, 0, ...uuidBytes(MS_OS_20_UUID), ...dw(0x06030000), ...w(178), 0x22, 0);
    const caps = [ext, ss, webusb, msos].flat();
    return Uint8Array.from([5, 0x0f, ...w(5 + caps.length), 4, ...caps]);
  };

  it('decodes USB 2.0 extension, SuperSpeed and WebUSB / MS OS 2.0 platform capabilities', () => {
    const r = parseBos(bos());
    expect(r.notes).toEqual([]);
    expect(r.numDeviceCaps).toBe(4);
    expect(r.capabilities).toHaveLength(4);
    expect(r.capabilities[0]).toMatchObject({ name: 'USB 2.0 Extension', lpm: true, besl: true });
    expect(r.capabilities[1]).toMatchObject({ name: 'SuperSpeed USB', speeds: ['Full', 'High', 'SuperSpeed'], functionalitySupport: 2, u1ExitLatency: 10, u2ExitLatency: 255 });
    expect(r.capabilities[2]).toMatchObject({ platform: 'WebUSB', uuid: WEBUSB_UUID, version: '1.00', vendorCode: 0x21, landingPageIndex: 1 });
    expect(r.capabilities[3]).toMatchObject({ platform: 'Microsoft OS 2.0', uuid: MS_OS_20_UUID, windowsVersion: 0x06030000, descriptorSetTotalLength: 178, vendorCode: 0x22 });
  });

  it('flags a truncated BOS without throwing', () => {
    const b = bos();
    const r = parseBos(b.subarray(0, b.length - 6));
    expect(r.notes.join('|')).toMatch(/malformed at offset \d+/);
  });
});

describe('small parsers', () => {
  it('parses string and language descriptors', () => {
    expect(parseLangIds([4, 3, 0x09, 0x04])).toEqual([0x0409]);
    const s = [10, 3, 0x41, 0, 0x72, 0, 0x64, 0, 0x75, 0];
    expect(parseStringDescriptor(s).text).toBe('Ardu');
    expect(parseStringDescriptor([20, 3, 0x41, 0]).notes[0]).toMatch(/overruns/);
  });

  it('parses the device descriptor and a hub descriptor', () => {
    const dev = parseDeviceDescriptor([18, 1, 0x00, 0x02, 2, 2, 0, 64, 0x41, 0x23, 0x43, 0x00, 0x00, 0x01, 1, 2, 3, 1]);
    expect(dev).toMatchObject({ usbVersion: '2.00', vendorId: 0x2341, productId: 0x0043, maxPacketSize0: 64, numConfigurations: 1 });
    expect(parseDeviceDescriptor([1, 2]).notes[0]).toMatch(/malformed/);
    const hub = parseHubDescriptor([9, 0x29, 4, 0x09, 0x00, 50, 100, 0, 0xff]);
    expect(hub).toMatchObject({ numPorts: 4, powerSwitching: 'individual', overCurrentProtection: 'individual', powerOnToGoodMs: 100, hubControllerCurrentMa: 100 });
  });

  it('walkDescriptors, formatUuid and hexDump', () => {
    expect(walkDescriptors([2, 1, 0, 0]).notes[0]).toMatch(/malformed at offset 2/);
    expect(formatUuid(uuidBytes(WEBUSB_UUID))).toBe(WEBUSB_UUID);
    expect(hexDump([0x41, 0x42, 0x00])).toBe('0000  41 42 00' + ' '.repeat(47 - 8) + '  AB.');
  });
});

describe('fetchRawDescriptors', () => {
  // A mock USBDevice backed by byte blobs; records every call.
  function mockDevice({ opened = false, openFails = false } = {}) {
    const dev18 = [18, 1, 0x00, 0x02, 0xef, 2, 1, 64, 0x8a, 0x2e, 0x0a, 0x00, 0x00, 0x01, 1, 2, 3, 1];
    const bosBlob = (() => {
      const cap = d(0x10, 0x05, 0, ...uuidBytes(WEBUSB_UUID), ...w(0x0100), 0x21, 1);
      return [5, 0x0f, ...w(5 + cap.length), 1, ...cap];
    })();
    const str = (s) => [2 + s.length * 2, 3, ...[...s].flatMap((c) => [c.charCodeAt(0), 0])];
    const cfg = Array.from(picoConfig());
    dev18[1] = 1; dev18[2] = 0x10; dev18[3] = 0x02; // bcdUSB 2.10
    const calls = [];
    const device = {
      opened, calls, outCalls: 0,
      async open() { calls.push('open'); if (openFails) throw new Error('Access denied'); device.opened = true; },
      async close() { calls.push('close'); device.opened = false; },
      async controlTransferIn(setup, length) {
        calls.push(setup);
        const type = setup.value >> 8; const idx = setup.value & 0xff;
        let blob = null;
        if (type === 1) blob = dev18;
        else if (type === 2) blob = cfg;
        else if (type === 0x0f) blob = bosBlob;
        else if (type === 3 && idx === 0) blob = [4, 3, 0x09, 0x04];
        else if (type === 3) blob = str(['', 'Pico', 'Board', 'SN1', 'CDC'][idx] || 'x');
        if (!blob) return { status: 'stall' };
        return { status: 'ok', data: new DataView(Uint8Array.from(blob.slice(0, length)).buffer) };
      },
      async controlTransferOut() { device.outCalls++; throw new Error('must not be called'); },
      async transferOut() { device.outCalls++; throw new Error('must not be called'); },
      async claimInterface() { device.outCalls++; throw new Error('must not be called'); }
    };
    return device;
  }

  it('reads device, configuration, BOS and strings with standard device GET_DESCRIPTOR only', async () => {
    const device = mockDevice();
    const raw = await fetchRawDescriptors(device);
    expect(raw.device).toMatchObject({ vendorId: 0x2e8a, productId: 0x000a, numConfigurations: 1 });
    expect(raw.configs).toHaveLength(1);
    expect(raw.configs[0].parsed.interfaces).toHaveLength(3);
    expect(raw.bos.parsed.capabilities[0].platform).toBe('WebUSB');
    expect(raw.langIds).toEqual([0x0409]);
    expect(raw.strings[0x0409][1]).toBe('Pico');

    const setups = device.calls.filter((c) => typeof c === 'object');
    expect(setups.length).toBeGreaterThan(5);
    for (const s of setups) {
      expect(s.requestType).toBe('standard');
      expect(s.recipient).toBe('device');
      expect(s.request).toBe(0x06);
    }
    expect(device.outCalls).toBe(0);
    // it opened the device, so it closes it again
    expect(device.calls[0]).toBe('open');
    expect(device.calls[device.calls.length - 1]).toBe('close');
    expect(toLsusbText(raw, { vendor: 'Raspberry Pi', product: 'Pico' })).toMatch(/idVendor\s+0x2e8a Raspberry Pi/);
  });

  it('does not close a device it did not open, and degrades if open() fails', async () => {
    const already = mockDevice({ opened: true });
    await fetchRawDescriptors(already);
    expect(already.calls).not.toContain('open');
    expect(already.calls).not.toContain('close');

    const blocked = mockDevice({ openFails: true });
    const raw = await fetchRawDescriptors(blocked);
    expect(raw.device).toBeNull();
    expect(raw.notes[0]).toMatch(/Could not open the device/);
    expect(blocked.calls.filter((c) => typeof c === 'object')).toHaveLength(0);
  });
});
