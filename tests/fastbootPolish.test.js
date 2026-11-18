import { describe, it, expect } from 'vitest';
import {
  identifyImage, parseSizeVar, preflightChecks, prepareConsoleCommand, formatVarsText,
  cliFlashCommand, buildFlashAllScript, sha256Hex, toSparse
} from '../src/utils/fastbootTools';

const bytes = (s, len = 2048) => { const b = new Uint8Array(len); b.set(new TextEncoder().encode(s)); return b; };

describe('identifyImage', () => {
  it('recognises common headers', () => {
    expect(identifyImage(bytes('ANDROID!')).kind).toBe('boot');
    expect(identifyImage(bytes('VNDRBOOT')).kind).toBe('vendor_boot');
    expect(identifyImage(bytes('AVB0')).kind).toBe('vbmeta');
    expect(identifyImage(bytes('hello')).kind).toBe('unknown');
    expect(identifyImage(toSparse(new Uint8Array(8192))).kind).toBe('sparse');
    const ext = new Uint8Array(2048); ext[1080] = 0x53; ext[1081] = 0xef;
    expect(identifyImage(ext).kind).toBe('ext4');
  });
});

describe('parseSizeVar', () => {
  it('parses hex and decimal', () => {
    expect(parseSizeVar('0x1000')).toBe(4096);
    expect(parseSizeVar('4096')).toBe(4096);
    expect(parseSizeVar('nope')).toBeNull();
    expect(parseSizeVar(undefined)).toBeNull();
  });
});

describe('preflightChecks', () => {
  it('warns on oversize and wrong type', () => {
    const w = preflightChecks('boot_a', bytes('AVB0', 5000), { 'partition-size:boot_a': '0x1000' });
    expect(w.some((x) => /only 4096/.test(x.text))).toBe(true);
    expect(w.some((x) => /boot image/.test(x.text))).toBe(true);
  });
  it('is quiet for a matching boot image', () => {
    expect(preflightChecks('boot', bytes('ANDROID!'), { 'partition-size:boot': '0x4000000' })).toEqual([]);
  });
  it('flags system given a boot image, and firmware', () => {
    expect(preflightChecks('system', bytes('ANDROID!'), {}).length).toBe(1);
    expect(preflightChecks('bootloader', bytes('x'), {}).length).toBe(1);
  });
});

describe('prepareConsoleCommand', () => {
  it('normalises CLI style', () => {
    expect(prepareConsoleCommand('fastboot getvar all').cmd).toBe('getvar:all');
    expect(prepareConsoleCommand('getvar:product').cmd).toBe('getvar:product');
    expect(prepareConsoleCommand('oem device-info').cmd).toBe('oem device-info');
    expect(prepareConsoleCommand('reboot bootloader').cmd).toBe('reboot-bootloader');
    expect(prepareConsoleCommand('reboot').cmd).toBe('reboot');
    expect(prepareConsoleCommand('erase cache').cmd).toBe('erase:cache');
  });
  it('flags destructive commands', () => {
    expect(prepareConsoleCommand('flashing unlock').destructive).toBe(true);
    expect(prepareConsoleCommand('erase userdata').destructive).toBe(true);
    expect(prepareConsoleCommand('oem unlock').destructive).toBe(true);
    expect(prepareConsoleCommand('getvar all').destructive).toBe(false);
    expect(prepareConsoleCommand('oem device-info').destructive).toBe(false);
  });
  it('rejects file commands, empty and long input', () => {
    expect(() => prepareConsoleCommand('flash boot boot.img')).toThrow(/panel/);
    expect(() => prepareConsoleCommand('download:1000')).toThrow();
    expect(() => prepareConsoleCommand('  ')).toThrow();
    expect(() => prepareConsoleCommand('oem ' + 'a'.repeat(70))).toThrow(/64/);
  });
});

describe('exports', () => {
  it('formats vars like fastboot getvar all', () => {
    expect(formatVarsText({ product: 'x', 'partition-type:boot': 'raw' })).toBe('(bootloader) product: x\n(bootloader) partition-type:boot: raw');
  });
  it('builds CLI commands with quoting', () => {
    expect(cliFlashCommand('boot', 'boot.img')).toBe('fastboot flash boot boot.img');
    expect(cliFlashCommand('boot', 'my boot.img', { slot: 'all' })).toBe("fastboot --slot=all flash boot 'my boot.img'");
  });
  it('builds a flash-all script in factory order', () => {
    const plan = {
      bootloader: 'p/bootloader-x.img', radio: 'p/radio-x.img', superEmpty: 'i/super_empty.img',
      images: [{ name: 'boot', file: 'i/boot.img', logical: false }, { name: 'system', file: 'i/system.img', logical: true }]
    };
    const s = buildFlashAllScript(plan, { wipe: true });
    const lines = s.trim().split('\n').filter((l) => l.startsWith('fastboot'));
    expect(lines).toEqual([
      'fastboot flash bootloader bootloader-x.img', 'fastboot reboot-bootloader',
      'fastboot flash radio radio-x.img', 'fastboot reboot-bootloader',
      'fastboot flash boot boot.img', 'fastboot reboot-fastboot',
      'fastboot update-super super super_empty.img --wipe', 'fastboot flash system system.img',
      'fastboot erase userdata', 'fastboot erase metadata', 'fastboot reboot'
    ]);
    expect(buildFlashAllScript(plan, { skip: ['radio', 'system'] })).not.toMatch(/radio|system/);
  });
  it('computes sha256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
