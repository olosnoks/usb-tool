// Piglet / WarHog Core monitor: parses the Core's periodic debug lines (the
// same lines the serial console shows) into a live dashboard model. Ported
// from the WarHog web flasher's toolkit.js "monitor" module. Pure data: the
// React side renders it.
//
//   [CORE-ISO] SD store q: depth=0 drops=0 | rx_drop txt=0 req=0 txtq_max=1 | rt_us max=2124 gt5ms=0 | loop_us max=0 gt5ms=0 | nodes=0 | heap=95464 heap_min=90804
//   [NODES] n=5 | 0:06FC hb=888ms rx=2 g1 | 1:57C4 hb=42ms rx=0 ! | ...
//   [CORE] cfg -> 06FC: channels=6,157,44;dwell=70;plan=6:70,157:60,44:60
//   [PAIR] grp=1 overlap both=0 either=5 pct=0%
//   [IOSESP] ... enq=12 sent=12 dropFull=0 depth=0
//   [SYS] cpu=240 heap=120000/320000 min=90000 psram=100/8192 sd=27/30408MB up=120
//   [SD] 30408 MB total, 27 MB used
//   [GPS] LOCKED
//   [BUILD] v2.84-fnk0104b  built Nov  1 2026 12:31:38

export const MON_HIST = 120;              // samples kept for sparklines (~10 min at 5 s)
export const NODE_TIMEOUT_MS = 90000;     // matches CORE_NODE_TIMEOUT for the hb bars

export function createMonitor() {
  return {
    iso: null, pair: null, ios: null, gps: null, build: null, sys: null, sd: null,
    nodes: [], nodeMeta: {},              // mac -> { rxPrev, chans, dwell, chlist, bands, plan, dwellLo, dwellHi, group }
    hist: { heap: [], loop: [], rt: [], nodes: [] },
    lines: 0, rate: 0, rateWin: [], firstMs: 0,
    version: 0                            // bumps on every line that changed something
  };
}

export function resetMonitor(mon) {
  Object.assign(mon, createMonitor(), { version: mon.version + 1 });
  return mon;
}

const push = (arr, v) => { arr.push(v); if (arr.length > MON_HIST) arr.shift(); };
const num = (s, re) => { const m = s.match(re); return m ? +m[1] : null; };

