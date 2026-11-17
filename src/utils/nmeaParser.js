/**
 * NMEA 0183 & Wardriving Telemetry Parser
 * Parses GPS strings ($GPGGA, $GPRMC, $GNGGA) and WiFi beacon logs into structured data.
 */

import {
  channelToFrequency,
  isValidFix,
  splitCsvLine,
  splitCsvRecords,
  toEpochMs,
  unneutralizeCsvText
} from './wardrivingExporter';

/**
 * Converts NMEA latitude/longitude coordinate (ddmm.mmmm) to decimal degrees
 * @param {string} rawCoord e.g. "4045.1234"
 * @param {string} direction 'N', 'S', 'E', 'W'
 * @returns {number|null}
 */
export function nmeaToDecimal(rawCoord, direction) {
  if (!rawCoord || !direction) return null;
  const dotIdx = rawCoord.indexOf('.');
  if (dotIdx === -1) return null;

  const degLen = dotIdx - 2;
  const degrees = parseFloat(rawCoord.substring(0, degLen));
  const minutes = parseFloat(rawCoord.substring(degLen));

  if (isNaN(degrees) || isNaN(minutes)) return null;

  let dec = degrees + (minutes / 60);
  if (direction === 'S' || direction === 'W') {
    dec = -dec;
  }
  return Number(dec.toFixed(6));
}

/**
 * Parses NMEA sentence
 * Supports $GPGGA, $GNGGA, $GPRMC, $GNRMC
 * @param {string} line
 * @returns {object|null}
 */
export function parseNmeaSentence(line) {
  if (!line || !line.startsWith('$')) return null;
  const clean = line.trim();
  const asterisk = clean.indexOf('*');
  const body = asterisk !== -1 ? clean.substring(1, asterisk) : clean.substring(1);
  const parts = body.split(',');
  const type = parts[0].toUpperCase();

  // GGA: Global Positioning System Fix Data
  // $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
  if (type.endsWith('GGA')) {
    const rawTime = parts[1];
    const rawLat = parts[2];
    const latDir = parts[3];
    const rawLon = parts[4];
    const lonDir = parts[5];
    const fixQuality = parseInt(parts[6], 10) || 0;
    const satellites = parseInt(parts[7], 10) || 0;
    const hdop = parseFloat(parts[8]) || 1.0;
    const altitude = parseFloat(parts[9]) || 0;

    const lat = nmeaToDecimal(rawLat, latDir);
    const lon = nmeaToDecimal(rawLon, lonDir);

    const fixTypes = ['No Fix', 'GPS Fix (SPS)', 'DGPS Fix', 'PPS Fix', 'RTK Fix', 'Float RTK', 'Dead Reckoning'];
    const fixLabel = fixTypes[fixQuality] || 'Unknown';

    let formattedTime = '';
    if (rawTime && rawTime.length >= 6) {
      formattedTime = `${rawTime.substr(0, 2)}:${rawTime.substr(2, 2)}:${rawTime.substr(4, 2)} UTC`;
    }

    return {
      type: 'GGA',
      valid: lat !== null && lon !== null && fixQuality > 0,
      lat,
      lon,
      altitude,
      satellites,
      hdop,
      fixQuality,
      fixLabel,
      time: formattedTime
    };
  }

  // RMC: Recommended Minimum Specific GPS/TRANSIT Data
  // $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
  if (type.endsWith('RMC')) {
    const rawTime = parts[1];
    const status = parts[2]; // 'A' = Valid, 'V' = Warning
    const rawLat = parts[3];
    const latDir = parts[4];
    const rawLon = parts[5];
    const lonDir = parts[6];
    const speedKnots = parseFloat(parts[7]) || 0;
    const course = parseFloat(parts[8]) || 0; // heading in degrees
    const dateStr = parts[9];

    const lat = nmeaToDecimal(rawLat, latDir);
    const lon = nmeaToDecimal(rawLon, lonDir);
    const speedKmh = Number((speedKnots * 1.852).toFixed(1));
    const speedMph = Number((speedKnots * 1.15078).toFixed(1));

    return {
      type: 'RMC',
      valid: status === 'A' && lat !== null && lon !== null,
      lat,
      lon,
      speedKnots,
      speedKmh,
      speedMph,
      heading: course,
      status: status === 'A' ? 'Active' : 'Void',
      date: dateStr
    };
  }

  return null;
}

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
};
// 0 is how many firmwares write "unknown" for RSSI / channel
const positiveOrNull = (v) => { const n = intOrNull(v); return n && n > 0 ? n : null; };
const rssiOrNull = (v) => { const n = intOrNull(v); return n === null || n === 0 ? null : n; };

