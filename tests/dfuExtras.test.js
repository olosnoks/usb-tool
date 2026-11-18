import { describe, it, expect } from 'vitest';
import { parseDfuSuffix, parseDfuSeImage } from '../src/utils/dfuDriver';
import {
  appendDfuSuffix,
  buildDfuSeFile,
  inspectCortexMImage,
  summarizeErasePlan,
  buildDfuUtilCommand
} from '../src/utils/dfuExtras';

describe('buildDfuSeFile', () => {
  it('round-trips through the suffix and DfuSe parsers', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const file = buildDfuSeFile([{ address: 0x08000000, data }, { address: 0x08001000, data }], { vid: 0x0483, pid: 0xdf11 });
    const sfx = parseDfuSuffix(file);
    expect(sfx.present).toBe(true);
    expect(sfx.valid).toBe(true);
    expect(sfx.idVendor).toBe(0x0483);
    expect(sfx.idProduct).toBe(0xdf11);
    expect(file[file.length - 8]).toBe(0x55);
    const img = parseDfuSeImage(sfx.payload);
    expect(img.isDfuSe).toBe(true);
    expect(img.targets[0].elements).toHaveLength(2);
    expect(img.targets[0].elements[1].address).toBe(0x08001000);
    expect(Array.from(img.targets[0].elements[0].data)).toEqual([1, 2, 3, 4, 5]);
  });
  it('rejects empty input', () => {
    expect(() => buildDfuSeFile([])).toThrow();
  });
  it('defaults to wildcard VID/PID', () => {
    const s = parseDfuSuffix(appendDfuSuffix(new Uint8Array([9])));
    expect(s.idVendor).toBe(0xffff);
    expect(s.valid).toBe(true);
  });
});

describe('inspectCortexMImage', () => {
  const img = (sp, reset) => {
    const b = new Uint8Array(64);
    new DataView(b.buffer).setUint32(0, sp, true);
    new DataView(b.buffer).setUint32(4, reset, true);
    return b;
  };
  it('accepts a sane image', () => {
    const r = inspectCortexMImage(img(0x20005000, 0x08000011), 0x08000000);
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(true);
  });
  it('warns when the reset vector is outside the image and region', () => {
    const r = inspectCortexMImage(img(0x20005000, 0x08008001), 0x08000000, { start: 0x08000000, end: 0x08004000 });
    expect(r.ok).toBe(false);
    expect(r.findings.filter((f) => f.level === 'warn')).toHaveLength(2);
  });
  it('skips non-ARM data', () => {
    expect(inspectCortexMImage(new Uint8Array(16), 0).applicable).toBe(false);
  });
});

describe('summarizeErasePlan', () => {
  const layout = [0, 1, 2, 3].map((i) => ({ start: 0x08000000 + i * 0x4000, size: 0x4000, erasable: true }));
  it('counts sectors', () => {
    expect(summarizeErasePlan(layout, 0x08000000, 0x5000)).toEqual({ sectors: 2, bytes: 0x8000 });
  });
  it('reports errors', () => {
    expect(summarizeErasePlan(layout, 0x08000000, 0x100000).error).toMatch(/does not fit/);
  });
});

describe('buildDfuUtilCommand', () => {
  it('builds download and upload commands', () => {
    expect(buildDfuUtilCommand({ vid: 0x483, pid: 0xdf11, alt: 0, address: 0x08000000, fileName: 'a.bin', dfuse: true })).toBe(
      'dfu-util -d 0483:df11 -a 0 -D "a.bin" -s 0x8000000:leave'
    );
    expect(buildDfuUtilCommand({ alt: 1, address: 0x08000000, fileName: 'r.bin', dfuse: true, upload: true, length: 1024 })).toBe(
      'dfu-util -a 1 -U "r.bin" -s 0x8000000:1024'
    );
  });
});
