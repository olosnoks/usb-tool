import { describe, it, expect } from 'vitest';
import { carve, SIGNATURES } from '../src/utils/carve';
import { memoryReader } from '../src/utils/diskImage';

const enc = (s) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const be16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const fill = (n, v) => new Array(n).fill(v);

// --- file builders -----------------------------------------------------------

function jpeg() {
  const thumb = [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x11, 0x11, 0xff, 0xd9]; // an embedded Exif thumbnail with its own EOI
  const app1 = [...enc('Exif\0\0'), ...thumb];
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xe1, ...be16(app1.length + 2), ...app1,
    0xff, 0xdb, ...be16(4), 0x22, 0x22,
    0xff, 0xda, ...be16(6), 0x33, 0x33, 0x33, 0x33,
    ...fill(300, 0x11), 0xff, 0x00, ...fill(50, 0x12), 0xff, 0xd0, ...fill(50, 0x13), // scan data with stuffing and a restart marker
    0xff, 0xd9
  ]);
}
const pngChunk = (type, data) => [...be32(data.length), ...enc(type), ...data, 0, 0, 0, 0];
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pngChunk('IHDR', fill(13, 1)), ...pngChunk('IDAT', fill(700, 0x55)), ...pngChunk('IEND', [])]);
const gif = () => Uint8Array.from([...enc('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, ...fill(6, 0x44), 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 3, 1, 2, 3, 0, 0x3b]);
const pdfText = (s) => Uint8Array.from(enc(s));
const pdf = () => pdfText('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n');
const pdfUpdated = () => pdfText('%PDF-1.4\n1 0 obj\n<<>>\nendobj\nxref\n0 1\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n2 0 obj\n<<>>\nendobj\nxref\n0 1\ntrailer\n<<>>\nstartxref\n99\n%%EOF');
function zip(entryName, body = 'hello') {
  const name = enc(entryName);
  const data = enc(body);
  const local = [...enc('PK\x03\x04'), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...name, ...data];
  const central = [...enc('PK\x01\x02'), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...name];
  const end = [...enc('PK\x05\x06'), 0, 0, 0, 0, ...le16(1), ...le16(1), ...le32(central.length), ...le32(local.length), ...le16(0)];
  return Uint8Array.from([...local, ...central, ...end]);
}
function sqlite() {
  const b = new Uint8Array(4096 * 3);
  b.set(enc('SQLite format 3\0'));
  b.set(be16(4096), 16); b.set(be32(3), 28);
  b.fill(0x20, 100, 200);
  return b;
}
const box = (type, size, v = 0) => [...be32(size), ...enc(type), ...fill(size - 8, v)];
const mp4 = () => Uint8Array.from([...box('ftyp', 24, 0x41), ...box('moov', 40, 0x42), ...box('mdat', 100, 0x43)]);

/** Lay files out at sector-aligned offsets in a junk-filled image. */
function buildImage(items, sectors = 400) {
  const img = new Uint8Array(sectors * 512).map((_, i) => (i * 31 + 7) & 0x7f);
  const placed = [];
  let sector = 3;
  for (const f of items) {
    img.set(f.data, sector * 512);
    placed.push({ ...f, offset: sector * 512 });
    sector += Math.ceil(f.data.length / 512) + 2;
  }
  return { img, placed };
}

describe('file carving', () => {
  it('finds every planted file with the right offset, length and type', async () => {
    const items = [
      { id: 'jpeg', data: jpeg() }, { id: 'png', data: png() }, { id: 'gif', data: gif() }, { id: 'pdf', data: pdf() },
      { id: 'zip', data: zip('word/document.xml'), ext: 'docx' }, { id: 'sqlite', data: sqlite() }, { id: 'mp4', data: mp4() }
    ];
    const { img, placed } = buildImage(items, 120);
    const res = await carve(memoryReader(img), img.length);
    // the PDF's trailing newline after %%EOF is not part of the carved file
    expect(res.files.map((f) => [f.type, f.offset, f.length])).toEqual(placed.map((p) => [p.id, p.offset, p.data.length - (p.id === 'pdf' ? 1 : 0)]));
    expect(res.files.find((f) => f.type === 'zip').ext).toBe('docx');
    const jpg = res.files[0];
    expect(Array.from(img.subarray(jpg.offset, jpg.offset + jpg.length))).toEqual(Array.from(items[0].data));
    expect(res.scannedBytes).toBe(img.length);
  });

  it('is not fooled by the thumbnail inside a JPEG (walks segments, not the first FFD9)', async () => {
    const j = jpeg();
    const { img } = buildImage([{ id: 'jpeg', data: j }], 40);
    const res = await carve(memoryReader(img), img.length, { types: ['jpeg'] });
    expect(res.files).toHaveLength(1);
    expect(res.files[0].length).toBe(j.length);
  });

  it('follows PDF incremental updates to the last %%EOF', async () => {
    const p = pdfUpdated();
    const { img } = buildImage([{ id: 'pdf', data: p }], 40);
    const res = await carve(memoryReader(img), img.length, { types: ['pdf'] });
    expect(res.files).toHaveLength(1);
    expect(res.files[0].length).toBe(p.length);
  });

  it('ignores signatures that are not on a sector boundary, unless align is 1', async () => {
    const img = new Uint8Array(40 * 512).map((_, i) => (i * 31 + 7) & 0x7f);
    img.set(png(), 5 * 512 + 100);
    expect((await carve(memoryReader(img), img.length)).files).toHaveLength(0);
    const loose = await carve(memoryReader(img), img.length, { align: 1 });
    expect(loose.files.map((f) => [f.type, f.offset])).toEqual([['png', 5 * 512 + 100]]);
  });

  it('drops files whose end is missing, or keeps them flagged when asked', async () => {
    const j = jpeg();
    const img = new Uint8Array(20 * 512).map((_, i) => (i * 31 + 7) & 0x7f);
    img.set(j.subarray(0, 200), 4 * 512); // cut short, followed by junk
    expect((await carve(memoryReader(img), img.length)).files).toHaveLength(0);
    const kept = await carve(memoryReader(img), img.length, { includeUnterminated: true, types: ['jpeg'] });
    expect(kept.files[0]).toMatchObject({ type: 'jpeg', offset: 4 * 512, truncated: true });
  });

  it('only scans the given ranges (unallocated space) and reports progress / cancel', async () => {
    const { img, placed } = buildImage([{ id: 'png', data: png() }, { id: 'gif', data: gif() }], 60);
    const gifAt = placed[1].offset;
    const only = await carve(memoryReader(img), img.length, { ranges: [{ start: gifAt - 512, length: 4096 }] });
    expect(only.files.map((f) => f.type)).toEqual(['gif']);
    expect(only.scannedBytes).toBe(4096);

    let calls = 0;
    const seen = [];
    const cancelled = await carve(memoryReader(img), img.length, { chunkBytes: 4096, onProgress: (p) => seen.push(p.done), shouldCancel: () => ++calls > 2 });
    expect(cancelled.cancelled).toBe(true);
    expect(seen.length).toBe(2);
  });

  it('ships a signature for each advertised format', () => {
    expect(SIGNATURES.map((s) => s.id).sort()).toEqual(['gif', 'jpeg', 'mp4', 'pdf', 'png', 'sqlite', 'zip']);
  });
});
