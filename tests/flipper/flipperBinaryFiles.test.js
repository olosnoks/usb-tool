import { describe, it, expect, vi } from 'vitest';
import { FlipperZeroDriver, isPrintableText, mimeForFileName } from '../../src/utils/flipperDriver';

function makeDriver(readBytes) {
  const d = new FlipperZeroDriver();
  d.isConnected = true;
  d.writer = {};
  d.ensureRpcSession = vi.fn(async () => {});
  d.sendRpcRequest = vi.fn(async () => readBytes);
  d.sendRpcMultipart = vi.fn(async () => {});
  return d;
}

const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('Flipper binary-safe files', () => {
  it('readRealFileBytes returns the bytes untouched', async () => {
    const d = makeDriver(allBytes);
    const out = await d.readRealFileBytes('/ext/x.bin');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual(Array.from(allBytes));
  });

  it('readRealFile still shows text as text and binary as hex dump', async () => {
    const text = new TextEncoder().encode('Filetype: Flipper SubGhz\n');
    expect(await makeDriver(text).readRealFile('/ext/a.sub')).toBe('Filetype: Flipper SubGhz\n');
    const hex = await makeDriver(allBytes).readRealFile('/ext/a.bin');
    expect(hex).toMatch(/^0000/);
  });

  it('writeRealFile sends all 256 byte values unchanged across chunks', async () => {
    const d = makeDriver(new Uint8Array(0));
    await d.writeRealFile('/ext/x.bin', allBytes);
    const [, parts] = d.sendRpcMultipart.mock.calls[0];
    expect(parts).toHaveLength(1);
    // the chunk payload (last 256 bytes of the part) equals the input
    const flat = Uint8Array.from(parts[0]);
    expect(Array.from(flat.slice(flat.length - 256))).toEqual(Array.from(allBytes));
  });

  it('isPrintableText scans the whole buffer (late NUL at byte 600)', () => {
    const b = new Uint8Array(1000).fill(65);
    expect(isPrintableText(b)).toBe(true);
    b[600] = 0;
    expect(isPrintableText(b)).toBe(false);
  });

  it('rejects invalid UTF-8 even without control bytes (PNG-like high bytes)', () => {
    expect(isPrintableText(Uint8Array.from([0xff, 0xfe, 0x41]))).toBe(false);
    expect(isPrintableText(new TextEncoder().encode('héllo\n'))).toBe(true);
    expect(isPrintableText(new Uint8Array(0))).toBe(true);
  });

  it('picks MIME by extension', () => {
    expect(mimeForFileName('pic.PNG')).toBe('image/png');
    expect(mimeForFileName('a.sub', true)).toBe('text/plain');
    expect(mimeForFileName('a.fap')).toBe('application/octet-stream');
  });
});
