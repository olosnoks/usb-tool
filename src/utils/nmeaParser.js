/**
 * NMEA 0183 & Wardriving Telemetry Parser
 * Parses GPS strings ($GPGGA, $GPRMC, $GNGGA) and WiFi beacon logs into structured data.
 */

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

/**
 * Parses wardriving WiFi & BLE beacon logs
 * Matches standard formats from Warhog CYD, Piglet (ESP32-C5/S3),
 * WiGLE CSV v1.4 / v1.6, and ESP32 Marauder output.
 * @param {string} line
 * @returns {object|null}
 */
export function parseWardriveLine(line) {
  if (!line || typeof line !== 'string') return null;
  const clean = line.trim();
  if (!clean || clean.startsWith('WigleWifi-') || clean.startsWith('MAC,SSID,')) return null;

  // Pattern 0: JSON telemetry line emitted by Piglet / Warhog CYD builds
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const obj = JSON.parse(clean);
      const bssid = (obj.bssid || obj.mac || obj.BSSID || '').toUpperCase();
      if (/^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/.test(bssid)) {
        const lat = obj.lat !== undefined ? parseFloat(obj.lat) : obj.latitude !== undefined ? parseFloat(obj.latitude) : null;
        const lon = obj.lon !== undefined ? parseFloat(obj.lon) : obj.longitude !== undefined ? parseFloat(obj.longitude) : null;
        return {
          bssid: bssid.replace(/-/g, ':'),
          ssid: obj.ssid || obj.essid || '<Hidden SSID>',
          rssi: parseInt(obj.rssi ?? -70, 10),
          channel: parseInt(obj.channel ?? obj.ch ?? 1, 10),
          frequency: obj.freq || obj.frequency || null,
          auth: obj.auth || obj.encryption || 'WPA2',
          deviceType: (obj.type || 'WIFI').toUpperCase(),
          sourceDevice: obj.src || obj.device || (obj.mode === 'WARHOG' ? 'warhog-cyd' : 'piglet'),
          lat: !Number.isNaN(lat) && lat !== 0 ? lat : null,
          lon: !Number.isNaN(lon) && lon !== 0 ? lon : null,
          altitude: obj.alt !== undefined ? parseFloat(obj.alt) : null,
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
      const lat = latMatch ? parseFloat(latMatch[1]) : gpsPairMatch ? parseFloat(gpsPairMatch[1]) : null;
      const lon = lonMatch ? parseFloat(lonMatch[1]) : gpsPairMatch ? parseFloat(gpsPairMatch[2]) : null;
      const isWarhog = /WARHOG|CYD/i.test(clean);
      const isPiglet = /PIGLET/i.test(clean);

      return {
        bssid: bssidMatch[1].toUpperCase(),
        ssid: ssidMatch ? ssidMatch[1].trim() : '<Hidden SSID>',
        rssi: rssiMatch ? parseInt(rssiMatch[1], 10) : -70,
        channel: chMatch ? parseInt(chMatch[1], 10) : 1,
        auth: authMatch ? authMatch[1] : 'WPA2/WPA3',
        deviceType: /\bBLE\b/i.test(clean) ? 'BLE' : 'WIFI',
        sourceDevice: isWarhog ? 'warhog-cyd' : isPiglet ? 'piglet' : 'serial',
        lat: lat && !Number.isNaN(lat) ? lat : null,
        lon: lon && !Number.isNaN(lon) ? lon : null,
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  // Pattern 2: CSV lines (WiGLE v1.6 14-col from Warhog CYD & Piglet, WiGLE v1.4 11-col, or 5-col simple CSV)
  const parts = clean.split(',');
  if (parts.length >= 5) {
    const macCandidate = parts[0].trim().replace(/^"|"$/g, '');
    if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(macCandidate)) {
      const stripQuotes = (s) => (s || '').trim().replace(/^"|"$/g, '');

      // Check if parts[3] looks like a timestamp (YYYY-MM-DD or ISO8601) -> WiGLE CSV v1.4 or v1.6
      const col3 = stripQuotes(parts[3]);
      const isWigleFormat = /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/.test(col3) && parts.length >= 10;

      if (isWigleFormat) {
        // WiGLE v1.6 has 14 columns: MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type
        // WiGLE v1.4 has 11 columns: MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type
        const isV16 = parts.length >= 13 && parseInt(parts[5], 10) > 1000;
        const channel = parseInt(parts[4], 10) || 1;
        const frequency = isV16 ? parseInt(parts[5], 10) || null : null;
        const rssi = parseInt(parts[isV16 ? 6 : 5], 10) || -70;
        const rawLat = parseFloat(parts[isV16 ? 7 : 6]);
        const rawLon = parseFloat(parts[isV16 ? 8 : 7]);
        const rawAlt = parseFloat(parts[isV16 ? 9 : 8]);
        const devType = stripQuotes(parts[isV16 ? 13 : 10]) || 'WIFI';

        return {
          bssid: macCandidate.toUpperCase().replace(/-/g, ':'),
          ssid: stripQuotes(parts[1]) || '<Hidden SSID>',
          auth: stripQuotes(parts[2]) || 'OPEN',
          channel,
          frequency,
          rssi,
          lat: !Number.isNaN(rawLat) && rawLat !== 0 ? rawLat : null,
          lon: !Number.isNaN(rawLon) && rawLon !== 0 ? rawLon : null,
          altitude: !Number.isNaN(rawAlt) ? rawAlt : null,
          deviceType: devType.toUpperCase(),
          sourceDevice: isV16 ? 'warhog-piglet-v16' : 'wigle-v14',
          seenTime: col3.split(/[ T]/)[1] || new Date().toLocaleTimeString()
        };
      }

      // Simple 5-column CSV: MAC,SSID,Auth,Channel,RSSI
      return {
        bssid: macCandidate.toUpperCase().replace(/-/g, ':'),
        ssid: stripQuotes(parts[1]) || '<Hidden SSID>',
        auth: stripQuotes(parts[2]) || 'WPA2',
        channel: parseInt(parts[3], 10) || 1,
        rssi: parseInt(parts[4], 10) || -70,
        deviceType: 'WIFI',
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  return null;
}

/**
 * Parses a full WiGLE v1.4 / v1.6 CSV file exported from Warhog CYD or Piglet SD card
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

  const lines = csvContent.split(/\r?\n/);
  const apMap = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('WigleWifi-')) {
      const tokens = line.split(',');
      result.metadata.format = tokens[0];
      for (const t of tokens.slice(1)) {
        const [k, v] = t.split('=');
        if (k && v) result.metadata[k.trim()] = v.trim();
      }
      continue;
    }

    const parsed = parseWardriveLine(line);
    if (parsed) {
      apMap.set(parsed.bssid, parsed);
      if (parsed.lat && parsed.lon) {
        const last = result.track[result.track.length - 1];
        if (!last || Math.abs(last.lat - parsed.lat) > 0.00002 || Math.abs(last.lon - parsed.lon) > 0.00002) {
          result.track.push({ lat: parsed.lat, lon: parsed.lon });
        }
      }
    }
  }

  result.aps = Array.from(apMap.values());
  return result;
}
