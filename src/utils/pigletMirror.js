// Piglet / WarHog screen mirror stream (firmware ScreenMirror.cpp). WT SCREEN
// ON makes a CYD / W550 stream its display as RLE'd 16x16 tiles:
//
//   WT FBH <id> <w> <h> <tile> <key> 565be     frame header (key=1: full frame)
//   WT FB <tx> <ty> <base64>                  one tile: [run-1][hi][lo]... RGB565 big-endian
//   WT FBE <id> <tiles> <bytes> <more>        frame end
//   WT FBX timeout                            the device stopped (no PING for 20 s)
//
// Pure decoding here; the canvas painting lives in PigletScreenMirror.jsx.
import { b64decode } from './pigletToolkit';

export const isFrameLine = (line) => line.startsWith('WT FB');

export function parseFbh(line) {
  if (!line.startsWith('WT FBH ')) return null;
  const f = line.split(' ');
  const w = +f[3], h = +f[4];
  if (!(w > 0) || !(h > 0)) return null;
  return { id: +f[2] || 0, w, h, tile: +f[5] || 16, key: f[6] === '1', fmt: f[7] || '565be' };
}

export function parseFbe(line) {
  if (!line.startsWith('WT FBE ')) return null;
  const f = line.split(' ');
  return { id: +f[2] || 0, tiles: +f[3] || 0, bytes: +f[4] || 0, more: f[5] === '1' };
}

/** Tile position and its RLE payload; null when the line is malformed. */
export function parseFbTile(line) {
  if (!line.startsWith('WT FB ')) return null;
  const sp1 = line.indexOf(' ', 6), sp2 = line.indexOf(' ', sp1 + 1);
  if (sp1 < 0 || sp2 < 0) return null;
  const tx = +line.slice(6, sp1), ty = +line.slice(sp1 + 1, sp2);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  let bytes;
  try { bytes = b64decode(line.slice(sp2 + 1)); } catch (e) { return null; }
  return { tx, ty, bytes };
}

/**
 * Expand [run-1][hi][lo] RGB565 runs into RGBA for n pixels. `out` may be a
 * reused Uint8ClampedArray of length n*4 (an ImageData's .data).
 */
export function rle565ToRgba(bytes, n, out) {
  const d = out || new Uint8ClampedArray(n * 4);
  let p = 0;
  for (let i = 0; i + 2 < bytes.length && p < n; i += 3) {
    const run = bytes[i] + 1, v = (bytes[i + 1] << 8) | bytes[i + 2];
    const r = (((v >> 11) & 31) * 255 / 31) | 0, g = (((v >> 5) & 63) * 255 / 63) | 0, b = ((v & 31) * 255 / 31) | 0;
    for (let k = 0; k < run && p < n; k++, p++) { const o = p * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
  }
  return d;
}

/**
 * Stateful decoder: feed every "WT FB*" line, get size / tile / frame / stop
 * callbacks plus a running fps and kbps. onTile(x0, y0, w, h, rgba) hands the
 * tile's pixels already clipped to the screen edge.
 */
export class MirrorDecoder {
  constructor({ onSize, onTile, onFrame, onStop, now = () => Date.now() } = {}) {
    this.onSize = onSize || (() => {}); this.onTile = onTile || (() => {});
    this.onFrame = onFrame || (() => {}); this.onStop = onStop || (() => {});
    this.now = now;
    this.w = 0; this.h = 0; this.tile = 16;
    this.frames = 0; this.bytes = 0; this.statT = 0; this.fps = 0; this.kbps = 0;
    this._buf = null;
  }

  setSize(w, h, tile) {
    if (w === this.w && h === this.h && (tile || this.tile) === this.tile) return;
    this.w = w; this.h = h; if (tile) this.tile = tile;
    this._buf = null;
    this.onSize(w, h);
  }

  feed(line) {
    this.bytes += line.length + 1;
    if (line.startsWith('WT FB ')) {
      if (!this.w) return false;
      const t = parseFbTile(line);
      if (!t) return false;
      const x0 = t.tx * this.tile, y0 = t.ty * this.tile;
      const tw = Math.min(this.tile, this.w - x0), th = Math.min(this.tile, this.h - y0);
      if (tw <= 0 || th <= 0) return false;
      const n = tw * th;
      const full = tw === this.tile && th === this.tile;
      if (full && (!this._buf || this._buf.length !== n * 4)) this._buf = new Uint8ClampedArray(n * 4);
      const rgba = rle565ToRgba(t.bytes, n, full ? this._buf : undefined);
      this.onTile(x0, y0, tw, th, rgba);
      return true;
    }
    if (line.startsWith('WT FBH ')) {
      const h = parseFbh(line);
      if (!h) return false;
      this.setSize(h.w, h.h, h.tile);
      return true;
    }
    if (line.startsWith('WT FBE ')) {
      this.frames++;
      const now = this.now();
      if (!this.statT) this.statT = now;
      else if (now - this.statT >= 1000) {
        const dt = (now - this.statT) / 1000;
        this.fps = this.frames / dt; this.kbps = this.bytes / 1024 / dt;
        this.frames = 0; this.bytes = 0; this.statT = now;
      }
      this.onFrame(parseFbe(line));
      return true;
    }
    if (line.startsWith('WT FBX')) { this.onStop(line.slice(6).trim()); return true; }
    return false;
  }
}

/** Map a pointer event on the canvas to device pixels (null when the canvas has no size). */
export function pointerToDevice(rect, clientX, clientY, w, h) {
  if (!rect.width || !rect.height || !w || !h) return null;
  let x = Math.round(((clientX - rect.left) / rect.width) * w);
  let y = Math.round(((clientY - rect.top) / rect.height) * h);
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  return { x, y };
}
