/**
 * Wardriving WiGLE CSV writer and shared helpers (the one implementation).
 *
 * Writes WigleWifi-1.6 files (14 columns). Rules:
 *  - FirstSeen is a real UTC time (YYYY-MM-DD HH:MM:SS) built from the device's
 *    first observation, never "now" unless nothing better is known.
 *  - Fields that are unknown (RSSI, channel, altitude, accuracy) are left empty,
 *    never filled with invented values.
 *  - Rows without a valid GPS fix are skipped by default (no 0,0 positions).
 *  - SSIDs are CSV-escaped and neutralised against spreadsheet formula injection.
 */

export const WIGLE_COLUMNS_V16 =
  'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type';

/**
 * Format security type into Wigle AuthMode tag syntax.
 * Accepts the app's labels (Open, WEP, WPA, WPA2, WPA3, "WPA2/WPA3 Mixed",
 * "WPA/WPA2", WPA2-EAP, WPA3-SAE, OWE) and already-formatted "[...]" strings.
 * Returns '' when the security is unknown (nothing is invented).
 * @param {string} security
 * @returns {string}
 */
export function formatWigleAuth(security) {
  if (security === null || security === undefined) return '';
  const raw = String(security).trim();
  if (!raw) return '';
  if (raw.startsWith('[')) return raw; // already WiGLE syntax (e.g. re-exported import)
  const s = raw.toUpperCase();
  const eap = /EAP|ENTERPRISE|802\.1X/.test(s);
  const tags = [];
  if (/WPA(?![23])/.test(s)) tags.push(eap ? '[WPA-EAP-TKIP]' : '[WPA-PSK-TKIP]');
  if (/WPA2/.test(s)) tags.push(eap ? '[WPA2-EAP-CCMP]' : '[WPA2-PSK-CCMP]');
  if (/WPA3|SAE/.test(s)) tags.push(eap ? '[WPA3-EAP-CCMP]' : '[WPA3-SAE-CCMP]');
  if (/OWE/.test(s)) tags.push('[OWE-CCMP]');
  if (/WEP/.test(s)) tags.push('[WEP]');
  return tags.join('') + '[ESS]';
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatUtc(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

/**
 * Convert many timestamp shapes to epoch milliseconds (UTC), or null.
 * Numbers below 1e11 are treated as epoch seconds. "YYYY-MM-DD HH:MM:SS"
 * without a zone is read as UTC (the WiGLE convention). A bare "HH:MM:SS"
 * is combined with today's UTC date (legacy fallback).
 */
export function toEpochMs(ts, nowMs = Date.now()) {
  if (ts === null || ts === undefined || ts === '') return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.getTime();
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return ts < 1e11 ? ts * 1000 : ts;
  }
  if (typeof ts !== 'string') return null;
  const s = ts.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[1] === '0000' || m[1] < '1971') return null; // WiGLE logs write 1970/0000 when the clock was unset
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || 'Z'}`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }
  m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (m) {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Format timestamp into UTC YYYY-MM-DD HH:MM:SS as required by Wigle.
 * An unusable input falls back to the current time.
 * @param {string|number|Date} ts
 * @returns {string}
 */
export function formatWigleTimestamp(ts) {
  const ms = toEpochMs(ts);
  return formatUtc(new Date(ms ?? Date.now()));
}

/** First observation of a device as epoch ms: firstSeenTimestamp, then firstSeen/timestamp/lastSeen. */
export function resolveFirstSeenMs(ap, nowMs = Date.now()) {
  for (const v of [ap.firstSeenTimestamp, ap.firstSeen, ap.timestamp, ap.lastSeenTimestamp, ap.lastSeen]) {
    const ms = toEpochMs(v, nowMs);
    if (ms !== null) return ms;
  }
  return null;
}

/** True for a finite, in-range position that is not the 0,0 "null island" placeholder. */
export function isValidFix(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined || lat === '' || lon === '') return false;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return false;
  if (la === 0 && lo === 0) return false;
  return true;
}

/** Wi-Fi channel to centre frequency in MHz, or null when unknown. */
export function channelToFrequency(channel) {
  const ch = Number(channel);
  if (!Number.isInteger(ch) || ch <= 0) return null;
  if (ch === 14) return 2484;
  if (ch <= 13) return 2407 + ch * 5;
  if (ch >= 36 && ch <= 177) return 5000 + ch * 5;
  return null;
}

const FORMULA_START = /^[=+\-@]/;

/**
 * Escape a CSV field. With `neutralize`, a leading = + - @ is prefixed with an
 * apostrophe so spreadsheets do not execute it (parseWigleCsvFile undoes this).
 */
export function escapeCsv(val, { neutralize = false } = {}) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (neutralize && FORMULA_START.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Undo the formula-neutralising apostrophe added by escapeCsv. */
export function unneutralizeCsvText(str) {
  return typeof str === 'string' && /^'[=+\-@]/.test(str) ? str.slice(1) : str;
}

/** Split one CSV record into fields, honouring double quotes and "" escapes. */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Split CSV text into records on newlines that are not inside quotes. */
export function splitCsvRecords(text) {
  const records = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (!q && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      records.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) records.push(cur);
  return records;
}

/**
 * Calculate distance between two lat/lon coordinates in meters using the Haversine formula.
 * @returns {number|null} Distance in meters (integer), or null if invalid
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined ||
      lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) {
    return null;
  }
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) {
    return null;
  }

  const R = 6371000; // Earth's mean radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtCoord = (n) => String(Number(Number(n).toFixed(7)));

/**
 * Convert access points (object map or array) into a WigleWifi-1.6 CSV.
 * @param {Object|Array} devices
 * @param {{includeUnfixed?: boolean, device?: string, now?: number}} [opts]
 * @returns {{csv: string, written: number, skippedNoFix: number}}
 */
export function exportWigleCsvDetailed(devices, opts = {}) {
  const { includeUnfixed = false, device = 'Browser', now = Date.now() } = opts;
  const safeDevice = String(device).replace(/[,\r\n]/g, ' ');
  const preHeader = `WigleWifi-1.6,appRelease=SkonUsbTool,model=WebUSB,release=1.0,device=${safeDevice},display=Web,board=JS,brand=Skon`;

  const list = !devices ? [] : Array.isArray(devices) ? devices : Object.values(devices);
  const rows = [preHeader, WIGLE_COLUMNS_V16];
  let written = 0;
  let skippedNoFix = 0;

  for (const ap of list) {
    if (!ap || !ap.bssid) continue;
    const mac = String(ap.bssid).toUpperCase();
    if (mac === 'FF:FF:FF:FF:FF:FF' || mac === '00:00:00:00:00:00') continue;

    const lat = ap.latitude ?? ap.lat;
    const lon = ap.longitude ?? ap.lon;
    const fixed = isValidFix(lat, lon);
    if (!fixed && !includeUnfixed) {
      skippedNoFix++;
      continue;
    }

    const isBle = String(ap.deviceType || ap.type || '').toUpperCase() === 'BLE';
    const ssid = ap.ssid === '<Hidden SSID>' ? '' : (ap.ssid || '');
    const auth = isBle ? '' : formatWigleAuth(ap.security ?? ap.auth);
    const firstSeenMs = resolveFirstSeenMs(ap, now);
    const firstSeen = formatUtc(new Date(firstSeenMs ?? now));

    const channel = isBle ? null : num(ap.channel);
    const freq = isBle ? null : (num(ap.frequency) ?? channelToFrequency(channel));
    const rssi = num(ap.rssi);
    const alt = num(ap.altitude);
    const acc = num(ap.accuracy);

    rows.push([
      escapeCsv(mac),
      escapeCsv(ssid, { neutralize: true }),
      escapeCsv(auth),
      firstSeen,
      channel !== null && channel > 0 ? String(Math.round(channel)) : '',
      freq !== null && freq > 0 ? String(Math.round(freq)) : '',
      rssi !== null && rssi !== 0 ? String(Math.round(rssi)) : '',
      fixed ? fmtCoord(lat) : '',
      fixed ? fmtCoord(lon) : '',
      fixed && alt !== null ? String(Math.round(alt)) : '',
      fixed && acc !== null && acc > 0 ? String(Math.round(acc)) : '',
      '',
      '',
      isBle ? 'BLE' : 'WIFI'
    ].join(','));
    written++;
  }

  return { csv: rows.join('\r\n') + '\r\n', written, skippedNoFix };
}

/**
 * Convert access points into a WigleWifi-1.6 CSV string.
 * @param {Object|Array} devices
 * @param {{includeUnfixed?: boolean, device?: string, now?: number}} [opts]
 * @returns {string}
 */
export function exportWigleCsv(devices, opts) {
  return exportWigleCsvDetailed(devices, opts).csv;
}

/**
 * Trigger browser download of Wigle CSV file.
 * @param {Object|Array} devices
 * @param {string} [filename]
 * @param {object} [opts] passed to exportWigleCsvDetailed
 * @returns {{written: number, skippedNoFix: number}}
 */
export function downloadWigleCsv(devices, filename, opts) {
  const { csv, written, skippedNoFix } = exportWigleCsvDetailed(devices, opts);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `wigle_wifi_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { written, skippedNoFix };
}
