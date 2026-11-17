// Pure helpers for the Alfa Wi-Fi survey: best-signal geotagging, JSON
// export/import and an O(1) packet ring buffer.

export const SURVEY_SCHEMA_VERSION = 1;
export const SURVEY_MAX_BYTES = 25 * 1024 * 1024;
export const SURVEY_MAX_APS = 5000;
export const SURVEY_MAX_CLIENTS = 20000;
/** A new observation must beat the stored best RSSI by this much to move the pin. */
export const FIX_RSSI_MARGIN_DB = 3;

const BSSID_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A usable GPS fix: in-range coordinates, not the (0,0) "no fix" placeholder. */
export function isValidFix(fix) {
  if (!fix || !isNum(fix.latitude) || !isNum(fix.longitude)) return false;
  if (fix.latitude < -90 || fix.latitude > 90 || fix.longitude < -180 || fix.longitude > 180) return false;
  if (fix.latitude === 0 && fix.longitude === 0) return false;
  if (fix.accuracy != null && (!isNum(fix.accuracy) || fix.accuracy < 0)) return false;
  return true;
}

/**
 * Track the position at which an AP was heard strongest.
 * `existing` carries { latitude, longitude, accuracy, altitude, bestRssi } (any may be null).
 * `observation` is { rssi, fix: { latitude, longitude, accuracy, altitude } }.
 * Position moves only when the fix is valid and the new RSSI beats `bestRssi`
 * by at least FIX_RSSI_MARGIN_DB (or nothing is stored yet). `bestRssi` is the
 * RSSI at which the stored position was taken.
 */
export function mergeFix(existing, observation) {
  const cur = {
    latitude: existing?.latitude ?? null,
    longitude: existing?.longitude ?? null,
    accuracy: existing?.accuracy ?? null,
    altitude: existing?.altitude ?? null,
    bestRssi: isNum(existing?.bestRssi) ? existing.bestRssi : null
  };
  const fix = observation?.fix;
  if (!isValidFix(fix)) return cur;
  const rssi = isNum(observation?.rssi) ? observation.rssi : null;
  const hasPos = isNum(cur.latitude) && isNum(cur.longitude);
  let replace = false;
  if (!hasPos) replace = true;
  else if (rssi !== null) replace = cur.bestRssi === null || rssi >= cur.bestRssi + FIX_RSSI_MARGIN_DB;
  if (!replace) return cur;
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy ?? null,
    altitude: fix.altitude ?? null,
    bestRssi: rssi
  };
}

/** Number of APs that have no geotag. */
export function countWithoutFix(devices) {
  return Object.values(devices || {}).filter((d) => !(isNum(d?.latitude) && isNum(d?.longitude))).length;
}

export function buildSurveyExport(devices, clients, meta = {}) {
  return {
    schemaVersion: SURVEY_SCHEMA_VERSION,
    tool: 'skons-usb-tool alfa-wifi-survey',
    exportTimestamp: meta.exportTimestamp || new Date().toISOString(),
    monitorChannel: meta.monitorChannel ?? null,
    accessPoints: devices || {},
    clientStations: clients || {}
  };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Deep-copy plain JSON data, dropping prototype-pollution keys and bounding depth.
function sanitize(value, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!FORBIDDEN_KEYS.has(k)) out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 512);
  return value;
}

function checkRange(obj, key, min, max, label) {
  const v = obj[key];
  if (v == null) return null;
  if (!isNum(v) || v < min || v > max) return `${label} has an invalid ${key}`;
  return null;
}

function validateNode(node, label) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return `${label} is not an object`;
  return (
    checkRange(node, 'rssi', -150, 20, label) ||
    checkRange(node, 'channel', 0, 233, label) ||
    checkRange(node, 'latitude', -90, 90, label) ||
    checkRange(node, 'longitude', -180, 180, label) ||
    checkRange(node, 'accuracy', 0, 1e7, label) ||
    checkRange(node, 'packetCount', 0, 1e12, label) ||
    checkRange(node, 'bestRssi', -150, 20, label)
  );
}

