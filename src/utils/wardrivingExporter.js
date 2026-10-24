/**
 * Wardriving Wigle.net CSV Exporter
 * Generates WigleWifi-1.4 formatted CSV strings for Wi-Fi geolocation databases.
 */

/**
 * Format security type into Wigle AuthMode tag syntax.
 * @param {string} security 
 * @returns {string}
 */
export function formatWigleAuth(security) {
  switch (security) {
    case 'WPA3':
      return '[WPA3-SAE-CCMP][ESS]';
    case 'WPA2':
      return '[WPA2-PSK-CCMP][ESS]';
    case 'WPA':
      return '[WPA-PSK-TKIP][ESS]';
    case 'WEP':
      return '[WEP][ESS]';
    case 'Open':
    default:
      return '[ESS]';
  }
}

/**
 * Format timestamp into YYYY-MM-DD HH:MM:SS format required by Wigle.
 * @param {string|number|Date} ts 
 * @returns {string}
 */
export function formatWigleTimestamp(ts) {
  let date;
  if (!ts) {
    date = new Date();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'string' && ts.includes('T')) {
    date = new Date(ts);
  } else if (typeof ts === 'string' && ts.includes(':')) {
    // If it's a HH:MM:SS time string, prefix with today's date
    const today = new Date().toISOString().split('T')[0];
    const cleanTime = ts.split('.')[0];
    return `${today} ${cleanTime}`;
  } else {
    date = new Date(ts);
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

/**
 * Escape CSV field to handle commas and double quotes.
 * @param {string} val 
 * @returns {string}
 */
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Calculate distance between two lat/lon coordinates in meters using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
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

/**
 * Convert access points dictionary or array into Wigle.net standard CSV string.
 * @param {Object|Array} devices 
 * @returns {string}
 */
export function exportWigleCsv(devices) {
  const headerLine1 = 'WigleWifi-1.4,appRelease=SkonUsbTool,model=WebUSB,release=1.0,device=Browser,display=Web,board=JS,brand=Skon';
  const headerLine2 = 'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type';

  const list = !devices
    ? []
    : Array.isArray(devices)
    ? devices
    : Object.values(devices);

  const rows = [headerLine1, headerLine2];

  for (const ap of list) {
    if (!ap || !ap.bssid) continue;
    // Skip placeholder/broadcast BSSIDs
    if (ap.bssid === 'FF:FF:FF:FF:FF:FF' || ap.bssid === '00:00:00:00:00:00') continue;

    const mac = ap.bssid;
    const ssid = ap.ssid === '<Hidden SSID>' ? '' : (ap.ssid || '');
    const auth = formatWigleAuth(ap.security);
    const firstSeen = formatWigleTimestamp(ap.firstSeen || ap.timestamp || ap.lastSeen);
    const channel = ap.channel || 1;
    const rssi = ap.rssi || -60;

    // Use tagged GPS coordinates if available, otherwise default to 0 / 0.0
    const lat = ap.latitude != null ? String(ap.latitude) : (ap.lat != null ? String(ap.lat) : '0.0');
    const lon = ap.longitude != null ? String(ap.longitude) : (ap.lon != null ? String(ap.lon) : '0.0');
    const alt = ap.altitude != null ? String(Math.round(ap.altitude)) : '0';
    const accuracy = ap.accuracy != null ? String(Math.round(ap.accuracy)) : '0';
    const type = 'WIFI';

    rows.push([
      escapeCsv(mac),
      escapeCsv(ssid),
      escapeCsv(auth),
      escapeCsv(firstSeen),
      escapeCsv(channel),
      escapeCsv(rssi),
      lat,
      lon,
      alt,
      accuracy,
      type
    ].join(','));
  }

  return rows.join('\r\n') + '\r\n';
}

/**
 * Trigger browser download of Wigle CSV file.
 * @param {Object|Array} devices 
 * @param {string} [filename]
 */
export function downloadWigleCsv(devices, filename) {
  const csvContent = exportWigleCsv(devices);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `wigle_wifi_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
