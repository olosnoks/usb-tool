/**
 * gcodeSender.js — pure G-code sender logic for Marlin (3D printers) and GRBL 1.1 (CNC).
 *
 * Everything here is hardware-free: line preparation, Marlin line numbers and
 * checksums, reply classification (ok / resend / error / temperature reports),
 * GRBL status reports, GRBL settings, command builders, and the streaming state
 * machine (Marlin: one line in flight with resend handling; GRBL: character
 * counting against the 127-byte planner budget).
 *
 * Out of scope: Klipper (its own host protocol), and any firmware other than
 * Marlin or GRBL 1.1 / grblHAL-style status reports.
 */

/** GRBL 1.1 serial RX buffer is 128 bytes; the common planner-safe budget is 127. */
export const GRBL_RX_BUFFER = 128;
export const GRBL_CHAR_LIMIT = 127;

/** Single-byte realtime commands (sent without a newline, never queued). */
export const REALTIME = Object.freeze({
  STATUS: 0x3f,      // '?'  status report request
  FEED_HOLD: 0x21,   // '!'  feed hold
  CYCLE_START: 0x7e, // '~'  cycle start / resume
  SOFT_RESET: 0x18,  // Ctrl-X soft reset
  JOG_CANCEL: 0x85,  // jog cancel
});

