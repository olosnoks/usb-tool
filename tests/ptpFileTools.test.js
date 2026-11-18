import { describe, it, expect } from 'vitest';
import { parsePtpDate, objectKind, filterObjects, summarize, objectsToCsv, safeFileName, buildDownloadNames } from '../src/utils/ptpFileTools';

const mk = (handle, filename, extra = {}) => ({ handle, info: { filename, objectFormat: 0x3801, compressedSize: 100, captureDate: '20240315T120000', ...extra } });
const list = [
  mk(1, 'B.JPG', { compressedSize: 300, captureDate: '20240101T000000' }),
  mk(2, 'a.mov', { objectFormat: 0xb982, compressedSize: 900 }),
  mk(3, 'c.CR3', { objectFormat: 0x3000 })
];

describe('ptpFileTools', () => {
  it('parses dates', () => {
    expect(parsePtpDate('20240315T120102').getHours()).toBe(12);
    expect(parsePtpDate('')).toBeNull();
  });
  it('classifies kinds', () => {
    expect(objectKind(list[0].info)).toBe('image');
    expect(objectKind(list[1].info)).toBe('video');
    expect(objectKind(list[2].info)).toBe('raw');
  });
  it('filters and sorts without mutating', () => {
    expect(filterObjects(list, { text: 'c.' }).map((o) => o.handle)).toEqual([3]);
    expect(filterObjects(list, { kind: 'video' }).map((o) => o.handle)).toEqual([2]);
    expect(filterObjects(list, { sort: 'name' }).map((o) => o.handle)).toEqual([2, 1, 3]);
    expect(filterObjects(list, { sort: 'size', desc: true }).map((o) => o.handle)).toEqual([2, 1, 3]);
    expect(filterObjects(list, { sort: 'date' })[0].handle).toBe(1);
    expect(list.map((o) => o.handle)).toEqual([1, 2, 3]);
  });
  it('summarises', () => {
    const s = summarize(list);
    expect(s.count).toBe(3);
    expect(s.bytes).toBe(1300);
    expect(s.byKind.video.count).toBe(1);
  });
  it('exports CSV with quoting', () => {
    const csv = objectsToCsv([mk(9, 'we"ird,name.jpg')]);
    expect(csv.split('\r\n')[0]).toMatch(/^handle,filename/);
    expect(csv).toContain('"we""ird,name.jpg"');
  });
  it('sanitises names', () => {
    expect(safeFileName('a/b:c.jpg')).toBe('a_b_c.jpg');
    expect(safeFileName('')).toBe('file');
  });
  it('builds names and dedupes collisions', () => {
    const dup = [mk(1, 'IMG.JPG'), mk(2, 'IMG.JPG')];
    expect(buildDownloadNames(dup)).toEqual(['IMG.JPG', 'IMG (2).JPG']);
    expect(buildDownloadNames(dup, '{date}_{n}')).toEqual(['20240315_0001.JPG', '20240315_0002.JPG']);
    expect(buildDownloadNames([mk(5, 'x.jpg')], '{date}-{time}-{name}.{ext}')).toEqual(['20240315-120000-x.jpg']);
  });
});
