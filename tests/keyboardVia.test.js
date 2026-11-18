import { describe, it, expect } from 'vitest';
import {
  buildViaPacket, protocolVersionHeader, uptimeHeader, matrixStateHeader, layerCountHeader,
  getKeycodeHeader, setKeycodeHeader, getBufferHeader, parseProtocolVersion, parseUptimeMs,
  parseLayerCount, parseKeycodeResponse, parseMatrixStateResponse, matrixRowsPerResponse,
  keymapChunks, parseKeymapBuffer, parseViaDefinition, decodeKeycode, parseKeycodeText,
  ViaClient, VIA_CMD, VIA_REPORT_LENGTH
} from '../src/utils/keyboardVia';
import {
  buildKeyboardLayout, layoutKeyCodes, applyKeyEvent, createTesterState, rolloverVerdict, MAX_LOG,
  dwellSummary, untestedKeys, testCoverage, comboStatus, buildReport, modifierLabel, COMBO_PRESETS
} from '../src/utils/keyboardVia/keyTester';

describe('VIA packet building', () => {
  it('pads every packet to 32 bytes with the header first', () => {
    const p = buildViaPacket([0x01]);
    expect(p.length).toBe(VIA_REPORT_LENGTH);
    expect(p[0]).toBe(0x01);
    expect(p.slice(1).every((b) => b === 0)).toBe(true);
  });

  it('rejects empty or oversized headers', () => {
    expect(() => buildViaPacket([])).toThrow();
    expect(() => buildViaPacket(new Array(33).fill(0))).toThrow();
  });

  it('uses the documented command ids', () => {
    expect(VIA_CMD.getProtocolVersion).toBe(0x01);
    expect(VIA_CMD.getKeyboardValue).toBe(0x02);
    expect(VIA_CMD.dynamicKeymapGetKeycode).toBe(0x04);
    expect(VIA_CMD.dynamicKeymapSetKeycode).toBe(0x05);
    expect(VIA_CMD.dynamicKeymapGetLayerCount).toBe(0x11);
    expect(VIA_CMD.dynamicKeymapGetBuffer).toBe(0x12);
    expect(protocolVersionHeader()).toEqual([0x01]);
    expect(uptimeHeader()).toEqual([0x02, 0x01]);
    expect(layerCountHeader()).toEqual([0x11]);
  });

  it('builds keycode get/set headers with the keycode big-endian', () => {
    expect(getKeycodeHeader(1, 2, 3)).toEqual([0x04, 1, 2, 3]);
    expect(setKeycodeHeader(0, 1, 2, 0x0104)).toEqual([0x05, 0, 1, 2, 0x01, 0x04]);
    expect(matrixStateHeader(28)).toEqual([0x02, 0x03, 28]);
  });

  it('builds buffer reads with a big-endian offset and a size of at most 28', () => {
    expect(getBufferHeader(0x0102, 28)).toEqual([0x12, 0x01, 0x02, 28]);
    expect(() => getBufferHeader(0, 29)).toThrow();
    expect(() => getBufferHeader(0, 0)).toThrow();
  });
});

