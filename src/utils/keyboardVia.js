/**
 * keyboardVia.js — VIA raw-HID protocol: packet building/parsing, keymap buffer
 * decoding, QMK keycode decoding, and a small serialized request client.
 *
 * Pure logic. The WebHID device is injected through `send` (a function that takes a
 * 32-byte Uint8Array and writes it as report 0), so the protocol is unit-tested
 * without hardware. Nothing here invents keyboard data: every value comes from bytes
 * the caller passes in.
 *
 * Sources (verified against the upstream files, not memory):
 *   - quantum/via.c and quantum/via.h in qmk_firmware (command ids, byte layout,
 *     VIA_PROTOCOL_VERSION 0x000D, switch matrix row packing, 28-byte buffer chunks)
 *   - quantum/keycodes.h "qk_keycode_ranges" enum in qmk_firmware (QK_* ranges)
 *   - USB HID Usage Tables, Keyboard/Keypad page 0x07 (basic keycodes)
 */

export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;
export const VIA_REPORT_LENGTH = 32;
export const VIA_BUFFER_CHUNK = 28; // max payload per get_buffer/set_buffer

export const VIA_CMD = {
  getProtocolVersion: 0x01,
  getKeyboardValue: 0x02,
  setKeyboardValue: 0x03,
  dynamicKeymapGetKeycode: 0x04,
  dynamicKeymapSetKeycode: 0x05,
  dynamicKeymapGetLayerCount: 0x11,
  dynamicKeymapGetBuffer: 0x12,
  unhandled: 0xff
};

export const VIA_VALUE = {
  uptime: 0x01,
  layoutOptions: 0x02,
  switchMatrixState: 0x03
};

/** Build a 32-byte VIA packet from its header bytes (command id first), zero padded. */
export function buildViaPacket(header) {
  if (!header || header.length < 1 || header.length > VIA_REPORT_LENGTH) {
    throw new Error('VIA header must be 1-32 bytes');
  }
  const packet = new Uint8Array(VIA_REPORT_LENGTH);
  packet.set(header, 0);
  return packet;
}

/** Header for get_protocol_version. */
export const protocolVersionHeader = () => [VIA_CMD.getProtocolVersion];
/** Header for get_keyboard_value(uptime). */
export const uptimeHeader = () => [VIA_CMD.getKeyboardValue, VIA_VALUE.uptime];
/** Header for get_keyboard_value(layout_options). */
export const layoutOptionsHeader = () => [VIA_CMD.getKeyboardValue, VIA_VALUE.layoutOptions];
/** Header for get_keyboard_value(switch_matrix_state) at a given row offset. */
export const matrixStateHeader = (offset) => [VIA_CMD.getKeyboardValue, VIA_VALUE.switchMatrixState, offset & 0xff];
/** Header for dynamic_keymap_get_layer_count. */
export const layerCountHeader = () => [VIA_CMD.dynamicKeymapGetLayerCount];
/** Header for dynamic_keymap_get_keycode(layer, row, col). */
export const getKeycodeHeader = (layer, row, col) => [VIA_CMD.dynamicKeymapGetKeycode, layer & 0xff, row & 0xff, col & 0xff];
/** Header for dynamic_keymap_set_keycode(layer, row, col, keycode); keycode is big-endian. */
export const setKeycodeHeader = (layer, row, col, keycode) => [
  VIA_CMD.dynamicKeymapSetKeycode, layer & 0xff, row & 0xff, col & 0xff, (keycode >> 8) & 0xff, keycode & 0xff
];
/** Header for dynamic_keymap_get_buffer(offset, size); offset is big-endian, size <= 28. */
export function getBufferHeader(offset, size) {
  if (size < 1 || size > VIA_BUFFER_CHUNK) throw new Error(`buffer chunk must be 1-${VIA_BUFFER_CHUNK} bytes`);
  return [VIA_CMD.dynamicKeymapGetBuffer, (offset >> 8) & 0xff, offset & 0xff, size];
}

const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** Response to get_protocol_version: bytes 1-2, big-endian. */
export function parseProtocolVersion(bytes) {
  return (bytes[1] << 8) | bytes[2];
}

/** Response to get_keyboard_value(uptime): uint32 big-endian at bytes 2-5 (QMK timer_read32, ms). */
export function parseUptimeMs(bytes) {
  return u32be(bytes, 2);
}

/** Response to get_keyboard_value(layout_options): uint32 big-endian at bytes 2-5. */
export function parseLayoutOptions(bytes) {
  return u32be(bytes, 2);
}

/** Response to dynamic_keymap_get_layer_count: byte 1. */
export function parseLayerCount(bytes) {
  return bytes[1];
}

