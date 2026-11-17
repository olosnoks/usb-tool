// Port of tests/test_dissector.py. The Python tests that run a Lua interpreter or tshark are not ported
// (no Lua in the browser); instead the generated text is checked directly.
import { describe, it, expect } from 'vitest';
import { _HELPERS, _LUA_CHECKSUMS, generate } from '../../src/utils/usbrea/dissector.js';
import { CHECKSUMS } from '../../src/utils/usbrea/checksums.js';
import { Command, Field, Protocol } from '../../src/utils/usbrea/infer.js';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { make_capture } from '../../src/utils/usbrea/synth.js';

function lamp() {
  const fields = [
    new Field({ offset: 0, kind: 'const', const: 0x5a }),
    new Field({ offset: 1, kind: 'command', const: 0x01 }),
    new Field({ offset: 2, kind: 'value', index: 0, scale: 2.55, bias: 0 }),
    new Field({ offset: 3, kind: 'lookup', index: 1, table: new Map([[50, 0x20], [10, 0x10]]) }),
    new Field({ offset: 4, kind: 'counter', step: 1 }),
    new Field({ offset: 5, kind: 'checksum', algo: 'sum8', covers: [0, 5] }),
  ];
  const c = new Command({
    name: 'brightness', endpoint: 1, xfer_type: 3, setup: null, length: 6, fields, confidence: 1,
    frames: [3, 7, 11], samples: [],
  });
  return new Protocol({ vid: 0x1234, pid: 0xabcd, commands: [c] });
}

describe('dissector', () => {
  it('every checksum has a Lua version', () => {
    expect(Object.keys(_LUA_CHECKSUMS).sort()).toEqual(Object.keys(CHECKSUMS).sort());
  });

  it('helpers are the Lua arithmetic helpers', () => {
    expect(_HELPERS).toContain('local function crc(d, w, poly, init, refin, refout, xorout)');
    expect(_HELPERS.startsWith('\n-- ---- arithmetic-only helpers')).toBe(true);
  });

  it('generates the expected Lua for a hand-built protocol', () => {
    const lua = generate(lamp(), 'mylamp');
    expect(lua).toContain('-- Wireshark dissector for USB device 1234:abcd.');
    expect(lua).toContain('wireshark -X lua_script:mylamp.lua capture.pcapng');
    expect(lua).toContain('local P = Proto("mylamp", "usb-rea: USB device 1234:abcd")');
    expect(lua).toContain('local f_brightness_command_id = pf(ProtoField.uint8("mylamp.brightness.command_id", "Command id", base.HEX))');
    expect(lua).toContain('local f_brightness_value = pf(ProtoField.double("mylamp.brightness.value", "brightness"))');
    expect(lua).toContain('local f_brightness_value1 = pf(ProtoField.uint8("mylamp.brightness.value1", "brightness (lookup)", base.HEX, { [16] = "10", [32] = "50" }))');
    expect(lua).toContain('local f_brightness_counter = pf(ProtoField.uint8("mylamp.brightness.counter", "Sequence counter"))');
    expect(lua).toContain('local f_brightness_checksum = pf(ProtoField.uint8("mylamp.brightness.checksum", "sum8", base.HEX))');
    expect(lua).toContain('    -- brightness: 100% confidence, evidence frames 3, 7, 11\n');
    expect(lua).toContain(
      '    { name = "brightness", ep = 1, control = false, setup = nil,\n'
      + '      length = 6, consts = { {0, 0x5a}, {1, 0x01} },\n'
      + '      roles = {\n'
      + '            { kind = "command", f = f_brightness_command_id, off = 1, w = 1, le = true },\n'
      + '            { kind = "value", f = f_brightness_value, off = 2, w = 1, le = true, scale = 2.55, bias = 0.0, idx = 0 },\n'
      + '            { kind = "lookup", f = f_brightness_value1, off = 3, w = 1, le = true, idx = 1, table = { [16] = 10.0, [32] = 50.0 } },\n'
      + '            { kind = "counter", f = f_brightness_counter, off = 4, w = 1, le = true },\n'
      + '            { kind = "checksum", f = f_brightness_checksum, off = 5, w = 1, le = true, a = 0, z = 5, check = function(d) return sum(d) % 256 end },\n'
      + '      } },\n');
    expect(lua).toContain('pinfo.cols.protocol:set("MYLAMP")');
    expect(lua.endsWith('register_postdissector(P)\n')).toBe(true);
  });

  it('control transfers get a setup triple', () => {
    const p = lamp();
    p.commands[0].xfer_type = 2;
    p.commands[0].setup = Uint8Array.from([0x21, 0x09, 0x00, 0x02, 0, 0, 6, 0]);
    expect(generate(p)).toContain('control = true, setup = {0x21, 0x09, 0x0200},');
  });

  it('unknown vendor id', () => {
    const p = lamp();
    p.vid = null; p.pid = null;
    expect(generate(p)).toContain('for USB device unknown id.');
  });
});

describe('dissector via the pipeline (test_cli_dissector)', () => {
  it('names fields after the -n argument', () => {
    const { capture, markers } = make_capture({});
    const src = generate(analyze(capture, markers), 'mylamp');
    expect(src).toContain('register_postdissector');
    expect(src).toContain('"mylamp.brightness.value"');
  });

  for (const [device, transport] of [['lamp', 'bulk'], ['lamp', 'control'], ['fan', 'bulk'], ['dial', 'bulk']]) {
    it(`generates balanced Lua for ${device}/${transport}`, () => {
      const { capture, markers } = make_capture({ device, transport });
      const src = generate(analyze(capture, markers));
      const count = (re) => (src.match(re) || []).length;
      // every `{` of the COMMANDS table closes (braces inside Lua strings are not used by the generator)
      expect(count(/\{/g)).toBe(count(/\}/g));
      expect(src).toContain('local COMMANDS = {');
      expect(src.endsWith('register_postdissector(P)\n')).toBe(true);
    });
  }
});
