// Pure helpers for the Serial Bridge capture log.
// Entry shape: { id, time, dir: 'A->B' | 'B->A', deltaMs, hex: 'AA BB', text }

export const byteCount = (entry) => (entry?.hex ? entry.hex.split(' ').filter(Boolean).length : 0);

export function filterLog(log, { query = '', dir = 'both' } = {}) {
  const q = String(query || '').trim();
  const ql = q.toLowerCase();
  const qHex = q.toUpperCase();
  return (log || []).filter((e) => {
    if (dir !== 'both' && e.dir !== dir) return false;
    if (!q) return true;
    return (e.text || '').toLowerCase().includes(ql) || (e.hex || '').includes(qHex);
  });
}

export function computeStats(log) {
  const s = { chunks: 0, bytes: 0, aToB: { chunks: 0, bytes: 0 }, bToA: { chunks: 0, bytes: 0 }, durationMs: 0, bytesPerSec: 0 };
  (log || []).forEach((e) => {
    const n = byteCount(e);
    const side = e.dir === 'A->B' ? s.aToB : s.bToA;
    side.chunks += 1; side.bytes += n;
    s.chunks += 1; s.bytes += n;
    s.durationMs += e.deltaMs || 0;
  });
  s.bytesPerSec = s.durationMs > 0 ? Math.round((s.bytes / s.durationMs) * 1000) : 0;
  return s;
}

const csvCell = (v) => {
  const t = String(v ?? '');
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function logToCsv(log, names = {}) {
  const a = names.a || 'A';
  const b = names.b || 'B';
  const rows = [['time', 'direction', 'from', 'to', 'delta_ms', 'bytes', 'hex', 'text']];
  (log || []).forEach((e) => {
    const fwd = e.dir === 'A->B';
    rows.push([e.time, e.dir, fwd ? a : b, fwd ? b : a, e.deltaMs || 0, byteCount(e), e.hex, e.text]);
  });
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Classic 16-bytes-per-line hex dump of one entry's hex string.
export function hexDump(hex) {
  const bytes = (hex || '').split(' ').filter(Boolean);
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16);
    const ascii = row.map((h) => {
      const c = parseInt(h, 16);
      return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
    }).join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${row.join(' ').padEnd(47, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
}

export function logToText(log, names = {}) {
  const a = names.a || 'A';
  const b = names.b || 'B';
  return (log || []).map((e) => {
    const fwd = e.dir === 'A->B';
    const head = `[${e.time}] ${fwd ? a : b} -> ${fwd ? b : a} (${byteCount(e)} bytes, +${e.deltaMs || 0}ms)`;
    return `${head}\n${hexDump(e.hex)}`;
  }).join('\n\n');
}
