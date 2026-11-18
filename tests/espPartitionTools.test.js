import { describe, it, expect } from 'vitest';
import { buildPreset, fillToEnd, layoutStats, lintLayout, buildSnippets, PRESETS } from '../src/utils/espPartitionTools.js';
import { resolveOffsets, validateRows, TYPE_APP, TYPE_DATA } from '../src/utils/espNvs/partitionTable.js';

describe('presets', () => {
  for (const flash of [0x400000, 0x800000, 0x1000000]) {
    for (const p of PRESETS) {
      it(`${p.id} on ${flash / 0x100000} MiB validates with no errors`, () => {
        const rows = resolveOffsets(buildPreset(p.id, flash));
        const errs = validateRows(rows, { flashSize: flash }).filter((i) => i.severity === 'error');
        expect(errs).toEqual([]);
        expect(lintLayout(rows).filter((m) => !m.includes('phy_init'))).toEqual([]);
      });
    }
  }
  it('ota-fs filesystem ends exactly at the end of flash', () => {
    const rows = resolveOffsets(buildPreset('ota-fs', 0x400000));
    const fs = rows[rows.length - 1];
    expect(fs.name).toBe('spiffs');
    expect(fs.offset + fs.size).toBe(0x400000);
  });
  it('rejects tiny flash and unknown presets', () => {
    expect(() => buildPreset('nope', 0x400000)).toThrow();
    expect(() => buildPreset('ota', 0x80000)).toThrow();
  });
});

describe('fillToEnd', () => {
  it('stretches the last partition to the end', () => {
    const rows = resolveOffsets(buildPreset('single', 0x400000));
    const r = fillToEnd(rows, 0x400000);
    expect(r.name).toBe('factory');
    const again = resolveOffsets(r.rows);
    expect(again[2].offset + again[2].size).toBe(0x400000);
  });
});

describe('layoutStats', () => {
  it('counts app, data and free', () => {
    const rows = resolveOffsets(buildPreset('single', 0x400000));
    const s = layoutStats(rows, 0x400000);
    expect(s.app).toBe(0x100000);
    expect(s.data).toBe(0x7000);
    expect(s.free).toBe(0x400000 - 0x9000 - 0x100000 - 0x7000);
    expect(s.tail).toBe(0x400000 - s.highest);
  });
});

describe('lintLayout', () => {
  const mk = (name, type, subtype, size) => ({ name, type, subtype, offset: 0x10000, size });
  it('flags OTA without otadata and single slot', () => {
    const w = lintLayout([mk('nvs', TYPE_DATA, 2, 0x6000), mk('ota_0', TYPE_APP, 0x10, 0x100000)]);
    expect(w.some((m) => m.includes('no otadata'))).toBe(true);
    expect(w.some((m) => m.includes('Only one OTA slot'))).toBe(true);
  });
  it('flags unequal slots and odd otadata size', () => {
    const w = lintLayout([mk('nvs', TYPE_DATA, 2, 0x6000), mk('otadata', TYPE_DATA, 0, 0x1000), mk('a', TYPE_APP, 0x10, 0x100000), mk('b', TYPE_APP, 0x11, 0x200000)]);
    expect(w.some((m) => m.includes('different sizes'))).toBe(true);
    expect(w.some((m) => m.includes('0x2000'))).toBe(true);
  });
});

describe('buildSnippets', () => {
  it('includes the filename and flash size', () => {
    const s = buildSnippets('my.csv', 0x400000);
    expect(s.platformio).toContain('board_build.partitions = my.csv');
    expect(s.platformio).toContain('4MB');
    expect(s.sdkconfig).toContain('CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y');
    expect(s.gen).toContain('--verify my.csv');
  });
});
