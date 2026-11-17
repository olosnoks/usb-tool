// Geo helpers for the Warhog/Piglet WiGLE log viewer. Pure functions over the rows
// produced by parseWigle() in pigletToolkit.js:
//   { mac, ssid, auth, seen, ch, freq, rssi, lat, lon, type }
// A row "has a fix" only when lat/lon are finite, in range and not 0,0.

export const WIGLE_HEADER = 'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type';

export function hasFix(r) {
  if (!r) return false;
  const { lat, lon } = r;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

const rssiOf = (r) => (typeof r.rssi === 'number' && isFinite(r.rssi) ? r.rssi : -Infinity);

// One row per MAC, the strongest-RSSI row that has a fix.
export function strongestFixRows(rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (!hasFix(r)) continue;
    const cur = best.get(r.mac);
    if (!cur || rssiOf(r) > rssiOf(cur)) best.set(r.mac, r);
  }
  return [...best.values()];
}

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')   // not representable in XML 1.0
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function rowsToGeoJson(rows) {
  const features = strongestFixRows(rows).map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    properties: { mac: r.mac, ssid: r.ssid, auth: r.auth, firstSeen: r.seen, channel: r.ch, frequency: r.freq, rssi: r.rssi, type: r.type }
  }));
  return { type: 'FeatureCollection', features };
}

export function rowsToKml(rows, name = 'Warhog log') {
  const marks = strongestFixRows(rows).map((r) => {
    const title = r.ssid || r.mac;
    const desc = `MAC ${r.mac}\nType ${r.type}\nSecurity ${r.auth || 'n/a'}\nChannel ${r.ch ?? 'n/a'}\nRSSI ${r.rssi ?? 'n/a'} dBm\nFirst seen ${r.seen || 'n/a'}`;
    return `    <Placemark>\n      <name>${escapeXml(title)}</name>\n      <description>${escapeXml(desc)}</description>\n      <Point><coordinates>${r.lon},${r.lat},0</coordinates></Point>\n    </Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${escapeXml(name)}</name>\n${marks.join('\n')}\n  </Document>\n</kml>\n`;
}

// Merge several parsed logs ({ rows } objects or plain row arrays) into one row per
// MAC: position and signal data of the best-RSSI sighting (a row with a fix wins
// when the strongest one has none), FirstSeen = earliest across all logs.
export function mergeWigleLogs(parsedLogs) {
  const by = new Map();
  for (const log of parsedLogs || []) {
    const rows = Array.isArray(log) ? log : (log && log.rows) || [];
    for (const r of rows) {
      const e = by.get(r.mac);
      if (!e) { by.set(r.mac, { best: r, bestFix: hasFix(r) ? r : null, earliest: r.seen || '' }); continue; }
      if (rssiOf(r) > rssiOf(e.best)) e.best = r;
      if (hasFix(r) && (!e.bestFix || rssiOf(r) > rssiOf(e.bestFix))) e.bestFix = r;
      if (r.seen && (!e.earliest || r.seen < e.earliest)) e.earliest = r.seen;
    }
  }
  const out = [];
  for (const e of by.values()) {
    const row = { ...e.best, seen: e.earliest };
    if (!hasFix(row) && e.bestFix) { row.lat = e.bestFix.lat; row.lon = e.bestFix.lon; }
    out.push(row);
  }
  return out;
}

const csvField = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// WiGLE CSV. The pre-header line is written only when the source file had one
// (pass it as opts.preHeader); no device name is invented. Columns the viewer
// does not parse (altitude, accuracy, RCOIs, MfgrId) are left empty.
export function rowsToWigleCsv(rows, opts = {}) {
  const lines = [];
  if (opts.preHeader) lines.push(opts.preHeader);
  lines.push(WIGLE_HEADER);
  for (const r of rows || []) {
    lines.push([r.mac, r.ssid, r.auth, r.seen, r.ch, r.freq, r.rssi, hasFix(r) ? r.lat : '', hasFix(r) ? r.lon : '', '', '', '', '', r.type]
      .map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---- histograms (arrays of { key, count }, ready to draw) -------------------
const toList = (m, cmp) => [...m.entries()].map(([key, count]) => ({ key, count })).sort(cmp);

export function channelHistogram(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (r.type === 'BLE' || r.ch == null) continue;
    m.set(r.ch, (m.get(r.ch) || 0) + 1);
  }
  return toList(m, (a, b) => a.key - b.key);
}

export function securityClass(auth) {
  const a = String(auth || '').toUpperCase();
  if (/WPA3|SAE/.test(a)) return 'WPA3';
  if (/WPA2|RSN/.test(a)) return 'WPA2';
  if (/WPA/.test(a)) return 'WPA';
  if (/WEP/.test(a)) return 'WEP';
  if (!a.replace(/\[ESS\]|\[IBSS\]|\[|\]/g, '').trim()) return 'Open';
  return 'Other';
}

export function securityHistogram(rows) {
  const order = ['Open', 'WEP', 'WPA', 'WPA2', 'WPA3', 'Other'];
  const m = new Map();
  for (const r of rows || []) {
    if (r.type === 'BLE') continue;
    const k = securityClass(r.auth);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return toList(m, (a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function typeHistogram(rows) {
  let wifi = 0, ble = 0;
  for (const r of rows || []) { if (r.type === 'BLE') ble++; else wifi++; }
  return [{ key: 'Wi-Fi', count: wifi }, { key: 'BLE', count: ble }].filter((x) => x.count > 0);
}

export const MAP_POINT_CAP = 5000;

// Points to plot: strongest fix per MAC, capped (strongest signals kept).
export function mapPoints(rows, cap = MAP_POINT_CAP) {
  const pts = strongestFixRows(rows);
  if (pts.length <= cap) return { points: pts, total: pts.length, capped: false };
  return { points: pts.sort((a, b) => rssiOf(b) - rssiOf(a)).slice(0, cap), total: pts.length, capped: true };
}
