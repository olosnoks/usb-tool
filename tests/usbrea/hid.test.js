// Port of the descriptor tests of usb-rea tests/test_hid.py (checked against HID 1.11 spec descriptors).
import { describe, it, expect } from 'vitest';
import * as hid from '../../src/utils/usbrea/hid.js';
import { fromHex } from '../../src/utils/usbrea/bytes.js';

// HID 1.11 Appendix E.10, boot mouse
const MOUSE = '05 01 09 02 A1 01 09 01 A1 00 05 09 19 01 29 03 15 00 25 01 95 03 75 01 81 02 95 01 75 05 81 01'
  + ' 05 01 09 30 09 31 15 81 25 7F 75 08 95 02 81 06 C0 C0';
// HID 1.11 Appendix E.6, boot keyboard
const KEYBOARD = '05 01 09 06 A1 01 05 07 19 E0 29 E7 15 00 25 01 75 01 95 08 81 02 95 01 75 08 81 01'
  + ' 95 05 75 01 05 08 19 01 29 05 91 02 95 01 75 03 91 01'
  + ' 95 06 75 08 15 00 25 65 05 07 19 00 29 65 81 00 C0';
// Constructed in the style of Logitech HID++ (documented: short report 0x10 = 7 bytes, long 0x11 = 20 bytes)
const HIDPP = '06 00 FF 09 01 A1 01 85 10 75 08 95 06 15 00 26 FF 00 09 01 81 00 09 01 91 00 C0'
  + ' 06 00 FF 09 02 A1 01 85 11 75 08 95 13 15 00 26 FF 00 09 02 81 00 09 02 91 00 C0';

describe('hid descriptor decoder', () => {
  it('boot mouse layout and decode', () => {
    const d = hid.parse(MOUSE);
    expect(d.top_usages).toEqual(['Generic Desktop: Mouse']);
    expect(d.reports).toHaveLength(1);
    const [inp] = d.reports;
    expect([inp.report_type, inp.report_id, inp.length]).toEqual(['Input', 0, 3]);
    const [buttons, pad, xy] = inp.fields;
    expect([buttons.bit_offset, buttons.size, buttons.count, buttons.usages]).toEqual([0, 1, 3, [1, 2, 3]]);
    expect(pad.constant).toBe(true);
    expect(pad.bit_offset).toBe(3);
    expect([xy.bit_offset, xy.logical_min, xy.logical_max, xy.relative]).toEqual([8, -127, 127, true]);
    expect(hid.decode(d, 'Input', Uint8Array.of(0x05, 0xfe, 0x03))).toEqual([
      ['Button: Button 1', 1], ['Button: Button 2', 0], ['Button: Button 3', 1],
      ['Generic Desktop: X', -2], ['Generic Desktop: Y', 3]]);
  });

  it('boot keyboard has an 8-byte input and a LED output', () => {
    const d = hid.parse(KEYBOARD);
    expect(d.report('Input').length).toBe(8);
    const out = d.report('Output');
    expect(out.length).toBe(1);
    const leds = out.fields[0];
    expect(hid.usage_name(leds.usage_page, leds.usages[1])).toBe('Caps Lock');
    const keys = hid.decode(d, 'Input', Uint8Array.of(0x02, 0, 0x04, 0, 0, 0, 0, 0));
    expect(keys).toContainEqual(['Keyboard/Keypad: 0xE1', 1]); // left shift modifier
    expect(keys).toContainEqual(['Keyboard/Keypad usage', 0x04]); // 'a' in the key array
    expect(hid.decode(d, 'Output', Uint8Array.of(0x02))[1]).toEqual(['LED: Caps Lock', 1]);
  });

  it('report ids and vendor pages', () => {
    const d = hid.parse(HIDPP);
    expect(d.uses_report_ids).toBe(true);
    expect(d.report('Output', 0x10).length).toBe(7);
    expect(d.report('Output', 0x11).length).toBe(20);
    expect(d.report('Output', 0x11).vendor).toBe(true);
    const rep = hid.match(d, null, 0x02, fromHex('10ff0d1d000000'));
    expect(rep).toBe(d.report('Output', 0x10));
    const setup = Uint8Array.of(0x21, 0x09, 0x11, 0x02, 2, 0, 20, 0); // SET_REPORT(Output, id 0x11)
    expect(hid.match(d, setup, 0, new Uint8Array(0))).toBe(d.report('Output', 0x11));
    expect(d.report('Output', 0x11).title()).toBe('Output report (id 0x11, 20 bytes, Vendor 0xFF00)');
  });

  it('push/pop, long usage and errors', () => {
    // Push, change page via 4-byte usage, Pop restores report size
    const d = hid.parse('05 01 09 05 A1 01 75 08 95 01 A4 75 10 0B 30 00 01 00 81 02 B4 0B 31 00 01 00 81 02 C0');
    const [f1, f2] = d.report('Input').fields;
    expect([f1.size, f1.usage_page, f1.usages]).toEqual([16, 0x01, [0x30]]);
    expect([f2.size, f2.bit_offset]).toEqual([8, 16]);
    expect(() => hid.parse('05')).toThrow(/truncated/); // truncated item
    expect(hid.items(fromHex('fe 02 10 aa bb'))[0].kind).toBe('long');
  });

  it('decode throws KeyError for an unknown report; dump and describe work', () => {
    const d = hid.parse(MOUSE);
    expect(() => hid.decode(d, 'Output', Uint8Array.of(0))).toThrow(/no Output report/);
    expect(hid.dump(d)).toContain('Input (Data,Var,Abs)');
    expect(d.to_dict().reports[0].fields[0]).toBe('bits 0..2: Button: Button 1 .. Button 3 (3x1 bit, logical 0..1, Data,Var,Abs)');
  });

  it('from_transfers finds a descriptor by its GET_DESCRIPTOR(0x22) request', async () => {
    const { Transfer, tupleKey } = await import('../../src/utils/usbrea/model.js');
    const raw = hid.parse(MOUSE).raw;
    const req = new Transfer({ frame: 1, ts: 0, bus: 1, device: 3, endpoint: 0x80, xfer_type: 2, setup: Uint8Array.of(0x81, 6, 0, 0x22, 2, 0, 52, 0) });
    const rsp = new Transfer({ frame: 2, ts: 0.001, bus: 1, device: 3, endpoint: 0x80, xfer_type: 2, setup: null, data: raw });
    const found = hid.from_transfers([req, rsp]);
    expect([...found.keys()]).toEqual([tupleKey([3, 2])]);
    expect(found.get(tupleKey([3, 2]))).toEqual(raw);
  });
});
