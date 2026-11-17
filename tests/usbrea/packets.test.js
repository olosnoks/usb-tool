import { describe, it, expect } from 'vitest';
import { UsbmonWriter, make_capture, encode } from '../../src/utils/usbrea/synth.js';
import { read_transfers, find_ids } from '../../src/utils/usbrea/pcap.js';
import { decode_setup, find_descriptors } from '../../src/utils/usbrea/setupDecode.js';
import { filter_transfers } from '../../src/components/tools/usbrea/PacketBrowser.jsx';

describe('setup decoding', () => {
  it('decodes standard, HID and CDC requests', () => {
    expect(decode_setup(Uint8Array.of(0x80, 6, 0, 2, 0, 0, 0xff, 0))).toBe('GET_DESCRIPTOR(CONFIGURATION idx 0, len 255)');
    expect(decode_setup(Uint8Array.of(0, 9, 1, 0, 0, 0, 0, 0))).toBe('SET_CONFIGURATION(config 1)');
    expect(decode_setup(Uint8Array.of(0x01, 11, 2, 0, 3, 0, 0, 0))).toBe('SET_INTERFACE(interface 3, alt 2)');
    expect(decode_setup(Uint8Array.of(0x21, 9, 0x01, 0x03, 0, 0, 8, 0))).toBe('SET_REPORT(Feature id 1, iface 0, len 8)');
    const lc = Uint8Array.of(0x00, 0xc2, 0x01, 0x00, 0, 0, 8); // 115200 8N1
    expect(decode_setup(Uint8Array.of(0x21, 0x20, 0, 0, 0, 0, 7, 0), lc)).toBe('SET_LINE_CODING(115200 baud, 8 data bits, stop 1, parity none)');
  });
});

describe('packet browser data', () => {
  it('finds the device descriptor in a capture and matches find_ids', () => {
    const ts = read_transfers(make_capture({}).capture);
    const d = find_descriptors(ts).find((x) => x.kind === 'DEVICE');
    const [vid, pid] = find_ids(ts)[5];
    expect(d).toBeTruthy();
    expect(d.summary.startsWith(`${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`)).toBe(true);
  });

  it('filters 100k rows quickly', () => {
    const w = new UsbmonWriter(1, 5);
    for (let i = 0; i < 100000; i++) w.out(1.7e9 + i * 0.001, 1 + (i % 3), encode('brightness', i % 100));
    const ts = read_transfers(w.to_bytes());
    expect(ts.length).toBe(100000);
    const t0 = Date.now();
    const ep2 = filter_transfers(ts, { device: '5', endpoint: '2', direction: 'out', type: '3', hex: '' });
    const hx = filter_transfers(ts, { device: '', endpoint: '', direction: '', type: '', hex: 'aa 01' });
    expect(ep2.length).toBeGreaterThan(30000);
    expect(hx.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
