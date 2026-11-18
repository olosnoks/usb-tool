// Pure helpers for the Packet Analyzer: a small Wireshark-style display filter, capture statistics,
// EAPOL handshake tracking and a canonical hex+ASCII dump. No React, no browser APIs.

const FIELDS = {
  type: (f) => f.type,
  subtype: (f) => f.subtype,
  proto: (f) => f.protocol,
  protocol: (f) => f.protocol,
  src: (f) => f.source,
  dst: (f) => f.dest,
  bssid: (f) => f.bssid,
  ssid: (f) => f.ssid,
  ch: (f) => f.channel,
  channel: (f) => f.channel,
  rssi: (f) => f.rssi,
  len: (f) => f.length,
  length: (f) => f.length,
  origin: (f) => f.origin,
};
const NUMERIC = new Set(['ch', 'channel', 'rssi', 'len', 'length']);
const TERM = /^([a-z]+)\s*(==|!=|<=|>=|~|<|>)\s*(.+)$/i;

/** Names of fields usable in display filter terms. */
export const FILTER_FIELDS = Object.keys(FIELDS);

function compileTerm(raw) {
  const text = raw.trim();
  if (!text) return () => true;
  let negate = false;
  let body = text;
  if (body.startsWith('!') && !body.startsWith('!=')) { negate = true; body = body.slice(1).trim(); }
  const m = TERM.exec(body);
  let fn;
  if (m && FIELDS[m[1].toLowerCase()]) {
    const field = m[1].toLowerCase();
    const op = m[2];
    const want = m[3].trim().replace(/^"(.*)"$/, '$1');
    const get = FIELDS[field];
    if (NUMERIC.has(field)) {
      const n = Number(want);
      if (Number.isNaN(n)) throw new Error(`"${field}" needs a number, got "${want}"`);
      fn = (f) => {
        const v = Number(get(f));
        switch (op) {
          case '==': return v === n;
          case '!=': return v !== n;
          case '<': return v < n;
          case '>': return v > n;
          case '<=': return v <= n;
          case '>=': return v >= n;
          default: return String(v).includes(want);
        }
      };
    } else {
      const w = want.toLowerCase();
      if (!['==', '!=', '~'].includes(op)) throw new Error(`Operator ${op} only works on numeric fields`);
      fn = (f) => {
        const v = String(get(f) ?? '').toLowerCase();
        if (op === '==') return v === w;
        if (op === '!=') return v !== w;
        return v.includes(w);
      };
    }
  } else if (m) {
    throw new Error(`Unknown field "${m[1]}". Fields: ${FILTER_FIELDS.join(', ')}`);
  } else {
    const q = body.toLowerCase();
    fn = (f) => [f.protocol, f.source, f.dest, f.bssid, f.ssid, f.type, f.subtype]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  }
  return negate ? (f) => !fn(f) : fn;
}

/**
 * Compile a display filter. Terms are `field op value` (ops: == != ~ < > <= >=) or free text,
 * combined with `&&` (and) and `||` (or, lower precedence); a leading `!` negates a term.
 * Example: `type==Data && rssi>-70 || ssid~cafe`. Throws Error with a readable message when invalid.
 */
export function compileFilter(expr) {
  const src = (expr || '').trim();
  if (!src) return () => true;
  const groups = src.split('||').map((g) => g.split('&&').map(compileTerm));
  return (f) => groups.some((all) => all.every((t) => t(f)));
}

/** Like compileFilter but never throws: { test, error }. */
export function tryCompileFilter(expr) {
  try { return { test: compileFilter(expr), error: null }; } catch (e) { return { test: () => true, error: e.message }; }
}

/** Counts per protocol, plus frame/byte totals and capture span. */
export function protocolStats(frames) {
  const byProto = new Map();
  let bytes = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const f of frames) {
    byProto.set(f.protocol, (byProto.get(f.protocol) || 0) + 1);
    bytes += f.length || 0;
    if (typeof f.timeMs === 'number') { first = Math.min(first, f.timeMs); last = Math.max(last, f.timeMs); }
  }
  const rows = [...byProto.entries()]
    .map(([protocol, count]) => ({ protocol, count, pct: frames.length ? (count / frames.length) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.protocol.localeCompare(b.protocol));
  return { total: frames.length, bytes, durationMs: last >= first ? last - first : 0, rows };
}

/** Access points seen in beacons / probe responses: bssid, ssid, channel, beacon count, strongest RSSI. */
export function accessPoints(frames) {
  const aps = new Map();
  for (const f of frames) {
    if (f.origin !== 'pcap' || f.type !== 'Management') continue;
    if (f.subtype !== 'Beacon' && f.subtype !== 'Probe Response') continue;
    const ap = aps.get(f.bssid) || { bssid: f.bssid, ssid: '', channel: 0, beacons: 0, bestRssi: -Infinity };
    ap.beacons += 1;
    if (f.ssid && f.ssid !== '(hidden)') ap.ssid = f.ssid; else if (!ap.ssid) ap.ssid = f.ssid;
    if (f.channel) ap.channel = f.channel;
    if (f.rssi && f.rssi > ap.bestRssi) ap.bestRssi = f.rssi;
    aps.set(f.bssid, ap);
  }
  return [...aps.values()]
    .map((a) => ({ ...a, bestRssi: a.bestRssi === -Infinity ? 0 : a.bestRssi }))
    .sort((a, b) => (b.bestRssi || -999) - (a.bestRssi || -999));
}

const eapolNumber = (f) => {
  const m = /^EAPOL 4-Way #([1-4])$/.exec(f.protocol || '');
  return m ? Number(m[1]) : 0;
};

/**
 * Group EAPOL 4-way handshake messages by AP + station. Messages 1 and 3 go AP to station, 2 and 4
 * station to AP. `messages` lists the message numbers seen; `complete` is true when 1-4 were all seen;
 * `pairable` means 1+2 or 2+3 were seen.
 */
export function findHandshakes(frames) {
  const map = new Map();
  for (const f of frames) {
    const n = eapolNumber(f);
    if (!n || f.origin !== 'pcap') continue;
    const apSide = n === 1 || n === 3;
    const station = apSide ? f.dest : f.source;
    const bssid = f.bssid !== 'N/A' ? f.bssid : apSide ? f.source : f.dest;
    const key = `${bssid}|${station}`;
    const h = map.get(key) || { bssid, station, seen: new Set(), frameIds: [] };
    h.seen.add(n);
    h.frameIds.push(f.id);
    map.set(key, h);
  }
  const ssidOf = new Map(accessPoints(frames).map((a) => [a.bssid, a.ssid]));
  return [...map.values()].map((h) => {
    const messages = [...h.seen].sort();
    return {
      bssid: h.bssid,
      station: h.station,
      ssid: ssidOf.get(h.bssid) || '',
      messages,
      frameIds: h.frameIds,
      complete: messages.length === 4,
      pairable: (h.seen.has(1) && h.seen.has(2)) || (h.seen.has(2) && h.seen.has(3)),
    };
  });
}

/** Classic 16-bytes-per-line hex dump: offset, hex columns, ASCII gutter. Accepts bytes or a "aa bb cc" string. */
export function hexDump(input) {
  const bytes = typeof input === 'string'
    ? Uint8Array.from((input.match(/[0-9a-fA-F]{2}/g) || []).map((h) => parseInt(h, 16)))
    : input;
  const lines = [];
  for (let o = 0; o < bytes.length; o += 16) {
    const chunk = Array.from(bytes.subarray(o, o + 16));
    const hex = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${o.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}
