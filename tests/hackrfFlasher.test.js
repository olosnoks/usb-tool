import { describe, it, expect } from 'vitest';
import {
  HackRfSpiFlasher, validateSpiImage, classifyUsbDevice, pickReleaseAssets, pickImagesFromZip,
  sdcardEntryPaths, copyZipToDirectory, fetchGithubReleases, HACKRF_SPI_PAGE, HACKRF_SPI_FLASH_BYTES
} from '../src/utils/hackrfFlasher';

// A fake HackRF: 1 MiB of SPI flash behind the libhackrf vendor requests.
function makeFakeHackRf({ corruptAt = -1 } = {}) {
  const flash = new Uint8Array(HACKRF_SPI_FLASH_BYTES).fill(0xff);
  const calls = [];
  let mode = 1;
  const dev = {
    vendorId: 0x1d50, productId: 0x6089, opened: true,
    async controlTransferOut(setup, data) {
      calls.push({ dir: 'out', request: setup.request, value: setup.value, index: setup.index, len: data ? data.byteLength : 0 });
      if (setup.request === 1) { mode = setup.value; return { status: 'ok' }; }
      if (setup.request === 18) { flash.fill(0xff); return { status: 'ok' }; }
      if (setup.request === 12) {
        const addr = (setup.value << 16) | setup.index;
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length > 256 || addr + bytes.length > flash.length) return { status: 'stall' };
        for (let i = 0; i < bytes.length; i++) flash[addr + i] = bytes[i] & 0xff;   // NOR: only clears bits after erase
        if (corruptAt >= addr && corruptAt < addr + bytes.length) flash[corruptAt] ^= 0x01;
        return { status: 'ok', bytesWritten: bytes.length };
      }
      if (setup.request === 22) throw new Error('device went away');
      return { status: 'ok' };
    },
    async controlTransferIn(setup, len) {
      calls.push({ dir: 'in', request: setup.request, value: setup.value, index: setup.index, len });
      if (setup.request === 15) return { data: new DataView(new TextEncoder().encode('2024.02.1').buffer) };
      if (setup.request === 14) return { data: new DataView(new Uint8Array([2]).buffer) };
      if (setup.request === 13) {
        const addr = (setup.value << 16) | setup.index;
        return { data: new DataView(flash.slice(addr, addr + len).buffer) };
      }
      return { data: new DataView(new Uint8Array(len).buffer) };
    }
  };
  return { dev, flash, calls, mode: () => mode };
}

