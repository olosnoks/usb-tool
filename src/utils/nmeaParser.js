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
 * Parses wardriving WiFi beacon logs
 * Matches standard formats like Wigle, Marauder, or Piglet wardriver output
 * @param {string} line
 * @returns {object|null}
 */
export function parseWardriveLine(line) {
  if (!line || typeof line !== 'string') return null;
  const clean = line.trim();

  // Pattern 1: "[WIFI] BSSID: XX:XX:XX... | SSID: ... | RSSI: -XX | CH: X | AUTH: ..."
  if (clean.includes('BSSID') || clean.includes('bssid')) {
    const bssidMatch = clean.match(/(?:BSSID|bssid)[:= ]\s*([0-9a-fA-F:]{17})/i);
    const ssidMatch = clean.match(/(?:SSID|ssid|ESSID)[:= ]\s*["']?([^"'|,]+)["']?/i);
    const rssiMatch = clean.match(/(?:RSSI|rssi)[:= ]\s*([+-]?\d+)/i);
    const chMatch = clean.match(/(?:CH|channel|Channel)[:= ]\s*(\d+)/i);
    const authMatch = clean.match(/(?:AUTH|auth|ENCR|sec)[:= ]\s*([A-Za-z0-9_\-\/]+)/i);

    if (bssidMatch) {
      return {
        bssid: bssidMatch[1].toUpperCase(),
        ssid: ssidMatch ? ssidMatch[1].trim() : '<Hidden SSID>',
        rssi: rssiMatch ? parseInt(rssiMatch[1], 10) : -70,
        channel: chMatch ? parseInt(chMatch[1], 10) : 1,
        auth: authMatch ? authMatch[1] : 'WPA2/WPA3',
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  // Pattern 2: CSV line: MAC,SSID,Auth,Channel,RSSI...
  const parts = clean.split(',');
  if (parts.length >= 5) {
    const macCandidate = parts[0].trim();
    if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(macCandidate)) {
      return {
        bssid: macCandidate.toUpperCase(),
        ssid: parts[1]?.trim() || '<Hidden SSID>',
        auth: parts[2]?.trim() || 'WPA2',
        channel: parseInt(parts[3], 10) || 1,
        rssi: parseInt(parts[4], 10) || -70,
        seenTime: new Date().toLocaleTimeString()
      };
    }
  }

  return null;
}
