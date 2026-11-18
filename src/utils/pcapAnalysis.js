// Pure analysis helpers for the PCAP viewer: capture summary, endpoints, I/O buckets, TCP stream
// following and CSV export of the statistics tables. Works on records produced by parsePcap().

/** Overall numbers for the (filtered) packet list. */
export function captureSummary(packets) {
  if (!packets.length) return { packets: 0, bytes: 0, duration: 0, pps: 0, bitsPerSec: 0, avgLen: 0 };
  let bytes = 0; let first = packets[0].ts; let last = packets[0].ts;
  for (const p of packets) {
    bytes += p.origlen;
    if (p.ts < first) first = p.ts;
    if (p.ts > last) last = p.ts;
  }
  const duration = last - first;
  return {
    packets: packets.length, bytes, duration, first, last,
    pps: duration > 0 ? packets.length / duration : 0,
    bitsPerSec: duration > 0 ? (bytes * 8) / duration : 0,
    avgLen: bytes / packets.length,
  };
}

/** Per-address traffic (IP, else MAC): packets and bytes sent and received, busiest first. */
export function endpoints(packets) {
  const m = new Map();
  const get = (k) => { let e = m.get(k); if (!e) { e = { address: k, txPackets: 0, rxPackets: 0, txBytes: 0, rxBytes: 0 }; m.set(k, e); } return e; };
  for (const p of packets) {
    const s = p.src || p.ethSrc; const d = p.dst || p.ethDst;
    if (s) { const e = get(s); e.txPackets++; e.txBytes += p.origlen; }
    if (d) { const e = get(d); e.rxPackets++; e.rxBytes += p.origlen; }
  }
  return [...m.values()]
    .map((e) => ({ ...e, packets: e.txPackets + e.rxPackets, bytes: e.txBytes + e.rxBytes }))
    .sort((a, b) => b.bytes - a.bytes || (a.address < b.address ? -1 : 1));
}

/** Pick a "nice" bucket width (seconds) giving roughly `target` buckets over `duration`. */
export function niceInterval(duration, target = 40) {
  if (!(duration > 0)) return 1;
  const raw = duration / target;
  const steps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 300, 600, 1800, 3600];
  return steps.find((s) => s >= raw) || 3600;
}

/** Packets and bytes per fixed time bucket (from the earliest packet). */
export function ioBuckets(packets, interval) {
  if (!packets.length) return { interval: interval || 1, buckets: [] };
  let t0 = packets[0].ts; let t1 = t0;
  for (const p of packets) { if (p.ts < t0) t0 = p.ts; if (p.ts > t1) t1 = p.ts; }
  const iv = interval > 0 ? interval : niceInterval(t1 - t0);
  const n = Math.min(5000, Math.floor((t1 - t0) / iv) + 1);
  const buckets = Array.from({ length: n }, (_, i) => ({ start: i * iv, packets: 0, bytes: 0 }));
  for (const p of packets) {
    const b = buckets[Math.min(n - 1, Math.floor((p.ts - t0) / iv))];
    b.packets++; b.bytes += p.origlen;
  }
  return { interval: iv, buckets };
}

/** TCP stream id (canonical endpoint pair) of a record, or null if it is not TCP/IP. */
export function tcpStreamKey(p) {
  if (!p || p.l4 !== 'TCP' || !p.src || !p.dst) return null;
  const a = `${p.src}:${p.sport}`; const b = `${p.dst}:${p.dport}`;
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Reassemble one TCP stream. Segments of each direction are ordered by sequence number (relative to the
 * first segment seen, 32-bit wrap aware); exact duplicates (retransmissions) are dropped and counted, and
 * a gap in the data is reported as `missing` bytes. The first sender is "client" (A).
 * Returns { key, a, b, chunks:[{dir:'A'|'B', bytes:Uint8Array}], bytesA, bytesB, retransmissions, missing, packets }.
 */
export function followTcpStream(packets, key) {
  const segs = packets.filter((p) => tcpStreamKey(p) === key && p.tcp);
  if (!segs.length) return null;
  const first = segs[0];
  const a = `${first.src}:${first.sport}`; const b = `${first.dst}:${first.dport}`;
  const dirs = { A: { base: null, items: [] }, B: { base: null, items: [] } };
  for (const p of segs) {
    const dir = `${p.src}:${p.sport}` === a ? 'A' : 'B';
    const d = dirs[dir];
    if (d.base === null) d.base = p.tcp.seq;
    if (p.tcp.flagBits & 0x02) d.base = (p.tcp.seq + 1) >>> 0; // SYN consumes one sequence number
    if (p.tcp.plen > 0) {
      d.items.push({ rel: ((p.tcp.seq - d.base) | 0), ts: p.ts, idx: d.items.length, data: p.data.subarray(p.tcp.pOff, p.tcp.pOff + p.tcp.plen) });
    }
  }
  let retransmissions = 0; let missing = 0; const chunks = [];
  for (const dir of ['A', 'B']) {
    const items = dirs[dir].items.sort((x, y) => x.rel - y.rel || x.idx - y.idx);
    let next = null;
    for (const it of items) {
      if (next === null) next = it.rel;
      const end = it.rel + it.data.length;
      if (end <= next) { retransmissions++; continue; }
      let data = it.data;
      if (it.rel > next) missing += it.rel - next;
      else if (it.rel < next) data = data.subarray(next - it.rel); // partial overlap
      chunks.push({ dir, ts: it.ts, bytes: data });
      next = end;
    }
  }
  // Interleave the two directions by time so the conversation reads in order.
  chunks.sort((x, y) => x.ts - y.ts);
  const merged = [];
  for (const c of chunks) {
    const last = merged[merged.length - 1];
    if (last && last.dir === c.dir) last.bytes = concat(last.bytes, c.bytes);
    else merged.push({ dir: c.dir, bytes: c.bytes });
  }
  const sum = (dir) => merged.filter((c) => c.dir === dir).reduce((n, c) => n + c.bytes.length, 0);
  return { key, a, b, chunks: merged, bytesA: sum('A'), bytesB: sum('B'), retransmissions, missing, packets: segs.length };
}

function concat(x, y) {
  const o = new Uint8Array(x.length + y.length);
  o.set(x, 0); o.set(y, x.length);
  return o;
}

/** Printable ASCII rendering (non-printables as '.', CR dropped, LF and TAB kept). */
export function bytesToAscii(bytes) {
  let s = '';
  for (const c of bytes) s += (c >= 32 && c < 127) || c === 10 || c === 9 ? String.fromCharCode(c) : c === 13 ? '' : '.';
  return s;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (c) => c.toString(16).padStart(2, '0')).join('');
}

function cell(v) {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function conversationsToCsv(convs) {
  return toCsv([['Protocol', 'Address A', 'Address B', 'Packets', 'Bytes', 'Duration (s)'],
    ...convs.map((c) => [c.proto, c.a, c.b, c.packets, c.bytes, c.duration.toFixed(6)])]);
}
export function endpointsToCsv(eps) {
  return toCsv([['Address', 'Packets', 'Bytes', 'Tx packets', 'Tx bytes', 'Rx packets', 'Rx bytes'],
    ...eps.map((e) => [e.address, e.packets, e.bytes, e.txPackets, e.txBytes, e.rxPackets, e.rxBytes])]);
}
export function protocolsToCsv(rows) {
  return toCsv([['Protocol', 'Packets', 'Bytes'], ...rows.map((r) => [r.proto, r.packets, r.bytes])]);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}
