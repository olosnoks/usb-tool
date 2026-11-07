import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  isSparse, parseSparse, toSparse, unsparse, splitSparse, imageParts, imageRawSize, resolvePartition, flashImage,
  parseAndroidInfo, checkRequirements, readFactoryZip, flashFactory, CHUNK
} from '../src/utils/fastbootTools';
import { FastbootDevice } from '../src/utils/fastbootDriver';
import { createSimulatedFastboot } from './helpers/sim/fastboot';

// A raw image with zero runs, a repeating fill and random-ish data.
function testImage(blocks = 40, bs = 4096) {
  const raw = new Uint8Array(blocks * bs);
  for (let b = 0; b < blocks; b++) {
    if (b % 10 < 3) continue; // zeros
    if (b % 10 < 5) { new Uint32Array(raw.buffer, b * bs, bs / 4).fill(0xdeadbeef); continue; }
    for (let i = 0; i < bs; i++) raw[b * bs + i] = (b * 31 + i * 7) & 0xff;
  }
  return raw;
}

/** Apply sparse pieces in order onto a zeroed buffer, like a bootloader would. */
function applyPieces(pieces) {
  const first = parseSparse(pieces[0]);
  const out = new Uint8Array(first.rawSize);
  for (const p of pieces) {
    const s = parseSparse(p);
    const raw = unsparse(p);
    for (const c of s.chunks) {
      if (c.type === CHUNK.DONT_CARE) continue;
      out.set(raw.subarray(c.startBlock * s.blockSize, (c.startBlock + c.blocks) * s.blockSize), c.startBlock * s.blockSize);
    }
  }
  return out;
}

async function simDevice({ maxDownload } = {}) {
  const transport = createSimulatedFastboot();
  if (maxDownload) transport.state.maxDownload = maxDownload;
  const fb = await new FastbootDevice(transport).open();
  return { fb, state: transport.state, transport };
}

describe('sparse images', () => {
  it('converts raw to sparse and back, using FILL chunks for repeated words', () => {
    const raw = testImage();
    const sp = toSparse(raw);
    expect(isSparse(sp)).toBe(true);
    expect(sp.length).toBeLessThan(raw.length);
    const parsed = parseSparse(sp);
    expect(parsed.chunks.some((c) => c.type === CHUNK.FILL)).toBe(true);
    expect(unsparse(sp)).toEqual(raw);
    expect(imageRawSize(sp)).toBe(raw.length);
  });

  it('pads a raw image that is not a whole number of blocks', () => {
    const raw = Uint8Array.from({ length: 5000 }, (_, i) => i & 0xff);
    const back = unsparse(toSparse(raw));
    expect(back.length).toBe(8192);
    expect(back.subarray(0, 5000)).toEqual(raw);
  });

  it('splits into pieces under the limit that rebuild the image', () => {
    const raw = testImage(60);
    const pieces = splitSparse(toSparse(raw), 40 * 1024);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.every((p) => p.length <= 40 * 1024)).toBe(true);
    expect(pieces.every((p) => parseSparse(p).totalBlocks === 60)).toBe(true);
    expect(applyPieces(pieces)).toEqual(raw);
  });

  it('leaves images that fit alone', () => {
    const raw = new Uint8Array(1000);
    expect(imageParts(raw, 4096)).toEqual([raw]);
    expect(() => parseSparse(raw)).toThrow(/Not an Android sparse/);
  });
});

describe('flashing', () => {
  it('names partitions by slot', async () => {
    const { fb } = await simDevice();
    expect(await resolvePartition(fb, 'boot')).toBe('boot_a');
    expect(await resolvePartition(fb, 'boot', 'b')).toBe('boot_b');
    expect(await resolvePartition(fb, 'userdata')).toBe('userdata');
    expect(await resolvePartition(fb, 'system_b')).toBe('system_b');
  });

  it('flashes an image bigger than max-download-size in sparse pieces', async () => {
    const { fb, state } = await simDevice({ maxDownload: 48 * 1024 });
    await fb.unlock();
    const raw = testImage(50);
    const n = await flashImage(fb, 'boot_a', raw);
    expect(n).toBeGreaterThan(2);
    expect(state.flashLog.filter((f) => f.partition === 'boot_a').every((f) => f.sparse && f.bytes <= 48 * 1024)).toBe(true);
    expect(state.partitions.boot_a).toEqual(raw);
  });
});

