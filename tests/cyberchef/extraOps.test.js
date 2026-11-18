import { describe, it, expect } from 'vitest';
import { Chef } from '../../src/utils/cyberchef/core/index.js';
import '../../src/utils/cyberchef/operations/index.js';
import { rotateBytes, bitwiseNot, shannonEntropy, textStats, escapeString, unescapeString } from '../../src/utils/cyberchef/operations/extraOps.js';

const bake = async (input, op, args = {}) => (await Chef.bake(input, [{ op, args }])).toString();
const bakeHex = async (input, op, args = {}) => (await Chef.bake(input, [{ op, args }, { op: 'to_hex', args: { delimiter: 'None' } }])).toString();

describe('extra operations', () => {
  it('bitwise NOT and rotate', async () => {
    expect([...bitwiseNot(new Uint8Array([0x00, 0xf0]))]).toEqual([0xff, 0x0f]);
    expect([...rotateBytes(new Uint8Array([0x81]), 1, 'Left')]).toEqual([0x03]);
    expect([...rotateBytes(new Uint8Array([0x81]), 1, 'Right')]).toEqual([0xc0]);
    expect(() => rotateBytes(new Uint8Array([1]), 9)).toThrow();
    expect(await bakeHex('A', 'rotate_bits', { direction: 'Left', amount: 4 })).toBe('14');
    expect(await bakeHex('\x00', 'bitwise_not')).toBe('ff');
  });

  it('entropy and stats', async () => {
    expect(shannonEntropy(new Uint8Array([]))).toBe(0);
    expect(shannonEntropy(new Uint8Array([1, 1, 1]))).toBe(0);
    expect(shannonEntropy(new Uint8Array([0, 1, 0, 1]))).toBeCloseTo(1);
    expect(textStats(new TextEncoder().encode('a b\nc'))).toMatchObject({ bytes: 5, words: 3, lines: 2 });
    expect(await bake('aabb', 'shannon_entropy')).toContain('1.0000 bits/byte');
    expect(await bake('one two', 'text_stats')).toContain('Words: 2');
  });

  it('escape / unescape round trip', async () => {
    expect(escapeString('a\n"b"é€')).toBe('a\\n\\"b\\"\\xe9\\u20ac');
    expect(unescapeString('a\\n\\x41\\u20ac\\u{1f600}\\q')).toBe('a\nA€\u{1f600}\\q');
    const t = 'tab\there \\ ÿ';
    expect(unescapeString(escapeString(t))).toBe(t);
    expect(await bake('x\ty', 'escape_string')).toBe('x\\ty');
  });
});