/**
 * Parse and validate a survey JSON (string or object). Never throws.
 * Returns { ok: true, devices, clients, version } or { ok: false, error }.
 */
export function parseSurveyExport(input) {
  let data = input;
  if (typeof input === 'string') {
    if (input.length > SURVEY_MAX_BYTES) return { ok: false, error: 'File is too large to import.' };
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, error: 'Not valid JSON.' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Not a survey export.' };
  const version = data.schemaVersion ?? 0; // exports before versioning have none
  if (!Number.isInteger(version) || version < 0 || version > SURVEY_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported survey schema version ${String(data.schemaVersion)}.` };
  }
  const aps = data.accessPoints;
  const cls = data.clientStations ?? {};
  if (!aps || typeof aps !== 'object' || Array.isArray(aps)) return { ok: false, error: 'Missing accessPoints.' };
  if (typeof cls !== 'object' || Array.isArray(cls) || cls === null) return { ok: false, error: 'Invalid clientStations.' };
  const apKeys = Object.keys(aps);
  const clKeys = Object.keys(cls);
  if (apKeys.length > SURVEY_MAX_APS) return { ok: false, error: `Too many access points (limit ${SURVEY_MAX_APS}).` };
  if (clKeys.length > SURVEY_MAX_CLIENTS) return { ok: false, error: `Too many clients (limit ${SURVEY_MAX_CLIENTS}).` };

  const devices = {};
  for (const key of apKeys) {
    const bssid = String(key).toUpperCase();
    if (!BSSID_RE.test(bssid)) return { ok: false, error: `Invalid BSSID "${String(key).slice(0, 40)}".` };
    const err = validateNode(aps[key], `AP ${bssid}`);
    if (err) return { ok: false, error: err };
    devices[bssid] = { ...sanitize(aps[key]), bssid };
  }
  const clients = {};
  for (const key of clKeys) {
    const mac = String(key).toUpperCase();
    if (!BSSID_RE.test(mac)) return { ok: false, error: `Invalid client MAC "${String(key).slice(0, 40)}".` };
    const err = validateNode(cls[key], `Client ${mac}`);
    if (err) return { ok: false, error: err };
    clients[mac] = { ...sanitize(cls[key]), clientMac: mac };
  }
  return { ok: true, devices, clients, version };
}

/**
 * Merge imported survey nodes into the live maps. Live data wins; the position
 * follows the stronger best-signal observation.
 */
export function mergeSurveyInto(current, imported) {
  const next = { ...(current || {}) };
  let added = 0;
  let updated = 0;
  for (const [id, node] of Object.entries(imported || {})) {
    const have = next[id];
    if (!have) {
      next[id] = node;
      added += 1;
      continue;
    }
    const importedBest = isNum(node.bestRssi) ? node.bestRssi : isNum(node.rssi) ? node.rssi : null;
    const fix = mergeFix(have, {
      rssi: importedBest,
      fix: { latitude: node.latitude, longitude: node.longitude, accuracy: node.accuracy, altitude: node.altitude }
    });
    if (fix.latitude !== have.latitude || fix.longitude !== have.longitude) {
      next[id] = { ...have, ...fix };
      updated += 1;
    }
  }
  return { merged: next, added, updated };
}

/** Fixed-capacity ring: push is O(1), oldest entries are overwritten. */
export function createPacketRing(capacity) {
  const cap = Math.max(1, Math.floor(capacity));
  let buf = new Array(cap);
  let start = 0;
  let size = 0;
  return {
    capacity: cap,
    /** Returns true when an old entry was overwritten. */
    push(item) {
      if (size < cap) {
        buf[(start + size) % cap] = item;
        size += 1;
        return false;
      }
      buf[start] = item;
      start = (start + 1) % cap;
      return true;
    },
    get length() {
      return size;
    },
    toArray() {
      const out = new Array(size);
      for (let i = 0; i < size; i += 1) out[i] = buf[(start + i) % cap];
      return out;
    },
    clear() {
      buf = new Array(cap);
      start = 0;
      size = 0;
    }
  };
}