/** Feed one serial line. Returns true when the dashboard changed. */
export function monitorFeed(mon, line, now = Date.now()) {
  mon.lines++;
  if (!mon.firstMs) mon.firstMs = now;
  mon.rateWin.push(now);
  while (mon.rateWin.length && now - mon.rateWin[0] > 5000) mon.rateWin.shift();
  mon.rate = mon.rateWin.length / 5;
  let hit = true;
  if (line.startsWith('[CORE-ISO]')) {
    mon.iso = {
      depth: num(line, /depth=(\d+)/), drops: num(line, /drops=(\d+)/),
      rxTxt: num(line, /txt=(\d+)/), rxReq: num(line, /req=(\d+)/), txtqMax: num(line, /txtq_max=(\d+)/),
      rtMax: num(line, /rt_us max=(\d+)/), rtGt5: num(line, /rt_us max=\d+ gt5ms=(\d+)/),
      loopMax: num(line, /loop_us max=(\d+)/), loopGt5: num(line, /loop_us max=\d+ gt5ms=(\d+)/),
      nodes: num(line, /nodes=(\d+)/), heap: num(line, /heap=(\d+)/), heapMin: num(line, /heap_min=(\d+)/)
    };
    if (mon.iso.heap != null) push(mon.hist.heap, mon.iso.heap);
    if (mon.iso.loopMax != null) push(mon.hist.loop, mon.iso.loopMax / 1000);   // ms
    if (mon.iso.rtMax != null) push(mon.hist.rt, mon.iso.rtMax / 1000);
    if (mon.iso.nodes != null) push(mon.hist.nodes, mon.iso.nodes);
  } else if (line.startsWith('[NODES]')) {
    const out = [];
    const re = /(\d+):([0-9A-Fa-f]{2,4})\s+hb=(\d+)ms\s+rx=(\d+)(?:\s+g(\d+))?(!?)/g;
    let m;
    while ((m = re.exec(line))) {
      const mac = m[2].toUpperCase();
      const meta = mon.nodeMeta[mac] || (mon.nodeMeta[mac] = { rxPrev: +m[4], chans: null, dwell: null });
      const drx = Math.max(0, +m[4] - meta.rxPrev); meta.rxPrev = +m[4];
      if (m[5]) meta.group = +m[5];
      out.push({
        idx: +m[1], mac, hb: +m[3], rx: +m[4], drx, warn: m[6] === '!', group: meta.group,
        chans: meta.chans, dwell: meta.dwell, chlist: meta.chlist, bands: meta.bands, plan: meta.plan, dwellLo: meta.dwellLo, dwellHi: meta.dwellHi
      });
    }
    mon.nodes = out;
  } else if (line.startsWith('[IOSESP]')) {
    const enq = num(line, /enq=(\d+)/), sent = num(line, /sent=(\d+)/);
    if (enq != null) mon.ios = { enq, sent, dropFull: num(line, /dropFull=(\d+)/), depth: num(line, /depth=(\d+)/) };
    else hit = false;
  } else if (line.startsWith('[PAIR]')) {
    mon.pair = { grp: num(line, /grp=(\d+)/), both: num(line, /both=(\d+)/), either: num(line, /either=(\d+)/), pct: num(line, /pct=(\d+)/) };
  } else if (line.startsWith('[CORE] cfg -> ')) {
    const m = line.match(/cfg -> ([0-9A-Fa-f]{2,4}): channels=([^;]+);dwell=(\d+)/);
    if (m) {
      const mac = m[1].toUpperCase();
      const meta = mon.nodeMeta[mac] || (mon.nodeMeta[mac] = { rxPrev: 0 });
      const chs = m[2].split(',').map(Number).filter((n) => n > 0);
      meta.chans = chs.length; meta.dwell = +m[3]; meta.chlist = chs;
      const has24 = chs.some((c) => c <= 14), has5 = chs.some((c) => c >= 32);
      meta.bands = has24 && has5 ? '2.4+5' : has5 ? '5' : has24 ? '2.4' : '';
      // Real adaptive per-channel dwell from the Core's ;plan=ch:ms list (pair
      // scheduler). The wire dwell= is just an advisory plain nodes don't use.
      const pm = line.match(/;plan=([0-9:,]+)/);
      if (pm) {
        meta.plan = {}; let lo = 1e9, hi = 0;
        pm[1].split(',').forEach((p) => {
          const kv = p.split(':'); const ch = +kv[0], d = +kv[1];
          if (ch > 0 && d > 0) { meta.plan[ch] = d; if (d < lo) lo = d; if (d > hi) hi = d; }
        });
        meta.dwellLo = lo < 1e9 ? lo : null; meta.dwellHi = hi || null;
      }
      // Keep the roster rows in sync so the chips update before the next [NODES].
      mon.nodes = mon.nodes.map((n) => (n.mac === mac ? { ...n, chans: meta.chans, dwell: meta.dwell, chlist: meta.chlist, bands: meta.bands, plan: meta.plan, dwellLo: meta.dwellLo, dwellHi: meta.dwellHi } : n));
    } else hit = false;
  } else if (line.startsWith('[SYS]')) {
    mon.sys = {
      cpu: num(line, /cpu=(\d+)/),
      heapFree: num(line, /heap=(\d+)/), heapTot: num(line, /heap=\d+\/(\d+)/),
      heapMin: num(line, /min=(\d+)/),
      psFree: num(line, /psram=(\d+)/), psTot: num(line, /psram=\d+\/(\d+)/),
      sdUsed: num(line, /sd=(\d+)/), sdTot: num(line, /sd=\d+\/(\d+)MB/),
      up: num(line, /up=(\d+)/)
    };
  } else if (/^\[SD\] \d+ MB total/.test(line)) {
    mon.sd = { tot: num(line, /(\d+) MB total/), used: num(line, /(\d+) MB used/) };
  } else if (line.startsWith('[GPS]')) {
    mon.gps = /LOCK/i.test(line) ? 'LOCKED' : (/fix|lock/i.test(line) ? 'FIX' : line.replace('[GPS]', '').trim() || 'searching');
  } else if (line.startsWith('[BUILD]')) {
    mon.build = line.replace('[BUILD]', '').trim();
  } else hit = false;
  if (hit) mon.version++;
  return hit;
}

// ---- formatting helpers shared by the dashboard ----
export const fmtKb = (b) => (b == null ? '--' : (b / 1024).toFixed(1) + ' KB');
export const fmtMb = (b) => (b == null ? '--' : (b / 1048576).toFixed(1) + ' MB');
export const fmtGbMb = (m) => (m == null ? '--' : m >= 1024 ? (m / 1024).toFixed(1) + ' GB' : m + ' MB');
export const fmtUp = (sec) => (sec >= 3600
  ? Math.floor(sec / 3600) + 'h' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'));
export const fmtClock = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

/** "70ms", "50-120ms" or "?ms" for a roster row. */
export function dwellText(nd) {
  if (nd.dwellLo && nd.dwellHi) return nd.dwellLo === nd.dwellHi ? nd.dwellLo + 'ms' : nd.dwellLo + '-' + nd.dwellHi + 'ms';
  return (nd.dwell || '?') + 'ms';
}

/** model= / fw= from the HELLO info string. */
export function helloField(info, key) {
  const m = (info || '').match(new RegExp(key + '=(\\S+)'));
  return m ? m[1] : null;
}
