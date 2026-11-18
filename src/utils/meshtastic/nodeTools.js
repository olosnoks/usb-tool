/**
 * Pure helpers for the Meshtastic node table and message list: distance and bearing from
 * your own node, signal rating, filtering, sorting, CSV export and CLI command text.
 * No React, no hardware access.
 */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Great-circle distance in kilometres between two {lat, lon} points. */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 to 360, 0 = north) from a to b. */
export function bearingDeg(a, b) {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function compassPoint(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function formatDistance(km) {
  if (km === null || km === undefined || Number.isNaN(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
}

/**
 * Rough signal label from LoRa SNR in dB. This is a heuristic, not a firmware value:
 * the usable range depends on the modem preset (LongFast decodes down to about -17 dB).
 */
export function signalQuality(snr) {
  if (snr === null || snr === undefined || Number.isNaN(Number(snr))) return null;
  const v = Number(snr);
  if (v >= 0) return 'good';
  if (v >= -10) return 'fair';
  return 'weak';
}

/** Add distanceKm, bearing, compass and signal to summarizeNodes() rows. Does not mutate. */
export function annotateNodes(rows) {
  const me = rows.find((r) => r.isMe && r.position);
  return rows.map((r) => {
    const out = { ...r, distanceKm: null, bearing: null, compass: '', signal: signalQuality(r.snr) };
    if (me && !r.isMe && r.position) {
      out.distanceKm = haversineKm(me.position, r.position);
      out.bearing = bearingDeg(me.position, r.position);
      out.compass = compassPoint(out.bearing);
    }
    return out;
  });
}

/**
 * Filter rows. Options: query (matches name, short name, id, hardware, role),
 * onlyPositioned, onlyDirect (hopsAway === 0), hideMe.
 */
export function filterNodes(rows, { query = '', onlyPositioned = false, onlyDirect = false, hideMe = false } = {}) {
  const q = String(query).trim().toLowerCase();
  return rows.filter((r) => {
    if (onlyPositioned && !r.position) return false;
    if (onlyDirect && r.hopsAway !== 0) return false;
    if (hideMe && r.isMe) return false;
    if (!q) return true;
    return [r.longName, r.shortName, r.id, r.hwName, r.role].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

const SORTERS = {
  lastHeard: (r) => r.lastHeard || 0,
  name: (r) => (r.longName || r.id).toLowerCase(),
  snr: (r) => (r.snr === null || r.snr === undefined ? null : Number(r.snr)),
  battery: (r) => (r.battery === null || r.battery === undefined ? null : Number(r.battery)),
  distance: (r) => (r.distanceKm === undefined ? null : r.distanceKm),
  hops: (r) => (r.hopsAway === null || r.hopsAway === undefined ? null : r.hopsAway),
};
export const NODE_SORT_KEYS = Object.keys(SORTERS);

/** Sort rows by key; missing values always go last. dir is 'asc' or 'desc'. */
export function sortNodes(rows, key = 'lastHeard', dir = 'desc') {
  const get = SORTERS[key] || SORTERS.lastHeard;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return a.num - b.num;
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.num - b.num;
  });
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of annotated node rows, limited to what the table shows. */
export function nodesToCsv(rows) {
  const head = ['id', 'long_name', 'short_name', 'hardware', 'role', 'last_heard_unix', 'snr_db', 'battery', 'hops_away', 'lat', 'lon', 'distance_km', 'bearing_deg'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.longName, r.shortName, r.hwName, r.role, r.lastHeard || '', r.snr, r.battery, r.hopsAway,
      r.position ? r.position.lat.toFixed(6) : '', r.position ? r.position.lon.toFixed(6) : '',
      r.distanceKm === null || r.distanceKm === undefined ? '' : r.distanceKm.toFixed(3),
      r.bearing === null || r.bearing === undefined ? '' : Math.round(r.bearing),
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** Filter messages. scope: 'all' | 'direct' | 'channel:<index>'. */
export function filterMessages(messages, scope = 'all') {
  if (scope === 'all') return messages;
  if (scope === 'direct') return messages.filter((m) => m.direct);
  const m = /^channel:(\d+)$/.exec(scope);
  if (m) {
    const idx = Number(m[1]);
    return messages.filter((x) => !x.direct && x.channel === idx);
  }
  return messages;
}

/** CSV export of the session's messages; `nameOf(num)` resolves a sender label. */
export function messagesToCsv(messages, nameOf = (n) => String(n)) {
  const lines = ['time_iso,direction,from,direct,channel,status,snr_db,text'];
  for (const m of messages) {
    lines.push([
      new Date(m.time).toISOString(), m.direction, nameOf(m.from), m.direct ? 'yes' : 'no', m.channel,
      m.status, m.snr, m.text,
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/**
 * Command lines for the official `meshtastic` Python CLI. The browser tool does not run
 * these; they are text to copy into a terminal that has the CLI installed.
 */
export function cliCommands(nodeId) {
  const id = String(nodeId || '').replace(/[^!0-9a-fA-F]/g, '');
  return {
    traceroute: `meshtastic --traceroute '${id}'`,
    sendDirect: `meshtastic --dest '${id}' --sendtext "hello"`,
    nodes: 'meshtastic --nodes',
    exportConfig: 'meshtastic --export-config > config.yaml',
  };
}
