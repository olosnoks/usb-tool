/**
 * Pure helpers for the GPS Navigation Suite toolkit tab:
 * NMEA checksum/field decoder, UBX frame decoder/builder, coordinate conversion.
 */
import { buildUbxPacket, calculateUbxChecksum, UBX_CLASSES } from './ubxProtocol';

// ---------- NMEA ----------

/** XOR of every character between '$' and '*' (exclusive), as 2-digit uppercase hex. */
export function nmeaChecksum(body) {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i) & 0xff;
  return x.toString(16).toUpperCase().padStart(2, '0');
}

/** Wrap a sentence body ("GPGGA,...") into "$body*HH". A leading '$' and old checksum are tolerated. */
export function buildNmeaSentence(body) {
  const b = String(body || '').trim().replace(/^\$/, '').replace(/\*[0-9A-Fa-f]{0,2}$/, '');
  return `$${b}*${nmeaChecksum(b)}`;
}

const FIELD_NAMES = {
  GGA: ['Time (UTC)', 'Latitude', 'N/S', 'Longitude', 'E/W', 'Fix quality', 'Satellites used', 'HDOP', 'Altitude', 'Alt unit', 'Geoid separation', 'Sep unit', 'DGPS age', 'DGPS station'],
  RMC: ['Time (UTC)', 'Status (A=valid)', 'Latitude', 'N/S', 'Longitude', 'E/W', 'Speed (knots)', 'Course (deg)', 'Date (ddmmyy)', 'Magnetic variation', 'Mag var E/W', 'Mode'],
  GLL: ['Latitude', 'N/S', 'Longitude', 'E/W', 'Time (UTC)', 'Status', 'Mode'],
  VTG: ['Course true', 'T', 'Course magnetic', 'M', 'Speed (knots)', 'N', 'Speed (km/h)', 'K', 'Mode'],
  GSA: ['Mode (M/A)', 'Fix type (1/2/3)', 'SV 1', 'SV 2', 'SV 3', 'SV 4', 'SV 5', 'SV 6', 'SV 7', 'SV 8', 'SV 9', 'SV 10', 'SV 11', 'SV 12', 'PDOP', 'HDOP', 'VDOP', 'System ID'],
  GSV: ['Total messages', 'Message number', 'Satellites in view']
};
const GSV_SAT = ['PRN', 'Elevation', 'Azimuth', 'SNR'];

/**
 * Validate and label an NMEA sentence.
 * @returns {{ok:boolean, error?:string, talker?:string, type?:string, hasChecksum?:boolean,
 *   checksumOk?:boolean, expected?:string, given?:string, fields?:{name:string,value:string}[]}}
 */
export function decodeNmeaSentence(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('$') && !s.startsWith('!')) return { ok: false, error: 'Sentence must start with $ (or !).' };
  const star = s.lastIndexOf('*');
  const body = star === -1 ? s.slice(1) : s.slice(1, star);
  const given = star === -1 ? '' : s.slice(star + 1, star + 3).toUpperCase();
  const expected = nmeaChecksum(body);
  const hasChecksum = star !== -1 && /^[0-9A-F]{2}$/.test(given);
  const parts = body.split(',');
  const head = parts[0].toUpperCase();
  if (!head) return { ok: false, error: 'Empty sentence address field.' };
  const proprietary = head.startsWith('P');
  const talker = proprietary ? head : head.slice(0, 2);
  const type = proprietary ? head : head.slice(2);
  const names = FIELD_NAMES[type] || [];
  const fields = parts.slice(1).map((value, i) => ({
    name: names[i] || (type === 'GSV' && i >= 3 ? GSV_SAT[(i - 3) % 4] : `Field ${i + 1}`),
    value
  }));
  return { ok: true, talker, type, hasChecksum, checksumOk: hasChecksum && given === expected, expected, given, fields };
}

// ---------- UBX ----------

