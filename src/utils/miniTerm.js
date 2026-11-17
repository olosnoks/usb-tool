// Lightweight in-house terminal emulator core (no dependencies).
//
// Used by TerminalEmulator.jsx when xterm.js is not available in the project.
// It is NOT a full VT/xterm implementation. Supported: printable text (UTF-8,
// streamed), CR/LF/BS/TAB/BEL, cursor movement (CSI A B C D E F G H f d, ESC 7/8,
// CSI s/u), erase (J, K), insert/delete chars and lines (@ P L M), SGR 16-colour
// foreground + bold, and the alternate screen (CSI ?47/1047/1049 h/l) so that
// full-screen programs such as vi and top draw on a separate screen.
// Not supported: scroll regions, 256/truecolor, background colours, mouse
// reporting, character sets, wide-character width handling.

const SGR_FG = {
  30: 'text-slate-500', 31: 'text-rose-400', 32: 'text-emerald-400', 33: 'text-amber-400',
  34: 'text-cyan-400', 35: 'text-purple-400', 36: 'text-teal-400', 37: 'text-slate-200',
  90: 'text-slate-600', 91: 'text-rose-300', 92: 'text-emerald-300', 93: 'text-amber-300',
  94: 'text-cyan-300', 95: 'text-purple-300', 96: 'text-teal-300', 97: 'text-white',
};

