import { blobChunks } from './adbDriver';

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

/**
 * Push an APK (bytes or a File/Blob, streamed) to /data/local/tmp and install it
 * with pm. Resolves with pm's output. `onProgress` gets a 0..1 fraction.
 */
export async function installApk(conn, apk, { replace = true, downgrade = false, onProgress } = {}) {
  const remote = `/data/local/tmp/skons-${Date.now()}.apk`;
  const progress = onProgress ? (f) => onProgress(f) : undefined;
  if (apk instanceof Uint8Array) await conn.push(remote, apk, { onProgress: progress });
  else await conn.pushFrom(apk, remote, { onProgress: progress });
  try {
    const out = (await conn.shell(`pm install ${replace ? '-r ' : ''}${downgrade ? '-d ' : ''}${quote(remote)}`)).trim();
    if (!/Success/.test(out)) throw new Error(out || 'pm install gave no answer.');
    return out;
  } finally {
    await conn.shell(`rm -f ${quote(remote)}`);
  }
}

const apkSize = (a) => (a.blob ? a.blob.size : a.bytes.length);
const apkBlob = (a) => a.blob || new Blob([a.bytes]);

/**
 * Install several APKs as one package (a base APK plus its splits) with a pm
 * install session: install-create, then install-write per file streamed over
 * `exec:` stdin, then install-commit. `apks` is [{ name, blob | bytes }].
 * `onProgress(fraction, bytesDone, totalBytes)`. A failed or cancelled session
 * is cleaned up with install-abandon.
 */
export async function installMultiple(conn, apks, { replace = true, downgrade = false, onProgress, signal } = {}) {
  if (!apks?.length) throw new Error('No APK files to install.');
  const total = apks.reduce((n, a) => n + apkSize(a), 0);
  const created = (await conn.shell(`pm install-create ${replace ? '-r ' : ''}${downgrade ? '-d ' : ''}-S ${total}`)).trim();
  const sid = created.match(/\[(\d+)\]/)?.[1];
  if (!/Success/.test(created) || !sid) throw new Error(created || 'pm install-create gave no session.');
  try {
    let done = 0;
    for (let i = 0; i < apks.length; i++) {
      const a = apks[i];
      const size = apkSize(a);
      const remoteName = `${i}_${String(a.name).replace(/[^\w.-]/g, '_')}`;
      const stream = await conn.open(`exec:pm install-write -S ${size} ${sid} ${remoteName} -`);
      for await (const chunk of blobChunks(apkBlob(a), 256 * 1024)) {
        if (signal?.aborted) { await stream.close(); throw new Error('Cancelled.'); }
        await stream.write(chunk);
        done += chunk.length;
        onProgress?.(total ? done / total : 1, done, total);
      }
      const reply = new TextDecoder().decode(await conn._collect(stream));
      if (!/Success/.test(reply)) throw new Error(`install-write ${a.name}: ${reply.trim() || 'no answer'}`);
    }
    const out = (await conn.shell(`pm install-commit ${sid}`)).trim();
    if (!/Success/.test(out)) throw new Error(out || 'pm install-commit gave no answer.');
    return out;
  } catch (e) {
    try { await conn.shell(`pm install-abandon ${sid}`); } catch (e2) { /* ignore */ }
    throw e;
  }
}

// Device-dependent split selection for bundletool `.apks` archives.
const ABI_NAMES = ['arm64_v8a', 'armeabi_v7a', 'armeabi', 'x86_64', 'x86', 'mips64', 'mips'];
const DENSITY_DPI = { ldpi: 120, mdpi: 160, tvdpi: 213, hdpi: 240, xhdpi: 320, xxhdpi: 480, xxxhdpi: 640 };

/** The device's ABI list (`_`-spelled, as in split names) and screen density. */
export async function deviceInstallProfile(conn) {
  const abilist = (await conn.shell('getprop ro.product.cpu.abilist')).trim();
  const density = Number((await conn.shell('wm density')).match(/(\d+)\s*$/m)?.[1]) || null;
  return { abis: abilist.split(',').map((a) => a.trim().replace(/-/g, '_')).filter(Boolean), density };
}

/**
 * Choose which entries of a bundletool `.apks` archive to install together:
 * universal.apk alone if present, otherwise each module's master split plus the
 * ABI split the device runs, the closest screen-density split and the listed
 * languages. Returns { names, skipped }. Throws if the archive only holds
 * standalone APKs for CPUs the device does not run.
 */
