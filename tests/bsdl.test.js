import { describe, it, expect } from 'vitest';
import { parseBsdl, opcodeValue, idcodeMatches, pinStates, extestVector, portPins } from '../src/utils/bsdl';
import { JtagClient } from '../src/utils/jtagDriver';

const BSDL = `
-- A small made-up part for tests
entity DEMO_CPLD is
  generic (PHYSICAL_PIN_MAP : string := "TQFP44");
  port (LED : out bit; BTN : in bit; D : inout bit_vector(0 to 1); TCK, TMS, TDI : in bit; TDO : out bit);
  use STD_1149_1_2001.all;
  attribute PIN_MAP of DEMO_CPLD : entity is PHYSICAL_PIN_MAP;
  constant TQFP44 : PIN_MAP_STRING :=
    "LED : 12, BTN : 13, D : (20, 21), " &
    "TCK : 30, TMS : 31, TDI : 32, TDO : 33";
  attribute INSTRUCTION_LENGTH of DEMO_CPLD : entity is 6;
  attribute INSTRUCTION_OPCODE of DEMO_CPLD : entity is
    "BYPASS (111111), " &
    "EXTEST (000000), " &
    "SAMPLE (000001, 100001), " &
    "IDCODE (001001)";
  attribute IDCODE_REGISTER of DEMO_CPLD : entity is
    "XXXX" & "0110001000101000" & "00001001001" & "1";
  attribute BOUNDARY_LENGTH of DEMO_CPLD : entity is 8;
  attribute BOUNDARY_REGISTER of DEMO_CPLD : entity is
    "0 (BC_1, BTN, input, X), " &
    "1 (BC_1, *, control, 0), " &
    "2 (BC_1, LED, output3, X, 1, 0, Z), " &
    "3 (BC_1, *, control, 0), " &
    "4 (BC_1, D(0), output3, X, 3, 0, Z), " &
    "5 (BC_1, D(0), input, X), " &
    "6 (BC_1, D(1), input, X), " &
    "7 (BC_1, *, internal, 1)";
end DEMO_CPLD;
`;

describe('BSDL', () => {
  const b = parseBsdl(BSDL);

  it('reads lengths, opcodes, IDCODE, cells and pins', () => {
    expect(b).toMatchObject({ entity: 'DEMO_CPLD', irLength: 6, bsrLength: 8 });
    expect(b.opcodes.SAMPLE).toEqual(['000001', '100001']);
    expect(opcodeValue(b, 'sample')).toBe(1);
    expect(opcodeValue(b, 'IDCODE')).toBe(9);
    expect(b.cells).toHaveLength(8);
    expect(b.cells[4]).toMatchObject({ port: 'D(0)', function: 'output3', control: 3, disableValue: 0 });
    expect(portPins(b, 'D(1)')).toEqual(['21']);
    expect(portPins(b, 'LED')).toEqual(['12']);
  });

  it('checks an IDCODE with don’t-care bits', () => {
    expect(idcodeMatches(b, 0x36228093)).toBe(true);
    expect(idcodeMatches(b, 0xf6228093)).toBe(true);
    expect(idcodeMatches(b, 0x36228091)).toBe(false);
  });

  it('turns sampled bits into pin levels', () => {
    const pins = pinStates(b, [1, 1, 0, 0, 0, 1, 0, 1]);
    const by = Object.fromEntries(pins.map((p) => [p.port, p]));
    expect(by.BTN).toMatchObject({ input: 1, pins: ['13'] });
    expect(by.LED).toMatchObject({ output: 0, driving: true });
    expect(by['D(0)']).toMatchObject({ input: 1, driving: false });
  });

  it('builds EXTEST vectors with safe values and enabled controls', () => {
    expect(extestVector(b, {})).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(extestVector(b, { LED: 1, 'D(0)': 0 })).toEqual([0, 1, 1, 1, 0, 0, 0, 1]);
    expect(() => extestVector(b, { BTN: 1 })).toThrow(/no output cell/);
  });

  it('rejects files that are not BSDL', () => {
    expect(() => parseBsdl('entity X is end X;')).toThrow(/Not a BSDL/);
  });
});

describe('EXTEST shifting', () => {
  it('preloads, switches to EXTEST and shifts the vector with bypass bits for other devices', async () => {
    const calls = [];
    const c = new JtagClient(() => {});
    c.isConnected = true;
    c.engine = {
      state: 'IDLE',
      shift(reg, bits, opts) { calls.push([reg, bits.join(''), !!opts.capture]); return Promise.resolve(bits.map((x) => x)); },
      async flush() {},
      goto() {}
    };
    const back = await c.extest({ target: 1, irLengths: [4, 6], preloadOp: 0x01, extestOp: 0x00, vector: [0, 1, 1, 1] });
    expect(calls.map((x) => x[0])).toEqual(['IR', 'DR', 'IR', 'DR']);
    expect(calls[0][1]).toBe('1111' + '100000');
    expect(calls[2][1]).toBe('1111' + '000000');
    expect(calls[1][1]).toBe('0' + '0111');
    expect(calls[3][2]).toBe(true);
    expect(back).toEqual([0, 1, 1, 1]);
  });
});
