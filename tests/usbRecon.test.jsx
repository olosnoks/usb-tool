import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  endpointKey, endpointAddress, describeEndpointOption, findDfuInterface, parseHexPayload, formatUsbVersion,
  dfuDetach, sendHexToEndpoint, readFromEndpoint, releaseDevice
} from '../src/utils/usbRecon';
import UsbReconDeck from '../src/components/UsbReconDeck';

// A composite device: CDC data interface with 0x81 IN + 0x01 OUT bulk, plus a DFU runtime interface (FE/01/01).
const cdcEndpoints = [
  { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 },
  { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 512 }
];
const configuration = {
  interfaces: [
    { interfaceNumber: 0, alternates: [{ interfaceClass: 0x0a, interfaceSubclass: 0, interfaceProtocol: 0, endpoints: cdcEndpoints }] },
    { interfaceNumber: 3, alternates: [{ interfaceClass: 0xfe, interfaceSubclass: 0x01, interfaceProtocol: 0x01, endpoints: [] }] }
  ]
};
const mockDevice = (cfg = configuration) => ({
  configuration: cfg,
  controlTransferOut: vi.fn(async () => ({ status: 'ok' })),
  transferOut: vi.fn(async (ep, data) => ({ status: 'ok', bytesWritten: data.length })),
  transferIn: vi.fn(async () => ({ status: 'ok', data: new DataView(Uint8Array.of(1, 2, 3).buffer) })),
  releaseInterface: vi.fn(async () => {}),
  close: vi.fn(async () => {})
});

describe('endpoints sharing a number in different directions', () => {
  it('gives 0x81 IN and 0x01 OUT different keys, addresses and labels', () => {
    const [inEp, outEp] = cdcEndpoints;
    expect(endpointKey(inEp)).not.toBe(endpointKey(outEp));
    expect(endpointAddress(inEp)).toBe(0x81);
    expect(endpointAddress(outEp)).toBe(0x01);
    expect(describeEndpointOption(inEp)).toMatch(/0x81 IN bulk/);
    expect(describeEndpointOption(outEp)).toMatch(/0x01 OUT bulk/);
  });

  it('each action uses the picked direction and refuses the other', async () => {
    const dev = mockDevice();
    const [inEp, outEp] = cdcEndpoints;
    const claimed = new Set([0]);
    await sendHexToEndpoint(dev, outEp, 0, claimed, '41 54 0D 0A');
    expect(dev.transferOut).toHaveBeenCalledWith(1, Uint8Array.of(0x41, 0x54, 0x0d, 0x0a));
    await expect(sendHexToEndpoint(dev, inEp, 0, claimed, '41')).rejects.toThrow(/is IN/);
    expect(dev.transferOut).toHaveBeenCalledTimes(1);

    const bytes = await readFromEndpoint(dev, inEp, 0, claimed);
    expect(dev.transferIn).toHaveBeenCalledWith(1, 512); // the endpoint's packet size, not a hard-coded 64
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    await expect(readFromEndpoint(dev, outEp, 0, claimed)).rejects.toThrow(/is OUT/);
    expect(dev.transferIn).toHaveBeenCalledTimes(1);
  });

  it('refuses transfers on an interface that was not claimed', async () => {
    const dev = mockDevice();
    await expect(sendHexToEndpoint(dev, cdcEndpoints[1], 0, new Set(), '41')).rejects.toThrow(/Claim interface #0/);
    await expect(readFromEndpoint(dev, cdcEndpoints[0], 0, new Set())).rejects.toThrow(/Claim interface #0/);
    expect(dev.transferOut).not.toHaveBeenCalled();
    expect(dev.transferIn).not.toHaveBeenCalled();
  });
});

describe('payload hex validation', () => {
  it('rejects a dangling nibble instead of silently sending part of it', () => {
    expect(() => parseHexPayload('41 5')).toThrow(/"5" is not a full hex byte/);
    expect(() => parseHexPayload('41 zz')).toThrow(/"zz"/);
    expect(() => parseHexPayload('')).toThrow(/at least one/);
  });
  it('accepts spaces, commas and 0x prefixes', () => {
    expect(Array.from(parseHexPayload('41, 0x54 0D\n0a'))).toEqual([0x41, 0x54, 0x0d, 0x0a]);
  });
  it('sends nothing for bad hex', async () => {
    const dev = mockDevice();
    await expect(sendHexToEndpoint(dev, cdcEndpoints[1], 0, new Set([0]), '41 5')).rejects.toThrow(/full hex byte/);
    expect(dev.transferOut).not.toHaveBeenCalled();
  });
});

describe('DFU_DETACH', () => {
  it('goes to the DFU interface index, not whichever interface is highlighted', async () => {
    const dev = mockDevice();
    const dfu = await dfuDetach(dev);
    expect(dfu).toEqual({ interfaceNumber: 3, protocol: 1 });
    expect(dev.controlTransferOut).toHaveBeenCalledWith({ requestType: 'class', recipient: 'interface', request: 0, value: 1000, index: 3 });
  });

  it('is refused when the device has no DFU interface', async () => {
    const dev = mockDevice({ interfaces: [configuration.interfaces[0]] });
    expect(findDfuInterface(dev.configuration)).toBeNull();
    await expect(dfuDetach(dev)).rejects.toThrow(/no DFU interface/);
    expect(dev.controlTransferOut).not.toHaveBeenCalled();
  });
});

describe('teardown', () => {
  it('releases every claimed interface and closes the device, even when a release fails', async () => {
    const dev = mockDevice();
    dev.releaseInterface.mockRejectedValueOnce(new Error('gone'));
    await releaseDevice(dev, new Set([0, 3]));
    expect(dev.releaseInterface).toHaveBeenCalledTimes(2);
    expect(dev.releaseInterface).toHaveBeenCalledWith(0);
    expect(dev.releaseInterface).toHaveBeenCalledWith(3);
    expect(dev.close).toHaveBeenCalledTimes(1);
    await expect(releaseDevice(null, new Set())).resolves.toBeUndefined();
  });

  it('the deck component still renders', () => {
    const html = renderToString(<UsbReconDeck isConnected={false} />);
    expect(html).toContain('INTERROGATE ANY USB DEVICE');
  });
});

describe('USB version', () => {
  it('formats the BCD nibbles WebUSB reports', () => {
    expect(formatUsbVersion(2, 1, 0)).toBe('2.1');
    expect(formatUsbVersion(2, 0, 0)).toBe('2.0');
    expect(formatUsbVersion(3, 2, 0)).toBe('3.2');
    expect(formatUsbVersion(1, 1, 0)).toBe('1.1');
  });
});
