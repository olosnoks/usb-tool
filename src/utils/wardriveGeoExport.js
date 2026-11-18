// Map-format exports (GeoJSON, GPX, KML) and run statistics for the Demo
// Wardrive Generator. Everything produced here is labelled SYNTHETIC.
import { SYNTHETIC_LABEL, SYNTHETIC_NOTICE } from './wardriveDemoGenerator';

const xmlEscape = (s) =>
  String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** "YYYY-MM-DD HH:MM:SS" (local) -> ISO 8601 UTC, or '' when unparseable. */
export function firstSeenToIso(str) {
  const d = new Date(String(str || '').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

const validPath = (path) => (Array.isArray(path) ? path.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) : []);

/** GeoJSON FeatureCollection: one LineString track plus one Point per AP. */
export function generateGeoJson(aps, masterPath = []) {
  const features = [];
  const path = validPath(masterPath);
  if (path.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { synthetic: true, kind: 'track', label: SYNTHETIC_LABEL },
      geometry: { type: 'LineString', coordinates: path.map(([lon, lat]) => [lon, lat]) }
    });
  }
  for (const ap of aps || []) {
    features.push({
      type: 'Feature',
      properties: {
        synthetic: true, kind: 'ap', mac: ap.mac, ssid: ap.ssid, auth: ap.auth,
        first_seen: ap.first_seen, channel: ap.channel, frequency: ap.frequency, rssi: ap.rssi
      },
      geometry: { type: 'Point', coordinates: [ap.lon, ap.lat, ap.alt ?? 0] }
    });
  }
  return JSON.stringify({ type: 'FeatureCollection', name: 'SYNTHETIC wardrive demo', synthetic: true, notice: SYNTHETIC_NOTICE, features }, null, 1);
}

/** GPX 1.1: waypoints for each AP and a track for the path. */
export function generateGpx(aps, masterPath = []) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SYNTHETIC-DEMO-GENERATOR" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>SYNTHETIC wardrive demo</name><desc>${xmlEscape(SYNTHETIC_NOTICE)}</desc></metadata>`
  ];
  for (const ap of aps || []) {
    const t = firstSeenToIso(ap.first_seen);
    out.push(`  <wpt lat="${ap.lat}" lon="${ap.lon}"><ele>${ap.alt ?? 0}</ele>${t ? `<time>${t}</time>` : ''}<name>${xmlEscape(ap.ssid)}</name><desc>${xmlEscape(`SYNTHETIC ${ap.mac} ch${ap.channel} ${ap.rssi}dBm ${ap.auth}`)}</desc></wpt>`);
  }
  const path = validPath(masterPath);
  if (path.length >= 2) {
    out.push('  <trk><name>SYNTHETIC track</name><trkseg>');
    for (const [lon, lat] of path) out.push(`    <trkpt lat="${lat}" lon="${lon}"/>`);
    out.push('  </trkseg></trk>');
  }
  out.push('</gpx>');
  return out.join('\n') + '\n';
}

/** KML 2.2: AP placemarks and a LineString for the path (opens in Google Earth). */
export function generateKml(aps, masterPath = []) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    '  <name>SYNTHETIC wardrive demo</name>',
    `  <description>${xmlEscape(SYNTHETIC_NOTICE)}</description>`
  ];
  const path = validPath(masterPath);
  if (path.length >= 2) {
    out.push(`  <Placemark><name>SYNTHETIC track</name><LineString><tessellate>1</tessellate><coordinates>${path.map(([lon, lat]) => `${lon},${lat},0`).join(' ')}</coordinates></LineString></Placemark>`);
  }
  for (const ap of aps || []) {
    const t = firstSeenToIso(ap.first_seen);
    out.push(`  <Placemark><name>${xmlEscape(ap.ssid)}</name><description>${xmlEscape(`SYNTHETIC ${ap.mac} ch${ap.channel} ${ap.rssi}dBm ${ap.auth}`)}</description>${t ? `<TimeStamp><when>${t}</when></TimeStamp>` : ''}<Point><coordinates>${ap.lon},${ap.lat},${ap.alt ?? 0}</coordinates></Point></Placemark>`);
  }
  out.push('</Document></kml>');
  return out.join('\n') + '\n';
}

/** Summary of a generated run: auth / band / RSSI breakdown, unique SSIDs. */
export function summarizeAps(aps) {
  const list = aps || [];
  const auth = {};
  const ssids = new Set();
  let b24 = 0, b5 = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const ap of list) {
    const key = /EAP/.test(ap.auth) ? 'WPA2-EAP' : /SAE|WPA3/.test(ap.auth) ? 'WPA3' : /WPA2|WPA/.test(ap.auth) ? 'WPA2/WPA' : 'Open';
    auth[key] = (auth[key] || 0) + 1;
    ssids.add(ap.ssid);
    if (Number(ap.channel) <= 14) b24++; else b5++;
    sum += ap.rssi; min = Math.min(min, ap.rssi); max = Math.max(max, ap.rssi);
  }
  return {
    count: list.length,
    uniqueSsids: ssids.size,
    auth,
    band24: b24,
    band5: b5,
    rssiAvg: list.length ? Math.round((sum / list.length) * 10) / 10 : null,
    rssiMin: list.length ? min : null,
    rssiMax: list.length ? max : null
  };
}
