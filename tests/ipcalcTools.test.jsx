import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  computeCidr, parseIpv4, classifyAddress, splitCidr, vlsm, aggregate, rangeToCidrs,
  overlaps, cidrRelation, reverseName, binaryView, parseCidr,
} from '../src/utils/ipcalc.js';
import IpCalculatorWorkbench from '../src/components/tools/IpCalculatorWorkbench.jsx';

describe('computeCidr validation', () => {
  it.each(['10.0.0.1/', '10.0.0.1/abc', '10.0.0.1/-1', '10.0.0.1/1e1', '10.0.0.1/ 8', '10.0.0.1/8/8', '::1/', '10.0.0.1/033'])('rejects %s', (v) => {
    expect(() => computeCidr(v)).toThrow();
  });
  it('empty prefix says Invalid prefix', () => {
    expect(() => computeCidr('10.0.0.1/')).toThrow(/Invalid prefix/);
  });
  it('rejects leading-zero octets and inner whitespace', () => {
    expect(parseIpv4('010.0.0.1')).toBeNull();
    expect(() => computeCidr('010.0.0.1')).toThrow();
    expect(() => computeCidr('10.0. 0.1/24')).toThrow();
    expect(() => computeCidr('10.0.0.1 /24')).toThrow();
    expect(parseIpv4('0.0.0.0')).toBe(0);
  });
  it('rejects out-of-range prefixes', () => {
    expect(() => computeCidr('10.0.0.1/33')).toThrow();
    expect(() => computeCidr('::1/129')).toThrow();
  });
  it('accepts a dotted netmask or wildcard as prefix', () => {
    expect(computeCidr('10.1.2.3/255.255.255.0').cidr).toBe('10.1.2.0/24');
    expect(computeCidr('10.1.2.3/0.0.0.255').cidr).toBe('10.1.2.0/24');
    expect(() => computeCidr('10.1.2.3/255.0.255.0')).toThrow(/Invalid prefix/);
  });
  it.each([['0.0.0.0/0', 2 ** 32], ['10.0.0.0/31', 2], ['10.0.0.1/32', 1]])('boundary %s', (v, total) => {
    expect(computeCidr(v).totalAddresses).toBe(total);
  });
  it('IPv6 boundaries /0 /127 /128', () => {
    expect(computeCidr('::/0').totalAddresses).toBe(2n ** 128n);
    expect(computeCidr('2001:db8::1/127').totalAddresses).toBe(2n);
    expect(computeCidr('2001:db8::1/128').network).toBe('2001:db8::1');
  });
  it('keeps isPrivate and adds a classification', () => {
    const r = computeCidr('192.168.1.10/24');
    expect(r.isPrivate).toBe(true);
    expect(r.classification.kind).toBe('private');
    expect(computeCidr('fd00::1/64').isPrivate).toBe(true);
  });
});

describe('classifyAddress', () => {
  it.each([
    ['100.64.1.1', 'cgnat'], ['10.1.1.1', 'private'], ['172.31.0.1', 'private'], ['172.32.0.1', 'public'], ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link-local'], ['192.0.2.5', 'documentation'], ['198.51.100.1', 'documentation'], ['203.0.113.9', 'documentation'],
    ['198.18.0.1', 'benchmarking'], ['224.0.0.1', 'multicast'], ['240.0.0.1', 'reserved'], ['255.255.255.255', 'broadcast'],
    ['0.0.0.0', 'unspecified'], ['8.8.8.8', 'public'],
    ['::1', 'loopback'], ['::', 'unspecified'], ['fd00::1', 'ula'], ['fe80::1', 'link-local'], ['2001:db8::1', 'documentation'],
    ['ff02::1', 'multicast'], ['::ffff:192.0.2.1', 'ipv4-mapped'], ['2606:4700::1111', 'public'],
  ])('%s -> %s', (ip, kind) => {
    expect(classifyAddress(ip).kind).toBe(kind);
  });
  it('invalid returns null', () => { expect(classifyAddress('nope')).toBeNull(); });
});

