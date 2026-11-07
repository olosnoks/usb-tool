/**
 * adbTools.js — device-level helpers on top of an AdbConnection: device info
 * from getprop and dumpsys, logcat polling, package management, input events
 * and screencap. Pure parsing functions are exported separately for tests.
 */

// ---------------------------------------------------------------------------
// Device info
// ---------------------------------------------------------------------------

/** `getprop` output ("[key]: [value]" lines) -> { key: value }. */
export function parseGetprop(text) {
  const out = {};
  for (const m of String(text).matchAll(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/gm)) out[m[1]] = m[2];
  return out;
}

export function deviceSummary(p) {
  return [
    ['Manufacturer', p['ro.product.manufacturer']],
    ['Model', p['ro.product.model']],
    ['Device', p['ro.product.device']],
    ['Android', p['ro.build.version.release'] && `${p['ro.build.version.release']} (API ${p['ro.build.version.sdk']})`],
    ['Security patch', p['ro.build.version.security_patch']],
    ['Build', p['ro.build.display.id']],
    ['Fingerprint', p['ro.build.fingerprint']],
    ['CPU ABI', p['ro.product.cpu.abi']],
    ['Hardware', p['ro.hardware'] || p['ro.boot.hardware']],
    ['Serial', p['ro.serialno'] || p['ro.boot.serialno']],
    ['Bootloader', p['ro.bootloader']],
    ['Verified boot', p['ro.boot.verifiedbootstate']],
    ['Bootloader lock', p['ro.boot.flash.locked'] === '1' ? 'locked' : p['ro.boot.flash.locked'] === '0' ? 'unlocked' : undefined],
    ['Debuggable build', p['ro.debuggable'] === '1' ? 'yes' : p['ro.debuggable'] === '0' ? 'no' : undefined]
  ].filter(([, v]) => v);
}

/** `dumpsys battery` -> { level, status, temperature (°C), voltage (V), health, plugged }. */
export function parseBattery(text) {
  const get = (k) => String(text).match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  const status = { 1: 'unknown', 2: 'charging', 3: 'discharging', 4: 'not charging', 5: 'full' }[get('status')];
  const health = { 1: 'unknown', 2: 'good', 3: 'overheat', 4: 'dead', 5: 'over voltage', 6: 'failure', 7: 'cold' }[get('health')];
  const plugged = get('AC powered') === 'true' ? 'AC' : get('USB powered') === 'true' ? 'USB' : get('Wireless powered') === 'true' ? 'wireless' : 'not plugged';
  return {
    level: get('level') !== undefined ? Number(get('level')) : null,
    status, health, plugged,
    temperature: get('temperature') !== undefined ? Number(get('temperature')) / 10 : null,
    voltage: get('voltage') !== undefined ? Number(get('voltage')) / 1000 : null
  };
}

// ---------------------------------------------------------------------------
// Logcat
// ---------------------------------------------------------------------------

const LOGCAT_RE = /^(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?)\s*:\s?(.*)$/;

/** Parse one `logcat -v threadtime` line, or null for headers/continuations. */
export function parseLogcatLine(line) {
  const m = line.match(LOGCAT_RE);
  if (!m) return null;
  return { date: m[1], time: m[2], pid: Number(m[3]), tid: Number(m[4]), level: m[5], tag: m[6].trim(), message: m[7], raw: line };
}

export const LOG_LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];

/**
 * Logcat without a long-lived stream (the connection runs one stream at a
 * time): each poll dumps entries since the last timestamp seen, and skips the
 * lines at that timestamp it already returned.
 */
export class LogcatPoller {
  constructor(conn, { initialLines = 300, buffers = 'main,system,crash' } = {}) {
    this.conn = conn;
    this.initialLines = initialLines;
    this.buffers = buffers;
    this.last = null; // "MM-DD HH:MM:SS.mmm"
    this.seenAtLast = new Set();
  }

  async poll() {
    const since = this.last ? `-T '${this.last}'` : `-t ${this.initialLines}`;
    const text = await this.conn.shell(`logcat -d -v threadtime -b ${this.buffers} ${since}`);
    return this.ingest(text);
  }

