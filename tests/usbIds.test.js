import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUsbIds } from '../scripts/build-usb-ids.mjs';
import {
  loadUsbIds, resetUsbIds, parseVidPid, formatVidPid, lookupVendor, lookupProduct, lookupClass, searchIds, usbIdsVersion
} from '../src/utils/usbIds';
import { identifyUsbChip, identifyUsbDevice, shortChipLabel } from '../src/utils/usbDatabase';

const SAMPLE = `#
#	List of USB ID's
#
# Version: 2099.01.01
# Date:    2099-01-01 00:00:00
#

0403  Future Technology Devices International, Ltd
	6001  FT232 Serial (UART) IC
		00  an interface line that is dropped
	6010  FT2232C/D/H Dual UART/FIFO IC
10c4  Silicon Labs
	ea60  CP210x UART Bridge
1d6b  Linux Foundation
	0002  2.0 root hub
	0003  3.0 root hub
1a86  QinHeng Electronics
	7523  CH340 serial converter
AT 00  nonsense
C 02  Communications
	02  Abstract (modem)
		01  AT-commands (v.25ter)
C 08  Mass Storage
	06  SCSI
		50  Bulk-Only
`;

describe('parseUsbIds (build script)', () => {
  it('parses vendors, products, classes and keeps the header', () => {
    const d = parseUsbIds(SAMPLE);
    expect(d.version).toBe('2099.01.01');
    expect(d.date).toBe('2099-01-01 00:00:00');
    expect(d.header[1]).toMatch(/List of USB ID/);
    expect(d.vendors).toHaveLength(4);
    expect(d.vendors[0]).toEqual([0x0403, 'Future Technology Devices International, Ltd', [[0x6001, 'FT232 Serial (UART) IC'], [0x6010, 'FT2232C/D/H Dual UART/FIFO IC']]]);
    expect(d.classes[0]).toEqual([2, 'Communications', [[2, 'Abstract (modem)', [[1, 'AT-commands (v.25ter)']]]]]);
    expect(d.license).toMatch(/BSD-3-Clause/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(parseUsbIds(SAMPLE))).toBe(JSON.stringify(parseUsbIds(SAMPLE)));
  });
});

describe('parseVidPid', () => {
  it('accepts the common ways of writing an id', () => {
    for (const s of ['10c4:ea60', 'ID 10c4:ea60', '10C4 EA60', '0x10C4:0xEA60', ' 10c4,ea60 ']) {
      expect(parseVidPid(s)).toEqual({ vid: 0x10c4, pid: 0xea60 });
    }
    expect(parseVidPid('0x10C4')).toEqual({ vid: 0x10c4, pid: null });
    expect(parseVidPid('10c4')).toEqual({ vid: 0x10c4, pid: null });
    expect(parseVidPid('1d6b:0002')).toEqual({ vid: 0x1d6b, pid: 2 });
    expect(parseVidPid('1d6b:0000')).toEqual({ vid: 0x1d6b, pid: 0 });
  });
  it('leaves names alone', () => {
    for (const s of ['ch340', 'ftdi', 'cp2102', '', '  ', 'zzzz:0001', null]) expect(parseVidPid(s)).toBeNull();
    expect(formatVidPid(0x1d6b, 2)).toBe('1d6b:0002');
    expect(formatVidPid(0x1d6b)).toBe('1d6b');
  });
});

