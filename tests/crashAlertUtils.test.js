import { describe, it, expect } from 'vitest';
import {
  PATTERN_PRESETS, mergePatterns, extractAddresses, buildAddr2line,
  extractExceptionCause, shouldAct, formatLogText, formatLogJson
} from '../src/utils/crashAlertUtils.js';
import { compilePattern } from '../src/components/CrashAlertDeck.jsx';

const DUMP = `Guru Meditation Error: Core 0 panic'ed (LoadProhibited). Exception was unhandled.
PC      : 0x400d1820  PS      : 0x00060030  A0      : 0x800d195c  A1      : 0x3ffb1d90
EXCVADDR: 0x00000000
Backtrace: 0x400d1820:0x3ffb1d90 0x400d1959:0x3ffb1db0`;

describe('crashAlertUtils', () => {
  it('extracts code addresses, dedupes, ignores NULL and stack halves', () => {
    expect(extractAddresses(DUMP)).toEqual(['0x400d1820', '0x800d195c', '0x400d1959']);
    expect(extractAddresses('EXCVADDR: 0x00000000')).toEqual([]);
    expect(extractAddresses('')).toEqual([]);
  });
  it('builds an addr2line command and quotes odd paths', () => {
    expect(buildAddr2line(['0x400d1820'], { toolchain: 'esp32', elf: 'build/a.elf' }))
      .toBe('xtensa-esp32-elf-addr2line -pfiaC -e build/a.elf 0x400d1820');
    expect(buildAddr2line(['0x1000'], { toolchain: 'arm', elf: 'my fw.elf' })).toContain('"my fw.elf"');
    expect(buildAddr2line(['0x1000'], { toolchain: 'generic', elf: 'a".elf`x`$y' })).toBe('addr2line -pfiaC -e "a.elfxy" 0x1000');
  });
  it('reads the exception cause', () => {
    expect(extractExceptionCause(DUMP)).toBe('LoadProhibited');
    expect(extractExceptionCause('nothing')).toBe('');
  });
  it('applies the cooldown', () => {
    expect(shouldAct(null, 1000, 5)).toBe(true);
    expect(shouldAct(1000, 3000, 5)).toBe(false);
    expect(shouldAct(1000, 6000, 5)).toBe(true);
    expect(shouldAct(1000, 1001, 0)).toBe(true);
  });
  it('merges presets without duplicates and every preset pattern compiles cleanly', () => {
    expect(mergePatterns(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    for (const list of Object.values(PATTERN_PRESETS)) {
      for (const p of list) expect(compilePattern(p).invalid).toBe(false);
    }
  });
  it('exports the log', () => {
    const h = [{ id: 'x', time: '10:00:00.000', signature: 'HardFault', snippet: 'boom' }];
    expect(formatLogText(h)).toContain('=== 10:00:00.000  HardFault ===\nboom');
    expect(JSON.parse(formatLogJson(h))).toEqual([{ time: '10:00:00.000', signature: 'HardFault', snippet: 'boom' }]);
    expect(formatLogText([])).toBe('');
  });
});
