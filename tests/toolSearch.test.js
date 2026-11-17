import { describe, it, expect } from 'vitest';
import { searchTools, matchesTool, normalizeText } from '../src/utils/toolSearch.js';

const ITEMS = [
  { id: 'usb-pd', name: 'USB PD Analyzer', desc: 'Power delivery sniffer', keywords: ['usbpd', 'charger'] },
  { id: 'i2c', name: 'I²C Scanner', desc: 'Bus scan', keywords: ['twi'] },
  { id: 'hex', name: 'Hex Viewer', desc: 'Inspect bytes, usb data', keywords: ['binary'] },
  { id: 'cyberchef', name: 'CyberChef Workbench', desc: 'Encode and decode', keywords: ['base64'] },
  { id: 'serial', name: 'Serial Terminal', desc: 'UART console', keywords: ['hex', 'uart'] },
  { id: 'bluetooth', name: 'Bluetooth LE', desc: 'GATT explorer', keywords: ['ble'] },
];
const ids = (r) => r.map((x) => x.id);

describe('toolSearch', () => {
  it('normalizes case, punctuation and diacritics', () => {
    expect(normalizeText('USB-PD_x/y.z:w')).toBe('usb pd x y z w');
    expect(normalizeText('I²C')).toBe('i2c');
  });

  it('treats usb-pd, usb pd and usbpd the same', () => {
    for (const q of ['usb-pd', 'USB PD', 'usbpd', 'usb_pd', 'usb/pd']) {
      expect(ids(searchTools(ITEMS, q))[0]).toBe('usb-pd');
    }
  });

  it('matches i2c against I²C', () => {
    expect(ids(searchTools(ITEMS, 'i2c'))).toEqual(['i2c']);
  });

  it('returns everything in original order for an empty query', () => {
    expect(searchTools(ITEMS, '')).toEqual(ITEMS);
    expect(searchTools(ITEMS, ' -- ')).toEqual(ITEMS);
  });

  it('requires every token to match (AND)', () => {
    expect(ids(searchTools(ITEMS, 'usb sniffer'))).toEqual(['usb-pd']);
    expect(searchTools(ITEMS, 'usb banana')).toEqual([]);
  });

  it('supports prefix matching on words', () => {
    expect(ids(searchTools(ITEMS, 'blue'))).toEqual(['bluetooth']);
    expect(ids(searchTools(ITEMS, 'wor'))).toEqual(['cyberchef']);
  });

  it('tolerates one typo for tokens of 5+ chars only', () => {
    expect(ids(searchTools(ITEMS, 'cyberchf'))).toContain('cyberchef');
    expect(ids(searchTools(ITEMS, 'bluetoth'))).toContain('bluetooth');
    expect(ids(searchTools(ITEMS, 'blutooth'))).toContain('bluetooth');
    expect(searchTools(ITEMS, 'hxe')).toEqual([]);
    expect(searchTools(ITEMS, 'hexx')).toEqual([]);
  });

  it('ranks name over keyword over description', () => {
    // 'hex': name word (Hex Viewer) > keyword (Serial) ; 'usb': desc of hex < name of usb-pd
    expect(ids(searchTools(ITEMS, 'hex'))).toEqual(['hex', 'serial']);
    expect(ids(searchTools(ITEMS, 'usb'))).toEqual(['usb-pd', 'hex']);
  });

  it('ranks exact id/name above prefix above word', () => {
    const items = [
      { id: 'a', name: 'My Hex Tool', desc: '', keywords: [] },
      { id: 'b', name: 'Hexagon', desc: '', keywords: [] },
      { id: 'hex', name: 'Hex', desc: '', keywords: [] },
    ];
    expect(ids(searchTools(items, 'hex'))).toEqual(['hex', 'b', 'a']);
  });

  it('keeps original order for ties and supports custom fields', () => {
    const arts = [
      { slug: 'x', title: 'Alpha', tags: ['foo'], content: 'lorem needle' },
      { slug: 'y', title: 'Needle', tags: [], content: '' },
    ];
    const fields = { name: ['title'], id: ['slug'], keywords: ['tags'], desc: [], body: ['content'] };
    expect(searchTools(arts, 'needle', { fields }).map((a) => a.slug)).toEqual(['y', 'x']);
  });

  it('matchesTool mirrors searchTools', () => {
    expect(matchesTool(ITEMS[0], 'usb-pd')).toBe(true);
    expect(matchesTool(ITEMS[0], 'zzzzz')).toBe(false);
    expect(matchesTool(ITEMS[0], '')).toBe(true);
  });
});