describe('lookups (fixture data)', () => {
  beforeEach(() => { resetUsbIds(); });

  it('looks up vendor, product, class and reports unknowns as null', async () => {
    await loadUsbIds(parseUsbIds(SAMPLE));
    expect(await lookupVendor(0x10c4)).toEqual({ vid: 0x10c4, name: 'Silicon Labs' });
    expect(await lookupVendor(0xdead)).toBeNull();
    expect(await lookupProduct(0x1d6b, 2)).toMatchObject({ vendor: 'Linux Foundation', product: '2.0 root hub' });
    expect(await lookupProduct(0x1d6b, 0x9999)).toMatchObject({ vendor: 'Linux Foundation', product: null });
    expect(await lookupProduct(0xdead, 1)).toBeNull();
    expect(await lookupClass(2, 2, 1)).toEqual({ class: 'Communications', subclass: 'Abstract (modem)', protocol: 'AT-commands (v.25ter)' });
    expect(await lookupClass(8, 6, 0x50)).toMatchObject({ class: 'Mass Storage', protocol: 'Bulk-Only' });
    expect(await lookupClass(0x77)).toBeNull();
    expect((await usbIdsVersion()).version).toBe('2099.01.01');
  });

  it('ranks searches: exact id, then prefix, then word, then substring', async () => {
    await loadUsbIds(parseUsbIds(SAMPLE));
    const byId = await searchIds('1d6b:0002');
    expect(byId[0]).toMatchObject({ kind: 'product', vid: 0x1d6b, pid: 2, name: '2.0 root hub' });
    const ch = await searchIds('ch340');
    expect(ch[0]).toMatchObject({ vid: 0x1a86, pid: 0x7523 });
    const root = await searchIds('root hub');
    expect(root.map((r) => r.pid)).toEqual([2, 3]);
    expect(await searchIds('')).toEqual([]);
    expect(await searchIds('nonexistentthing')).toEqual([]);
  });
});

describe('real usb.ids data file', () => {
  beforeEach(() => { resetUsbIds(); });

  it('names 1d6b:0002 and 10c4:ea60 and records the version', async () => {
    const data = JSON.parse(readFileSync(new URL('../src/data/usb-ids.json', import.meta.url), 'utf8'));
    expect(data.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(data.header.join('\n')).toMatch(/List of USB ID/);
    await loadUsbIds(data);
    expect(await lookupProduct(0x1d6b, 2)).toMatchObject({ vendor: 'Linux Foundation', product: '2.0 root hub' });
    expect((await lookupProduct(0x10c4, 0xea60)).vendor).toBe('Silicon Labs');
    const ftdi = await searchIds('ftdi');
    expect(ftdi.length).toBeGreaterThan(0);
    expect((await lookupClass(0x09)).class).toBe('Hub');
  });

  it('lazy-loads the json through a dynamic import when nothing is injected', async () => {
    const r = await lookupProduct(0x1d6b, 2);
    expect(r.product).toBe('2.0 root hub');
  });
});

describe('identifyUsbChip / identifyUsbDevice fallbacks', () => {
  it('never reuses another product\'s voltage/auto-reset/notes for a VID-only match', () => {
    const exact = identifyUsbChip(0x10c4, 0xea60);
    const other = identifyUsbChip(0x10c4, 0x9999);
    expect(other.known).toBe(true);
    expect(other.manufacturer).toBe('Silicon Labs');
    expect(other.voltage).toMatch(/unknown for this product/);
    expect(other.autoReset).toMatch(/unknown for this product/);
    expect(other.notes).not.toBe(exact.notes);
    expect(other.notes).not.toMatch(/NodeMCU/);
    expect(shortChipLabel(other)).toBe('Silicon');
  });

  it('treats PID 0x0000 (and VID-only) as real values, not "missing"', () => {
    const r = identifyUsbChip(0x10c4, 0x0000);
    expect(r.key).toBe('10c4:0000');
    expect(r.vidOnly).toBe(true);
    expect(identifyUsbChip(0x1234, 0).key).toBe('1234:0000');
    expect(identifyUsbChip(undefined, undefined).known).toBe(false);
  });

  it('merges curated and usb.ids data', async () => {
    resetUsbIds();
    await loadUsbIds(parseUsbIds(SAMPLE));
    const cur = await identifyUsbDevice(0x10c4, 0xea60);
    expect(cur.curated).toBe(true);
    expect(cur.source).toBe('curated');
    expect(cur.voltage).toMatch(/3\.3V/);
    expect(cur.vendorName).toBe('Silicon Labs');
    expect(cur.productName).toBe('CP210x UART Bridge');

    const root = await identifyUsbDevice(0x1d6b, 2);
    expect(root.curated).toBe(false);
    expect(root.manufacturer).toBe('Linux Foundation');
    expect(root.chip).toBe('Linux Foundation 2.0 root hub');
    expect(root.voltage).toMatch(/unknown for this product/);

    const unknown = await identifyUsbDevice(0xdead, 0xbeef);
    expect(unknown.source).toBe('none');
    expect(unknown.known).toBe(false);
  });
});
