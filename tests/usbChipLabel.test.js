import { describe, it, expect } from 'vitest';
import { identifyUsbChip, shortChipLabel } from '../src/utils/usbDatabase';

// The Terminal's connect built its tab label from chip.name, a field
// identifyUsbChip() never returns, and threw for every device with a USB ID.
describe('shortChipLabel', () => {
  it('works for every shape identifyUsbChip returns', () => {
    expect(shortChipLabel(identifyUsbChip(0x10c4, 0xea60))).toBe('CP2102');        // exact match
    expect(typeof shortChipLabel(identifyUsbChip(0x303a, 0x1001))).toBe('string'); // Espressif native USB
    expect(shortChipLabel(identifyUsbChip(0x10c4, 0x9999))).toBe('Silicon');       // VID-only match
    expect(shortChipLabel(identifyUsbChip(0xdead, 0xbeef))).toBe('USB');           // unknown vendor
    expect(shortChipLabel(identifyUsbChip(undefined, undefined))).toBe('USB');     // no IDs
    expect(shortChipLabel(null)).toBe('USB');
  });
});
