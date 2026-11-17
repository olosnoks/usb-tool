// Port of the capture-level tests of usb-rea tests/test_hid.py (go through pipeline.analyze and synth.make_capture).
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { make_capture, LAMP_HID_DESCRIPTOR } from '../../src/utils/usbrea/synth.js';
import { fromHex } from '../../src/utils/usbrea/bytes.js';
import { eq } from '../../src/utils/usbrea/bytes.js';

describe('hid in captures', () => {
  it('a capture with a HID descriptor is annotated', () => {
    const { capture, markers } = make_capture({ transport: 'control' });
    const proto = analyze(capture, markers);
    expect(proto.hid).toHaveLength(1);
    const [h] = proto.hid;
    expect(eq(fromHex(h.descriptor), LAMP_HID_DESCRIPTOR)).toBe(true);
    expect(new Set(Object.keys(h.commands))).toEqual(new Set(proto.commands.map((c) => c.name)));
    for (const v of Object.values(h.commands)) expect(v).toBe('Output report (no id, 5 bytes, Vendor 0xFF00)');
  });

  it('a bulk capture has no hid section', () => {
    const { capture, markers } = make_capture({});
    expect(analyze(capture, markers).hid).toEqual([]);
  });
});
