// ============================================================================
//  Piglet Toolkit client — WebSerial client for the WarHog firmware "WT"
//  protocol (SerialTool.cpp). A DOM-free port of web-flasher/toolkit.js from
//  olosnoks/warhog, so it behaves exactly like the hosted web flasher:
//
//    WT HELLO                 -> WT HELLO fw=<v> model=<board> proto=1
//    WT LS <dir>              -> WT DIR <path> | WT F <size> <path> ... WT END
//    WT GET <path>            -> WT BEGIN <size>, WT DATA <b64>..., WT END <crc32>
//    WT PUT <path> <n> <crc>  -> WT READY, (WT DATA <b64>)..., WT OK
//    WT CFG PUT <n> <crc>     -> same, then the firmware reloads the config
//    WT RM <path>             -> WT OK | WT ERR busy|rm
//    WT BYE                   -> ends the session, scanning resumes
//    WT STAT                  -> WT STAT {json}  (device status, like /status.json)
//    WT SCAN START|STOP       -> WT OK scan on|off  (START also ends the session)
//    WT UPLOAD [all|wdgwars|wardrift] -> WT OK <uploaded> <total> <message>
//    WT REBOOT                -> WT OK reboot, then the board restarts
//  The firmware pauses scanning while a session (HELLO) is open and ends it by
//  itself after 30 s without file commands ("WT TIMEOUT"). File operations
//  reopen the session first, so they never share the SD card with a scan.
//  Errors are "WT ERR <reason>". Non-"WT" lines are firmware debug output.
// ============================================================================

const enc = new TextEncoder();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export const hex8 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout'); })]);

// ---- path helpers (same as the flasher's file browser) ----
export const baseName = (p) => p.replace(/\/+$/, '').split('/').pop() || '/';
export const extOf = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
export const parentOf = (p) => (p.replace(/\/[^/]+\/?$/, '') || '/');
export const joinPath = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;

