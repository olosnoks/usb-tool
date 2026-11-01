import { describe, it, expect } from 'vitest';
import { parseFbh, parseFbe, parseFbTile, rle565ToRgba, MirrorDecoder, pointerToDevice, isFrameLine } from '../src/utils/pigletMirror';
import { b64encode } from '../src/utils/pigletToolkit';

// Build a WT FB tile line from solid-colour RGB565 runs.
function tileLine(tx, ty, runs) {
  const bytes = [];
  for (const [count, v] of runs) { bytes.push(count - 1, (v >> 8) & 0xff, v & 0xff); }
  return `WT FB ${tx} ${ty} ${b64encode(new Uint8Array(bytes))}`;
}

describe('pigletMirror', () => {
  it('recognises frame lines', () => {
    expect(isFrameLine('WT FBH 1 240 320 16 1 565be')).toBe(true);
    expect(isFrameLine('WT FB 0 0 AAAA')).toBe(true);
    expect(isFrameLine('WT FBE 1 2 3 0')).toBe(true);
    expect(isFrameLine('WT HELLO fw=1')).toBe(false);
  });

  it('parses header, end and tile lines', () => {
    expect(parseFbh('WT FBH 7 240 320 16 1 565be')).toEqual({ id: 7, w: 240, h: 320, tile: 16, key: true, fmt: '565be' });
    expect(parseFbh('WT FBH 7 0 320 16 0 565be')).toBeNull();     // zero width rejected
    expect(parseFbe('WT FBE 7 12 900 1')).toEqual({ id: 7, tiles: 12, bytes: 900, more: true });
    const t = parseFbTile('WT FB 2 3 ' + b64encode(new Uint8Array([0, 0xff, 0xff])));
    expect(t.tx).toBe(2); expect(t.ty).toBe(3);
    expect(Array.from(t.bytes)).toEqual([0, 0xff, 0xff]);
    expect(parseFbTile('WT FB 2 3 !!!not-base64!!!')).toBeNull();
  });

  it('expands RLE RGB565 runs to RGBA', () => {
    // one red pixel (0xF800) then one blue pixel (0x001F)
    const rgba = rle565ToRgba(new Uint8Array([0, 0xf8, 0x00, 0, 0x00, 0x1f]), 2);
    expect(Array.from(rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it('decodes a frame into tile paints and tracks size', () => {
    const paints = [];
    let size = null, frames = 0, stopped = null;
    const d = new MirrorDecoder({
      onSize: (w, h) => { size = { w, h }; },
      onTile: (x, y, w, h, rgba) => paints.push({ x, y, w, h, first: Array.from(rgba.slice(0, 4)) }),
      onFrame: () => frames++,
      onStop: (why) => { stopped = why; }
    });
    d.feed('WT FBH 1 32 16 16 1 565be');
    expect(size).toEqual({ w: 32, h: 16 });
    d.feed(tileLine(0, 0, [[256, 0xf800]]));         // a full 16x16 red tile (256 px, run capped at 256)
    expect(paints).toHaveLength(1);
    expect(paints[0]).toMatchObject({ x: 0, y: 0, w: 16, h: 16, first: [255, 0, 0, 255] });
    d.feed('WT FBE 1 1 48 0');
    expect(frames).toBe(1);
    d.feed('WT FBX timeout');
    expect(stopped).toBe('timeout');
  });

  it('clips tiles at the screen edge and ignores tiles before a header', () => {
    const paints = [];
    const d = new MirrorDecoder({ onTile: (x, y, w, h) => paints.push({ x, y, w, h }) });
    // no header yet: tile ignored
    expect(d.feed(tileLine(0, 0, [[1, 0]]))).toBe(false);
    d.feed('WT FBH 1 24 24 16 1 565be');              // 24x24 screen, 16px tiles
    d.feed(tileLine(1, 1, [[64, 0x07e0]]));           // tile at (16,16): only 8x8 visible
    expect(paints).toEqual([{ x: 16, y: 16, w: 8, h: 8 }]);
  });

  it('maps pointer coordinates to device pixels', () => {
    const rect = { left: 10, top: 20, width: 240, height: 320 };
    expect(pointerToDevice(rect, 10, 20, 240, 320)).toEqual({ x: 0, y: 0 });
    expect(pointerToDevice(rect, 130, 180, 240, 320)).toEqual({ x: 120, y: 160 });
    // clamped inside the screen
    expect(pointerToDevice(rect, 9999, 9999, 240, 320)).toEqual({ x: 239, y: 319 });
    expect(pointerToDevice({ left: 0, top: 0, width: 0, height: 0 }, 5, 5, 240, 320)).toBeNull();
  });
});
