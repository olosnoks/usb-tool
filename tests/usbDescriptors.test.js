import { describe, it, expect } from 'vitest';
import {
  describeDevice, classDetail, className, formatBcd, formatId, describeEndpoint, toTextReport
} from '../src/utils/usbDescriptors';

// A Samsung phone in fastboot: per-interface class, one vendor interface with
// a bulk IN/OUT pair.
const fastbootDevice = {
  vendorId: 0x04e8, productId: 0x6860,
  deviceClass: 0, deviceSubclass: 0, deviceProtocol: 0,
  usbVersionMajor: 2, usbVersionMinor: 0, usbVersionSubminor: 0,
  deviceVersionMajor: 1, deviceVersionMinor: 0, deviceVersionSubminor: 0,
  manufacturerName: 'Samsung', productName: 'Galaxy', serialNumber: 'CAFE1234',
  configurations: [{
    configurationValue: 1, configurationName: null,
    interfaces: [{
      interfaceNumber: 0,
      alternates: [{
        alternateSetting: 0, interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: 0x03,
        interfaceName: 'Android Fastboot',
        endpoints: [
          { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 512 },
          { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 }
        ]
      }]
    }]
  }]
};

describe('class code decoding', () => {
  it('names base classes and known triples', () => {
    expect(className(0x08)).toBe('Mass Storage');
    expect(className(0x42)).toMatch(/0x42/);
    expect(classDetail(0x08, 0x06, 0x50)).toMatch(/Bulk-Only/);
    expect(classDetail(0xff, 0x42, 0x03)).toBe('Android fastboot');
    expect(classDetail(0x03, 0x00, 0x00)).toBe('HID');
    expect(classDetail(0x03, 0x05, 0x07)).toMatch(/HID \(subclass 5, protocol 7\)/);
  });
});

describe('field formatting', () => {
  it('formats BCD and 16-bit IDs', () => {
    expect(formatBcd(0x0210)).toBe('2.10');
    expect(formatBcd(0x0100)).toBe('1.00');
    expect(formatId(0x04e8)).toBe('04e8');
    expect(formatId(null)).toBe('----');
  });
});

describe('endpoint decoding', () => {
  it('builds the address with the direction bit and names the type', () => {
    expect(describeEndpoint({ endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }))
      .toMatchObject({ address: '0x82', direction: 'IN', type: 'Bulk', packetSize: 64 });
    expect(describeEndpoint({ endpointNumber: 3, direction: 'out', type: 'interrupt', packetSize: 8 }))
      .toMatchObject({ address: '0x03', type: 'Interrupt' });
  });
});

describe('describeDevice', () => {
  it('builds a named tree and highlights', () => {
    const info = describeDevice(fastbootDevice);
    expect(info.vendorIdHex).toBe('04e8');
    expect(info.usbVersion).toBe('2.00');
    expect(info.className).toBe('Per-interface');
    const alt = info.configurations[0].interfaces[0].alternates[0];
    expect(alt.detail).toBe('Android fastboot');
    expect(alt.endpoints.map((e) => e.address)).toEqual(['0x01', '0x81']);
    expect(info.highlights.endpointCount).toBe(2);
    expect(info.highlights.interfaceClasses).toContain('Android fastboot');
  });

  it('uses the device-level class when it is not per-interface', () => {
    const hub = describeDevice({ vendorId: 1, productId: 2, deviceClass: 0x09, configurations: [] });
    expect(hub.className).toBe('Hub');
    expect(hub.configurationCount).toBe(0);
  });

  it('tolerates a device with no strings or configurations', () => {
    const info = describeDevice({ vendorId: 0x1234, productId: 0x5678 });
    expect(info.manufacturerName).toBe(null);
    expect(info.configurations).toEqual([]);
    expect(toTextReport(info)).toMatch(/1234:5678/);
  });

  it('renders a readable text report', () => {
    const txt = toTextReport(describeDevice(fastbootDevice));
    expect(txt).toMatch(/04e8:6860/);
    expect(txt).toMatch(/Android fastboot/);
    expect(txt).toMatch(/EP 0x81 IN Bulk/);
  });
});