  /** Split a dump into new entries (exported for tests). */
  ingest(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const e = parseLogcatLine(line);
      if (!e) continue;
      const stamp = `${e.date} ${e.time}`;
      if (this.last && stamp < this.last) continue;
      if (stamp === this.last && this.seenAtLast.has(line)) continue;
      if (stamp !== this.last) { this.last = stamp; this.seenAtLast = new Set(); }
      this.seenAtLast.add(line);
      out.push(e);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

/** `pm list packages -f [-3]` -> [{ name, apk }], sorted by name. */
export function parsePackages(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^package:(.+)=([\w.]+)$/);
    if (m) out.push({ name: m[2], apk: m[1] });
    else {
      const n = line.trim().match(/^package:([\w.]+)$/);
      if (n) out.push({ name: n[1], apk: null });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** Push an APK to /data/local/tmp and install it with pm. Resolves with pm's output. */
export async function installApk(conn, bytes, { replace = true, downgrade = false, onProgress } = {}) {
  const remote = `/data/local/tmp/skons-${Date.now()}.apk`;
  await conn.push(remote, bytes, { onProgress });
  try {
    const out = (await conn.shell(`pm install ${replace ? '-r ' : ''}${downgrade ? '-d ' : ''}${quote(remote)}`)).trim();
    if (!/Success/.test(out)) throw new Error(out || 'pm install gave no answer.');
    return out;
  } finally {
    await conn.shell(`rm -f ${quote(remote)}`);
  }
}

export async function uninstallPackage(conn, name, { keepData = false } = {}) {
  if (!/^[\w.]+$/.test(name)) throw new Error('Not a package name.');
  const out = (await conn.shell(`pm uninstall ${keepData ? '-k ' : ''}${name}`)).trim();
  if (!/Success/.test(out)) throw new Error(out || 'pm uninstall gave no answer.');
  return out;
}

/** The APK path(s) of an installed package (split APKs give several). */
export async function packagePaths(conn, name) {
  if (!/^[\w.]+$/.test(name)) throw new Error('Not a package name.');
  return (await conn.shell(`pm path ${name}`)).split(/\r?\n/).map((l) => l.trim().replace(/^package:/, '')).filter(Boolean);
}

export async function packageVersion(conn, name) {
  if (!/^[\w.]+$/.test(name)) throw new Error('Not a package name.');
  const text = await conn.shell(`dumpsys package ${name}`);
  return {
    versionName: text.match(/versionName=(\S+)/)?.[1] || null,
    versionCode: text.match(/versionCode=(\d+)/)?.[1] || null,
    firstInstall: text.match(/firstInstallTime=(.+)/)?.[1]?.trim() || null,
    lastUpdate: text.match(/lastUpdateTime=(.+)/)?.[1]?.trim() || null
  };
}

// ---------------------------------------------------------------------------
// Input and screen
// ---------------------------------------------------------------------------

export const KEYCODES = {
  HOME: 3, BACK: 4, CALL: 5, ENDCALL: 6, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, CAMERA: 27,
  ENTER: 66, DEL: 67, MENU: 82, APP_SWITCH: 187, WAKEUP: 224, SLEEP: 223, MEDIA_PLAY_PAUSE: 85
};

export function tapCommand(x, y) { return `input tap ${Math.round(x)} ${Math.round(y)}`; }
export function swipeCommand(x1, y1, x2, y2, ms = 300) { return `input swipe ${[x1, y1, x2, y2].map(Math.round).join(' ')} ${ms}`; }

/** Text for `input text`: spaces become %s and shell metacharacters are escaped. */
export function inputTextCommand(text) {
  const escaped = String(text).replace(/([\\"'`$&|;<>()*?#~!{}[\]])/g, '\\$1').replace(/ /g, '%s');
  return `input text "${escaped}"`;
}

/** "Physical size: 1080x2400" (and an optional override) -> { width, height }. */
export function parseWmSize(text) {
  const all = [...String(text).matchAll(/(\d+)x(\d+)/g)];
  const m = all[all.length - 1];
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// A small PNG encoder (stored deflate) for the simulated device's screencap
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(width, height, rgba) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  // zlib stream of stored (uncompressed) deflate blocks
  const blocks = [];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535));
    const last = i + 65535 >= raw.length ? 1 : 0;
    blocks.push(Uint8Array.from([last, part.length & 0xff, part.length >> 8, ~part.length & 0xff, (~part.length >> 8) & 0xff]), part);
  }
  let a = 1;
  let b = 0;
  for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
  const zlib = concat([Uint8Array.from([0x78, 0x01]), ...blocks, Uint8Array.from([(b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff])]);
  const chunk = (type, data) => {
    const td = concat([new TextEncoder().encode(type), data]);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(td));
    return concat([len, td, crc]);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return concat([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