describe('factory images', () => {
  it('parses and checks android-info requirements', () => {
    const reqs = parseAndroidInfo('require board=blueline|crosshatch\nrequire version-bootloader=b1c1-0.4*\nrequire-for-product:other version-baseband=x\n');
    expect(reqs[0]).toEqual({ product: null, name: 'product', values: ['blueline', 'crosshatch'] });
    const res = checkRequirements(reqs, { product: 'blueline', 'version-bootloader': 'b1c1-0.4-7617406' });
    expect(res.map((r) => r.ok)).toEqual([true, true]);
    expect(checkRequirements(reqs, { product: 'sargo' })[0].ok).toBe(false);
  });

  const buildFactoryZip = async (board = 'virtual-pixel') => {
    const inner = new JSZip();
    inner.file('android-info.txt', `require board=${board}\n`);
    inner.file('boot.img', new Uint8Array(8192).fill(1));
    inner.file('vbmeta.img', new Uint8Array(4096).fill(2));
    inner.file('system.img', toSparse(testImage(30)));
    inner.file('vendor.img', new Uint8Array(4096).fill(3));
    inner.file('super_empty.img', new Uint8Array(4096).fill(9));
    const outer = new JSZip();
    outer.file('blueline-sp1a/bootloader-blueline-b1c1-0.4.img', new Uint8Array(4096).fill(7));
    outer.file('blueline-sp1a/radio-blueline-g845.img', new Uint8Array(4096).fill(8));
    outer.file('blueline-sp1a/flash-all.sh', '#!/bin/sh\n');
    outer.file('blueline-sp1a/image-blueline-sp1a.zip', await inner.generateAsync({ type: 'uint8array' }));
    return outer.generateAsync({ type: 'uint8array' });
  };

  it('reads a factory zip into a plan', async () => {
    const plan = await readFactoryZip(await buildFactoryZip());
    expect(plan.bootloader).toMatch(/bootloader-.*\.img$/);
    expect(plan.radio).toMatch(/radio-.*\.img$/);
    expect(plan.images.map((i) => [i.name, i.logical])).toEqual([['boot', false], ['vbmeta', false], ['system', true], ['vendor', true]]);
    expect(plan.superEmpty).toBe('super_empty.img');
  });

  it('flashes in the same order as flash-all.sh / fastboot update', async () => {
    const { fb, state } = await simDevice();
    await fb.unlock();
    const plan = await readFactoryZip(await buildFactoryZip());
    let dev = fb;
    const steps = [];
    const reconnects = [];
    await flashFactory(plan, {
      fb: () => dev,
      reconnect: async () => { reconnects.push(state.rebooted); dev = fb; return dev; },
      wipe: true,
      onStep: (s) => steps.push(s)
    });
    expect(state.flashLog.map((f) => f.partition)).toEqual(['bootloader_a', 'radio_a', 'boot_a', 'vbmeta_a', 'system_a', 'vendor_a']);
    expect(reconnects).toEqual(['reboot-bootloader', 'reboot-bootloader', 'reboot-fastboot']);
    expect(state.superUpdated).toBe('super:wipe');
    expect(state.partitions.system_a).toEqual(testImage(30));
    expect(state.erased).toEqual(['userdata', 'metadata']);
    expect(steps[steps.length - 1]).toMatch(/Done/);
  });

  it('refuses the wrong device and a locked bootloader', async () => {
    const plan = await readFactoryZip(await buildFactoryZip('some-other-phone'));
    const { fb } = await simDevice();
    await fb.unlock();
    await expect(flashFactory(plan, { fb: () => fb, reconnect: async () => fb })).rejects.toThrow(/for some-other-phone/);
    const right = await readFactoryZip(await buildFactoryZip());
    const locked = await simDevice();
    await expect(flashFactory(right, { fb: () => locked.fb, reconnect: async () => locked.fb })).rejects.toThrow(/locked/);
  });
});