/** Response to dynamic_keymap_get_keycode / set_keycode: keycode big-endian at bytes 4-5 (set echoes 4-5 too). */
export function parseKeycodeResponse(bytes) {
  return (bytes[4] << 8) | bytes[5];
}

/** Bytes per matrix row in a switch_matrix_state response for a given column count. */
export function matrixBytesPerRow(cols) {
  return Math.ceil(cols / 8);
}

/** How many matrix rows one switch_matrix_state response carries (28 payload bytes). */
export function matrixRowsPerResponse(cols) {
  return Math.floor(28 / matrixBytesPerRow(cols));
}

/**
 * Decode a switch_matrix_state response for rows starting at `offset`.
 * Layout (via.c): bytes 0-1 echo the command and value id, byte 2 the offset,
 * then one row per (ceil(cols/8)) bytes, most significant byte first; column c is bit c.
 * Returns { offset, rows: boolean[][] } covering only the rows this response carries.
 * Note: a keyboard with readout locked (SECURE) returns zeros, which read as "nothing pressed".
 */
export function parseMatrixStateResponse(bytes, offset, rows, cols) {
  const bpr = matrixBytesPerRow(cols);
  const count = Math.min(matrixRowsPerResponse(cols), rows - offset);
  const out = [];
  for (let r = 0; r < count; r++) {
    let value = 0;
    for (let b = 0; b < bpr; b++) value = value * 256 + bytes[3 + r * bpr + b];
    const line = [];
    for (let c = 0; c < cols; c++) line.push(((value >>> c) & 1) === 1);
    out.push(line);
  }
  return { offset, rows: out };
}

/**
 * Split the whole dynamic keymap into chunk reads: [{ offset, size }].
 * Total size = layers * rows * cols * 2 bytes.
 */
export function keymapChunks(layers, rows, cols) {
  const total = layers * rows * cols * 2;
  const chunks = [];
  for (let off = 0; off < total; off += VIA_BUFFER_CHUNK) {
    chunks.push({ offset: off, size: Math.min(VIA_BUFFER_CHUNK, total - off) });
  }
  return chunks;
}

/**
 * Decode a whole keymap buffer into layers[layer][row][col] = 16-bit keycode.
 * Storage assumed: layer-major, then row, then column, each keycode 2 bytes big-endian
 * (VIA dynamic keymap convention). Throws if the buffer length does not match.
 */
export function parseKeymapBuffer(bytes, layers, rows, cols) {
  const expected = layers * rows * cols * 2;
  if (bytes.length !== expected) {
    throw new Error(`keymap buffer is ${bytes.length} bytes, expected ${expected} (${layers} layers x ${rows}x${cols})`);
  }
  const out = [];
  let i = 0;
  for (let l = 0; l < layers; l++) {
    const layer = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push((bytes[i] << 8) | bytes[i + 1]);
        i += 2;
      }
      layer.push(row);
    }
    out.push(layer);
  }
  return out;
}

/** Parse a VIA keyboard definition JSON and return its matrix size and name. */
export function parseViaDefinition(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
  const m = json && json.matrix;
  if (!m || !Number.isInteger(m.rows) || !Number.isInteger(m.cols)) {
    throw new Error('Definition has no matrix.rows / matrix.cols integers');
  }
  if (m.rows < 1 || m.rows > 64 || m.cols < 1 || m.cols > 32) {
    throw new Error('matrix must be 1-64 rows and 1-32 columns (VIA matrix state packing limit)');
  }
  return { name: typeof json.name === 'string' ? json.name : '', rows: m.rows, cols: m.cols };
}

// ---------------------------------------------------------------------------
// QMK keycode decoding
// ---------------------------------------------------------------------------

const LETTER_NAMES = {};
for (let i = 0; i < 26; i++) LETTER_NAMES[0x04 + i] = `KC_${String.fromCharCode(65 + i)}`;

