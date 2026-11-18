import { describe, it, expect } from 'vitest';
import { buildRequestOptions, filterGattTree, countCharacteristics } from '../src/utils/bleView.js';

const tree = [
  {
    uuid: '0000180f-0000-1000-8000-00805f9b34fb', name: 'Battery Service', short: 0x180f,
    characteristics: [
      { uuid: '00002a19-0000-1000-8000-00805f9b34fb', name: 'Battery Level', short: 0x2a19, properties: { read: true, notify: true } }
    ]
  },
  {
    uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'Nordic UART', short: null,
    characteristics: [
      { uuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', name: 'RX', short: null, properties: { write: true } },
      { uuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', name: 'TX', short: null, properties: { notify: true } }
    ]
  }
];

describe('buildRequestOptions', () => {
  it('accepts all devices without a prefix', () => {
    expect(buildRequestOptions({ optionalServices: ['a'] })).toEqual({ acceptAllDevices: true, optionalServices: ['a'] });
    expect(buildRequestOptions({ namePrefix: '  ' }).acceptAllDevices).toBe(true);
  });
  it('uses a namePrefix filter', () => {
    const o = buildRequestOptions({ namePrefix: ' Flip ', optionalServices: ['a'] });
    expect(o.filters).toEqual([{ namePrefix: 'Flip' }]);
    expect(o.acceptAllDevices).toBeUndefined();
    expect(o.optionalServices).toEqual(['a']);
  });
});

describe('filterGattTree', () => {
  it('returns everything with no filter', () => {
    expect(countCharacteristics(filterGattTree(tree))).toBe(3);
  });
  it('matches by name, short id and uuid', () => {
    expect(filterGattTree(tree, { query: 'battery' })).toHaveLength(1);
    expect(filterGattTree(tree, { query: '0x2a19' })[0].characteristics).toHaveLength(1);
    expect(filterGattTree(tree, { query: '6e400003' })[0].characteristics[0].name).toBe('TX');
  });
  it('keeps all characteristics when the service matches', () => {
    expect(filterGattTree(tree, { query: 'uart' })[0].characteristics).toHaveLength(2);
  });
  it('filters by capability and drops empty services', () => {
    const w = filterGattTree(tree, { flag: 'write' });
    expect(w).toHaveLength(1);
    expect(w[0].characteristics.map((c) => c.name)).toEqual(['RX']);
    expect(countCharacteristics(filterGattTree(tree, { flag: 'notify' }))).toBe(2);
    expect(filterGattTree(tree, { flag: 'read', query: 'uart' })).toEqual([]);
  });
});
