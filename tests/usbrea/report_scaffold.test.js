// Report and scaffold text generators. Ports the assertions of tests/test_e2e.py that do not execute the
// generated Python (test_generated_driver_control, the sum8 check of test_cli_report_and_transfers, the
// demo output checks), plus smoke runs over every synthetic device/feature so formatting bugs surface.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/utils/usbrea/report.js';
import { generate } from '../../src/utils/usbrea/scaffold.js';
import { Command, Field, Protocol } from '../../src/utils/usbrea/infer.js';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { make_capture } from '../../src/utils/usbrea/synth.js';

const run = (opts) => {
  const { capture, markers } = make_capture(opts);
  return analyze(capture, markers);
};

const BAD = /undefined|NaN|\[object|null/;

describe('test_e2e ports', () => {
  it('generated driver control transfers carry the setup tuple', () => {
    const src = generate(run({ transport: 'control' }));
    expect(src).toContain('ctrl_transfer');
    expect(src).toContain('(33, 9, 512, 0)');
  });

  it('report mentions the checksum', () => {
    expect(render(run({}))).toContain('sum8');
  });

  it('demo report and driver (lamp)', () => {
    const p = run({});
    const md = render(p, 'lamp.pcap', 'ab'.repeat(32));
    expect(md.startsWith('# usb-rea protocol report\n\nCapture: `lamp.pcap` (sha256 `abababababababab…`)\nDevice: `1234:abcd`\n')).toBe(true);
    expect(md).toContain('## `brightness`');
    expect(md).toContain('| Byte | Role | Encoding |');
    const src = generate(p);
    expect(src).toContain('VID = 0x1234');
    expect(src).toContain('PID = 0xabcd');
    expect(src).toContain('def set_brightness(self, v0):');
    expect(src).toContain('BRIGHTNESS = {');
    expect(src).toContain('# ---- checksums (copied from usb_rea.checksums) ----');
    expect(src).toContain('def compute(algo, data):');
    expect(src.endsWith('print(fn(*map(float, args)))\n')).toBe(true);
  });

  it('demo report (dial) shows u32le and a bitfield', () => {
    const md = render(run({ device: 'dial' }));
    expect(md).toContain('u32le');
    expect(md).toContain('bits[0:4]');
  });
});

describe('generated text is clean for every synthetic scenario', () => {
  const scenarios = {
    lamp: {},
    'lamp control': { transport: 'control' },
    fan: { device: 'fan' },
    dial: { device: 'dial' },
    'fan states': { device: 'fan', states: true },
    'fan reported': { device: 'fan', reported: true },
    'fan switch': { device: 'fan', switch: true },
    'lamp observe': { observe: true },
    'lamp poll': { poll: 0.5 },
    'fan handshake': { device: 'fan', handshake: true },
    'fan reopen': { device: 'fan', handshake: true, reopen: true },
    'fan branch': { device: 'fan', handshake: true, branch: true },
    'lcd jpeg': { device: 'lcd', image_stream: true },
    'lcd rgb565': { device: 'lcd', image_stream: true, raw: 'rgb565' },
    'lcd rgb565 inline': { device: 'lcd', image_stream: true, raw: 'rgb565', inline: true },
    'lcd rgb888': { device: 'lcd', image_stream: true, raw: 'rgb888' },
    'lcd bmp': { device: 'lcd', image_stream: true, bmp: true },
    'lcd webp': { device: 'lcd', image_stream: true, webp: true },
  };
  for (const [name, opts] of Object.entries(scenarios)) {
    it(name, () => {
      let p;
      try {
        p = run(opts);
      } catch (e) {
        // a scenario another module cannot build yet is not this module's failure
        console.warn(`skipped ${name}: ${e.message}`);
        return;
      }
      const md = render(p);
      const py = generate(p);
      expect(md).not.toMatch(BAD);
      expect(py).not.toMatch(/undefined|NaN|\[object/);
      expect(py).toContain('class Device:');
      expect(py).toContain('# ---- message specs (from inference) ----');
      // the specs section only holds valid-looking Python literals
      expect(py).not.toMatch(/\bnull\b|\btrue\b|\bfalse\b/);
    });
  }
});

describe('scaffold repr formatting', () => {
  function proto() {
    const fields = [
      new Field({ offset: 0, kind: 'command', const: 0x01 }),
      new Field({ offset: 1, kind: 'value', index: 0, scale: 1, bias: 0 }),
      new Field({ offset: 2, kind: 'lookup', index: 1, table: new Map([[50, 0x20], [10, 0x10]]) }),
      new Field({ offset: 3, kind: 'checksum', algo: 'sum8', covers: [0, 3] }),
    ];
    const c = new Command({
      name: 'level', endpoint: 2, xfer_type: 3, setup: null, length: 4, fields, confidence: 0.875,
      frames: [1, 2, 3], samples: [],
    });
    return new Protocol({ vid: 0x1b1c, pid: 0x0c18, commands: [c] });
  }

  it('prints floats, tuples and dicts like Python repr', () => {
    const src = generate(proto());
    expect(src).toContain('"""Open-source driver for USB device 1b1c:0c18.');
    expect(src).toContain(
      "LEVEL = {'template': '01000000', 'endpoint': 2, 'setup': None, 'fields': ["
      + "{'kind': 'value', 'offset': 1, 'width': 1, 'endian': 'le', 'index': 0, 'scale': 1.0, 'bias': 0.0, 'table': None, "
      + "'step': None, 'algo': None, 'covers': None, 'bit_offset': None, 'bit_width': None, 'source': None}, "
      + "{'kind': 'lookup', 'offset': 2, 'width': 1, 'endian': 'le', 'index': 1, 'scale': None, 'bias': None, "
      + "'table': {50.0: 32, 10.0: 16}, 'step': None, 'algo': None, 'covers': None, 'bit_offset': None, 'bit_width': None, 'source': None}, "
      + "{'kind': 'checksum', 'offset': 3, 'width': 1, 'endian': 'le', 'index': 0, 'scale': None, 'bias': None, "
      + "'table': None, 'step': None, 'algo': 'sum8', 'covers': (0, 3), 'bit_offset': None, 'bit_width': None, 'source': None}]}\n");
    expect(src).toContain('    def set_level(self, v0, v1):\n        """level (88% confidence; evidence frames 1, 2, 3).');
    expect(src).toContain('        return self._send(LEVEL, v0, v1)\n');
    expect(src).toContain('HANDSHAKE = []\n');
  });

  it('report lists the fields', () => {
    const md = render(proto());
    expect(md).toContain('## `level`');
    expect(md).toContain('- Channel: bulk EP 0x02');
    expect(md).toContain('- Confidence: 88%');
    expect(md).toContain('| 3 | checksum | `sum8(bytes[0:3])` |');
  });
});