describe('VIA reply parsing', () => {
  it('reads protocol version big-endian (VIA protocol 13 = 0x000D)', () => {
    expect(parseProtocolVersion([0x01, 0x00, 0x0d])).toBe(13);
  });

  it('reads uptime as a big-endian uint32 from bytes 2-5', () => {
    expect(parseUptimeMs([0x02, 0x01, 0x00, 0x01, 0x02, 0x03])).toBe(0x00010203);
    expect(parseUptimeMs([0x02, 0x01, 0xff, 0xff, 0xff, 0xff])).toBe(0xffffffff);
  });

  it('reads layer count and keycode replies', () => {
    expect(parseLayerCount([0x11, 4])).toBe(4);
    expect(parseKeycodeResponse([0x04, 0, 1, 2, 0x00, 0x04])).toBe(4);
  });

  it('decodes switch matrix rows: column c is bit c, MSB byte first', () => {
    // 8 columns: one byte per row. Row 0 = cols 0 and 2.
    const reply = new Uint8Array(32);
    reply.set([0x02, 0x03, 0x00, 0b00000101, 0x80]);
    const parsed = parseMatrixStateResponse(reply, 0, 2, 8);
    expect(parsed.rows[0]).toEqual([true, false, true, false, false, false, false, false]);
    expect(parsed.rows[1][7]).toBe(true);
    expect(parsed.rows.length).toBe(2);

    // 12 columns: two bytes per row, 0x0110 = bits 4 and 8.
    const wide = new Uint8Array(32);
    wide.set([0x02, 0x03, 0x00, 0x01, 0x10]);
    const w = parseMatrixStateResponse(wide, 0, 1, 12);
    expect(w.rows[0].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([4, 8]);
  });

  it('stops at the last row when the offset is near the end of the matrix', () => {
    expect(matrixRowsPerResponse(8)).toBe(28);
    expect(matrixRowsPerResponse(16)).toBe(14);
    const r = parseMatrixStateResponse(new Uint8Array(32), 28, 30, 8);
    expect(r.rows.length).toBe(2);
  });

  it('splits the keymap into 28-byte chunks covering every byte once', () => {
    const chunks = keymapChunks(2, 6, 16); // 384 bytes
    expect(chunks.length).toBe(14);
    expect(chunks[0]).toEqual({ offset: 0, size: 28 });
    expect(chunks[13]).toEqual({ offset: 13 * 28, size: 20 });
    expect(chunks.reduce((s, c) => s + c.size, 0)).toBe(384);
  });

  it('decodes a keymap buffer into layers[layer][row][col] big-endian', () => {
    const layers = parseKeymapBuffer(Uint8Array.from([0x00, 0x04, 0x52, 0x00, 0x00, 0x29, 0x00, 0x2a]), 2, 1, 2);
    expect(layers).toEqual([[[4, 0x5200]], [[0x29, 0x2a]]].map((l) => l));
    expect(layers[0][0][1]).toBe(0x5200);
    expect(layers[1][0][1]).toBe(0x2a);
  });

  it('refuses a keymap buffer of the wrong length', () => {
    expect(() => parseKeymapBuffer(new Uint8Array(3), 1, 1, 2)).toThrow(/expected 4/);
  });

  it('reads matrix size from a VIA definition and rejects bad ones', () => {
    const def = parseViaDefinition(JSON.stringify({ name: 'Test', matrix: { rows: 4, cols: 12 } }));
    expect(def).toEqual({ name: 'Test', rows: 4, cols: 12 });
    expect(() => parseViaDefinition('not json')).toThrow(/Not valid JSON/);
    expect(() => parseViaDefinition('{}')).toThrow(/matrix/);
    expect(() => parseViaDefinition('{"matrix":{"rows":4,"cols":40}}')).toThrow(/32 columns/);
  });
});

describe('QMK keycode decoding', () => {
  const label = (c) => decodeKeycode(c).label;

  it('decodes basic keycodes', () => {
    expect(label(0x0004)).toBe('KC_A');
    expect(label(0x001d)).toBe('KC_Z');
    expect(label(0x001e)).toBe('KC_1');
    expect(label(0x0027)).toBe('KC_0');
    expect(label(0x0028)).toBe('KC_ENT');
    expect(label(0x003a)).toBe('KC_F1');
    expect(label(0x0045)).toBe('KC_F12');
    expect(label(0x0068)).toBe('KC_F13');
    expect(label(0x0073)).toBe('KC_F24');
    expect(label(0x00e1)).toBe('KC_LSFT');
    expect(label(0x00e7)).toBe('KC_RGUI');
    expect(label(0x0000)).toBe('KC_NO');
    expect(label(0x0001)).toBe('KC_TRNS');
    expect(decodeKeycode(0x0004).kind).toBe('basic');
  });

  it('decodes modifier combinations on basic keys', () => {
    expect(decodeKeycode(0x0104)).toMatchObject({ kind: 'mods', label: 'LCTL(KC_A)' });
    expect(label(0x0304)).toBe('LCTL|LSFT(KC_A)');
    expect(label(0x1104)).toBe('RCTL(KC_A)');
  });

  it('decodes mod-tap, layer-tap and layer keys', () => {
    expect(label(0x2204)).toBe('MT(LSFT, KC_A)');
    expect(decodeKeycode(0x2204).kind).toBe('mod-tap');
    expect(label(0x4228)).toBe('LT(2, KC_ENT)');
    expect(decodeKeycode(0x4228).layer).toBe(2);
    expect(label(0x5223)).toBe('MO(3)');
    expect(label(0x5241)).toBe('DF(1)');
    expect(label(0x5262)).toBe('TG(2)');
    expect(label(0x5284)).toBe('OSL(4)');
    expect(label(0x52c1)).toBe('TT(1)');
  });

  it('shows hex for codes it does not decode', () => {
    expect(decodeKeycode(0x5600)).toMatchObject({ kind: 'unknown', label: '0x5600', hex: '0x5600' });
    expect(label(0x00ff)).toBe('0x00FF');
  });

  it('parses typed keycodes: hex, decimal, names and layer keys', () => {
    expect(parseKeycodeText('0x0004')).toBe(4);
    expect(parseKeycodeText('kc_a')).toBe(4);
    expect(parseKeycodeText(' KC_ENT ')).toBe(0x28);
    expect(parseKeycodeText('MO(3)')).toBe(0x5223);
    expect(parseKeycodeText('tg(2)')).toBe(0x5262);
    expect(parseKeycodeText('MO(40)')).toBe(null);
    expect(parseKeycodeText('KC_BOGUS')).toBe(null);
    expect(parseKeycodeText('0x12345')).toBe(null);
    expect(parseKeycodeText('')).toBe(null);
  });
});

// A keyboard that answers the way quantum/via.c does: it edits the payload in place and
// leaves the header bytes alone, so every reply echoes the request header.
function fakeKeyboard({ layers, rows, cols, pressed = [] }) {
  const keymap = new Uint8Array(layers * rows * cols * 2);
  const idx = (l, r, c) => (l * rows * cols + r * cols + c) * 2;
  return {
    keymap,
    setKey(l, r, c, code) { keymap[idx(l, r, c)] = code >> 8; keymap[idx(l, r, c) + 1] = code & 0xff; },
    reply(p) {
      const out = new Uint8Array(32);
      out.set(p);
      const cmd = p[0];
      if (cmd === 0x01) { out[1] = 0; out[2] = 13; }
      else if (cmd === 0x02 && p[1] === 0x01) { out.set([0x00, 0x00, 0x01, 0x00], 2); } // uptime 256 ms
      else if (cmd === 0x11) { out[1] = layers; }
      else if (cmd === 0x04) { const i = idx(p[1], p[2], p[3]); out[4] = keymap[i]; out[5] = keymap[i + 1]; }
      else if (cmd === 0x05) { const i = idx(p[1], p[2], p[3]); keymap[i] = p[4]; keymap[i + 1] = p[5]; }
      else if (cmd === 0x12) {
        const off = (p[1] << 8) | p[2];
        for (let i = 0; i < p[3]; i++) out[4 + i] = keymap[off + i];
      } else if (cmd === 0x02 && p[1] === 0x03) {
        const off = p[2];
        const bpr = Math.ceil(cols / 8);
        const count = Math.min(Math.floor(28 / bpr), rows - off);
        for (let r = 0; r < count; r++) {
          let v = 0;
          for (let c = 0; c < cols; c++) if (pressed.some(([pr, pc]) => pr === off + r && pc === c)) v |= 1 << c;
          for (let b = 0; b < bpr; b++) out[3 + r * bpr + b] = (v >> (8 * (bpr - 1 - b))) & 0xff;
        }
      } else {
        out[0] = 0xff; // unhandled
      }
      return out;
    }
  };
}

function connect(kb, opts = {}) {
  let client;
  const sent = [];
  client = new ViaClient({
    timeoutMs: opts.timeoutMs || 200,
    send: async (packet) => {
      sent.push(Uint8Array.from(packet));
      const reply = kb.reply(packet);
      setTimeout(() => client.handleInput(reply), 0);
    }
  });
  return { client, sent };
}

describe('ViaClient against a simulated keyboard', () => {
  it('reads protocol version, layer count and uptime', async () => {
    const kb = fakeKeyboard({ layers: 3, rows: 2, cols: 2 });
    const { client } = connect(kb);
    expect(await client.protocolVersion()).toBe(13);
    expect(await client.layerCount()).toBe(3);
    expect(await client.uptimeMs()).toBe(0x0100);
  });

  it('writes a keycode then reads it back', async () => {
    const kb = fakeKeyboard({ layers: 2, rows: 2, cols: 3 });
    const { client, sent } = connect(kb);
    expect(await client.setKeycode(1, 1, 2, 0x0004)).toBe(0x0004);
    expect(await client.getKeycode(1, 1, 2)).toBe(0x0004);
    expect(Array.from(sent[0].subarray(0, 6))).toEqual([0x05, 1, 1, 2, 0x00, 0x04]);
    expect(sent[0].length).toBe(32);
  });

  it('reads the whole keymap in chunks and decodes it', async () => {
    const kb = fakeKeyboard({ layers: 2, rows: 6, cols: 16 });
    kb.setKey(0, 0, 0, 0x0004);
    kb.setKey(1, 5, 15, 0x5223);
    const { client } = connect(kb);
    let progress = 0;
    const map = await client.readKeymap(2, 6, 16, (done, total) => { progress = total; });
    expect(map[0][0][0]).toBe(0x0004);
    expect(map[1][5][15]).toBe(0x5223);
    expect(progress).toBe(384);
  });

  it('reads the switch matrix with pressed positions lit', async () => {
    const kb = fakeKeyboard({ layers: 1, rows: 5, cols: 10, pressed: [[0, 0], [4, 9]] });
    const { client } = connect(kb);
    const m = await client.readMatrix(5, 10);
    expect(m.length).toBe(5);
    expect(m[0][0]).toBe(true);
    expect(m[4][9]).toBe(true);
    expect(m.flat().filter(Boolean).length).toBe(2);
  });

  it('reports an unhandled command as an error', async () => {
    const kb = fakeKeyboard({ layers: 1, rows: 1, cols: 1 });
    const { client } = connect(kb);
    await expect(client.request([0x7e])).rejects.toThrow(/unhandled/);
  });

  it('times out when the keyboard never answers', async () => {
    const client = new ViaClient({ send: async () => {}, timeoutMs: 20 });
    await expect(client.protocolVersion()).rejects.toThrow(/timeout/);
  });

  it('serializes overlapping requests so each gets its own reply', async () => {
    const kb = fakeKeyboard({ layers: 4, rows: 2, cols: 2 });
    const { client } = connect(kb);
    const [a, b] = await Promise.all([client.layerCount(), client.protocolVersion()]);
    expect(a).toBe(4);
    expect(b).toBe(13);
  });
});

describe('key tester layout', () => {
  it('has 104 keys for ANSI and 87 for TKL, with unique codes', () => {
    const ansi = layoutKeyCodes(buildKeyboardLayout()).map((k) => k.c);
    const tkl = layoutKeyCodes(buildKeyboardLayout({ tkl: true })).map((k) => k.c);
    expect(ansi.length).toBe(104);
    expect(tkl.length).toBe(87);
    expect(new Set(ansi).size).toBe(104);
  });

  it('adds the ISO keys when ISO is selected', () => {
    const iso = layoutKeyCodes(buildKeyboardLayout({ iso: true })).map((k) => k.c);
    expect(iso).toContain('IntlBackslash');
    expect(iso).toContain('Backslash');
    expect(new Set(iso).size).toBe(iso.length);
  });
});

describe('key tester events', () => {
  const ev = (type, code, t, extra = {}) => ({ type, code, key: code, location: 0, repeat: false, timeStamp: t, ...extra });

  it('tracks pressed-now, ever-pressed and per-key counts', () => {
    let s = createTesterState();
    s = applyKeyEvent(s, ev('down', 'KeyA', 100));
    expect(s.down.KeyA).toBe(100);
    s = applyKeyEvent(s, ev('up', 'KeyA', 150));
    expect(s.down.KeyA).toBeUndefined();
    expect(s.ever.KeyA).toBe(true);
    expect(s.counts.KeyA).toBe(1);
  });

  it('does not count auto-repeat as a new press', () => {
    let s = createTesterState();
    s = applyKeyEvent(s, ev('down', 'KeyA', 100));
    s = applyKeyEvent(s, ev('down', 'KeyA', 130, { repeat: true }));
    s = applyKeyEvent(s, ev('down', 'KeyA', 160, { repeat: true }));
    expect(s.counts.KeyA).toBe(1);
    expect(s.log.length).toBe(3);
    expect(s.log[2].repeat).toBe(true);
  });

  it('flags chatter when a key goes down again within the window after its release', () => {
    let s = createTesterState(20);
    s = applyKeyEvent(s, ev('down', 'KeyS', 100));
    s = applyKeyEvent(s, ev('up', 'KeyS', 110));
    s = applyKeyEvent(s, ev('down', 'KeyS', 115)); // 5 ms after release
    expect(s.chatter.KeyS).toBe(1);
    expect(s.log[2].chatter).toBe(true);
    expect(s.log[2].gapMs).toBe(5);
    s = applyKeyEvent(s, ev('up', 'KeyS', 120));
    s = applyKeyEvent(s, ev('down', 'KeyS', 200)); // 80 ms later: a real press
    expect(s.chatter.KeyS).toBe(1);
  });

  it('respects the configured chatter window', () => {
    let s = createTesterState(3);
    s = applyKeyEvent(s, ev('down', 'KeyD', 100));
    s = applyKeyEvent(s, ev('up', 'KeyD', 110));
    s = applyKeyEvent(s, ev('down', 'KeyD', 115)); // 5 ms: outside a 3 ms window
    expect(s.chatter.KeyD).toBeUndefined();
  });

  it('keeps a count of simultaneous keys and turns it into a rollover verdict', () => {
    let s = createTesterState();
    const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH'];
    codes.forEach((c, i) => { s = applyKeyEvent(s, ev('down', c, 100 + i)); });
    expect(s.maxSimultaneous).toBe(6);
    expect(rolloverVerdict(6).level).toBe('6kro');
    s = applyKeyEvent(s, ev('down', 'KeyJ', 200));
    expect(s.maxSimultaneous).toBe(7);
    expect(rolloverVerdict(7).level).toBe('nkro');
    s = applyKeyEvent(s, ev('up', 'KeyJ', 210));
    expect(s.maxSimultaneous).toBe(7);
    expect(rolloverVerdict(3).level).toBe('short');
    expect(rolloverVerdict(0).level).toBe('none');
  });

  it('does not mutate the previous state', () => {
    const before = createTesterState();
    const after = applyKeyEvent(before, ev('down', 'KeyA', 1));
    expect(before.events).toBe(0);
    expect(before.down).toEqual({});
    expect(after.events).toBe(1);
  });

  it('caps the log and ignores events with no key identity', () => {
    let s = createTesterState();
    for (let i = 0; i < MAX_LOG + 25; i++) s = applyKeyEvent(s, ev(i % 2 ? 'up' : 'down', 'KeyA', i * 100));
    expect(s.log.length).toBe(MAX_LOG);
    expect(applyKeyEvent(s, { type: 'down', code: '', key: '' })).toBe(s);
  });

  it('uses the logical key when the browser gives no physical code', () => {
    const s = applyKeyEvent(createTesterState(), { type: 'down', code: '', key: 'Dead', timeStamp: 5 });
    expect(s.counts['Key:Dead']).toBe(1);
  });
});

describe('key tester extras', () => {
  const press = (s, code, down, up) => applyKeyEvent(applyKeyEvent(s, { type: 'down', code, key: 'a', timeStamp: down }), { type: 'up', code, key: 'a', timeStamp: up });

  it('tracks hold time per key', () => {
    let s = press(createTesterState(), 'KeyA', 100, 160);
    s = press(s, 'KeyA', 300, 320);
    expect(dwellSummary(s, 'KeyA')).toEqual({ n: 2, avg: 40, min: 20, max: 60 });
    expect(dwellSummary(s, 'KeyB')).toBeNull();
  });

  it('computes coverage and untested keys', () => {
    const layout = buildKeyboardLayout({ tkl: true });
    const s = press(createTesterState(), 'KeyA', 1, 2);
    const cov = testCoverage(s, layout);
    expect(cov.tested).toBe(1);
    expect(cov.total).toBe(layoutKeyCodes(layout).length);
    expect(untestedKeys(s, layout).some((k) => k.c === 'KeyA')).toBe(false);
    expect(buildReport(s, layout)).toContain(`1/${cov.total}`);
  });

  it('compares held keys with a combo', () => {
    const r = comboStatus(['KeyW', 'KeyA', 'KeyZ'], COMBO_PRESETS[0].codes);
    expect(r.ok).toBe(false);
    expect(r.held).toBe(2);
    expect(r.missing).toContain('Space');
    expect(r.extra).toEqual(['KeyZ']);
    expect(comboStatus(['KeyA', 'KeyB'], ['KeyA', 'KeyB']).ok).toBe(true);
  });

  it('formats modifiers', () => {
    expect(modifierLabel({ ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift');
    expect(modifierLabel({})).toBe('none');
  });
});