export class MiniTerm {
  constructor({ cols = 80, rows = 24, scrollback = 10000 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.scrollback = scrollback;
    this.decoder = new TextDecoder('utf-8', { fatal: false });
    this.reset();
  }

  reset() {
    this.lines = [];
    for (let i = 0; i < this.rows; i++) this.lines.push([]);
    this.x = 0;
    this.y = 0;
    this.style = '';
    this.state = 'ground';
    this.params = '';
    this.saved = null;
    this.alt = null;
    this.bracketedPaste = false; // set by the device via CSI ?2004 h/l
    this.version = 0;
  }

  resize(cols, rows) {
    cols = Math.max(2, cols | 0);
    rows = Math.max(1, rows | 0);
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    // Keep the bottom of the buffer anchored to the screen bottom.
    while (this.lines.length < rows) this.lines.push([]);
    this.rows = rows;
    this.x = Math.min(this.x, cols - 1);
    this.y = Math.min(this.y, rows - 1);
    this.version++;
  }

  get top() { return this.lines.length - this.rows; }

  _row(y) { return this.lines[this.top + y]; }

  _lineFeed() {
    if (this.y >= this.rows - 1) {
      this.lines.push([]);
      const max = this.rows + (this.alt ? 0 : this.scrollback);
      if (this.lines.length > max) this.lines.splice(0, this.lines.length - max);
    } else {
      this.y++;
    }
  }

  _put(ch) {
    if (this.x >= this.cols) { this.x = 0; this._lineFeed(); }
    const row = this._row(this.y);
    while (row.length < this.x) row.push([' ', '']);
    row[this.x] = [ch, this.style];
    this.x++;
  }

  /** Feed raw bytes (Uint8Array) from the serial port. */
  write(bytes) {
    this.writeText(this.decoder.decode(bytes, { stream: true }));
  }

  writeText(text) {
    for (const ch of text) this._feed(ch);
    this.version++;
  }

  _feed(ch) {
    const code = ch.codePointAt(0);
    if (this.state === 'osc') {
      if (code === 0x07 || code === 0x9c) this.state = 'ground';
      else if (code === 0x1b) this.state = 'oscEsc';
      return;
    }
    if (this.state === 'oscEsc') { this.state = 'ground'; return; }
    if (this.state === 'esc') {
      this.state = 'ground';
      if (ch === '[') { this.state = 'csi'; this.params = ''; }
      else if (ch === ']') this.state = 'osc';
      else if (ch === '7') this.saved = { x: this.x, y: this.y, style: this.style };
      else if (ch === '8' && this.saved) { this.x = this.saved.x; this.y = Math.min(this.saved.y, this.rows - 1); this.style = this.saved.style; }
      else if (ch === 'c') this.reset();
      else if (ch === 'D') this._lineFeed();
      else if (ch === 'M') { if (this.y > 0) this.y--; }
      else if (ch === '(' || ch === ')') this.state = 'charset';
      return;
    }
    if (this.state === 'charset') { this.state = 'ground'; return; }
    if (this.state === 'csi') {
      if ((code >= 0x30 && code <= 0x3f) || (code >= 0x20 && code <= 0x2f)) { this.params += ch; return; }
      this.state = 'ground';
      this._csi(ch, this.params);
      return;
    }
    // ground
    if (code === 0x1b) { this.state = 'esc'; return; }
    if (code === 0x0d) { this.x = 0; return; }
    if (code === 0x0a || code === 0x0b || code === 0x0c) { this._lineFeed(); return; }
    if (code === 0x08) { this.x = Math.max(0, Math.min(this.x, this.cols - 1) - 1); return; }
    if (code === 0x09) { this.x = Math.min(this.cols - 1, (this.x + 8) & ~7); return; }
    if (code === 0x07 || code < 0x20 || code === 0x7f) return;
    this._put(ch);
  }

  _csi(final, rawParams) {
    const priv = rawParams.startsWith('?');
    const nums = rawParams.replace(/^[?>!]/, '').split(';').map((p) => (p === '' ? NaN : parseInt(p, 10)));
    const n = (i, d) => (Number.isFinite(nums[i]) && nums[i] > 0 ? nums[i] : d);
    const clampX = () => { this.x = Math.max(0, Math.min(this.cols - 1, this.x)); };
    switch (final) {
      case 'A': this.y = Math.max(0, this.y - n(0, 1)); break;
      case 'B': case 'e': this.y = Math.min(this.rows - 1, this.y + n(0, 1)); break;
      case 'C': this.x = Math.min(this.cols - 1, this.x + n(0, 1)); break;
      case 'D': this.x = Math.max(0, Math.min(this.x, this.cols - 1) - n(0, 1)); break;
      case 'E': this.y = Math.min(this.rows - 1, this.y + n(0, 1)); this.x = 0; break;
      case 'F': this.y = Math.max(0, this.y - n(0, 1)); this.x = 0; break;
      case 'G': case '`': this.x = Math.min(this.cols - 1, n(0, 1) - 1); break;
      case 'd': this.y = Math.min(this.rows - 1, n(0, 1) - 1); break;
      case 'H': case 'f':
        this.y = Math.min(this.rows - 1, n(0, 1) - 1);
        this.x = Math.min(this.cols - 1, n(1, 1) - 1);
        break;
      case 'J': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        clampX();
        if (mode === 0) {
          this._row(this.y).length = Math.min(this._row(this.y).length, this.x);
          for (let y = this.y + 1; y < this.rows; y++) this.lines[this.top + y] = [];
        } else if (mode === 1) {
          const row = this._row(this.y);
          for (let i = 0; i <= this.x && i < row.length; i++) row[i] = [' ', ''];
          for (let y = 0; y < this.y; y++) this.lines[this.top + y] = [];
        } else {
          for (let y = 0; y < this.rows; y++) this.lines[this.top + y] = [];
          if (mode === 3 && !this.alt) this.lines.splice(0, this.top);
        }
        break;
      }
      case 'K': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        clampX();
        const row = this._row(this.y);
        if (mode === 0) row.length = Math.min(row.length, this.x);
        else if (mode === 1) for (let i = 0; i <= this.x && i < row.length; i++) row[i] = [' ', ''];
        else row.length = 0;
        break;
      }
      case '@': { clampX(); const row = this._row(this.y); while (row.length < this.x) row.push([' ', '']); row.splice(this.x, 0, ...Array.from({ length: n(0, 1) }, () => [' ', ''])); if (row.length > this.cols) row.length = this.cols; break; }
      case 'P': { clampX(); this._row(this.y).splice(this.x, n(0, 1)); break; }
      case 'L': { const k = n(0, 1); for (let i = 0; i < k; i++) { this.lines.splice(this.top + this.rows - 1, 1); this.lines.splice(this.top + this.y, 0, []); } break; }
      case 'M': { const k = n(0, 1); for (let i = 0; i < k; i++) { this.lines.splice(this.top + this.y, 1); this.lines.splice(this.top + this.rows - 1, 0, []); } break; }
      case 's': this.saved = { x: this.x, y: this.y, style: this.style }; break;
      case 'u': if (this.saved) { this.x = this.saved.x; this.y = Math.min(this.saved.y, this.rows - 1); } break;
      case 'm': this._sgr(nums); break;
      case 'h': case 'l':
        if (priv && nums.some((v) => v === 47 || v === 1047 || v === 1049)) this._altScreen(final === 'h');
        if (priv && nums.includes(2004)) this.bracketedPaste = final === 'h';
        break;
      default: break;
    }
  }

  _altScreen(on) {
    if (on && !this.alt) {
      this.alt = { lines: this.lines, x: this.x, y: this.y };
      this.lines = Array.from({ length: this.rows }, () => []);
      this.x = 0; this.y = 0;
    } else if (!on && this.alt) {
      this.lines = this.alt.lines;
      this.x = this.alt.x; this.y = this.alt.y;
      this.alt = null;
      while (this.lines.length < this.rows) this.lines.push([]);
    }
  }

  _sgr(nums) {
    const list = nums.length ? nums : [0];
    let color = this.style.split(' ').find((c) => c.startsWith('text-')) || '';
    let bold = this.style.includes('font-bold');
    for (const v of list) {
      if (!Number.isFinite(v) || v === 0) { color = ''; bold = false; }
      else if (v === 1) bold = true;
      else if (v === 22) bold = false;
      else if (v === 39) color = '';
      else if (SGR_FG[v]) color = SGR_FG[v];
    }
    this.style = [color, bold ? 'font-bold' : ''].filter(Boolean).join(' ');
  }

  /** Rows as arrays of runs {text, className}, last `limit` rows only. */
  snapshot(limit = 2000) {
    const rows = this.lines.slice(-limit);
    return rows.map((row) => {
      const runs = [];
      for (const cell of row) {
        const last = runs[runs.length - 1];
        if (last && last.className === cell[1]) last.text += cell[0];
        else runs.push({ text: cell[0], className: cell[1] });
      }
      return runs;
    });
  }

  /** Plain text of the whole buffer (trailing blank rows trimmed). */
  toText() {
    const text = this.lines.map((row) => row.map((c) => c[0]).join('').replace(/\s+$/, ''));
    while (text.length && text[text.length - 1] === '') text.pop();
    return text.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Keyboard -> bytes
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const FKEYS = {
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS', F5: '\x1b[15~', F6: '\x1b[17~',
  F7: '\x1b[18~', F8: '\x1b[19~', F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~',
};
const NAMED = {
  Escape: '\x1b', Tab: '\t', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', PageUp: '\x1b[5~', PageDown: '\x1b[6~', Delete: '\x1b[3~', Insert: '\x1b[2~',
};

/**
 * Bytes sent for Enter / Backspace given the settings.
 *  enter: 'cr' | 'crlf' | 'lf'     backspace: 'del' (0x7F) | 'bs' (0x08)
 */
export function enterBytes(mode = 'cr') {
  return mode === 'crlf' ? '\r\n' : mode === 'lf' ? '\n' : '\r';
}
export function backspaceBytes(mode = 'del') {
  return mode === 'bs' ? '\x08' : '\x7f';
}

/**
 * Map a KeyboardEvent-like object to the bytes a terminal would send, or null
 * when the event should be left to the browser (copy/paste shortcuts, plain
 * modifier presses, Meta combos). `opts.hasSelection` lets Ctrl-C copy when text
 * is selected.
 */
export function keyToBytes(e, { enter = 'cr', backspace = 'del', hasSelection = false } = {}) {
  const key = e.key;
  if (e.metaKey) return null;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead', 'Process'].includes(key)) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;

  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey && (k === 'c' || k === 'v')) return null; // Ctrl+Shift+C/V: copy/paste
    if (k === 'v') return null; // paste event handles it
    if (k === 'c' && hasSelection) return null; // copy selection
    if (k.length === 1 && k >= 'a' && k <= 'z') return Uint8Array.of(k.charCodeAt(0) - 96);
    if (k === ' ' || k === '@') return Uint8Array.of(0);
    if (k === '[') return Uint8Array.of(0x1b);
    if (k === '\\') return Uint8Array.of(0x1c);
    if (k === ']') return Uint8Array.of(0x1d);
    if (k === '^') return Uint8Array.of(0x1e);
    if (k === '_' || k === '-') return Uint8Array.of(0x1f);
    if (key === 'Backspace') return Uint8Array.of(0x08);
  }

  let seq = null;
  if (key === 'Enter') seq = enterBytes(enter);
  else if (key === 'Backspace') seq = backspaceBytes(backspace);
  else if (key === 'Tab' && e.shiftKey) seq = '\x1b[Z';
  else if (NAMED[key]) seq = NAMED[key];
  else if (FKEYS[key]) seq = FKEYS[key];
  else if ([...key].length === 1) seq = key;
  if (seq === null) return null;
  if (e.altKey && !e.ctrlKey) seq = '\x1b' + seq;
  return enc.encode(seq);
}

/** Bytes for pasted text; wraps in bracketed-paste markers when enabled. Newlines become the Enter mapping. */
export function pasteBytes(text, { bracketed = false, enter = 'cr' } = {}) {
  let t = String(text).replace(/\r\n|\n|\r/g, enterBytes(enter));
  if (bracketed) t = `\x1b[200~${t}\x1b[201~`;
  return enc.encode(t);
}