/** Position for a row, or nulls: rejects non-finite, out-of-range and 0,0. */
function fixOrNull(rawLat, rawLon) {
  const lat = toNum(rawLat);
  const lon = toNum(rawLon);
  return isValidFix(lat, lon) ? { lat, lon } : { lat: null, lon: null };
}

/** Standard WiGLE columns (name -> default index) for v1.6 (14 cols) and v1.4 (11 cols). */
const WIGLE_V16_INDEX = { mac: 0, ssid: 1, auth: 2, seen: 3, channel: 4, frequency: 5, rssi: 6, lat: 7, lon: 8, alt: 9, acc: 10, type: 13 };
const WIGLE_V14_INDEX = { mac: 0, ssid: 1, auth: 2, seen: 3, channel: 4, rssi: 5, lat: 6, lon: 7, alt: 8, acc: 9, type: 10 };

/** Build a name->index map from a "MAC,SSID,AuthMode,..." header line. */
export function wigleColumnIndex(headerFields) {
  const names = {
    mac: 'mac', ssid: 'ssid', authmode: 'auth', firstseen: 'seen', channel: 'channel', frequency: 'frequency',
    rssi: 'rssi', currentlatitude: 'lat', currentlongitude: 'lon', altitudemeters: 'alt', accuracymeters: 'acc', type: 'type'
  };
  const idx = {};
  headerFields.forEach((h, i) => {
    const k = names[String(h).trim().toLowerCase()];
    if (k && idx[k] === undefined) idx[k] = i;
  });
  return idx.mac === 0 && idx.seen !== undefined ? idx : null;
}

function parseWigleFields(parts, idx) {
  const get = (k) => (idx[k] === undefined ? '' : (parts[idx[k]] ?? '').trim());
  const seenRaw = get('seen');
  const firstSeenTimestamp = toEpochMs(seenRaw);
  const { lat, lon } = fixOrNull(get('lat'), get('lon'));
  const rawAlt = toNum(get('alt'));
  const accuracy = toNum(get('acc'));
  const devType = (get('type') || 'WIFI').toUpperCase();
  const channel = positiveOrNull(get('channel'));
  const frequency = positiveOrNull(get('frequency')) ?? (channel ? channelToFrequency(channel) : null);
  const timePart = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2}:\d{2})/.exec(seenRaw);
  return {
    bssid: get('mac').toUpperCase().replace(/-/g, ':'),
    ssid: unneutralizeCsvText(parts[idx.ssid] ?? '') || '<Hidden SSID>',
    auth: get('auth') || null,
    channel,
    frequency,
    rssi: rssiOrNull(get('rssi')),
    lat,
    lon,
    altitude: lat !== null && rawAlt !== null ? rawAlt : null,
    accuracy: lat !== null && accuracy !== null && accuracy > 0 ? accuracy : null,
    deviceType: devType,
    sourceDevice: idx.frequency !== undefined ? 'warhog-piglet-v16' : 'wigle-v14',
    firstSeenTimestamp,
    seenTime: timePart ? timePart[1] : ''
  };
}

/**
 * Parses wardriving WiFi & BLE beacon logs
 * Matches standard formats from Warhog CYD, Piglet (ESP32-C5/S3),
 * WiGLE CSV v1.4 / v1.6, and ESP32 Marauder output.
 * Unknown RSSI / channel / auth are returned as null (never invented).
 * @param {string} line
 * @param {object} [columns] optional name->index map from {@link wigleColumnIndex}
 * @returns {object|null}
 */
