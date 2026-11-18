import { describe, it, expect } from 'vitest';
import { Transfer } from '../../src/utils/usbrea/model.js';
import { endpoint_stats, wireshark_filter, transfers_to_csv, diff_bytes, render_diff } from '../../src/utils/usbrea/packetTools.js';

const T = (frame, ts, ep, type, data, setup = null) => new Transfer({ frame, ts, bus: 1, device: 5, endpoint: ep, xfer_type: type, data: Uint8Array.from(data), setup });

describe('packet tools', () => {
  const ts = [T(1, 10, 0x02, 3, [1, 2, 3]), T(2, 10.5, 0x02, 3, [1]), T(3, 11, 0x81, 1, [9, 9]), T(4, 12, 0x00, 2, [], Uint8Array.of(0, 9, 1, 0, 0, 0, 0, 0))];
  it('computes per-endpoint stats', () => {
    const s = endpoint_stats(ts);
    expect(s[0]).toMatchObject({ endpoint: 2, dir: 'OUT', kind: 'bulk', packets: 2, bytes: 4, min: 1, max: 3 });
    expect(s.length).toBe(3);
  });
  it('builds Wireshark filters', () => {
    expect(wireshark_filter({ device: '5', endpoint: '1', direction: 'in', type: '1', hex: 'aa 01' }))
      .toBe('usb.device_address == 5 && usb.endpoint_address == 0x81 && usb.transfer_type == 0x01 && frame contains aa:01');
    expect(wireshark_filter({ device: '', endpoint: '', direction: 'out', type: '', hex: '' })).toBe('usb.endpoint_address.direction == 0');
    expect(wireshark_filter({ device: '', endpoint: '3', direction: '', type: '', hex: 'a' })).toBe('usb.endpoint_address.number == 3');
  });
  it('exports CSV', () => {
    const csv = transfers_to_csv(ts, 10).split('\n');
    expect(csv[1]).toBe('1,0.000000,1,5,2,OUT,bulk,3,,010203');
    expect(csv[4]).toContain('0009010000000000');
  });
  it('diffs bytes', () => {
    const d = diff_bytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 9, 3, 4));
    expect(d.changed).toBe(2);
    expect(d.cells[3].a).toBeNull();
    expect(render_diff(d)).toContain('^^');
    expect(render_diff(diff_bytes(new Uint8Array(), new Uint8Array()))).toBe('(both empty)');
  });
});