export class PigletToolkitClient {
  /**
   * @param {object} [opts]
   * @param {(msg: string) => void} [opts.onLog]          toolkit log lines
   * @param {(line: string) => void} [opts.onDebugLine]   firmware output not consumed by an operation
   * @param {() => void} [opts.onDisconnect]              port closed / died
   * @param {object} [opts.serial]                        navigator.serial override (tests)
   */
  constructor(opts = {}) {
    this.onLog = opts.onLog || (() => {});
    this.onDebugLine = opts.onDebugLine || (() => {});
    this.onDisconnect = opts.onDisconnect || (() => {});
    this.serial = opts.serial || (typeof navigator !== 'undefined' ? navigator.serial : undefined);
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.readDone = null;      // promise of the running readLoop()
    this.readRestarts = 0;     // consecutive restarts without data (capped)
    this.closing = false;      // true while disconnect() tears down
    this.connected = false;
    this.lineHandler = null;   // current op's line handler, or null
    this.buf = '';             // text accumulator for line framing
    this.info = '';
    this.sessionActive = false; // firmware tool mode (scanning paused) is on
    this._queue = Promise.resolve();
    this._pending = 0;
    this._onSerialDisconnect = (e) => { if (this.port && e.target === this.port) this.disconnect(); };
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  // One reader for the session. On end/error it EXITS — it never re-acquires a
  // reader in a tight loop (a failing read that rejects instantly would otherwise
  // spin on microtasks and freeze the tab, e.g. while the board reboots).
  async readLoop() {
    const dec = new TextDecoder();
    let restart = false;
    try {
      this.reader = this.port.readable.getReader();
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.readRestarts = 0;
        this.buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, nl).replace(/\r$/, '');
          this.buf = this.buf.slice(nl + 1);
          if (line === 'WT TIMEOUT') this.sessionActive = false;   // firmware ended the idle session
          if ((line.startsWith('WT ') || line === 'WT') && this.lineHandler) {
            this.lineHandler(line);
          } else {
            // Firmware debug output, or a WT reply nobody is waiting for (a command
            // typed in the console): hand it to the console view.
            try { this.onDebugLine(line); } catch (e) { /* UI callback must not kill the reader */ }
          }
        }
        if (this.buf.length > 65536) this.buf = this.buf.slice(-4096);   // newline-less flood guard
      }
    } catch (e) {
      // Non-fatal errors (e.g. buffer overrun from a boot-log burst) leave a fresh
      // port.readable behind: restart once via a macrotask, never synchronously.
      if (!this.closing && this.port && this.port.readable && ++this.readRestarts <= 5) restart = true;
      else if (!this.closing) this.onLog('Serial read stopped: ' + e.message);
    } finally {
      try { this.reader.releaseLock(); } catch (e) { /* already released */ }
      this.reader = null;
    }
    if (this.closing) return;
    if (restart) {
      await sleep(100);
      if (!this.closing && this.port && this.port.readable) { this.readDone = this.readLoop(); return; }
    }
    if (this.connected) { this.onLog('Piglet disconnected.'); this.disconnect(); }   // port died under us
  }

  async writeLine(s) {
    if (!this.writer) throw new Error('not connected');
    await this.writer.write(enc.encode(s + '\n'));
  }

  // Run one operation: install a line handler, send the command, resolve when the
  // handler calls done()/fail(). Only one op at a time (the UI serializes).
  // timeoutMs is an idle timeout: it restarts on every line from the device, so a
  // long download only fails if the Piglet goes quiet, not because it is big.
  op(sendFn, handlerFactory, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false, t = null;
      const arm = () => { clearTimeout(t); t = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs || 15000); };
      const finish = (fn) => { if (settled) return; settled = true; clearTimeout(t); this.lineHandler = null; fn(); };
      arm();
      const handler = handlerFactory(
        (val) => finish(() => resolve(val)),
        (err) => finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      );
      this.lineHandler = (line) => {
        arm();
        try { handler(line); } catch (e) { finish(() => reject(e)); }
      };
      Promise.resolve(sendFn()).catch((e) => finish(() => reject(e)));
    });
  }

  // Opening the port can glitch the USB control lines and reset the board, so keep
  // re-sending HELLO (once a second) until the firmware has booted and answers.
  hello(totalMs = 15000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + totalMs;
      let finished = false, iv = null;
      const finish = (fn) => { if (finished) return; finished = true; clearInterval(iv); this.lineHandler = null; fn(); };
      this.lineHandler = (line) => {
        if (line.startsWith('WT HELLO')) finish(() => { this.sessionActive = true; resolve(line.slice(3).trim()); });
      };
      const send = () => {
        if (finished) return;
        if (Date.now() > deadline || this.closing || !this.writer) {
          finish(() => reject(new Error('no reply from the Piglet — flash the latest firmware (it adds the toolkit protocol), then try again')));
          return;
        }
        this.writeLine('WT HELLO').catch(() => {});
      };
      iv = setInterval(send, 1000);
      send();
    });
  }

  _ls(dir) {
    const files = [], dirs = [];
    return this.op(() => this.writeLine('WT LS ' + dir), (done, fail) => (line) => {
      if (line.startsWith('WT F ')) {
        const m = line.match(/^WT F (\d+) (.+)$/);
        if (m) files.push({ size: +m[1], path: m[2] });
      } else if (line.startsWith('WT DIR ')) {
        dirs.push(line.slice(7).trim());
      } else if (line === 'WT END') {
        done({ files, dirs });
      } else if (line.startsWith('WT ERR')) {
        fail(line.slice(3).trim());
      }
    }, 20000);
  }

  _get(path, onProgress) {
    let size = 0, received = 0, begun = false;
    const chunks = [];
    return this.op(() => this.writeLine('WT GET ' + path), (done, fail) => (line) => {
      if (line.startsWith('WT BEGIN ')) {
        size = +line.slice(9).trim();
        begun = true;
      } else if (!begun && (line.startsWith('WT DATA ') || line.startsWith('WT END'))) {
        // Tail of an earlier transfer that failed part-way (getRetry): the firmware
        // answers commands in order, so everything before our BEGIN is stale.
        return;
      } else if (line.startsWith('WT DATA ')) {
        let bytes;
        // Another task's log line can land mid-line on the device's USB serial;
        // fail this attempt (getRetry fetches the file again) instead of throwing.
        try { bytes = b64decode(line.slice(8)); } catch (e) { fail('garbled data line'); return; }
        chunks.push(bytes); received += bytes.length;
        if (onProgress && size) onProgress(received, size);
      } else if (line.startsWith('WT END ')) {
        const crc = parseInt(line.slice(7).trim(), 16) >>> 0;
        const out = new Uint8Array(received);
        let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
        if (received !== size) { fail('short read (' + received + ' of ' + size + ' B)'); return; }
        if ((crc32(out) >>> 0) !== crc) { fail('CRC mismatch'); return; }
        done(out);
      } else if (line.startsWith('WT ERR')) {
        fail(line.slice(3).trim());
      }
    }, 30000);
  }

  // GET with one automatic retry (a flaky SD read on the device, a USB hiccup).
  // "open" errors are not retried: the file isn't there.
  async getRetry(path, onProgress) {
    try { return await this.get(path, onProgress); }
    catch (e) {
      if (/open|nosd/.test(e.message)) throw e;
      this.onLog('GET ' + path + ' failed (' + e.message + '), retrying…');
      return await this.get(path, onProgress);
    }
  }

  _putBytes(cmd, bytes, onProgress) {
    const crc = crc32(bytes);
    const CHUNK = 384;
    return this.op(() => this.writeLine(cmd + ' ' + bytes.length + ' ' + hex8(crc)), (done, fail) => (line) => {
      if (line === 'WT READY') {
        (async () => {
          try {
            for (let i = 0; i < bytes.length; i += CHUNK) {
              const slice = bytes.subarray(i, i + CHUNK);
              await this.writeLine('WT DATA ' + b64encode(slice));
              if (onProgress) onProgress(Math.min(i + CHUNK, bytes.length), bytes.length);
            }
            if (bytes.length === 0) await this.writeLine('WT DATA ');
          } catch (e) { fail(e); }
        })();
      } else if (line.startsWith('WT OK')) {
        done(line.slice(3).trim());
      } else if (line.startsWith('WT ERR')) {
        fail(line.slice(3).trim());
      }
    }, 120000);
  }

  // ---- serialized public operations ----
  // One operation at a time on the wire: each call waits for the previous one,
  // so a status poll can never interleave with a file transfer. File commands
  // reopen the firmware session first (see the header).
  isIdle() { return this._pending === 0; }

  _exclusive(fn, needsSession = true) {
    this._pending++;
    const run = async () => {
      try {
        if (needsSession && this.connected && !this.sessionActive) await this.hello(5000);
        return await fn();
      } finally {
        this._pending--;
      }
    };
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }

  ls(dir) { return this._exclusive(() => this._ls(dir)); }
  get(path, onProgress) { return this._exclusive(() => this._get(path, onProgress)); }
  putBytes(cmd, bytes, onProgress) { return this._exclusive(() => this._putBytes(cmd, bytes, onProgress)); }
  rm(path) { return this._exclusive(() => this._rm(path)); }

  // ---- device control (the Web UI's routes over USB; no session needed) ----
  stat() {
    return this._exclusive(() => this.op(() => this.writeLine('WT STAT'), (done, fail) => (line) => {
      if (line.startsWith('WT STAT ')) {
        try { done(JSON.parse(line.slice(8))); } catch (e) { fail('garbled status line'); }
      } else if (line.startsWith('WT ERR')) fail(line.slice(3).trim());
    }, 5000), false);
  }

  scan(on) {
    return this._exclusive(() => this.op(() => this.writeLine('WT SCAN ' + (on ? 'START' : 'STOP')), (done, fail) => (line) => {
      if (line.startsWith('WT OK')) { if (on) this.sessionActive = false; done(line.slice(3).trim()); }
      else if (line.startsWith('WT ERR')) fail(line.slice(3).trim());
    }, 5000), false);
  }

  // Joins home Wi-Fi if needed and uploads pending logs. The firmware prints no
  // WT lines while it uploads, so the idle timeout is long.
  upload(which = 'all') {
    return this._exclusive(() => this.op(() => this.writeLine('WT UPLOAD ' + which), (done, fail) => (line) => {
      const m = line.match(/^WT OK (\d+) (\d+) ?(.*)$/);
      if (m) done({ uploaded: +m[1], total: +m[2], message: m[3] });
      else if (line.startsWith('WT ERR')) fail(line.slice(3).trim());
    }, 30 * 60 * 1000), false);
  }

  reboot() {
    return this._exclusive(() => this.op(() => this.writeLine('WT REBOOT'), (done, fail) => (line) => {
      if (line.startsWith('WT OK')) done();
      else if (line.startsWith('WT ERR')) fail(line.slice(3).trim());
    }, 5000), false);
  }

  put(path, bytes, onProgress) { return this.putBytes('WT PUT ' + path, bytes, onProgress); }
  cfgPut(bytes, onProgress) { return this.putBytes('WT CFG PUT', bytes, onProgress); }
  cfgGet() { return this.get('/wardriver.cfg'); }

  _rm(path) {
    return this.op(() => this.writeLine('WT RM ' + path), (done, fail) => (line) => {
      if (line.startsWith('WT OK')) done();
      else if (line.startsWith('WT ERR')) fail(line.slice(3).trim());
    }, 15000);
  }

  /**
   * Ask for a port and open a WT session. Resolves with the HELLO info string.
   * @param {object} [port] an already-chosen SerialPort (skips the picker)
   */
  async connect(port) {
    if (!this.serial && !port) throw new Error('WebSerial needs Chrome or Edge on desktop.');
    try {
      this.port = port || await this.serial.requestPort();
      await this.port.open({ baudRate: 115200, bufferSize: 65536 });   // native USB-CDC ignores baud
      // On the ESP32 USB-Serial/JTAG, RTS-high + DTR-low resets the chip. Drive both
      // lines to the idle "run" state, dropping RTS FIRST so we never pass through
      // the reset combination (open() itself may already have glitched them).
      try {
        await this.port.setSignals({ requestToSend: false });
        await this.port.setSignals({ dataTerminalReady: false });
      } catch (e) { /* not every port supports setSignals */ }
      this.closing = false;
      this.readRestarts = 0;
      this.writer = this.port.writable.getWriter();
      this.readDone = this.readLoop();
      if (this.serial && this.serial.addEventListener) this.serial.addEventListener('disconnect', this._onSerialDisconnect);
      const info = await this.hello(15000);
      this.connected = true;
      this.info = info;
      this.onLog('Connected: ' + info);
      return info;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      this.onLog('Connect failed: ' + msg);
      await this.disconnect();
      throw e;
    }
  }

  // Tear down in a fixed order with a timeout on every step, so a dead or
  // rebooting device can never leave the page hanging.
  async disconnect() {
    if (this.closing) return;
    this.closing = true;
    const wasConnected = this.connected;
    this.connected = false;
    this.sessionActive = false;
    this.lineHandler = null;
    if (this.serial && this.serial.removeEventListener) this.serial.removeEventListener('disconnect', this._onSerialDisconnect);
    if (wasConnected && this.writer) { try { await withTimeout(this.writer.write(enc.encode('WT BYE\n')), 500); } catch (e) { /* ignore */ } }
    try { if (this.reader) await withTimeout(this.reader.cancel(), 1000); } catch (e) { /* ignore */ }
    try { if (this.readDone) await withTimeout(this.readDone, 1000); } catch (e) { /* ignore */ }
    try { if (this.writer) this.writer.releaseLock(); } catch (e) { /* ignore */ }
    this.writer = null;
    try { if (this.port) await withTimeout(this.port.close(), 1500); } catch (e) { /* ignore */ }
    this.port = null; this.readDone = null; this.buf = ''; this.info = '';
    this.closing = false;
    try { this.onDisconnect(wasConnected); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
//  wardriver.cfg helpers (same rules as the flasher's form-only editor)
// ---------------------------------------------------------------------------

// Known scalar keys -> form field spec. The raw file text stays the source of
// truth; the form patches key=value lines in place, so comments and keys the
// form doesn't know about are kept.
export const CFG_FIELDS = [
  { k: 'deviceName',           label: 'Device name',             type: 'text' },
  { k: 'board',                label: 'Board',                   type: 'select', opts: ['auto', 's3', 'c5', 'c6', 'c3', 'exp'] },
  { k: 'scanMode',             label: 'Scan mode',               type: 'select', opts: ['aggressive', 'powersaving'] },
  { k: 'speedUnits',           label: 'Speed units',             type: 'select', opts: ['kmh', 'mph'] },
  { k: 'scan24',               label: '2.4 GHz scanning',        type: 'bool' },
  { k: 'scan5',                label: '5 GHz scanning (C5)',     type: 'bool' },
  { k: 'bluetoothScan',        label: 'Bluetooth scanning',      type: 'bool' },
  { k: 'homeSsid',             label: 'Home SSID',               type: 'text' },
  { k: 'homePsk',              label: 'Home password',           type: 'text' },
  { k: 'wardriverSsid',        label: 'AP SSID',                 type: 'text' },
  { k: 'wardriverPsk',         label: 'AP password',             type: 'text' },
  { k: 'wigleBasicToken',      label: 'WiGLE token',             type: 'text' },
  { k: 'wdgwarsApiKey',        label: 'WDGoWars API key',        type: 'text' },
  { k: 'wardriftApiKey',       label: 'Wardrift API key',        type: 'text' },
  { k: 'meshModeOnBoot',       label: 'Mesh mode on boot',       type: 'select', opts: ['none', 'core', 'node'] },
  { k: 'blePersonality',       label: 'Core phone app',          type: 'select', opts: ['biscuit', 'wardrivego'] },
  { k: 'blePhoneSolo',         label: 'Phone bridge in solo',    type: 'bool' },
  { k: 'uploadOnNetworkSeen',  label: 'Upload on home seen',     type: 'bool' },
  { k: 'autoStartAfterUpload', label: 'Auto-start after upload', type: 'bool' },
  { k: 'rotateScreen180',      label: 'Rotate screen 180°',      type: 'bool' }
];

// A real wardriver.cfg is plain key=value text. Refuse anything else so the
// editor can never write binary junk back over a config.
export function looksLikeConfig(bytes) {
  if (!bytes.length) return true;
  let printable = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13 || b >= 0xC2) printable++;
  }
  if (printable / bytes.length < 0.95) return false;
  return /^\s*[A-Za-z][A-Za-z0-9_]*\s*=/m.test(new TextDecoder().decode(bytes));
}

