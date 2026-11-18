import { describe, it, expect } from 'vitest';
import { parseEspImageHeader, describeImage, checkLayout, buildEsptoolCommand, isPartitionTable } from '../src/utils/flashPlan';

const hdr = (over = {}) => {
  const d = new Uint8Array(32);
  d[0] = 0xe9; d[1] = 3; d[2] = 2; d[3] = 0x20; d[12] = 9; d[13] = 0;
  Object.entries(over).forEach(([k, v]) => { d[k] = v; });
  return d;
};

describe('parseEspImageHeader', () => {
  it('decodes an ESP32-S3 header', () => {
    const h = parseEspImageHeader(hdr());
    expect(h).toMatchObject({ segments: 3, flashMode: 'DIO', flashSizeMB: 4, chip: 'ESP32-S3' });
  });
  it('rejects non-images', () => {
    expect(parseEspImageHeader(new Uint8Array(32))).toBeNull();
    expect(parseEspImageHeader(null)).toBeNull();
  });
  it('does not guess chip or size without an extended header', () => {
    const h = parseEspImageHeader(hdr({ 12: 0x77, 13: 0x40 }));
    expect(h.chip).toBeNull();
    expect(h.flashSizeMB).toBeNull();
  });
  it('describes images and partition tables', () => {
    expect(describeImage(hdr())).toContain('ESP32-S3 image');
    const pt = new Uint8Array(32); pt[0] = 0xaa; pt[1] = 0x50;
    expect(isPartitionTable(pt)).toBe(true);
    expect(describeImage(pt)).toMatch(/partition table/);
    expect(describeImage(new Uint8Array(32))).toBeNull();
  });
});

describe('checkLayout', () => {
  it('flags overlap', () => {
    const r = checkLayout([
      { label: 'A', offset: 0x1000, size: 0x9000 },
      { label: 'B', offset: 0x8000, size: 0x100 }
    ]);
    expect(r.some(x => x.level === 'error' && /overlap/.test(x.message))).toBe(true);
  });
  it('passes adjacent images', () => {
    const r = checkLayout([
      { label: 'A', offset: 0x1000, size: 0x7000 },
      { label: 'B', offset: 0x8000, size: 0x100 }
    ]);
    expect(r.filter(x => x.level === 'error')).toHaveLength(0);
  });
  it('flags invalid and unaligned offsets', () => {
    const r = checkLayout([{ label: 'A', offset: null, size: 1 }, { label: 'B', offset: 0x1010, size: 1 }]);
    expect(r[0].level).toBe('error');
    expect(r[1].level).toBe('warn');
  });
  it('checks expected magic at known offsets', () => {
    const bad = new Uint8Array(16);
    const r = checkLayout([
      { label: 'App', offset: 0x10000, size: 16 },
      { label: 'PT', offset: 0x8000, size: 16 }
    ], [bad, bad]);
    expect(r.filter(x => x.level === 'warn')).toHaveLength(2);
    expect(checkLayout([{ label: 'App', offset: 0x10000, size: 16 }], [hdr()])).toHaveLength(0);
  });
  it('recognises a merged image at 0x0', () => {
    const d = new Uint8Array(0x9000); d[0x8000] = 0xaa; d[0x8001] = 0x50;
    const r = checkLayout([{ label: 'M', offset: 0, size: d.length }], [d]);
    expect(r[0].level).toBe('info');
  });
});

describe('buildEsptoolCommand', () => {
  it('builds a write_flash line and quotes odd names', () => {
    const c = buildEsptoolCommand([
      { offset: 0x1000, name: 'boot.bin' },
      { offset: 0x10000, name: 'my app.bin' }
    ], { baud: 921600, compress: false, port: '/dev/ttyUSB0' });
    expect(c).toBe('esptool.py --port /dev/ttyUSB0 --baud 921600 write_flash --no-compress 0x1000 boot.bin 0x10000 "my app.bin"');
  });
  it('returns empty when nothing to flash', () => {
    expect(buildEsptoolCommand([])).toBe('');
  });
});