/** UTF-8 byte length of a string (GRBL counts bytes, not characters). */
export function utf8Length(str) {
  let n = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// --- Line preparation ----------------------------------------------------------

/**
 * Remove comments and surrounding whitespace from one G-code line.
 * Handles `; comment` and `(parenthesised)` comments, a leading `N<digits>` line
 * number and a trailing `*<digits>` checksum (so a file that already carries
 * Marlin numbering is not double-numbered). Returns '' for blank/comment-only lines.
 */
export function stripGcode(line) {
  let s = String(line ?? '');
  const semi = s.indexOf(';');
  if (semi >= 0) s = s.slice(0, semi);
  let prev;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  } while (s !== prev);
  s = s.trim().replace(/^N\d+\s+/i, '').replace(/\s*\*\d+\s*$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Turn a whole .gcode file into the list of commands to send.
 * `%` program delimiters (common in CNC output) are skipped.
 * @returns {{ commands: string[], skipped: number }}
 */
export function prepareGcodeLines(text) {
  const commands = [];
  let skipped = 0;
  for (const raw of String(text ?? '').split(/\r\n|\n|\r/)) {
    const cmd = stripGcode(raw);
    if (!cmd || cmd === '%') {
      skipped++;
      continue;
    }
    commands.push(cmd);
  }
  return { commands, skipped };
}

/** Marlin checksum: XOR of every character before the '*'. */
export function marlinChecksum(text) {
  let cs = 0;
  for (let i = 0; i < text.length; i++) cs ^= text.charCodeAt(i);
  return cs;
}

/** `N<n> <cmd>*<checksum>` (no trailing newline). */
export function marlinNumbered(cmd, lineNumber) {
  const body = `N${lineNumber} ${cmd}`;
  return `${body}*${marlinChecksum(body)}`;
}

/** The exact bytes-as-text to transmit for one command, newline included. */
export function encodeForFirmware(firmware, cmd, lineNumber) {
  if (firmware === 'marlin') return `${marlinNumbered(cmd, lineNumber)}\n`;
  return `${cmd}\n`;
}

// --- Number helpers ----------------------------------------------------------------

/** Format a finite number for G-code without exponents or trailing zeros. */
export function fmtNum(n) {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  const s = n.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function parseNumList(val) {
  const parts = String(val).split(',');
  const out = [];
  for (const p of parts) {
    if (p.trim() === '') return null;
    const v = Number(p);
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

// --- Marlin reply parsing ----------------------------------------------------------

const TEMP_RE = /\b(T\d*|B|C):\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?/g;

/**
 * Parse temperature tokens from an M105 reply or an M155 auto-report, e.g.
 * `ok T:201.23 /210.00 B:60.00 /60.00 @:127 B@:0`. `T`, `T0`, `T1`... are hotends,
 * `B` the bed, `C` a chamber. Missing targets are null. Returns null if none found.
 * @returns {{ hotends: {index:number, actual:number, target:number|null}[], bed: object|null, chamber: object|null } | null}
 */
export function parseTempReport(line) {
  const hotends = [];
  let bed = null;
  let chamber = null;
  let any = false;
  for (const m of String(line ?? '').matchAll(TEMP_RE)) {
    any = true;
    const key = m[1];
    const actual = Number(m[2]);
    const target = m[3] !== undefined ? Number(m[3]) : null;
    if (key.startsWith('T')) {
      hotends.push({ index: key === 'T' ? 0 : Number(key.slice(1)), actual, target });
    } else if (key === 'B') {
      bed = { actual, target };
    } else {
      chamber = { actual, target };
    }
  }
  if (!any) return null;
  hotends.sort((a, b) => a.index - b.index);
  return { hotends, bed, chamber };
}

/**
 * Parse an M115 `FIRMWARE_NAME:... KEY:value ...` line into a key/value map.
 * Values may contain spaces and colons; a new key starts at an uppercase `WORD:`.
 */
export function parseMarlinFirmware(line) {
  const fields = {};
  for (const m of String(line).matchAll(/([A-Z_]+):(.*?)(?=\s+[A-Z_]+:|$)/g)) {
    fields[m[1]] = m[2].trim();
  }
  const name = fields.FIRMWARE_NAME || '';
  const v = /(\d+\.\d+(?:\.\d+)*)/.exec(name);
  return { firmware: 'marlin', name, version: v ? v[1] : null, fields };
}

// --- GRBL reply parsing -------------------------------------------------------------

/** `Grbl 1.1h [...]` banner or `[VER:1.1h.20190825:]` ($I reply). Returns the version or null. */
export function parseGrblVersion(line) {
  let m = /^\[VER:([^\]:]+)/.exec(line);
  if (m) return m[1];
  m = /^Grbl\s+(\S+)/i.exec(line);
  return m ? m[1] : null;
}

/** `$<id>=<value> (optional comment)` from a `$$` dump. Returns null for other lines. */
export function parseGrblSetting(line) {
  const m = /^\$(\d+)=(\S+?)\s*(?:\(([^)]*)\))?$/.exec(String(line).trim());
  if (!m) return null;
  return { id: Number(m[1]), value: m[2], comment: m[3] ?? '' };
}

/**
 * Parse a GRBL realtime status report, e.g.
 * `<Run|MPos:1.000,2.000,0.000|FS:500,0|Ov:100,100,100>`.
 * Returns null if the line is not a status report. Unknown fields are ignored.
 */
export function parseGrblStatus(line) {
  const m = /^<([^>]*)>$/.exec(String(line).trim());
  if (!m) return null;
  const [stateRaw, ...rest] = m[1].split('|');
  if (!stateRaw) return null;
  const [state, substate = null] = stateRaw.split(':');
  const status = {
    state, substate, mpos: null, wpos: null, wco: null,
    feed: null, speed: null, overrides: null, buffer: null, pins: null,
  };
  const vec3 = (val) => {
    const v = parseNumList(val);
    return v && v.length >= 3 ? v.slice(0, 3) : null;
  };
  for (const part of rest) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i);
    const val = part.slice(i + 1);
    switch (key) {
      case 'MPos': status.mpos = vec3(val); break;
      case 'WPos': status.wpos = vec3(val); break;
      case 'WCO': status.wco = vec3(val); break;
      case 'FS': {
        const v = parseNumList(val);
        if (v) { status.feed = v[0] ?? null; status.speed = v[1] ?? null; }
        break;
      }
      case 'F': {
        const v = parseNumList(val);
        if (v) status.feed = v[0] ?? null;
        break;
      }
      case 'Ov': {
        const v = parseNumList(val);
        if (v && v.length === 3) status.overrides = { feed: v[0], rapid: v[1], spindle: v[2] };
        break;
      }
      case 'Bf': {
        const v = parseNumList(val);
        if (v && v.length === 2) status.buffer = { planner: v[0], rx: v[1] };
        break;
      }
      case 'Pn': status.pins = val; break;
      default: break;
    }
  }
  return status;
}

/**
 * Work out machine and work coordinates from a status report. GRBL sends WCO only
 * now and then, so pass the last WCO seen as `cachedWco` to fill in the gap:
 * WPos = MPos - WCO and MPos = WPos + WCO.
 */
export function resolveCoordinates(status, cachedWco = null) {
  const wco = status.wco ?? cachedWco ?? null;
  let mpos = status.mpos ?? null;
  let wpos = status.wpos ?? null;
  if (!mpos && wpos && wco) mpos = wpos.map((v, i) => v + wco[i]);
  if (!wpos && mpos && wco) wpos = mpos.map((v, i) => v - wco[i]);
  return { mpos, wpos, wco };
}

// --- Line classification ------------------------------------------------------------

/**
 * Classify one received line (without its line ending).
 * Types: empty, grbl-status, grbl-version, grbl-setting, marlin-firmware, grbl-error,
 * grbl-alarm, resend, ok, temp, marlin-error, busy, echo, text.
 * An `ok` line that also carries temperatures (`ok T:...`, an M105 reply) is type
 * `ok` with `temp` set, and it counts as an acknowledgement.
 */
export function classifyLine(rawLine) {
  const line = String(rawLine ?? '').replace(/\r/g, '').trim();
  if (!line) return { type: 'empty' };

  if (line.startsWith('<') && line.endsWith('>')) {
    const status = parseGrblStatus(line);
    if (status) return { type: 'grbl-status', status };
  }

  const setting = parseGrblSetting(line);
  if (setting) return { type: 'grbl-setting', ...setting };

  const version = parseGrblVersion(line);
  if (version) return { type: 'grbl-version', version };

  if (/^FIRMWARE_NAME:/.test(line)) return { type: 'marlin-firmware', info: parseMarlinFirmware(line) };

  let m = /^error:\s*(\d+)/i.exec(line);
  if (m) return { type: 'grbl-error', code: Number(m[1]) };

  m = /^ALARM:\s*(\d+)/i.exec(line);
  if (m) return { type: 'grbl-alarm', code: Number(m[1]) };

  m = /^(?:Resend:\s*(\d+)|rs\s+N?(\d+))/i.exec(line);
  if (m) return { type: 'resend', lineNumber: Number(m[1] ?? m[2]) };

  const temp = parseTempReport(line);
  if (/^ok(\s|$)/i.test(line)) return { type: 'ok', temp };
  if (temp) return { type: 'temp', temps: temp };

  m = /^Error:\s*(.*)$/i.exec(line);
  if (m) {
    const message = m[1].trim();
    return { type: 'marlin-error', message, lineError: /line number|checksum/i.test(message) };
  }

  if (/^(echo:\s*)?busy/i.test(line)) return { type: 'busy' };
  if (/^echo:/i.test(line)) return { type: 'echo', text: line.slice(5).trim() };
  return { type: 'text', text: line };
}

// --- Command builders -----------------------------------------------------------------

const AXES = ['X', 'Y', 'Z'];

function normAxis(axis) {
  const a = String(axis ?? '').toUpperCase();
  if (!AXES.includes(a)) throw new Error(`Unknown axis "${axis}"`);
  return a;
}

/** Relative jog of one axis. GRBL uses `$J=` jog; Marlin uses relative moves and restores G90. */
export function buildJog(firmware, { axis, distance, feed }) {
  const ax = normAxis(axis);
  const d = Number(distance);
  if (!Number.isFinite(d) || d === 0) throw new Error('Jog distance must be a non-zero number');
  const f = Number(feed);
  if (!(f > 0)) throw new Error('Jog feed must be greater than zero');
  if (firmware === 'grbl') return [`$J=G21G91${ax}${fmtNum(d)}F${fmtNum(f)}`];
  if (firmware === 'marlin') return ['G91', `G1 ${ax}${fmtNum(d)} F${fmtNum(f)}`, 'G90'];
  throw new Error('Unknown firmware');
}

export function homeLines(firmware) {
  if (firmware === 'grbl') return ['$H'];
  if (firmware === 'marlin') return ['G28'];
  throw new Error('Unknown firmware');
}

/** Make the current position the zero for the given axes (work offset on GRBL, G92 on Marlin). */
export function zeroLines(firmware, axes) {
  const list = (Array.isArray(axes) ? axes : [axes]).map(normAxis);
  if (list.length === 0) throw new Error('No axes selected');
  const words = list.map((a) => `${a}0`).join(' ');
  if (firmware === 'grbl') return [`G10 L20 P1 ${words}`];
  if (firmware === 'marlin') return [`G92 ${words}`];
  throw new Error('Unknown firmware');
}

function bounded(value, min, max, what) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${what} must be between ${min} and ${max}`);
  return v;
}

export function hotendLines(temp) {
  return [`M104 S${fmtNum(bounded(temp, 0, 400, 'Hotend temperature'))}`];
}

export function bedLines(temp) {
  return [`M140 S${fmtNum(bounded(temp, 0, 150, 'Bed temperature'))}`];
}

/** Fan speed 0-255 (M106), or fan off (M107). */
export function fanLines(value) {
  if (value === 0 || value === 'off') return ['M107'];
  return [`M106 S${Math.round(bounded(value, 0, 255, 'Fan value'))}`];
}

/** M155 auto-report interval in seconds; 0 turns auto-report off. */
export function autoReportLines(seconds) {
  return [`M155 S${Math.round(bounded(seconds, 0, 60, 'Auto-report interval'))}`];
}

/**
 * Relative extrude (positive mm) or retract (negative mm) at a feed rate in mm/min.
 * M83 switches the extruder to relative mode for the move; M82 restores absolute.
 */
export function extrudeLines(mm, feed) {
  const d = Number(mm);
  if (!Number.isFinite(d) || d === 0) throw new Error('Extrude length must be a non-zero number');
  const f = Number(feed);
  if (!(f > 0)) throw new Error('Feed must be greater than zero');
  return ['M83', `G1 E${fmtNum(d)} F${fmtNum(f)}`, 'M82'];
}

/** Validate and trim a manual console line. Returns '' if nothing should be sent. */
export function normalizeConsoleLine(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').trim();
}

// --- Temperature history ----------------------------------------------------------------

/** One chart sample from a parsed temperature report (values null when not reported). */
export function makeTempSample(t, temps) {
  return {
    t,
    hotend: temps.hotends[0]?.actual ?? null,
    hotendTarget: temps.hotends[0]?.target ?? null,
    bed: temps.bed?.actual ?? null,
    bedTarget: temps.bed?.target ?? null,
  };
}

/** Append a sample, keeping only the newest `maxPoints`. Returns a new array. */
export function appendTempSample(history, sample, maxPoints = 600) {
  const next = [...history, sample];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}

// --- Receive framing --------------------------------------------------------------------

/**
 * Turn a byte stream into complete lines. Keeps a partial line between pushes,
 * drops `\r`, and caps the partial buffer so a runaway stream cannot grow without limit.
 */
export function createLineSplitter({ maxPartial = 65536 } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buf = '';
  return {
    push(bytes) {
      buf += decoder.decode(bytes, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      if (buf.length > maxPartial) buf = '';
      return parts.map((p) => p.replace(/\r$/, ''));
    },
    /** Return any unterminated remainder as a final line and clear it. */
    flush() {
      const rest = buf;
      buf = '';
      return rest ? [rest.replace(/\r$/, '')] : [];
    },
  };
}

// --- Progress --------------------------------------------------------------------------

/** Remaining time from the average pace so far, or null before the first acknowledged line. */
export function estimateRemainingMs({ done, total, elapsedMs }) {
  if (!(total > done)) return 0;
  if (!(done > 0) || !(elapsedMs >= 0)) return null;
  return Math.round((elapsedMs * (total - done)) / done);
}

// --- Streaming state machine -----------------------------------------------------------------

/**
 * Streams prepared commands to a printer or controller, one acknowledgement at a time.
 *
 * Usage: `const out = streamer.start();` send every string in `out`; for every line
 * received, call `const events = streamer.receive(classifyLine(line));` then send
 * `streamer.pump()`. Nothing is sent from inside the class, so it is testable offline.
 *
 * Marlin: the stream opens with `M110 N0` and then sends `N<n> <cmd>*<cs>` lines with
 * exactly one line in flight. `Resend: N` rewinds to line N and the trailing `ok`
 * that Marlin sends with the resend is consumed. Line-number and checksum errors
 * are warnings, since Marlin follows them with a resend. Any other `Error:` halts.
 *
 * GRBL: lines are sent with a newline and at most 127 bytes are unacknowledged at
 * once (character counting). Each `ok` frees the oldest line. `error:N` or `ALARM:N`
 * halts the stream; lines already buffered on the controller still run.
 *
 * States: idle, running, paused, done, halted, stopped.
 */
export class GcodeStreamer {
  /**
   * @param {{ firmware: 'marlin'|'grbl', commands: string[] }} opts  commands already prepared with prepareGcodeLines
   */
  constructor({ firmware, commands }) {
    if (firmware !== 'marlin' && firmware !== 'grbl') throw new Error('firmware must be "marlin" or "grbl"');
    this.firmware = firmware;
    this.preamble = firmware === 'marlin' ? 1 : 0;
    const list = firmware === 'marlin' ? ['M110 N0', ...commands] : [...commands];
    if (firmware === 'grbl') {
      for (const c of list) {
        const bytes = utf8Length(c) + 1;
        if (bytes > GRBL_CHAR_LIMIT) {
          throw new Error(`Line is ${bytes} bytes, longer than the GRBL buffer allows: ${c.slice(0, 40)}...`);
        }
      }
    }
    this.commands = list;
    this.cursor = 0;          // index of the next command not yet transmitted
    this.inflight = [];       // [{ index, bytes }] transmitted, not yet acknowledged
    this.inflightBytes = 0;
    this.acked = 0;           // contiguous commands acknowledged (includes the M110 preamble)
    this.transmitted = 0;     // every transmission, including resends
    this.resends = 0;
    this.errors = 0;
    this.skipOk = 0;          // Marlin: trailing ok to ignore after a Resend
    this.state = 'idle';
    this.reason = null;
  }

  /** Number of user-visible commands (the Marlin preamble is not counted). */
  get total() {
    return this.commands.length - this.preamble;
  }

  start() {
    if (this.state !== 'idle') throw new Error(`Cannot start a stream that is ${this.state}`);
    this.state = 'running';
    this._finishIfDone();
    return this.pump();
  }

  pause() {
    if (this.state === 'running') this.state = 'paused';
  }

  /** Resume a paused stream. Returns the strings to transmit now. */
  resume() {
    if (this.state !== 'paused') return [];
    this.state = 'running';
    this._finishIfDone();
    return this.pump();
  }

  /** Stop sending and forget unacknowledged lines. A finished or halted stream keeps its state. */
  stop() {
    if (this.state === 'running' || this.state === 'paused') {
      this.state = 'stopped';
      this.inflight = [];
      this.inflightBytes = 0;
    }
  }

  /** Strings to transmit now, given the current state. Each already ends in '\n'. */
  pump() {
    if (this.state !== 'running' || this.skipOk > 0) return [];
    const out = [];
    if (this.firmware === 'marlin') {
      if (this.inflight.length === 0 && this.cursor < this.commands.length) {
        out.push(this._transmit(this.cursor));
      }
    } else {
      while (this.cursor < this.commands.length) {
        const text = encodeForFirmware('grbl', this.commands[this.cursor], this.cursor);
        const bytes = utf8Length(text);
        if (this.inflightBytes + bytes > GRBL_CHAR_LIMIT) break;
        out.push(this._transmit(this.cursor));
      }
    }
    return out;
  }

  _transmit(index) {
    const text = encodeForFirmware(this.firmware, this.commands[index], index);
    const bytes = utf8Length(text);
    this.inflight.push({ index, bytes });
    this.inflightBytes += bytes;
    this.cursor = index + 1;
    this.transmitted++;
    return text;
  }

  _halt(reason) {
    if (this.state === 'running' || this.state === 'paused') {
      this.state = 'halted';
      this.reason = reason;
    }
  }

  _finishIfDone() {
    if ((this.state === 'running' || this.state === 'paused')
      && this.cursor >= this.commands.length && this.inflight.length === 0) {
      this.state = 'done';
    }
  }

  /**
   * Feed one classified line (from classifyLine). Returns events describing what happened:
   * { type: 'ack', index } | { type: 'resend', lineNumber } | { type: 'warning', message }
   * | { type: 'error', message } | { type: 'stray-ok' } | { type: 'resend-ok' }.
   */
  receive(c) {
    const events = [];
    if (!c) return events;
    const acceptsAcks = this.state === 'running' || this.state === 'paused' || this.state === 'halted';

    switch (c.type) {
      case 'ok': {
        if (!acceptsAcks) break;
        if (this.skipOk > 0) {
          this.skipOk--;
          events.push({ type: 'resend-ok' });
          break;
        }
        if (this.inflight.length === 0) {
          events.push({ type: 'stray-ok' });
          break;
        }
        const head = this.inflight.shift();
        this.inflightBytes -= head.bytes;
        this.acked = Math.max(this.acked, head.index + 1);
        events.push({ type: 'ack', index: head.index });
        this._finishIfDone();
        break;
      }
      case 'resend': {
        if (this.firmware !== 'marlin' || !acceptsAcks) break;
        this.resends++;
        const n = c.lineNumber;
        if (!Number.isInteger(n) || n < 0 || n > this.commands.length) {
          this._halt(`Printer asked for line ${n}, which is not in this stream`);
          events.push({ type: 'error', message: this.reason });
          break;
        }
        this.inflight = [];
        this.inflightBytes = 0;
        this.cursor = n;
        this.skipOk = 1;
        events.push({ type: 'resend', lineNumber: n });
        break;
      }
      case 'grbl-error': {
        if (this.firmware !== 'grbl' || !acceptsAcks) break;
        this.errors++;
        // GRBL answers the failed line with error:N in place of ok, so it leaves the buffer.
        let where = 'an unknown line';
        if (this.inflight.length > 0) {
          const head = this.inflight.shift();
          this.inflightBytes -= head.bytes;
          where = `command ${head.index + 1}: ${this.commands[head.index]}`;
        }
        const message = `GRBL error:${c.code} at ${where}`;
        this._halt(message);
        events.push({ type: 'error', message });
        break;
      }
      case 'grbl-alarm': {
        if (this.firmware !== 'grbl' || !acceptsAcks) break;
        this.errors++;
        this.inflight = [];
        this.inflightBytes = 0;
        const message = `GRBL ALARM:${c.code}`;
        this._halt(message);
        events.push({ type: 'error', message });
        break;
      }
      case 'marlin-error': {
        if (this.firmware !== 'marlin' || !acceptsAcks) break;
        if (c.lineError) {
          events.push({ type: 'warning', message: c.message });
          break;
        }
        this.errors++;
        const message = `Marlin error: ${c.message}`;
        this._halt(message);
        events.push({ type: 'error', message });
        break;
      }
      default:
        break;
    }
    return events;
  }

  /** Snapshot for the UI. */
  progress() {
    const total = this.total;
    const done = Math.min(total, Math.max(0, this.acked - this.preamble));
    return {
      state: this.state,
      reason: this.reason,
      total,
      done,
      percent: total ? (done / total) * 100 : 100,
      transmitted: this.transmitted,
      resends: this.resends,
      errors: this.errors,
      inFlight: this.inflight.length,
    };
  }
}
