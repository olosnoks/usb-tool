import { describe, it, expect } from 'vitest';
import { make_capture } from '../../src/utils/usbrea/synth.js';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { render } from '../../src/utils/usbrea/report.js';
import { generate as scaffold } from '../../src/utils/usbrea/scaffold.js';
import { generate as dissector } from '../../src/utils/usbrea/dissector.js';
import * as lookup from '../../src/utils/usbrea/lookup.js';

// The paths the USB Protocol RE workbench drives: demo button, markers as JSON text, labels mode, lookup.
describe('USB Protocol RE workbench flows', () => {
  it('demo: make_capture() with no options feeds the pipeline and all generators', () => {
    const { capture, markers } = make_capture();
    const proto = analyze(capture, JSON.stringify(markers, null, 1), null, null);
    expect(proto.commands.length).toBeGreaterThan(0);
    for (const text of [render(proto, 'demo.pcap', 'x'), scaffold(proto), dissector(proto, 'demo')]) {
      expect(text).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(() => JSON.stringify(proto.to_dict())).not.toThrow();
  });

  it('lookup: parse_id accepts lsusb form and a known device is documented', async () => {
    expect(lookup.parse_id('ID 1e71:170e')).toEqual([0x1e71, 0x170e]);
    const text = lookup.render(await lookup.lookup(0x1e71, 0x170e, false));
    expect(text).toMatch(/liquidctl/);
  });
});