function image(len) {
  const b = new Uint8Array(len);
  b[0] = 0x1a; b[1] = 0x3f;
  for (let i = 2; i < len; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
}

describe('HackRF SPI flasher (simulated board)', () => {
  it('identifies, erases, writes every page, verifies and resets', async () => {
    const { dev, flash, calls, mode } = makeFakeHackRf();
    const f = new HackRfSpiFlasher(dev);
    expect(await f.identify()).toEqual({ firmwareVersion: '2024.02.1', boardId: 2, boardName: 'HackRF One' });
    const img = image(1000);                       // not a multiple of 256: last page is short
    const phases = [];
    const r = await f.flash(img, { onProgress: (p) => phases.push(p.phase) });
    expect(r).toEqual({ bytes: 1000, pages: 4, verified: true });
    expect(flash.subarray(0, 1000)).toEqual(img);
    expect(flash[1000]).toBe(0xff);
    expect(mode()).toBe(0);                        // radio stopped first
    const seq = calls.map((c) => c.request);
    expect(seq.indexOf(18)).toBeLessThan(seq.indexOf(12));                  // erase before write
    expect(seq.lastIndexOf(12)).toBeLessThan(seq.indexOf(13));              // writes before read-back
    expect(seq[seq.length - 1]).toBe(22);                                   // reset last
    const writes = calls.filter((c) => c.request === 12);
    expect(writes.map((w) => w.len)).toEqual([256, 256, 256, 232]);
    expect(writes[3]).toMatchObject({ value: 0, index: 768 });
    expect(phases[0]).toBe('erase'); expect(phases[phases.length - 1]).toBe('done');
    expect(phases).toContain('verify');
  });

  it('addresses pages above 64 KiB through wValue', async () => {
    const { dev, calls } = makeFakeHackRf();
    const f = new HackRfSpiFlasher(dev);
    await expect(f.writePage(HACKRF_SPI_FLASH_BYTES - 8, new Uint8Array(16))).rejects.toThrow(/past the end/);
    await f.writePage(0x010100, new Uint8Array(16));
    const w = calls.filter((c) => c.request === 12).pop();
    expect(w.value).toBe(1); expect(w.index).toBe(0x0100);
  });

  it('reports a verify mismatch with the address and does not reset', async () => {
    const { dev, calls } = makeFakeHackRf({ corruptAt: 300 });
    const f = new HackRfSpiFlasher(dev);
    await expect(f.flash(image(600))).rejects.toThrow(/Verify failed at 0x12c/);
    expect(calls.some((c) => c.request === 22)).toBe(false);
  });

  it('refuses images that are empty, too big, or not an LPC43xx SPI image (unless overridden)', async () => {
    const { dev } = makeFakeHackRf();
    const f = new HackRfSpiFlasher(dev);
    await expect(f.flash(new Uint8Array(0))).rejects.toThrow(/empty/);
    await expect(f.flash(new Uint8Array(HACKRF_SPI_FLASH_BYTES + 1))).rejects.toThrow(/1 MiB/);
    const odd = image(512); odd[0] = 0x00;
    await expect(f.flash(odd)).rejects.toThrow(/LPC43xx boot header/);
    const r = await f.flash(odd, { allowUnrecognised: true });
    expect(r.verified).toBe(true);
    expect(validateSpiImage(image(100000))).toEqual({ ok: true, errors: [], warnings: [], unrecognised: false });
  });
});

describe('setup helpers', () => {
  it('classifies the USB ids of the setup flow', () => {
    expect(classifyUsbDevice(0x1d50, 0x6089)).toBe('hackrf');
    expect(classifyUsbDevice(0x1d50, 0x6018)).toBe('mayhem-serial');
    expect(classifyUsbDevice(0x1fc9, 0x000c)).toBe('lpc-dfu');
    expect(classifyUsbDevice(0x0403, 0x6001)).toBe('unknown');
  });

  it('picks the firmware and SD-card assets from a Mayhem or HackRF release', () => {
    const mayhem = [{ name: 'mayhem_v2.1.0_COPY_TO_SDCARD.zip' }, { name: 'mayhem_v2.1.0_FIRMWARE.zip' }, { name: 'mayhem_v2.1.0_FIRMWARE.ppfw.tar' }, { name: 'Source code (zip)' }];
    const m = pickReleaseAssets(mayhem);
    expect(m.firmwareZip.name).toBe('mayhem_v2.1.0_FIRMWARE.zip');
    expect(m.sdcardZip.name).toBe('mayhem_v2.1.0_COPY_TO_SDCARD.zip');
    expect(m.ppfw.name).toBe('mayhem_v2.1.0_FIRMWARE.ppfw.tar');
    const h = pickReleaseAssets([{ name: 'hackrf-2024.02.1.zip' }, { name: 'hackrf-2024.02.1.tar.xz' }]);
    expect(h.firmwareZip.name).toBe('hackrf-2024.02.1.zip');
    expect(h.sdcardZip).toBe(null);
  });

  it('finds the .bin and .dfu inside the zips', () => {
    expect(pickImagesFromZip(['portapack-h1_h2-mayhem.bin', 'README.md'])).toEqual({ bin: 'portapack-h1_h2-mayhem.bin', dfu: null });
    expect(pickImagesFromZip(['hackrf-2024.02.1/firmware-bin/hackrf_cpld_default.xsvf', 'hackrf-2024.02.1/firmware-bin/hackrf_one_usb.bin', 'hackrf-2024.02.1/firmware-bin/hackrf_one_usb.dfu']))
      .toEqual({ bin: 'hackrf-2024.02.1/firmware-bin/hackrf_one_usb.bin', dfu: 'hackrf-2024.02.1/firmware-bin/hackrf_one_usb.dfu' });
  });

  it('strips a single wrapping sdcard folder and junk from the SD zip', () => {
    expect(sdcardEntryPaths(['sdcard/', 'sdcard/APPS/adsb.ppma', 'sdcard/FREQMAN/x.txt', '__MACOSX/._x'])).toEqual([
      { entry: 'sdcard/APPS/adsb.ppma', path: 'APPS/adsb.ppma' }, { entry: 'sdcard/FREQMAN/x.txt', path: 'FREQMAN/x.txt' }
    ]);
    expect(sdcardEntryPaths(['APPS/adsb.ppma', 'SPLASH.BMP'])).toEqual([
      { entry: 'APPS/adsb.ppma', path: 'APPS/adsb.ppma' }, { entry: 'SPLASH.BMP', path: 'SPLASH.BMP' }
    ]);
  });

  it('copies zip entries into a directory tree', async () => {
    const written = {};
    const makeDir = (prefix) => ({
      getDirectoryHandle: async (n) => makeDir(prefix + n + '/'),
      getFileHandle: async (n) => ({ createWritable: async () => ({ write: async (d) => { written[prefix + n] = d.length; }, close: async () => {} }) })
    });
    const zip = { files: { 'sdcard/APPS/a.ppma': {}, 'sdcard/SPLASH.BMP': {} }, file: (n) => ({ async: async () => new Uint8Array(n.length) }) };
    const r = await copyZipToDirectory(zip, makeDir(''));
    expect(r.files).toBe(2);
    expect(written).toEqual({ 'APPS/a.ppma': 18, 'SPLASH.BMP': 17 });
  });

  it('lists GitHub releases through a fetch implementation', async () => {
    const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => [{ tag_name: 'v2.1.0', name: 'Mayhem v2.1.0', published_at: '2025-01-01', prerelease: false, html_url: 'u', assets: [{ name: 'mayhem_v2.1.0_FIRMWARE.zip', size: 1, browser_download_url: 'd' }] }] });
    const rel = await fetchGithubReleases('portapack-mayhem/mayhem-firmware', { fetchImpl });
    expect(rel[0].tag).toBe('v2.1.0');
    expect(rel[0].assets[0].url).toBe('d');
    await expect(fetchGithubReleases('x/y', { fetchImpl: async () => ({ ok: false, status: 403 }) })).rejects.toThrow(/rate limit/);
  });
});