export function selectApksSet(entryNames, { abis = [], density = null, languages = ['en'] } = {}) {
  const apks = entryNames.filter((n) => /\.apk$/i.test(n));
  if (apks.includes('universal.apk')) return { names: ['universal.apk'], skipped: apks.filter((n) => n !== 'universal.apk') };
  const splits = apks.filter((n) => n.startsWith('splits/'));
  if (!splits.length) {
    const standalone = apks.filter((n) => n.startsWith('standalones/'));
    for (const abi of abis) {
      const hit = standalone.find((n) => n.replace(/-/g, '_').includes(abi));
      if (hit) return { names: [hit], skipped: standalone.filter((n) => n !== hit) };
    }
    if (standalone.length === 1) return { names: standalone, skipped: [] };
    throw new Error("This .apks archive has no splits/ folder and no standalone APK for this device's CPU.");
  }
  const names = []; const skipped = [];
  const bestDensity = new Map();
  for (const n of splits) {
    const base = n.split('/').pop().replace(/\.apk$/i, '');
    const dash = base.lastIndexOf('-');
    const module = dash < 0 ? base : base.slice(0, dash);
    const config = dash < 0 ? 'master' : base.slice(dash + 1);
    if (config.startsWith('master')) names.push(n);
    else if (ABI_NAMES.includes(config)) (abis.includes(config) ? names : skipped).push(n);
    else if (DENSITY_DPI[config]) {
      const dist = Math.abs(DENSITY_DPI[config] - (density || 480));
      const prev = bestDensity.get(module);
      if (!prev || dist < prev.dist) { if (prev) skipped.push(prev.n); bestDensity.set(module, { n, dist }); } else skipped.push(n);
    } else if (/^[a-z]{2,3}(_[A-Za-z0-9]+)?$/.test(config) && languages.includes(config.split('_')[0])) names.push(n);
    else skipped.push(n);
  }
  for (const { n } of bestDensity.values()) names.push(n);
  return { names, skipped };
}

/**
 * Open an install bundle and return what to pass to installMultiple():
 * { apks: [{ name, bytes }], notes: [string] }. Handles .xapk / .apkm (a zip of
 * split APKs, optionally with manifest.json) and bundletool .apks. The archive
 * is read into memory (the APKs are small next to media). `profile` is
 * deviceInstallProfile()'s result; it only matters for .apks.
 */