export function cfgReadKey(text, key) {
  const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.*)$', 'm'));
  return m ? m[1].trim() : null;
}

export function cfgSetKey(text, key, val) {
  const re = new RegExp('^(\\s*' + key + '\\s*=).*$', 'm');
  if (re.test(text)) return text.replace(re, (_, lhs) => lhs + val);
  return text.replace(/\s*$/, '') + '\n' + key + '=' + val + '\n';
}

// ---------------------------------------------------------------------------
//  WiGLE CSV parsing for the Networks viewer
// ---------------------------------------------------------------------------
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parse a WiGLE CSV. Lines that aren't a clean row (bad MAC, control bytes,
// short) are counted as unreadable rather than shown.
export function parseWigle(text) {
  const lines = text.split(/\r?\n/);
  let i = 0, preHeader = '';
  if (lines[0] && lines[0].startsWith('WigleWifi')) preHeader = lines[i++];
  if (!lines[i] || !/^MAC,/i.test(lines[i])) return null;          // not a WiGLE log
  const cols = splitCsvLine(lines[i++]).map((c) => c.trim());
  const ix = (n) => cols.findIndex((c) => c.toLowerCase() === n.toLowerCase());
  const C = { mac: ix('MAC'), ssid: ix('SSID'), auth: ix('AuthMode'), seen: ix('FirstSeen'), ch: ix('Channel'),
              freq: ix('Frequency'), rssi: ix('RSSI'), lat: ix('CurrentLatitude'), lon: ix('CurrentLongitude'), type: ix('Type') };
  const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i, BAD = /[\x00-\x08\x0e-\x1f\x7f�]/;
  const rows = []; let bad = 0;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) continue;
    if (BAD.test(ln)) { bad++; continue; }
    const f = splitCsvLine(ln);
    if (f.length < cols.length - 1 || !MAC.test(f[C.mac] || '')) { bad++; continue; }
    const num = (k) => { const v = parseFloat(f[C[k]]); return isFinite(v) ? v : null; };
    rows.push({ mac: f[C.mac].toUpperCase(), ssid: f[C.ssid] || '', auth: f[C.auth] || '', seen: f[C.seen] || '',
                ch: num('ch'), freq: num('freq'), rssi: num('rssi'), lat: num('lat'), lon: num('lon'),
                type: (f[C.type] || '').toUpperCase() || 'WIFI' });
  }
  if (!rows.length) return null;                                     // nothing usable: show as text
  const dev = (preHeader.match(/device=([^,]+)/) || [])[1] || '';
  return { rows, bad, dev };
}
