// Pure helpers for the PTP workbench file list: filter, sort, summarise,
// export metadata and build collision-free download names.
import { objectFormatName } from './ptpDriver';

/** Parse a PTP datetime ("20240315T120000" with optional fraction/zone) to a Date, or null. */
export function parsePtpDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

/** Coarse kind of an object for filtering: image, raw, video or other. */
export function objectKind(info) {
  const f = info.objectFormat;
  const name = info.filename || '';
  if ([0x3801, 0x3804, 0x3808, 0x380b, 0x380d, 0x3802, 0x3805, 0x3807, 0x3809, 0x380a, 0x380c].includes(f)) return 'image';
  if (f === 0xb101 || /\.(cr2|cr3|nef|arw|dng|orf|raf|rw2)$/i.test(name)) return 'raw';
  if ([0xb982, 0x300d, 0x3009].includes(f) || /\.(mp4|mov|avi|mts)$/i.test(name)) return 'video';
  return 'other';
}

/** Filter by name substring and kind, then sort. Never mutates the input. */
export function filterObjects(objects, { text = '', kind = 'all', sort = 'camera', desc = false } = {}) {
  const q = text.trim().toLowerCase();
  let out = objects.filter((o) => {
    if (kind !== 'all' && objectKind(o.info) !== kind) return false;
    return !q || (o.info.filename || `#${o.handle}`).toLowerCase().includes(q);
  });
  const key = {
    name: (o) => (o.info.filename || '').toLowerCase(),
    date: (o) => parsePtpDate(o.info.captureDate)?.getTime() ?? 0,
    size: (o) => o.info.compressedSize || 0
  }[sort];
  if (key) out = [...out].sort((a, b) => { const x = key(a); const y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  if (desc) out = [...out].reverse();
  return out;
}

/** Count and total bytes, overall and per kind. */
export function summarize(objects) {
  const byKind = {};
  let bytes = 0;
  for (const o of objects) {
    const k = objectKind(o.info);
    const s = o.info.compressedSize || 0;
    bytes += s;
    byKind[k] = byKind[k] || { count: 0, bytes: 0 };
    byKind[k].count++; byKind[k].bytes += s;
  }
  return { count: objects.length, bytes, byKind };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Metadata listing as CSV text. */
export function objectsToCsv(objects) {
  const head = ['handle', 'filename', 'format', 'size_bytes', 'width', 'height', 'captured', 'modified', 'protected'];
  const rows = objects.map((o) => [
    o.handle, o.info.filename, objectFormatName(o.info.objectFormat), o.info.compressedSize,
    o.info.imagePixWidth || '', o.info.imagePixHeight || '', o.info.captureDate, o.info.modificationDate,
    o.info.protectionStatus === 1 ? 'yes' : 'no'
  ]);
  return `${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Strip characters that are illegal in file names on common systems. */
export function safeFileName(name) {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim();
  return s || 'file';
}

/**
 * Build download names from a template. Tokens: {name} (without extension),
 * {ext}, {date} (YYYYMMDD), {time} (HHMMSS), {n} (1-based, zero padded to 4), {handle}.
 * An empty template keeps the camera's file name. Names that collide get " (2)", " (3)"...
 */
export function buildDownloadNames(objects, template = '') {
  const used = new Map();
  return objects.map((o, i) => {
    const orig = o.info.filename || `object_${o.handle}`;
    let name = orig;
    if (template.trim()) {
      const dot = orig.lastIndexOf('.');
      const base = dot > 0 ? orig.slice(0, dot) : orig;
      const ext = dot > 0 ? orig.slice(dot + 1) : '';
      const d = parsePtpDate(o.info.captureDate);
      const vals = {
        name: base,
        ext,
        date: d ? `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` : 'nodate',
        time: d ? `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` : '000000',
        n: String(i + 1).padStart(4, '0'),
        handle: String(o.handle)
      };
      name = template.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
      if (ext && !/\{ext\}/.test(template) && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) name += `.${ext}`;
    }
    name = safeFileName(name);
    const key = name.toLowerCase();
    const seen = used.get(key) || 0;
    used.set(key, seen + 1);
    if (!seen) return name;
    const dot = name.lastIndexOf('.');
    const [b, e] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    return `${b} (${seen + 1})${e}`;
  });
}
