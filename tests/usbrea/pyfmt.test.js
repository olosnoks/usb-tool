import { describe, it, expect } from 'vitest';
import {
  fmt_g, fmt_fixed, fmt_pct, fmt_hex, py_float_str, py_round, py_str_repr, py_repr, pyfloat, pytuple, py_format,
} from '../../src/utils/usbrea/pyfmt.js';

describe('fmt_g (Python {x:g})', () => {
  it('matches CPython', () => {
    expect(fmt_g(0)).toBe('0');
    expect(fmt_g(-0)).toBe('-0');
    expect(fmt_g(1)).toBe('1');
    expect(fmt_g(0.5)).toBe('0.5');
    expect(fmt_g(25.098039)).toBe('25.098');
    expect(fmt_g(2.55)).toBe('2.55');
    expect(fmt_g(1180)).toBe('1180');
    expect(fmt_g(100000)).toBe('100000');
    expect(fmt_g(1000000)).toBe('1e+06');
    expect(fmt_g(1234567)).toBe('1.23457e+06');
    expect(fmt_g(0.0001)).toBe('0.0001');
    expect(fmt_g(0.00001)).toBe('1e-05');
    expect(fmt_g(0.1 + 0.2)).toBe('0.3');
    expect(fmt_g(-5)).toBe('-5');
    expect(fmt_g(999999.5)).toBe('1e+06');
    expect(fmt_g(1e100)).toBe('1e+100');
  });
  it('rounds exact ties to even', () => {
    expect(fmt_g(123456.5)).toBe('123456');
    expect(fmt_g(123457.5)).toBe('123458');
    expect(fmt_g(2.5, 1)).toBe('2');
    expect(fmt_g(3.5, 1)).toBe('4');
  });
  it('handles nan and inf', () => {
    expect(fmt_g(NaN)).toBe('nan');
    expect(fmt_g(Infinity)).toBe('inf');
    expect(fmt_g(-Infinity)).toBe('-inf');
  });
});

describe('fmt_fixed / fmt_pct', () => {
  it('formats percentages like :.0%', () => {
    expect(fmt_pct(1)).toBe('100%');
    expect(fmt_pct(0.5)).toBe('50%');
    expect(fmt_pct(0.125)).toBe('12%'); // 12.5 -> even
    expect(fmt_pct(0.375)).toBe('38%'); // 37.5 -> even
    expect(fmt_pct(0.9)).toBe('90%');
    expect(fmt_pct(0.666)).toBe('67%');
    expect(fmt_pct(0)).toBe('0%');
  });
  it('fixed', () => {
    expect(fmt_fixed(2.675, 2)).toBe('2.67'); // binary value is below the tie
    expect(fmt_fixed(0.5, 0)).toBe('0');
    expect(fmt_fixed(1.5, 0)).toBe('2');
    expect(fmt_fixed(2.5, 0)).toBe('2');
    expect(fmt_fixed(99.5, 0)).toBe('100');
    expect(fmt_fixed(-0.4, 0)).toBe('-0');
    expect(fmt_fixed(3.14159, 3)).toBe('3.142');
    expect(fmt_fixed(7, 2)).toBe('7.00');
  });
});

describe('fmt_hex', () => {
  it('pads like {x:02x}', () => {
    expect(fmt_hex(10, 2)).toBe('0a');
    expect(fmt_hex(0x1b1c, 4)).toBe('1b1c');
    expect(fmt_hex(0x1234, 2)).toBe('1234');
    expect(fmt_hex(255)).toBe('ff');
  });
});

describe('py_float_str (repr of float)', () => {
  it('prints floats Python style', () => {
    expect(py_float_str(1)).toBe('1.0');
    expect(py_float_str(0)).toBe('0.0');
    expect(py_float_str(-0)).toBe('-0.0');
    expect(py_float_str(2.55)).toBe('2.55');
    expect(py_float_str(-3)).toBe('-3.0');
    expect(py_float_str(0.1)).toBe('0.1');
    expect(py_float_str(1e15)).toBe('1000000000000000.0');
    expect(py_float_str(1e16)).toBe('1e+16');
    expect(py_float_str(1.5e16)).toBe('1.5e+16');
    expect(py_float_str(0.0001)).toBe('0.0001');
    expect(py_float_str(0.00001)).toBe('1e-05');
    expect(py_float_str(1.5e-7)).toBe('1.5e-07');
    expect(py_float_str(123456789.125)).toBe('123456789.125');
    expect(py_float_str(0.255)).toBe('0.255');
  });
});

describe('py_round', () => {
  it('rounds half to even', () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, 2.4, 2.6].map(py_round)).toEqual([0, 2, 2, 4, 0, -2, 2, 3]);
  });
});

describe('py_str_repr / py_repr', () => {
  it('quotes like Python', () => {
    expect(py_str_repr('abc')).toBe("'abc'");
    expect(py_str_repr("it's")).toBe('"it\'s"');
    expect(py_str_repr('a\'"b')).toBe("'a\\'\"b'");
    expect(py_str_repr('x\ny\t\\')).toBe("'x\\ny\\t\\\\'");
    expect(py_str_repr('\x00\x7f')).toBe("'\\x00\\x7f'");
    expect(py_str_repr('°C')).toBe("'°C'");
    expect(py_str_repr('a b')).toBe("'a\\xa0b'");
  });
  it('reprs containers', () => {
    expect(py_repr(null)).toBe('None');
    expect(py_repr([1, true, false, 'a'])).toBe("[1, True, False, 'a']");
    expect(py_repr(pyfloat(1))).toBe('1.0');
    expect(py_repr(2.5)).toBe('2.5');
    expect(py_repr(pytuple([1, 2]))).toBe('(1, 2)');
    expect(py_repr(pytuple([1]))).toBe('(1,)');
    expect(py_repr({ a: 1, b: [pyfloat(2), null] })).toBe("{'a': 1, 'b': [2.0, None]}");
    expect(py_repr(new Map([[pyfloat(25), 64], [pyfloat(50), 128]]))).toBe('{25.0: 64, 50.0: 128}');
    expect(py_repr(new Map([[0, 'off'], [1, 'on']]))).toBe("{0: 'off', 1: 'on'}");
  });
});

describe('py_format', () => {
  it('substitutes names and unescapes braces in one pass', () => {
    expect(py_format('a {x} {{y}} {z}', { x: '{q}', z: 3 })).toBe('a {q} {y} 3');
  });
});
