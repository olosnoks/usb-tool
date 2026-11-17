import { describe, it, expect } from 'vitest';
import {
  parse_id, usb_ids_names, lookup, render, KNOWN, from_capture,
} from '../../src/utils/usbrea/lookup.js';
import { capture_from_messages } from '../../src/utils/usbrea/synth.js';
import { fromHex } from '../../src/utils/usbrea/bytes.js';

const USB_IDS = `# sample in the usb.ids format
1038  SteelSeries ApS
\t1702  Rival 100 Gaming Mouse
1e71  NZXT
\t170e  Kraken X
\t2007  Kraken X Series
1e72  Other Vendor
\t170e  Not this one
C 03  Human Interface Device
`;

const INDEX = [
  { id: 'nzxt/hue-2', vendor: 'NZXT', model: 'Hue 2', status: 'controllable', sources: ['openrgb'], identifiers: { usb: ['1e71:20aa'] } },
  { id: 'acme/other', vendor: 'Acme', model: 'Other', identifiers: { chips: ['ESP32'] } },
];
const RECORD = { id: 'nzxt/hue-2', projects: [{ name: 'OpenRGB', url: 'https://gitlab.com/CalcProgrammer1/OpenRGB' }] };

function fakeFetch(url) {
  if (url.endsWith('/index.json')) return JSON.stringify(INDEX);
  if (url.endsWith('/devices/nzxt/hue-2.json')) return JSON.stringify(RECORD);
  throw new Error('404');
}
const noNetwork = () => { throw new Error('network disabled in tests'); };

describe('lookup', () => {
  it('parse_id', () => {
    expect(parse_id('1e71:170e')).toEqual([0x1E71, 0x170E]);
    expect(parse_id('0x1E71:0x170E')).toEqual([0x1E71, 0x170E]);
    expect(parse_id(' 1038 1702 ')).toEqual([0x1038, 0x1702]);
    expect(parse_id('ID 1e71:170e')).toEqual([0x1E71, 0x170E]);
    expect(parse_id('id 1e71:170e')).toEqual([0x1E71, 0x170E]);
    expect(() => parse_id('kraken')).toThrow(/capture/);
  });

  it('known devices offline', () => {
    const k = lookup(0x1E71, 0x170E);
    expect(k.status).toBe('documented');
    expect(k.vendor).toBe('NZXT');
    expect(k.product).toContain('Kraken X');
    expect(k.projects.some((p) => p.project === 'liquidctl' && p.url.endsWith('kraken2.py'))).toBe(true);
    expect('opendevicedb' in k).toBe(false);
    expect(lookup(0x1038, 0x1702).projects[0].project).toBe('rivalcfg');
    const t = lookup(0x1A86, 0x5722);
    expect(t.projects[0].project).toContain('turing');
    expect(t.limits).toContain('serial number');
    expect(lookup(0x87AD, 0x70DB).projects[0].project).toBe('linux-thermalright-lcd-control');
    expect(lookup(0x0B05, 0x1C7B).projects[0].project).toContain('case study');
  });

  it('unknown stays unknown', () => {
    const u = lookup(0x1E71, 0x9999);
    expect(u.status).toBe('unknown');
    expect(u.projects).toEqual([]);
    expect(u.product).toBeNull();
    expect(u.same_vendor).toEqual(expect.arrayContaining(['liquidctl', 'OpenRGB']));
    const text = render(u);
    expect(text).toContain('unknown');
    expect(text).toContain('--online');
    const nobody = lookup(0xFFFF, 0x0001);
    expect(nobody.vendor).toBeNull();
    expect(render(nobody)).toContain('unknown device');
  });

  it('usb_ids_names', () => {
    expect(usb_ids_names(USB_IDS, 0x1E71, 0x2007)).toEqual(['NZXT', 'Kraken X Series']);
    expect(usb_ids_names(USB_IDS, 0x1E71, 0x1234)).toEqual(['NZXT', null]);
    expect(usb_ids_names(USB_IDS, 0x1E72, 0x170E)).toEqual(['Other Vendor', 'Not this one']);
    expect(usb_ids_names(USB_IDS, 0x0003, 0x0000)).toEqual([null, null]);
    const u = lookup(0x1E71, 0x2007, false, USB_IDS);
    expect(u.names_from).toBe('usb-rea');
    expect(u.usb_ids.product).toBe('Kraken X Series');
    expect(u.product).toBe('NZXT Kraken X (X53, X63 or X73)'); // the curated name wins
    const other = lookup(0x1E72, 0x170E, false, USB_IDS);
    expect(other.status).toBe('unknown');
    expect(other.product).toBe('Not this one');
    expect(other.names_from).toBe('usb.ids');
  });

  it('online OpenDeviceDB (faked)', async () => {
    const u = await lookup(0x1E71, 0x20AA, true, null, fakeFetch);
    expect(u.status).toBe('listed in OpenDeviceDB');
    const rec = u.opendevicedb.records[0];
    expect(rec.id).toBe('nzxt/hue-2');
    expect(rec.projects[0].project).toBe('OpenRGB');
    expect(render(u)).toContain('OpenRGB');
    const none = await lookup(0x1E71, 0x9999, true, null, fakeFetch);
    expect(none.status).toBe('unknown');
    expect(render(none)).toContain('no record');
  });

  it('online without network degrades', async () => {
    const k = await lookup(0x1E71, 0x170E, true, null, noNetwork);
    expect(k.status).toBe('documented');
    expect(k.projects.length).toBeGreaterThan(0);
    expect(k.opendevicedb.error).toContain('network disabled');
    expect(render(k)).toContain('not reachable');
  });

  it('expanded known devices', () => {
    expect(KNOWN.size).toBeGreaterThanOrEqual(267);
    const a = lookup(0x1E71, 0x2001);
    expect(a.status).toBe('documented');
    expect(a.projects.some((p) => p.project === 'liquidctl')).toBe(true);
    expect(a.projects.some((p) => p.project === 'OpenRGB')).toBe(true);
    const r = lookup(0x1038, 0x1836);
    expect(r.projects[0].project).toBe('rivalcfg');
    expect(r.product).toContain('Aerox 3');
    expect(lookup(0x1CBE, 0x0046).projects[0].project).toContain('turing');
    expect(lookup(0x1A86, 0xFE0C).limits).toContain('serial number');
    expect(lookup(0x264A, 0x1FA5).projects[0].project).toBe('OpenRGB');
    expect(lookup(0x1B1C, 0x0C2D).projects[0].project).toBe('OpenRGB');
    const a2 = lookup(0x0402, 0x3922);
    expect(a2.product).toContain('Frozen Warframe');
    expect(a2.projects[0].url.endsWith('device_0402_3922.py')).toBe(true);
    expect(lookup(0x0416, 0x8001).limits).toContain('generic');
    const msi = lookup(0x0DB0, 0xCA00);
    expect(msi.projects[0].url.endsWith('msi.py')).toBe(true);
    expect(msi.limits).toContain('unsafe');
  });

  it('from_capture finds the device IDs', () => {
    const { capture } = capture_from_messages([['fan 50', fromHex('024d000032'), ['interrupt', 1]]], 0x1E71, 0x170E);
    expect(from_capture(capture)).toEqual([[5, 0x1E71, 0x170E]]);
  });
});