export function parseWardriveLine(line, columns) {
  if (!line || typeof line !== 'string') return null;
  const clean = line.trim();
  if (!clean || clean.startsWith('WigleWifi-') || clean.startsWith('MAC,SSID,')) return null;

  // Pattern 0: JSON telemetry line emitted by Piglet / Warhog CYD builds
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const obj = JSON.parse(clean);
      const bssid = (obj.bssid || obj.mac || obj.BSSID || '').toUpperCase();
      if (/^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/.test(bssid)) {
        const { lat, lon } = fixOrNull(obj.lat ?? obj.latitude, obj.lon ?? obj.longitude);
        const alt = toNum(obj.alt);
        return {
          bssid: bssid.replace(/-/g, ':'),
          ssid: obj.ssid || obj.essid || '<Hidden SSID>',
          rssi: rssiOrNull(obj.rssi),
          channel: positiveOrNull(obj.channel ?? obj.ch),
          frequency: obj.freq || obj.frequency || null,
          auth: obj.auth || obj.encryption || null,
          deviceType: (obj.type || 'WIFI').toUpperCase(),
          sourceDevice: obj.src || obj.device || (obj.mode === 'WARHOG' ? 'warhog-cyd' : 'piglet'),
          lat,
          lon,
          altitude: lat !== null ? alt : null,
          firstSeenTimestamp: Date.now(),
          seenTime: obj.time || new Date().toLocaleTimeString()
        };
      }
    } catch {
      // fall through to regex/CSV parsers
    }
  }

  // Pattern 1: "[WARHOG] / [PIGLET] / [WIFI] BSSID: XX:XX:XX... | SSID: ... | RSSI: -XX | CH: X | AUTH: ..."
  if (clean.includes('BSSID') || clean.includes('bssid')) {
    const bssidMatch = clean.match(/(?:BSSID|bssid)[:= ]\s*([0-9a-fA-F:]{17})/i);
    const ssidMatch = clean.match(/(?:SSID|ssid|ESSID)[:= ]\s*["']?([^"'|,]+)["']?/i);
    const rssiMatch = clean.match(/(?:RSSI|rssi)[:= ]\s*([+-]?\d+)/i);
    const chMatch = clean.match(/(?:CH|channel|Channel)[:= ]\s*(\d+)/i);
    const authMatch = clean.match(/(?:AUTH|auth|ENCR|sec)[:= ]\s*([A-Za-z0-9_\-\/+[\]]+)/i);
    const latMatch = clean.match(/(?:LAT|lat)[:= ]\s*([+-]?\d+\.\d+)/);
    const lonMatch = clean.match(/(?:LON|LNG|lon|lng)[:= ]\s*([+-]?\d+\.\d+)/);
    const gpsPairMatch = clean.match(/GPS[:= ]\s*([+-]?\d+\.\d+)\s*[,/]\s*([+-]?\d+\.\d+)/i);

    if (bssidMatch) {
      const rawLat = latMatch ? latMatch[1] : gpsPairMatch ? gpsPairMatch[1] : null;
      const rawLon = lonMatch ? lonMatch[1] : gpsPairMatch ? gpsPairMatch[2] : null;
      const { lat, lon } = fixOrNull(rawLat, rawLon);
      const isWarhog = /WARHOG|CYD/i.test(clean);
      const isPiglet = /PIGLET/i.test(clean);

      return {
        bssid: bssidMatch[1].toUpperCase(),
        ssid: ssidMatch ? ssidMatch[1].trim() : '<Hidden SSID>',
        rssi: rssiMatch ? rssiOrNull(rssiMatch[1]) : null,
        channel: chMatch ? positiveOrNull(chMatch[1]) : null,
        auth: authMatch ? authMatch[1] : null,
        deviceType: /\bBLE\b/i.test(clean) ? 'BLE' : 'WIFI',
        sourceDevice: isWarhog ? 'warhog-cyd' : isPiglet ? 'piglet' : 'serial',
        lat,
        lon,
        firstSeenTimestamp: Date.now(),
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  // Pattern 2: CSV lines (WiGLE v1.6 14-col from Warhog CYD & Piglet, WiGLE v1.4 11-col, or 5-col simple CSV)
  const parts = splitCsvLine(clean);
  if (parts.length >= 5) {
    const macCandidate = parts[0].trim();
    if (MAC_RE.test(macCandidate)) {
      const col3 = (parts[3] || '').trim();
      const isWigleFormat = /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/.test(col3) && parts.length >= 10;

      if (isWigleFormat) {
        // Header-driven when the file's header line was seen; otherwise by column count.
        const idx = columns || (parts.length >= 13 ? WIGLE_V16_INDEX : WIGLE_V14_INDEX);
        return parseWigleFields(parts, idx);
      }

      // Simple 5-column CSV: MAC,SSID,Auth,Channel,RSSI
      return {
        bssid: macCandidate.toUpperCase().replace(/-/g, ':'),
        ssid: parts[1].trim() || '<Hidden SSID>',
        auth: parts[2].trim() || null,
        channel: positiveOrNull(parts[3]),
        rssi: rssiOrNull(parts[4]),
        deviceType: 'WIFI',
        firstSeenTimestamp: Date.now(),
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  return null;
}

/**
 * Parses a full WiGLE v1.4 / v1.6 CSV file exported from Warhog CYD, Piglet SD
 * card or this app. Quote-aware (commas and newlines inside SSIDs). When a
 * BSSID appears several times the strongest-RSSI row wins (its position is the
 * closest to the AP), and the earliest FirstSeen is kept.
 * @param {string} csvContent
 * @returns {{ metadata: object, aps: Array<object>, track: Array<{lat: number, lon: number}> }}
 */
export function parseWigleCsvFile(csvContent) {
  const result = {
    metadata: { format: 'WigleWifi-1.6', device: 'Unknown', model: 'ESP32' },
    aps: [],
    track: []
  };
  if (!csvContent || typeof csvContent !== 'string') return result;

  const text = csvContent.replace(/^﻿/, '');
  const apMap = new Map();
  let columns = null;

  for (const rawLine of splitCsvRecords(text)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('WigleWifi-')) {
      const tokens = line.split(',');
      result.metadata.format = tokens[0];
      for (const t of tokens.slice(1)) {
        const eq = t.indexOf('=');
        if (eq > 0) {
          const k = t.slice(0, eq).trim();
          const v = t.slice(eq + 1).trim();
          if (k && v) result.metadata[k] = v;
        }
      }
      continue;
    }

    if (/^MAC,/i.test(line)) {
      columns = wigleColumnIndex(splitCsvLine(line));
      continue;
    }

    const parsed = parseWardriveLine(line, columns || undefined);
    if (!parsed) continue;
    const prev = apMap.get(parsed.bssid);
    if (!prev) {
      apMap.set(parsed.bssid, parsed);
    } else {
      const better = (parsed.rssi ?? -Infinity) > (prev.rssi ?? -Infinity) ? parsed : prev;
      const other = better === parsed ? prev : parsed;
      const times = [prev.firstSeenTimestamp, parsed.firstSeenTimestamp].filter((t) => typeof t === 'number');
      const useOtherPos = better.lat === null || better.lat === undefined;
      apMap.set(parsed.bssid, {
        ...better,
        // fill a missing position from the weaker row, never overwrite a real one
        lat: useOtherPos ? other.lat : better.lat,
        lon: useOtherPos ? other.lon : better.lon,
        firstSeenTimestamp: times.length ? Math.min(...times) : null
      });
    }
    if (parsed.lat !== null && parsed.lat !== undefined) {
      const last = result.track[result.track.length - 1];
      if (!last || Math.abs(last.lat - parsed.lat) > 0.00002 || Math.abs(last.lon - parsed.lon) > 0.00002) {
        result.track.push({ lat: parsed.lat, lon: parsed.lon });
      }
    }
  }

  result.aps = Array.from(apMap.values());
  return result;
}