export async function apkSetFromArchive(file, profile = {}) {
  const JSZip = (await import('jszip')).default;
  const data = file instanceof Uint8Array ? file : await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const notes = [];
  let chosen;
  const isBundle = names.includes('toc.pb') || names.includes('universal.apk') || names.some((n) => n.startsWith('splits/') || n.startsWith('standalones/'));
  if (isBundle) {
    const sel = selectApksSet(names, profile);
    chosen = sel.names;
    if (sel.skipped.length) notes.push(`${sel.skipped.length} split(s) for other CPUs, screen densities or languages were skipped.`);
  } else {
    let listed = null;
    if (names.includes('manifest.json')) {
      try {
        const m = JSON.parse(await zip.file('manifest.json').async('string'));
        if (Array.isArray(m.split_apks)) listed = m.split_apks.map((x) => x.file).filter((f) => names.includes(f));
      } catch (e) { /* fall back to every root .apk */ }
    }
    chosen = listed?.length ? listed : names.filter((n) => /\.apk$/i.test(n) && !n.includes('/'));
  }
  if (!chosen.length) throw new Error('No .apk files found in this archive.');
  const obb = names.filter((n) => /^Android\/(obb|data)\//i.test(n) || /\.obb$/i.test(n));
  if (obb.length) notes.push(`${obb.length} expansion (OBB/data) file(s) in the archive are not installed; copy them to /sdcard/Android/obb/<package>/ separately.`);
  const apks = [];
  for (const n of chosen) apks.push({ name: n.split('/').pop(), bytes: await zip.file(n).async('uint8array') });
  return { apks, notes };
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

/** Swipe duration in ms from how long the user dragged, kept in a range Android accepts well. */
export function swipeDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 300;
  return Math.min(2000, Math.max(50, Math.round(n)));
}

/** `screenrecord` command line. Android caps one recording at 180 s; bitRateMbps is in Mbit/s. */
export function screenrecordCommand(path, { seconds = 10, bitRateMbps = 4, size = '' } = {}) {
  const t = Math.min(180, Math.max(1, Math.round(Number(seconds)) || 10));
  const br = Math.min(50, Math.max(1, Number(bitRateMbps) || 4));
  const sz = /^\d{2,5}x\d{2,5}$/.test(size) ? ` --size ${size}` : '';
  return `screenrecord --time-limit ${t} --bit-rate ${Math.round(br * 1e6)}${sz} ${quote(path)}`;
}

/** `ip -o -4 addr show` (or `ip addr`) output -> [{ iface, ip }], skipping loopback. */
export function parseIpAddresses(text) {
  const out = [];
  let iface = '';
  for (const line of String(text).split(/\r?\n/)) {
    const header = line.match(/^\d+:\s+([^\s:@]+)/);
    if (header) iface = header[1];
    const m = line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (!m) continue;
    const name = header ? header[1] : iface;
    if (m[1].startsWith('127.') || name === 'lo') continue;
    out.push({ iface: name, ip: m[1] });
  }
  return out;
}

/** The desktop command that connects to a device after `tcpip`. */
export function adbConnectCommand(ip, port = 5555) {
  return `adb connect ${ip}:${Number(port) || 5555}`;
}

/**
 * Logcat search. Whitespace-separated terms are ANDed: `tag:Foo`, `pid:123`, `-word` (exclude),
 * `/regex/i` (regular expression on tag + message; no spaces, use s), anything else is a case-insensitive substring.
 * A bare number also matches the PID.
 */
export function compileLogcatQuery(query) {
  const preds = [];
  for (const raw of String(query || '').trim().split(/\s+/).filter(Boolean)) {
    let term = raw; let neg = false;
    if (term.length > 1 && term[0] === '-') { neg = true; term = term.slice(1); }
    let test;
    const re = term.match(/^\/(.+)\/(i?)$/);
    if (re) {
      let rx;
      try { rx = new RegExp(re[1], re[2]); } catch (e) { return { error: `Bad regular expression: ${e.message}`, test: () => true }; }
      test = (e) => rx.test(`${e.tag} ${e.message}`);
    } else if (/^tag:/i.test(term)) {
      const v = term.slice(4).toLowerCase();
      test = (e) => e.tag.toLowerCase().includes(v);
    } else if (/^pid:/i.test(term)) {
      const v = term.slice(4);
      test = (e) => String(e.pid) === v;
    } else {
      const v = term.toLowerCase();
      test = (e) => e.tag.toLowerCase().includes(v) || e.message.toLowerCase().includes(v) || String(e.pid) === term;
    }
    preds.push(neg ? (e) => !test(e) : test);
  }
  return { error: null, test: (e) => preds.every((p) => p(e)) };
}

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

// ---------------------------------------------------------------------------
// Folder pull and bugreport
// ---------------------------------------------------------------------------

/**
 * Recursively list the files under `remoteDir`: { files: [{ path, rel, size }],
 * skipped: [string] }. Symlinks are skipped (they can loop); unreadable folders
 * are reported in `skipped` instead of stopping the walk.
 */
export async function walkRemote(conn, remoteDir, { signal } = {}) {
  const root = remoteDir.replace(/\/?$/, '/');
  const files = []; const skipped = [];
  const stack = [''];
  while (stack.length) {
    if (signal?.aborted) throw new Error('Cancelled.');
    const rel = stack.pop();
    let entries;
    try { entries = await conn.list(root + rel); } catch (e) { skipped.push(`${root}${rel} (${e.message})`); continue; }
    for (const e of entries) {
      if (e.name.includes('/') || e.name === '.' || e.name === '..') continue;
      if (e.isLink) { skipped.push(`${root}${rel}${e.name} (symlink)`); continue; }
      if (e.isDir) stack.push(`${rel}${e.name}/`);
      else files.push({ path: `${root}${rel}${e.name}`, rel: `${rel}${e.name}`, size: e.size });
    }
  }
  return { files, skipped };
}

/**
 * Pull a remote folder into a sink: anything with `openFile(rel) -> writable`
 * (see directoryHandleSink / createZipSink). Files are streamed one at a time;
 * a file that fails is recorded and the pull carries on.
 * `onProgress({ fraction, bytes, total, file })`.
 */
export async function pullDirectory(conn, remoteDir, sink, { onProgress, signal } = {}) {
  const { files, skipped } = await walkRemote(conn, remoteDir, { signal });
  const total = files.reduce((n, f) => n + f.size, 0);
  let bytes = 0; let pulled = 0;
  const failed = [];
  for (const f of files) {
    if (signal?.aborted) throw new Error('Cancelled.');
    let writable = null;
    const before = bytes;
    try {
      writable = await sink.openFile(f.rel);
      await conn.pullTo(f.path, writable, {
        total: f.size,
        signal,
        onProgress: (_frac, b) => { bytes = before + b; onProgress?.({ fraction: total ? bytes / total : 1, bytes, total, file: f.rel }); }
      });
      await writable.close?.();
      pulled++;
    } catch (e) {
      try { await writable?.abort?.(); } catch (e2) { /* ignore */ }
      bytes = before;
      if (/^Cancelled/.test(e.message)) throw e;
      failed.push({ path: f.path, error: e.message });
    }
  }
  return { files: pulled, bytes, total, skipped, failed };
}

/** A sink that writes into a folder the user picked (File System Access directory handle). */
export function directoryHandleSink(rootHandle) {
  return {
    async openFile(rel) {
      const parts = rel.split('/');
      const name = parts.pop();
      let dir = rootHandle;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      return handle.createWritable();
    }
  };
}

/** A sink that collects files into a zip (JSZip). `generate()` returns the zip Blob. */
export async function createZipSink() {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  return {
    openFile(rel) {
      const parts = [];
      return { write: (c) => { parts.push(c); }, close: () => { zip.file(rel, new Blob(parts)); } };
    },
    generate: () => zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  };
}

/** Parse one line of `bugreportz -p` output. */
export function parseBugreportLine(line) {
  const t = String(line).trim();
  let m = t.match(/^PROGRESS:(\d+)\/(\d+)$/);
  if (m) return { type: 'progress', done: Number(m[1]), total: Number(m[2]) };
  m = t.match(/^OK:(.+)$/);
  if (m) return { type: 'ok', path: m[1] };
  m = t.match(/^FAIL:(.*)$/);
  if (m) return { type: 'fail', message: m[1] };
  return null;
}

/**
 * Run `bugreportz -p` (Android 7+) and resolve with the path of the zip it wrote
 * on the device; fetch it with conn.pullTo(). `onProgress(fraction)`.
 */
export async function runBugreport(conn, { onProgress, signal } = {}) {
  const stream = await conn.open('shell:bugreportz -p');
  let buf = ''; let path = null; let failure = null;
  const dec = new TextDecoder();
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('Cancelled.');
      const chunk = await stream.read();
      if (chunk === null) break;
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const ev = parseBugreportLine(line);
        if (ev?.type === 'progress') onProgress?.(ev.total ? ev.done / ev.total : 0);
        else if (ev?.type === 'ok') path = ev.path;
        else if (ev?.type === 'fail') failure = ev.message;
      }
    }
  } finally { await stream.close(); }
  const tail = parseBugreportLine(buf);
  if (tail?.type === 'ok') path = tail.path;
  if (failure !== null) throw new Error(`bugreportz failed: ${failure || 'no reason given'}`);
  if (!path) throw new Error('bugreportz did not report a file (it needs Android 7 or newer).');
  return path;
}