/** Parse "B5 62 06 08 ..." / "0xB5,0x62" / "b562..." into bytes. Returns null when invalid. */
export function parseHexBytes(text) {
  const cleaned = String(text || '').replace(/0x/gi, '').replace(/[\s,:;-]+/g, '');
  if (!cleaned || cleaned.length % 2 || !/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

const UBX_NAMES = {
  '01:07': 'NAV-PVT', '01:03': 'NAV-STATUS', '01:35': 'NAV-SAT', '01:04': 'NAV-DOP', '01:21': 'NAV-TIMEUTC',
  '05:01': 'ACK-ACK', '05:00': 'ACK-NAK',
  '06:00': 'CFG-PRT', '06:01': 'CFG-MSG', '06:08': 'CFG-RATE', '06:09': 'CFG-CFG', '06:24': 'CFG-NAV5', '06:04': 'CFG-RST',
  '0A:04': 'MON-VER', '0A:09': 'MON-HW', '0A:28': 'MON-GNSS', '0A:38': 'MON-RF',
  '02:15': 'RXM-RAWX', '02:13': 'RXM-SFRBX'
};

const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

export function ubxMessageName(cls, id) {
  return UBX_NAMES[`${hex2(cls)}:${hex2(id)}`] || `0x${hex2(cls)} 0x${hex2(id)}`;
}

/** Short human summary for the few messages whose payload layout is simple. */
function summarizeUbx(cls, id, p) {
  if (cls === 0x05 && p.length >= 2) return `${id === 1 ? 'ACK' : 'NAK'} of class 0x${hex2(p[0])} id 0x${hex2(p[1])}`;
  if (cls === 0x06 && id === 0x08 && p.length >= 6) {
    const ms = p[0] | (p[1] << 8);
    return `measRate ${ms} ms (${ms ? (1000 / ms).toFixed(2) : '?'} Hz), navRate ${p[2] | (p[3] << 8)}, timeRef ${p[4] | (p[5] << 8)}`;
  }
  if (cls === 0x06 && id === 0x00 && p.length >= 20 && p[0] === 1) {
    return `UART1 baud ${(p[8] | (p[9] << 8) | (p[10] << 16) | (p[11] << 24)) >>> 0}`;
  }
  if (cls === 0x06 && id === 0x01 && p.length >= 3) return `message 0x${hex2(p[0])} 0x${hex2(p[1])} rate ${p[2]}`;
  if (cls === 0x06 && id === 0x24 && p.length >= 3) return `dynModel ${p[2]}`;
  return '';
}

/**
 * Scan bytes for UBX frames (B5 62 ...), verifying the Fletcher-8 checksum of each.
 * Bytes between frames (for example NMEA text) are skipped.
 */
export function decodeUbxFrames(bytes) {
  const frames = [];
  let i = 0;
  while (i + 8 <= bytes.length) {
    if (bytes[i] !== 0xb5 || bytes[i + 1] !== 0x62) { i++; continue; }
    const cls = bytes[i + 2];
    const id = bytes[i + 3];
    const length = bytes[i + 4] | (bytes[i + 5] << 8);
    const end = i + 6 + length + 2;
    if (end > bytes.length) {
      frames.push({ offset: i, cls, id, name: ubxMessageName(cls, id), length, truncated: true, checksumOk: false, payload: bytes.slice(i + 6), summary: '' });
      break;
    }
    const { ckA, ckB } = calculateUbxChecksum(bytes.slice(i + 2, i + 6 + length));
    const checksumOk = ckA === bytes[end - 2] && ckB === bytes[end - 1];
    const payload = bytes.slice(i + 6, i + 6 + length);
    frames.push({
      offset: i, cls, id, name: ubxMessageName(cls, id), length, checksumOk, truncated: false, payload,
      summary: checksumOk ? summarizeUbx(cls, id, payload) : ''
    });
    i = checksumOk ? end : i + 2;
  }
  return frames;
}

/** Update rate in Hz -> measurement period in ms (clamped to 25..65535 ms, i.e. up to 40 Hz). */
export function hzToMeasRateMs(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(65535, Math.max(25, Math.round(1000 / n)));
}

/** UBX-CFG-MSG for any class/id, setting the output rate on the current port (3-byte form). */
export function buildCfgMsgRate(msgClass, msgId, rate = 1) {
  return buildUbxPacket(UBX_CLASSES.CFG, 0x01, [msgClass & 0xff, msgId & 0xff, rate & 0xff]);
}

/** UBX poll request (empty payload), e.g. MON-VER = 0x0A 0x04. */
export function buildUbxPoll(msgClass, msgId) {
  return buildUbxPacket(msgClass & 0xff, msgId & 0xff, []);
}

// ---------- Coordinates ----------

/** Parse decimal degrees, "40 42.767 N", or 40d42'46.0"N into signed decimal degrees. */
export function parseCoordinate(text) {
  const s = String(text || '').trim().toUpperCase();
  if (!s) return null;
  const hemi = (s.match(/[NSEW]/) || [''])[0];
  const nums = s.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  const [d, m = 0, sec = 0] = nums.map(Number);
  if (m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
  let v = Math.abs(d) + m / 60 + sec / 3600;
  if (nums[0].startsWith('-') || hemi === 'S' || hemi === 'W') v = -v;
  return Number.isFinite(v) ? v : null;
}

const hemiOf = (value, isLat) => (isLat ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E'));

export function toDms(value, isLat) {
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Number((((abs - d) * 60 - m) * 60).toFixed(2));
  if (s >= 60) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(2).padStart(5, '0')}"${hemiOf(value, isLat)}`;
}

export function toDdm(value, isLat) {
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Number(((abs - d) * 60).toFixed(4));
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${m.toFixed(4).padStart(7, '0')}'${hemiOf(value, isLat)}`;
}

/** Maidenhead grid locator, 6 characters (e.g. JN58td). */
export function toMaidenhead(lat, lon) {
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  const x = Math.min(lon + 180, 359.9999999);
  const y = Math.min(lat + 90, 179.9999999);
  const fx = Math.floor(x / 20), fy = Math.floor(y / 10);
  const sx = Math.floor((x - fx * 20) / 2), sy = Math.floor(y - fy * 10);
  const ux = Math.floor(((x - fx * 20 - sx * 2) * 60) / 5), uy = Math.floor(((y - fy * 10 - sy) * 60) / 2.5);
  const A = 'ABCDEFGHIJKLMNOPQR';
  const a = 'abcdefghijklmnopqrstuvwx';
  return `${A[fx]}${A[fy]}${sx}${sy}${a[ux]}${a[uy]}`;
}

const R_EARTH_M = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine, mean earth radius). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, 0..360 degrees true. */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg) {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