describe('subnet helpers', () => {
  it('splitCidr', () => {
    expect(splitCidr('10.0.0.0/24', 26)).toEqual(['10.0.0.0/26', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/26']);
    expect(() => splitCidr('10.0.0.0/8', 24, 100)).toThrow(/limit/);
    expect(() => splitCidr('10.0.0.0/24', 16)).toThrow();
    expect(splitCidr('10.0.0.0/24', 24)).toEqual(['10.0.0.0/24']);
    expect(splitCidr('2001:db8::/126', 128)).toHaveLength(4);
    expect(() => splitCidr('2001:db8::/32', 64)).toThrow(/limit/);
  });
  it('aggregate', () => {
    expect(aggregate(['10.0.0.0/25', '10.0.0.128/25'])).toEqual(['10.0.0.0/24']);
    expect(aggregate(['10.0.0.0/24', '10.0.0.5/32'])).toEqual(['10.0.0.0/24']);
    expect(aggregate(['10.0.0.0/24', '10.0.2.0/24'])).toEqual(['10.0.0.0/24', '10.0.2.0/24']);
    expect(aggregate(['10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/23'])).toEqual(['10.0.0.0/22']);
    expect(aggregate(['2001:db8::/33', '2001:db8:8000::/33'])).toEqual(['2001:db8::/32']);
    expect(aggregate(['10.0.1.0/24', '10.0.2.0/24'])).toEqual(['10.0.1.0/24', '10.0.2.0/24']); // not aligned siblings
  });
  it('rangeToCidrs', () => {
    expect(rangeToCidrs('10.0.0.1', '10.0.0.6')).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32']);
    expect(rangeToCidrs('10.0.0.0', '10.0.0.255')).toEqual(['10.0.0.0/24']);
    expect(rangeToCidrs('0.0.0.0', '255.255.255.255')).toEqual(['0.0.0.0/0']);
    expect(rangeToCidrs('::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toEqual(['::/0']);
    expect(rangeToCidrs('10.0.0.5', '10.0.0.5')).toEqual(['10.0.0.5/32']);
    expect(() => rangeToCidrs('10.0.0.9', '10.0.0.1')).toThrow();
    expect(() => rangeToCidrs('10.0.0.1', '::1')).toThrow();
  });
  it('vlsm [100,50,10] in /24, largest first, no overlaps', () => {
    const r = vlsm('10.0.0.0/24', [10, 100, 50]);
    expect(r.map((x) => x.cidr)).toEqual(['10.0.0.0/25', '10.0.0.128/26', '10.0.0.192/28']);
    expect(r.map((x) => x.requested)).toEqual([100, 50, 10]);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(overlaps(r[i].cidr, r[j].cidr)).toBe(false);
    r.forEach((x) => expect(cidrRelation('10.0.0.0/24', x.cidr)).toBe('a-contains-b'));
    expect(() => vlsm('10.0.0.0/24', [200, 100])).toThrow(/too small/);
  });
  it('overlaps / relation', () => {
    expect(overlaps('10.0.0.0/24', '10.0.0.128/25')).toBe(true);
    expect(overlaps('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
    expect(cidrRelation('10.0.0.0/16', '10.0.5.7')).toBe('a-contains-b');
    expect(cidrRelation('10.0.5.7', '10.0.0.0/16')).toBe('b-contains-a');
    expect(cidrRelation('10.0.0.0/24', '10.0.0.0/24')).toBe('equal');
    expect(cidrRelation('2001:db8::/32', '2001:db8:1::/48')).toBe('a-contains-b');
  });
  it('reverseName', () => {
    expect(reverseName('10.0.0.1')).toBe('1.0.0.10.in-addr.arpa');
    expect(reverseName('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
  });
  it('binaryView splits at the prefix', () => {
    expect(binaryView('192.168.1.10', 24)).toEqual({ network: '11000000.10101000.00000001', host: '.00001010'.slice(1) });
    expect(binaryView('10.0.0.1', 12).network).toBe('00001010.0000');
    expect(binaryView('::1', 0).network).toBe('');
  });
  it('parseCidr requirePrefix', () => {
    expect(() => parseCidr('10.0.0.0', { requirePrefix: true })).toThrow();
  });
});

describe('IpCalculatorWorkbench tabs', () => {
  const html = (tab) => renderToString(<IpCalculatorWorkbench initialTab={tab} />);
  it('calculate tab shows the classification label and binary view', () => {
    const h = html('calc');
    expect(h).toContain('Private (RFC 1918');
    expect(h).toContain('Binary (network bits highlighted)');
    expect(h).toContain('11000000.10101000.00000001');
  });
  it('renders every tab with its default result', () => {
    for (const label of ['Calculate', 'Split', 'VLSM', 'Aggregate', 'Contains / overlap']) expect(html('calc')).toContain(label);
    expect(html('split')).toContain('10.0.0.192/26');
    expect(html('vlsm')).toContain('10.0.0.128/26');
    expect(html('aggregate')).toContain('10.0.0.0/24');
    expect(html('contains')).toContain('A contains B');
  });
});

import { addressForms, excludeCidr, prefixTable, aclEntry } from '../src/utils/ipcalcExtra.js';

describe('ipcalcExtra', () => {
  it('addressForms v4 and v6', () => {
    const f4 = Object.fromEntries(addressForms('192.168.1.10/24'));
    expect(f4['Decimal integer']).toBe('3232235786');
    expect(f4.Hexadecimal).toBe('0xc0a8010a');
    expect(f4['IPv4-mapped IPv6']).toBe('::ffff:192.168.1.10');
    const f6 = Object.fromEntries(addressForms('2001:db8::1'));
    expect(f6.Expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(f6.Compressed).toBe('2001:db8::1');
    expect(Object.fromEntries(addressForms('::ffff:1.2.3.4'))['Embedded IPv4']).toBe('1.2.3.4');
  });
  it('excludeCidr', () => {
    expect(excludeCidr('10.0.0.0/24', '10.0.0.64/26')).toEqual(['10.0.0.0/26', '10.0.0.128/25']);
    expect(excludeCidr('10.0.0.0/24', '192.168.0.0/16')).toEqual(['10.0.0.0/24']);
    expect(excludeCidr('10.0.0.0/24', '10.0.0.0/16')).toEqual([]);
    expect(excludeCidr('2001:db8::/32', '2001:db8::/33')).toEqual(['2001:db8:8000::/33']);
    expect(() => excludeCidr('10.0.0.0/8', '::/8')).toThrow();
  });
  it('prefixTable and aclEntry', () => {
    const t = prefixTable(4);
    expect(t).toHaveLength(33);
    expect(t[24]).toMatchObject({ netmask: '255.255.255.0', wildcard: '0.0.0.255', usable: 254n });
    expect(prefixTable(6).at(-1).addresses).toBe(1n);
    expect(aclEntry('10.1.2.3/24')).toBe('10.1.2.0 0.0.0.255');
    expect(() => aclEntry('::1/64')).toThrow();
  });
  it('workbench renders new tabs', () => {
    const html = renderToString(<IpCalculatorWorkbench />);
    expect(html).toContain('Exclude');
    expect(html).toContain('Prefix table');
  });
});
