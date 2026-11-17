import { describe, it, expect } from 'vitest';
import { parseSvd, svdNumber, decodeRegister, extractField, insertField, findRegisterAt } from '../src/utils/svd';

const SVD = `<?xml version="1.0"?>
<device schemaVersion="1.3">
  <name>TESTMCU</name><width>32</width><size>32</size><access>read-write</access><resetValue>0x0</resetValue>
  <cpu><name>CM4</name><revision>r0p1</revision><endian>little</endian><nvicPrioBits>4</nvicPrioBits></cpu>
  <peripherals>
    <peripheral>
      <name>GPIOA</name><description>Port A &amp; friends</description><baseAddress>0x48000000</baseAddress>
      <registers>
        <register><name>MODER</name><description>mode</description><addressOffset>0x0</addressOffset><resetValue>0xA8000000</resetValue>
          <fields>
            <field><name>MODE0</name><bitOffset>0</bitOffset><bitWidth>2</bitWidth>
              <enumeratedValues><enumeratedValue><name>Input</name><value>0</value></enumeratedValue><enumeratedValue><name>Output</name><value>1</value></enumeratedValue></enumeratedValues></field>
            <field><name>MODE1</name><bitRange>[3:2]</bitRange></field>
          </fields></register>
        <register><name>IDR</name><addressOffset>0x10</addressOffset><access>read-only</access><size>16</size></register>
        <register><dim>2</dim><dimIncrement>4</dimIncrement><dimIndex>L,H</dimIndex><name>AFR%s</name><addressOffset>0x20</addressOffset></register>
        <register><name>SR</name><addressOffset>0x30</addressOffset><readAction>clear</readAction></register>
      </registers>
    </peripheral>
    <peripheral derivedFrom="GPIOA"><name>GPIOB</name><baseAddress>0x48000400</baseAddress></peripheral>
    <peripheral>
      <name>TIMER</name><baseAddress>0x40000000</baseAddress>
      <registers>
        <cluster><dim>2</dim><dimIncrement>0x10</dimIncrement><name>CH[%s]</name><addressOffset>0x100</addressOffset>
          <register><name>CTRL</name><addressOffset>0x0</addressOffset><fields><field><name>EN</name><bitOffset>0</bitOffset><bitWidth>1</bitWidth></field></fields></register>
          <register><name>CC</name><addressOffset>0x4</addressOffset></register>
        </cluster>
        <register><name>CNT</name><addressOffset>0x0</addressOffset></register>
        <register><name>CNT2</name><addressOffset>0x4</addressOffset></register>
      </registers>
    </peripheral>
    <peripheral><dim>2</dim><dimIncrement>0x1000</dimIncrement><name>UART%s</name><baseAddress>0x40010000</baseAddress>
      <registers><register><name>DR</name><addressOffset>0x4</addressOffset></register></registers></peripheral>
  </peripherals>
</device>`;

describe('SVD numbers', () => {
  it('reads decimal, hex and binary', () => {
    expect(svdNumber('0x10')).toBe(16);
    expect(svdNumber('#101')).toBe(5);
    expect(svdNumber(' 12 ')).toBe(12);
    expect(svdNumber('#1x1')).toBeUndefined();
    expect(svdNumber(undefined)).toBeUndefined();
  });
});

describe('parseSvd', () => {
  const svd = parseSvd(SVD);
  const p = (n) => svd.peripherals.find((x) => x.name === n);
  const r = (pn, rn) => p(pn).registers.find((x) => x.name === rn);

  it('reads device, cpu and peripherals with decoded entities', () => {
    expect(svd.name).toBe('TESTMCU');
    expect(svd.cpu.name).toBe('CM4');
    expect(p('GPIOA').baseAddress).toBe(0x48000000);
    expect(p('GPIOA').description).toBe('Port A & friends');
  });

  it('computes absolute addresses, defaults, access and sizes', () => {
    expect(r('GPIOA', 'MODER')).toMatchObject({ address: 0x48000000, size: 32, access: 'read-write', resetValue: 0xa8000000 });
    expect(r('GPIOA', 'IDR')).toMatchObject({ address: 0x48000010, size: 16, access: 'read-only' });
  });

  it('handles bit ranges and enumerated values', () => {
    const f = r('GPIOA', 'MODER').fields;
    expect(f[0]).toMatchObject({ name: 'MODE0', bitOffset: 0, bitWidth: 2 });
    expect(f[0].enums.map((e) => e.name)).toEqual(['Input', 'Output']);
    expect(f[1]).toMatchObject({ name: 'MODE1', bitOffset: 2, bitWidth: 2 });
  });

  it('expands dim register arrays with dimIndex lists', () => {
    expect(r('GPIOA', 'AFRL').address).toBe(0x48000020);
    expect(r('GPIOA', 'AFRH').address).toBe(0x48000024);
  });

  it('resolves derivedFrom peripherals at their own base address', () => {
    expect(p('GPIOB').registers.map((x) => x.name)).toEqual(p('GPIOA').registers.map((x) => x.name));
    expect(r('GPIOB', 'MODER').address).toBe(0x48000400);
    expect(r('GPIOB', 'MODER').fields.length).toBe(2);
  });

  it('flattens clusters and cluster dim arrays', () => {
    expect(r('TIMER', 'CH0.CTRL').address).toBe(0x40000100);
    expect(r('TIMER', 'CH1.CTRL').address).toBe(0x40000110);
    expect(r('TIMER', 'CH1.CC').address).toBe(0x40000114);
    expect(r('TIMER', 'CH0.CTRL').fields[0].name).toBe('EN');
    expect(r('TIMER', 'CNT')).toBeTruthy();
  });

  it('expands peripheral dim arrays', () => {
    expect(p('UART0').baseAddress).toBe(0x40010000);
    expect(p('UART1').baseAddress).toBe(0x40011000);
    expect(r('UART1', 'DR').address).toBe(0x40011004);
  });

  it('flags registers whose read has side effects', () => {
    expect(r('GPIOA', 'SR').sideEffects).toBe(true);
    expect(r('GPIOA', 'MODER').sideEffects).toBe(false);
  });

  it('finds the register at an address', () => {
    expect(findRegisterAt(svd, 0x48000010).register.name).toBe('IDR');
    expect(findRegisterAt(svd, 0x12345678)).toBeNull();
  });

  it('rejects a non-SVD document', () => {
    expect(() => parseSvd('<foo/>')).toThrow(/no <device>/);
  });
});

describe('field decode round trip', () => {
  const reg = parseSvd(SVD).peripherals[0].registers[0];
  it('decodes fields with enum names', () => {
    const d = decodeRegister(reg, 0b0110);
    expect(d[0]).toMatchObject({ name: 'MODE0', value: 2 });
    expect(d[1]).toMatchObject({ name: 'MODE1', value: 1 });
    expect(decodeRegister(reg, 1)[0].enumName).toBe('Output');
  });
  it('inserts a field and reads it back, leaving other bits alone', () => {
    const v = insertField(0xffff0000, reg.fields[1], 2);
    expect(v >>> 0).toBe(0xffff0008);
    expect(extractField(v, reg.fields[1])).toBe(2);
    expect(extractField(v, reg.fields[0])).toBe(0);
    expect(() => insertField(0, reg.fields[0], 4)).toThrow(/2 bit/);
  });
});