// ---------------------------------------------------------------------------
// Interactive shell: a tiny terminal model (no full-screen apps)
// ---------------------------------------------------------------------------

/**
 * Turns a pty byte stream into plain lines: ANSI sequences are dropped (except
 * erase-to-end-of-line and cursor left/right, which shells use to redraw their
 * input), \r returns to column 0, \b/DEL step left, \n starts a line. Not an
 * emulator: full-screen programs (vi, top) will not render.
 */
export class TerminalText {
  constructor({ maxLines = 3000 } = {}) {
    this.maxLines = maxLines;
    this.lines = [];
    this.cur = '';
    this.pos = 0;
    this.pending = '';
  }

  get text() { return [...this.lines, this.cur].join('\n'); }

  clear() { this.lines = []; this.cur = ''; this.pos = 0; this.pending = ''; }

  _put(ch) {
    this.cur = this.pos < this.cur.length ? this.cur.slice(0, this.pos) + ch + this.cur.slice(this.pos + 1) : this.cur + ch;
    this.pos++;
  }

  _csi(params, final) {
    const n = Number(params.split(';')[0]) || 0;
    if (final === 'K') {
      if (n === 0) this.cur = this.cur.slice(0, this.pos);
      else if (n === 2) { this.cur = ''; this.pos = 0; }
    } else if (final === 'D') this.pos = Math.max(0, this.pos - (n || 1));
    else if (final === 'C') this.pos = Math.min(this.cur.length, this.pos + (n || 1));
  }

  append(chunk) {
    const s = this.pending + chunk;
    this.pending = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\x1b') {
        const rest = s.slice(i);
        const csi = rest.match(/^\x1b\[([0-?]*)[ -/]*([@-~])/);
        if (csi) { this._csi(csi[1], csi[2]); i += csi[0].length - 1; continue; }
        const osc = rest.match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/);
        if (osc) { i += osc[0].length - 1; continue; }
        const two = rest.match(/^\x1b(?:[()#][A-Za-z0-9]|[=>78MDEHc])/);
        if (two) { i += two[0].length - 1; continue; }
        if (rest.length < 64 && (rest === '\x1b' || /^\x1b\[[0-?]*[ -/]*$/.test(rest) || /^\x1b\][^\x07\x1b]*\x1b?$/.test(rest) || /^\x1b[()#]$/.test(rest))) { this.pending = rest; break; }
        continue; // stray ESC
      }
      if (ch === '\n') {
        this.lines.push(this.cur); this.cur = ''; this.pos = 0;
        if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
      } else if (ch === '\r') this.pos = 0;
      else if (ch === '\b' || ch === '\x7f') this.pos = Math.max(0, this.pos - 1);
      else if (ch === '\t') { const n = 8 - (this.pos % 8); for (let k = 0; k < n; k++) this._put(' '); }
      else if (ch < ' ') continue;
      else this._put(ch);
    }
    return this.text;
  }
}
