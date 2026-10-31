// Kismet REST client for the Kismet Studio workbench.
//
// Auth: an API key goes in the KISMET URL parameter; "user:password" goes in
// a Basic Authorization header. Devices come from
// POST /devices/last-time/<-seconds>/devices.json with a field list (each
// [path, rename]) so only what the UI needs is sent back.
//
// The browser can only reach Kismet if Kismet allows this page's origin
// (CORS) and, from an https page, if Kismet is on localhost or https.

export const KISMET_DEVICE_FIELDS = [
  ['kismet.device.base.macaddr', 'mac'],
  ['kismet.device.base.commonname', 'name'],
  ['kismet.device.base.type', 'type'],
  ['kismet.device.base.channel', 'channel'],
  ['kismet.device.base.frequency', 'freqKhz'],
  ['kismet.device.base.crypt', 'crypt'],
  ['kismet.device.base.manuf', 'manuf'],
  ['kismet.device.base.signal/kismet.common.signal.last_signal', 'rssi'],
  ['kismet.device.base.packets.total', 'packets'],
  ['kismet.device.base.first_time', 'first'],
  ['kismet.device.base.last_time', 'last'],
  ['dot11.device/dot11.device.num_associated_clients', 'clients'],
  ['dot11.device/dot11.device.associated_client_map', 'clientMap']
];

function withAuth(server, path, apiKey) {
  const base = String(server || '').replace(/\/+$/, '');
  const url = new URL(base + path);
  const headers = {};
  if (apiKey) {
    if (apiKey.includes(':')) headers.Authorization = 'Basic ' + btoa(apiKey);
    else url.searchParams.set('KISMET', apiKey);
  }
  return { url: url.toString(), headers };
}

export async function kismetFetch(server, path, { apiKey, form, fetchImpl = fetch } = {}) {
  const { url, headers } = withAuth(server, path, apiKey);
  const init = { headers };
  if (form) {
    init.method = 'POST';
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new Error(`can't reach Kismet at ${server} (${e.message}). Is it running, and does it allow requests from this page (CORS)?`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Kismet refused the login: check the API key or user:password.');
  if (!res.ok) throw new Error(`Kismet answered HTTP ${res.status} for ${path}`);
  return res.json();
}

const ago = (sec, now) => {
  if (!sec) return '—';
  const d = Math.max(0, Math.round(now - sec));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)} mins ago`;
  return `${Math.round(d / 3600)} h ago`;
};

/** Kismet device record (renamed fields) -> the workbench's device shape. */
export function mapKismetDevice(r, nowSec = Date.now() / 1000) {
  const khz = Number(r.freqKhz) || 0;
  const rssi = Number(r.rssi) || null;           // 0 = no signal recorded
  const type = String(r.type || '');
  const crypt = String(r.crypt || '').trim();
  return {
    bssid: String(r.mac || '').toUpperCase(),
    ssid: r.name && r.name !== r.mac ? String(r.name) : '',
    type: /AP/.test(type) ? 'AP' : 'STA',
    kismetType: type,
    channel: parseInt(r.channel, 10) || 0,
    frequency: khz ? `${(khz / 1e6).toFixed(3)} GHz` : '—',
    band: khz >= 5925000 ? '6GHz' : khz >= 5000000 ? '5GHz' : khz ? '2.4GHz' : '',
    signal: rssi,
    signalQuality: rssi === null ? 0 : Math.max(0, Math.min(100, 2 * (rssi + 100))),
    crypto: !crypt || /^none$/i.test(crypt) ? 'Open' : crypt,
    manufacturer: r.manuf || 'Unknown',
    packets: Number(r.packets) || 0,
    clients: Number(r.clients) || 0,
    clientList: r.clientMap && typeof r.clientMap === 'object' ? Object.keys(r.clientMap).map((m) => m.toUpperCase()) : [],
    firstSeenTs: Number(r.first) || null,
    firstSeen: ago(Number(r.first), nowSec),
    lastSeen: ago(Number(r.last), nowSec)
  };
}

/** Devices active in the last `windowSec` seconds. */
export async function fetchKismetDevices(server, apiKey, { windowSec = 600, fetchImpl } = {}) {
  const raw = await kismetFetch(server, `/devices/last-time/-${Math.round(windowSec)}/devices.json`, {
    apiKey, fetchImpl, form: { json: JSON.stringify({ fields: KISMET_DEVICE_FIELDS }) }
  });
  const now = Date.now() / 1000;
  return (Array.isArray(raw) ? raw : []).map((r) => mapKismetDevice(r, now))
    .filter((d) => d.bssid)
    .sort((a, b) => (b.signal ?? -999) - (a.signal ?? -999));
}

const SEVERITY = (n) => (n >= 15 ? 'CRITICAL' : n >= 5 ? 'WARN' : 'INFO');

/** Alerts since `sinceSec` (0 = all Kismet still holds). */
export async function fetchKismetAlerts(server, apiKey, { sinceSec = 0, fetchImpl } = {}) {
  const raw = await kismetFetch(server, `/alerts/last-time/${Math.floor(sinceSec)}/alerts.json`, { apiKey, fetchImpl });
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.['kismet.alert.list']) ? raw['kismet.alert.list'] : [];
  const now = Date.now() / 1000;
  return list.map((a, i) => {
    const src = a['kismet.alert.source_mac'], dst = a['kismet.alert.dest_mac'];
    const target = [src, dst].filter((m) => m && m !== '00:00:00:00:00:00').join(' → ');
    return {
      id: `${a['kismet.alert.timestamp'] || 0}-${i}`,
      type: a['kismet.alert.header'] || 'ALERT',
      severity: SEVERITY(Number(a['kismet.alert.severity']) || 0),
      target: target || '—',
      desc: a['kismet.alert.text'] || '',
      channel: parseInt(a['kismet.alert.channel'], 10) || 0,
      time: ago(Number(a['kismet.alert.timestamp']), now)
    };
  }).reverse();
}

/** Server uptime from /system/status.json, e.g. "02:45:12". */
export async function fetchKismetStatus(server, apiKey, { fetchImpl } = {}) {
  const s = await kismetFetch(server, '/system/status.json', { apiKey, fetchImpl });
  const start = Number(s['kismet.system.timestamp.start_sec']) || 0;
  const now = Number(s['kismet.system.timestamp.sec']) || Date.now() / 1000;
  const up = start ? Math.max(0, Math.round(now - start)) : null;
  const hh = up === null ? null : `${String(Math.floor(up / 3600)).padStart(2, '0')}:${String(Math.floor((up % 3600) / 60)).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
  return { uptime: hh, version: s['kismet.system.version'] || '' };
}