const BASIC_NAMES = {
  0x00: 'KC_NO', 0x01: 'KC_TRNS',
  0x1e: 'KC_1', 0x1f: 'KC_2', 0x20: 'KC_3', 0x21: 'KC_4', 0x22: 'KC_5',
  0x23: 'KC_6', 0x24: 'KC_7', 0x25: 'KC_8', 0x26: 'KC_9', 0x27: 'KC_0',
  0x28: 'KC_ENT', 0x29: 'KC_ESC', 0x2a: 'KC_BSPC', 0x2b: 'KC_TAB', 0x2c: 'KC_SPC',
  0x2d: 'KC_MINS', 0x2e: 'KC_EQL', 0x2f: 'KC_LBRC', 0x30: 'KC_RBRC', 0x31: 'KC_BSLS',
  0x32: 'KC_NUHS', 0x33: 'KC_SCLN', 0x34: 'KC_QUOT', 0x35: 'KC_GRV', 0x36: 'KC_COMM',
  0x37: 'KC_DOT', 0x38: 'KC_SLSH', 0x39: 'KC_CAPS',
  0x46: 'KC_PSCR', 0x47: 'KC_SCRL', 0x48: 'KC_PAUS', 0x49: 'KC_INS', 0x4a: 'KC_HOME',
  0x4b: 'KC_PGUP', 0x4c: 'KC_DEL', 0x4d: 'KC_END', 0x4e: 'KC_PGDN', 0x4f: 'KC_RGHT',
  0x50: 'KC_LEFT', 0x51: 'KC_DOWN', 0x52: 'KC_UP', 0x53: 'KC_NUM', 0x54: 'KC_PSLS',
  0x55: 'KC_PAST', 0x56: 'KC_PMNS', 0x57: 'KC_PPLS', 0x58: 'KC_PENT',
  0x59: 'KC_P1', 0x5a: 'KC_P2', 0x5b: 'KC_P3', 0x5c: 'KC_P4', 0x5d: 'KC_P5',
  0x5e: 'KC_P6', 0x5f: 'KC_P7', 0x60: 'KC_P8', 0x61: 'KC_P9', 0x62: 'KC_P0',
  0x63: 'KC_PDOT', 0x64: 'KC_NUBS', 0x65: 'KC_APP', 0x66: 'KC_KB_POWER', 0x67: 'KC_PEQL',
  0x7f: 'KC_MUTE', 0x80: 'KC_VOLU', 0x81: 'KC_VOLD',
  0xe0: 'KC_LCTL', 0xe1: 'KC_LSFT', 0xe2: 'KC_LALT', 0xe3: 'KC_LGUI',
  0xe4: 'KC_RCTL', 0xe5: 'KC_RSFT', 0xe6: 'KC_RALT', 0xe7: 'KC_RGUI'
};
for (let i = 0; i < 12; i++) BASIC_NAMES[0x3a + i] = `KC_F${i + 1}`;
for (let i = 0; i < 12; i++) BASIC_NAMES[0x68 + i] = `KC_F${i + 13}`;
Object.assign(BASIC_NAMES, LETTER_NAMES);

const NAME_TO_BASIC = {};
for (const [code, name] of Object.entries(BASIC_NAMES)) NAME_TO_BASIC[name] = Number(code);

// Mod bits in QK_MODS / MT: 0x01 LCTL, 0x02 LSFT, 0x04 LALT, 0x08 LGUI; 0x10 = right-hand side.
const MOD_NAMES = ['CTL', 'SFT', 'ALT', 'GUI'];
export function modBitsLabel(bits) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    if (bits & (1 << i)) parts.push(`${bits & 0x10 ? 'R' : 'L'}${MOD_NAMES[i]}`);
  }
  return parts.length ? parts.join('|') : '0';
}

const hex4 = (n) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

function basicName(code) {
  return BASIC_NAMES[code] || null;
}

/**
 * Decode one 16-bit QMK keycode. Returns { code, hex, kind, label, ... }.
 * kind: 'basic' | 'mods' | 'mod-tap' | 'layer-tap' | 'layer' | 'unknown'.
 * Anything not decoded here is labelled with its hex value only.
 */
export function decodeKeycode(code) {
  const c = code & 0xffff;
  const hex = hex4(c);
  const base = basicName(c & 0xff);

  if (c <= 0x00ff) {
    const name = basicName(c);
    return name ? { code: c, hex, kind: 'basic', label: name } : { code: c, hex, kind: 'unknown', label: hex };
  }
  if (c >= 0x0100 && c <= 0x1fff) {
    const bits = (c >> 8) & 0x1f;
    const inner = base || hex;
    return { code: c, hex, kind: 'mods', label: `${modBitsLabel(bits)}(${inner})`, mods: bits };
  }
  if (c >= 0x2000 && c <= 0x3fff) {
    const bits = (c >> 8) & 0x1f;
    return { code: c, hex, kind: 'mod-tap', label: `MT(${modBitsLabel(bits)}, ${base || hex})`, mods: bits };
  }
  if (c >= 0x4000 && c <= 0x4fff) {
    const layer = (c >> 8) & 0xf;
    return { code: c, hex, kind: 'layer-tap', label: `LT(${layer}, ${base || hex})`, layer };
  }
  const layerRanges = [
    [0x5220, 0x523f, 'MO'],
    [0x5240, 0x525f, 'DF'],
    [0x5260, 0x527f, 'TG'],
    [0x5280, 0x529f, 'OSL'],
    [0x52c0, 0x52df, 'TT']
  ];
  for (const [lo, hi, fn] of layerRanges) {
    if (c >= lo && c <= hi) {
      const layer = c - lo;
      return { code: c, hex, kind: 'layer', label: `${fn}(${layer})`, layer };
    }
  }
  return { code: c, hex, kind: 'unknown', label: hex };
}

