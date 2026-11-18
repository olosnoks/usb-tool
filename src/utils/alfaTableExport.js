// Pure helpers for the Wi-Fi monitor: spreadsheet (CSV) export of the AP and
// client tables, a Windows-style signal quality figure and a one-line survey
// summary (band split, security mix). No DOM or I/O in here.

/** Band label for a channel number (6 GHz channel numbers overlap 5 GHz, so
 *  anything above 14 is reported as 5 GHz unless a frequency is known). */
export function bandOfChannel(channel, freqMhz) {
  if (Number.isFinite(freqMhz)) {
    if (freqMhz >= 5925) return '6 GHz';
    if (freqMhz >= 4900) return '5 GHz';
    if (freqMhz >= 2400) return '2.4 GHz';
  }
  const ch = Number(channel);
  if (!Number.isFinite(ch) || ch <= 0) return 'Unknown';
  return ch <= 14 ? '2.4 GHz' : '5 GHz';
}

/** RSSI (dBm) to 0-100 quality, the same linear scale Windows uses: -100 dBm = 0, -50 dBm or better = 100. */
export function rssiToQuality(rssi) {
  if (!Number.isFinite(rssi)) return null;
  return Math.round(Math.min(100, Math.max(0, 2 * (rssi + 100))));
}

/** Quote a CSV field (RFC 4180) and neutralise spreadsheet formula injection:
 *  SSIDs and hostnames come off the air, so a value starting with = + - @ is prefixed with a quote. */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof value === 'number')) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const sortByRssi = (list) =>
  [...list].sort((a, b) => (Number.isFinite(b.rssi) ? b.rssi : -999) - (Number.isFinite(a.rssi) ? a.rssi : -999));

export const AP_CSV_HEADER = [
  'SSID', 'BSSID', 'Vendor', 'Band', 'Channel', 'Security', 'RSSI_dBm', 'Quality_pct', 'SNR_dB',
  'Packets', 'WiFi6', 'MFP', 'FirstSeen', 'LastSeen', 'Latitude', 'Longitude'
];

/** `devices` is the AP map (bssid -> node). Strongest signal first. */
export function apsToCsv(devices) {
  const list = sortByRssi(Object.values(devices || {}));
  const rows = list.map((d) => [
    d.ssid, d.bssid, d.vendor, bandOfChannel(d.channel), d.channel, d.security || 'Open',
    d.rssi, rssiToQuality(d.rssi), d.snr, d.packetCount,
    d.isWifi6 ? 'yes' : 'no',
    d.isMfpRequired || d.mfp === 'required' ? 'required' : d.isMfpCapable || d.mfp === 'capable' ? 'capable' : '',
    d.firstSeen, d.lastSeen, d.latitude, d.longitude
  ]);
  return toCsv(AP_CSV_HEADER, rows);
}

export const CLIENT_CSV_HEADER = [
  'MAC', 'Vendor', 'AssociatedBSSID', 'RSSI_dBm', 'Quality_pct', 'Packets', 'ProbedSSIDs',
  'IP', 'Hostname', 'FirstSeen', 'LastSeen'
];

export function clientsToCsv(clients) {
  const list = sortByRssi(Object.values(clients || {}));
  const rows = list.map((c) => [
    c.clientMac || c.mac, c.vendor, c.bssid, c.rssi, rssiToQuality(c.rssi),
    c.packetCount, Array.isArray(c.probedSsids) ? c.probedSsids.join(' | ') : '',
    c.ipAddress, c.dhcpHostname, c.firstSeen, c.lastSeen
  ]);
  return toCsv(CLIENT_CSV_HEADER, rows);
}

/** Counts for the summary strip. */
export function summarizeAps(devices) {
  const list = Object.values(devices || {});
  const bands = { '2.4 GHz': 0, '5 GHz': 0, '6 GHz': 0, Unknown: 0 };
  let open = 0, wep = 0, wpa3 = 0, hidden = 0;
  for (const d of list) {
    bands[bandOfChannel(d.channel)] += 1;
    const sec = String(d.security || 'Open');
    if (/^open$/i.test(sec)) open += 1;
    else if (/wep/i.test(sec)) wep += 1;
    if (/wpa3/i.test(sec)) wpa3 += 1;
    if (!d.ssid || d.ssid === '<Unknown>' || d.ssid === '<Hidden>' || /^<.*>$/.test(d.ssid)) hidden += 1;
  }
  return { total: list.length, bands, open, wep, wpa3, hidden };
}
