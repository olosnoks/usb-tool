// Pure helpers for the HID Inspector's input-report log, byte diffing and device-info export.

/** Indices of bytes that differ between two reports (a longer/shorter report counts the extra bytes as changed). */
export function diffBytes(prev, next) {
  const out = [];
  const n = Math.max(prev ? prev.length : 0, next ? next.length : 0);
  for (let i = 0; i < n; i++) {
    if (!prev || i >= prev.length || i >= next.length || prev[i] !== next[i]) out.push(i);
  }
  return out;
}

/** Keep the newest `max` entries. */
export function trimLog(list, max) {
  return list.length > max ? list.slice(list.length - max) : list;
}

/** Entries matching a report id filter ('' or 'all' = everything) and a case-insensitive hex substring. */
export function filterLog(entries, { reportId = 'all', hex = '' } = {}) {
  const needle = String(hex).toLowerCase().replace(/[^0-9a-f]/g, '');
  return entries.filter((e) => {
    if (reportId !== 'all' && reportId !== '' && e.reportId !== Number(reportId)) return false;
    if (needle && !e.hex.replace(/ /g, '').includes(needle)) return false;
    return true;
  });
}

/** Distinct report ids seen, ascending. */
export function seenReportIds(entries) {
  return [...new Set(entries.map((e) => e.reportId))].sort((a, b) => a - b);
}

/** CSV with a header row: index, time_ms, delta_ms, report_id, length, hex. */
export function logToCsv(entries) {
  const rows = ['index,time_ms,delta_ms,report_id,length,hex'];
  entries.forEach((e, i) => {
    rows.push([i, e.t.toFixed(3), e.delta == null ? '' : e.delta.toFixed(3), e.reportId, e.hex.split(' ').filter(Boolean).length, `"${e.hex}"`].join(','));
  });
  return rows.join('\n') + '\n';
}

/** Plain-text log, one report per line, for pasting into a bug report. */
export function logToText(entries) {
  return entries.map((e) => `${e.t.toFixed(3).padStart(10)} ms  id=${e.reportId}  ${e.hex}`).join('\n');
}

/** JSON snapshot of the device identity and its decoded collections (no live data). */
export function deviceInfoJson(meta, info) {
  const hex4 = (n) => (n == null ? null : n.toString(16).padStart(4, '0'));
  return JSON.stringify({
    vendorId: hex4(meta?.vendorId),
    productId: hex4(meta?.productId),
    productName: meta?.productName || null,
    collections: (info || []).map((c) => ({
      usagePage: c.usagePage,
      usage: c.usage,
      name: c.name,
      reports: ['inputReports', 'outputReports', 'featureReports'].flatMap((kind) => (c[kind] || []).map((r) => ({
        kind: kind.replace('Reports', ''),
        reportId: r.reportId,
        bytes: r.byteLength,
        fields: r.fields.map((f) => ({
          name: f.isConstant ? 'padding' : (f.usages[0]?.name || null),
          bits: f.bitSize,
          count: f.count,
          min: f.logicalMinimum,
          max: f.logicalMaximum
        }))
      })))
    }))
  }, null, 2);
}