/**
 * Parse a keycode typed by the user: hex (0x0004), decimal, a QMK basic name (KC_A),
 * or a layer key MO(n) / DF(n) / TG(n) / OSL(n) / TT(n). Returns a number or null.
 */
export function parseKeycodeText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^0x[0-9a-f]{1,4}$/i.test(t)) return parseInt(t, 16);
  if (/^\d{1,5}$/.test(t)) { const n = Number(t); return n <= 0xffff ? n : null; }
  const upper = t.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(NAME_TO_BASIC, upper)) return NAME_TO_BASIC[upper];
  const m = /^(MO|DF|TG|OSL|TT)\((\d{1,2})\)$/.exec(upper);
  if (m) {
    const n = Number(m[2]);
    if (n > 0x1f) return null;
    const base = { MO: 0x5220, DF: 0x5240, TG: 0x5260, OSL: 0x5280, TT: 0x52c0 }[m[1]];
    return base + n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Request client (serialized: one VIA command in flight at a time)
// ---------------------------------------------------------------------------

/**
 * Every VIA reply echoes the request's header bytes (via.c edits command_data in place
 * and leaves the header alone), so a reply is matched by comparing the request header.
 * `send(Uint8Array(32))` must write the packet as report 0 and return a promise.
 */
export class ViaClient {
  constructor({ send, timeoutMs = 1000 }) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.pending = null;
    this.queue = Promise.resolve();
  }

  /** Feed a received 32-byte input report. Returns true if it was consumed as a reply. */
  handleInput(bytes) {
    const p = this.pending;
    if (!p) return false;
    if (bytes[0] === VIA_CMD.unhandled && p.header[0] !== VIA_CMD.unhandled) {
      this.pending = null;
      p.reject(new Error('Keyboard answered "unhandled" (VIA command not supported by this firmware or disabled).'));
      return true;
    }
    if (bytes[0] !== p.header[0]) return false;
    for (let i = 0; i < p.header.length; i++) if (bytes[i] !== p.header[i]) return false;
    this.pending = null;
    p.resolve(Uint8Array.from(bytes));
    return true;
  }

  request(header) {
    const packet = buildViaPacket(header);
    const run = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('No VIA reply (timeout). Check the keyboard uses VIA raw HID and that this browser has access to it.'));
      }, this.timeoutMs);
      this.pending = {
        header: Uint8Array.from(header),
        resolve: (b) => { clearTimeout(timer); resolve(b); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      };
      Promise.resolve()
        .then(() => this.send(packet))
        .catch((err) => {
          if (this.pending) this.pending = null;
          clearTimeout(timer);
          reject(err);
        });
    });
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  async protocolVersion() {
    return parseProtocolVersion(await this.request(protocolVersionHeader()));
  }

  async uptimeMs() {
    return parseUptimeMs(await this.request(uptimeHeader()));
  }

  async layoutOptions() {
    return parseLayoutOptions(await this.request(layoutOptionsHeader()));
  }

  async layerCount() {
    return parseLayerCount(await this.request(layerCountHeader()));
  }

  async getKeycode(layer, row, col) {
    return parseKeycodeResponse(await this.request(getKeycodeHeader(layer, row, col)));
  }

  async setKeycode(layer, row, col, keycode) {
    return parseKeycodeResponse(await this.request(setKeycodeHeader(layer, row, col, keycode)));
  }

  /** Read the whole dynamic keymap; onProgress(doneBytes, totalBytes) is optional. */
  async readKeymap(layers, rows, cols, onProgress) {
    const chunks = keymapChunks(layers, rows, cols);
    const total = layers * rows * cols * 2;
    const buf = new Uint8Array(total);
    let done = 0;
    for (const { offset, size } of chunks) {
      const reply = await this.request(getBufferHeader(offset, size));
      buf.set(reply.subarray(4, 4 + size), offset);
      done += size;
      if (onProgress) onProgress(done, total);
    }
    return parseKeymapBuffer(buf, layers, rows, cols);
  }

  /** Read the switch matrix once: boolean[rows][cols]. */
  async readMatrix(rows, cols) {
    const out = [];
    const step = matrixRowsPerResponse(cols);
    for (let off = 0; off < rows; off += step) {
      const reply = await this.request(matrixStateHeader(off));
      out.push(...parseMatrixStateResponse(reply, off, rows, cols).rows);
    }
    return out;
  }
}
