import { describe, it, expect } from 'vitest';
import {
  noteName, ccName, describeMessage, createDecodeState, MidiStreamParser, parseStream, splitSyx, buildSyx,
  parseHexBytes, lookupManufacturer, decodeIdentityReply, ClockBpmEstimator, mtcQuarterFrameMessages, MtcAssembler,
  latencyStats, keyboardOffset, noteOnBytes, noteOffBytes, controlChangeBytes, programChangeBytes,
  identityRequestBytes, categoryOf,
} from '../src/utils/midiTools.js';

const bytes = (...xs) => Uint8Array.from(xs);

// Decode a list of messages with one shared state, the way the monitor does for one input.
function decodeAll(msgs, t0 = 0, step = 0) {
  const st = createDecodeState();
  return msgs.map((m, i) => describeMessage(bytes(...m), { t: t0 + i * step, state: st }));
}

describe('note names', () => {
  it('uses C4 = 60 by default', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(64)).toBe('E4');
    expect(noteName(0)).toBe('C-1');
    expect(noteName(127)).toBe('G9');
  });

  it('supports the C3 = 60 convention', () => {
    expect(noteName(60, 'C3')).toBe('C3');
    expect(noteName(0, 'C3')).toBe('C-2');
    expect(noteName(127, 'C3')).toBe('G8');
  });

  it('returns a placeholder for out-of-range values', () => {
    expect(noteName(128)).toBe('?');
    expect(noteName(-1)).toBe('?');
    expect(noteName(1.5)).toBe('?');
  });
});

describe('controller names', () => {
  it('names standard controllers', () => {
    expect(ccName(7)).toBe('Channel Volume');
    expect(ccName(74)).toBe('Brightness (Cutoff)');
    expect(ccName(64)).toBe('Sustain Pedal');
    expect(ccName(123)).toBe('All Notes Off');
  });

  it('names LSB controllers 32-63 and marks the rest undefined', () => {
    expect(ccName(40)).toBe('LSB of CC 8 (Balance)');
    expect(ccName(3)).toBe('Undefined');
  });
});

describe('channel voice messages', () => {
  it('decodes note on with note name and channel', () => {
    const ev = describeMessage(bytes(0x90, 0x3C, 0x64));
    expect(ev).toMatchObject({ type: 'note-on', category: 'note', channel: 1, note: 60, noteName: 'C4', velocity: 100 });
    expect(ev.text).toContain('Note On C4');
  });

  it('treats note on with velocity 0 as note off and flags it', () => {
    const ev = describeMessage(bytes(0x91, 0x3C, 0x00));
    expect(ev).toMatchObject({ type: 'note-off', channel: 2, note: 60, viaZeroVelocity: true });
  });

  it('decodes note off with release velocity', () => {
    expect(describeMessage(bytes(0x82, 0x40, 0x20))).toMatchObject({ type: 'note-off', channel: 3, note: 64, noteName: 'E4', velocity: 32 });
  });

  it('applies the chosen note name convention', () => {
    const ev = describeMessage(bytes(0x90, 0x3C, 0x64), { noteConvention: 'C3' });
    expect(ev.noteName).toBe('C3');
    expect(ev.text).toContain('C3');
  });

  it('decodes control change with the controller name', () => {
    expect(describeMessage(bytes(0xB0, 0x07, 0x7F))).toMatchObject({ type: 'control-change', channel: 1, controller: 7, value: 127, controllerName: 'Channel Volume' });
  });

  it('decodes program change and channel pressure', () => {
    expect(describeMessage(bytes(0xC2, 0x05))).toMatchObject({ type: 'program-change', channel: 3, program: 5 });
    expect(describeMessage(bytes(0xD0, 0x40))).toMatchObject({ type: 'channel-pressure', category: 'aftertouch', pressure: 64 });
  });

  it('decodes polyphonic pressure', () => {
    expect(describeMessage(bytes(0xA0, 0x3C, 0x50))).toMatchObject({ type: 'poly-pressure', note: 60, noteName: 'C4', pressure: 80 });
  });

  it('decodes pitch bend as signed around centre', () => {
    expect(describeMessage(bytes(0xE0, 0x00, 0x40))).toMatchObject({ type: 'pitch-bend', value: 0, value14: 8192 });
    expect(describeMessage(bytes(0xE0, 0x00, 0x00))).toMatchObject({ type: 'pitch-bend', value: -8192, value14: 0 });
    expect(describeMessage(bytes(0xE0, 0x7F, 0x7F))).toMatchObject({ type: 'pitch-bend', value: 8191, value14: 16383 });
    expect(describeMessage(bytes(0xE0, 0x00, 0x60))).toMatchObject({ type: 'pitch-bend', value: 4096 });
  });

  it('reports an incomplete channel message instead of guessing', () => {
    expect(describeMessage(bytes(0x90, 0x3C))).toMatchObject({ type: 'unknown' });
  });

  it('builds outgoing channel messages with 1-based channels', () => {
    expect(Array.from(noteOnBytes(16, 60, 100))).toEqual([0x9F, 0x3C, 0x64]);
    expect(Array.from(noteOffBytes(1, 60))).toEqual([0x80, 0x3C, 0x00]);
    expect(Array.from(controlChangeBytes(2, 7, 100))).toEqual([0xB1, 7, 100]);
    expect(Array.from(programChangeBytes(10, 5))).toEqual([0xC9, 5]);
  });
});

describe('RPN and NRPN assembly', () => {
  it('assembles RPN 0 (pitch bend range) from CC 101/100/6', () => {
    const evs = decodeAll([[0xB0, 101, 0], [0xB0, 100, 0], [0xB0, 6, 12]]);
    expect(evs[0].type).toBe('control-change');
    expect(evs[2]).toMatchObject({ type: 'rpn', channel: 1, number: 0, parameterName: 'Pitch Bend Range', value: 12 * 128 });
  });

  it('adds CC 38 (LSB) to the 14-bit data value', () => {
    const evs = decodeAll([[0xB0, 101, 0], [0xB0, 100, 0], [0xB0, 6, 12], [0xB0, 38, 10]]);
    expect(evs[3]).toMatchObject({ type: 'rpn', value: 12 * 128 + 10 });
  });

  it('assembles NRPN from CC 99/98 and keeps channels separate', () => {
    const evs = decodeAll([[0xB0, 99, 1], [0xB0, 98, 2], [0xB0, 6, 5], [0xB1, 6, 9]]);
    expect(evs[2]).toMatchObject({ type: 'nrpn', channel: 1, number: 130, value: 640 });
    // Channel 2 has no parameter selected, so its data entry is a plain CC.
    expect(evs[3].type).toBe('control-change');
  });

  it('treats RPN 127/127 as null and emits no parameter value', () => {
    const evs = decodeAll([[0xB0, 101, 127], [0xB0, 100, 127], [0xB0, 6, 5]]);
    expect(evs[2].type).toBe('control-change');
    expect(evs[2].text).toContain('null');
  });

  it('resets data entry when a new parameter is selected', () => {
    const evs = decodeAll([[0xB0, 101, 0], [0xB0, 100, 1], [0xB0, 6, 3], [0xB0, 101, 0], [0xB0, 100, 2], [0xB0, 38, 4]]);
    // After the new select, CC 38 alone gives MSB 0 + LSB 4.
    expect(evs[5]).toMatchObject({ type: 'rpn', number: 2, value: 4 });
  });
});

describe('clock, transport and sensing', () => {
  it('estimates BPM from 0xF8 timing (120 BPM = one tick every 20.8333 ms)', () => {
    const tick = 60000 / (120 * 24);
    const st = createDecodeState();
    let last = null;
    for (let i = 0; i < 25; i++) last = describeMessage(bytes(0xF8), { t: 1000 + i * tick, state: st });
    expect(last.type).toBe('clock');
    expect(last.bpm).toBeCloseTo(120, 6);
  });

  it('gives no BPM with fewer than two ticks or zero timing span', () => {
    const c = new ClockBpmEstimator();
    expect(c.push(0)).toBeNull();
    expect(c.push(0)).toBeNull();
    expect(new ClockBpmEstimator().push(10)).toBeNull();
  });

  it('decodes start, continue, stop, active sensing and reset', () => {
    expect(describeMessage(bytes(0xFA))).toMatchObject({ type: 'start', category: 'clock' });
    expect(describeMessage(bytes(0xFB))).toMatchObject({ type: 'continue', category: 'clock' });
    expect(describeMessage(bytes(0xFC))).toMatchObject({ type: 'stop', category: 'clock' });
    expect(describeMessage(bytes(0xFE))).toMatchObject({ type: 'active-sensing', category: 'sensing' });
    expect(describeMessage(bytes(0xFF))).toMatchObject({ type: 'system-reset', category: 'system' });
  });

  it('decodes song position (14-bit, LSB first), song select and tune request', () => {
    expect(describeMessage(bytes(0xF2, 0x0A, 0x01))).toMatchObject({ type: 'song-position', beats: 138 });
    expect(describeMessage(bytes(0xF3, 0x05))).toMatchObject({ type: 'song-select', song: 5 });
    expect(describeMessage(bytes(0xF6))).toMatchObject({ type: 'tune-request' });
  });

  it('exposes categories for the monitor filters', () => {
    expect(categoryOf('clock')).toBe('clock');
    expect(categoryOf('rpn')).toBe('cc');
    expect(categoryOf('note-on')).toBe('note');
    expect(categoryOf('nope')).toBe('other');
  });
});

describe('MIDI time code quarter frames', () => {
  it('round-trips a timecode through eight quarter-frame messages', () => {
    const msgs = mtcQuarterFrameMessages({ hours: 1, minutes: 2, seconds: 3, frames: 4, rate: 1 });
    expect(msgs).toHaveLength(8);
    expect(Array.from(msgs[0])).toEqual([0xF1, 0x04]);
    const evs = decodeAll(msgs.map((m) => Array.from(m)));
    expect(evs[0].type).toBe('mtc-quarter-frame');
    const last = evs[7];
    expect(last.type).toBe('mtc-timecode');
    expect(last.timecode).toMatchObject({ hours: 1, minutes: 2, seconds: 3, frames: 4, rate: '25 fps' });
    expect(last.text).toBe('MTC 01:02:03:04 25 fps');
  });

  it('keeps hours above 15 and the drop-frame rate code', () => {
    const msgs = mtcQuarterFrameMessages({ hours: 23, minutes: 59, seconds: 59, frames: 29, rate: 2 });
    const asm = new MtcAssembler();
    let tc = null;
    for (const m of msgs) tc = asm.push(m[1]) || tc;
    expect(tc).toMatchObject({ hours: 23, minutes: 59, seconds: 59, frames: 29, rate: '29.97 fps (drop frame)' });
  });

  it('waits for piece 0 after a sequence break', () => {
    const asm = new MtcAssembler();
    expect(asm.push(0x25)).toBeNull(); // piece 2 with no piece 0 before it
    expect(asm.push(0x10)).toBeNull(); // piece 1 with no piece 0
  });
});

describe('SysEx decoding', () => {
  it('decodes a Universal Identity Request', () => {
    const ev = describeMessage(identityRequestBytes());
    expect(Array.from(identityRequestBytes())).toEqual([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);
    expect(ev).toMatchObject({ type: 'sysex', category: 'sysex', universal: 'identity-request', complete: true });
  });

  it('decodes an Identity Reply with a 1-byte manufacturer ID', () => {
    const ev = describeMessage(bytes(0xF0, 0x7E, 0x7F, 0x06, 0x02, 0x41, 0x10, 0x00, 0x02, 0x00, 0x01, 0x02, 0x03, 0x04, 0xF7));
    expect(ev.universal).toBe('identity-reply');
    expect(ev.identity).toEqual({
      deviceId: '7F', manufacturer: 'Roland', manufacturerId: '41', family: 16, model: 2, version: '01 02 03 04',
    });
  });

  it('decodes an Identity Reply with a 3-byte (00 xx xx) manufacturer ID', () => {
    const ev = describeMessage(bytes(0xF0, 0x7E, 0x00, 0x06, 0x02, 0x00, 0x00, 0x0E, 0x01, 0x00, 0x02, 0x00, 0x03, 0x04, 0x05, 0x06, 0xF7));
    expect(ev.identity).toMatchObject({ manufacturer: 'Alesis', manufacturerId: '00 00 0E', family: 1, model: 2, version: '03 04 05 06' });
  });

  it('decodes Universal master volume and GM on', () => {
    const vol = describeMessage(bytes(0xF0, 0x7F, 0x7F, 0x04, 0x01, 0x00, 0x7F, 0xF7));
    expect(vol.universal).toBe('master-volume');
    expect(vol.value).toBe(127 << 7);
    expect(describeMessage(bytes(0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF7)).text).toContain('GM1 System On');
  });

  it('looks up manufacturers from 1-byte and 00 xx xx IDs', () => {
    expect(lookupManufacturer(bytes(0x43))).toEqual({ id: '43', name: 'Yamaha', length: 1 });
    expect(lookupManufacturer(bytes(0x00, 0x20, 0x29))).toEqual({ id: '00 20 29', name: 'Focusrite / Novation', length: 3 });
    expect(lookupManufacturer(bytes(0x00, 0x20, 0x32))).toMatchObject({ name: 'Behringer', length: 3 });
    expect(lookupManufacturer(bytes(0x00, 0x7A, 0x01))).toMatchObject({ name: 'Unknown 3-byte ID', length: 3 });
    expect(lookupManufacturer(bytes(0x77))).toMatchObject({ name: 'Unknown ID', length: 1 });
    expect(lookupManufacturer(bytes(0x00, 0x20))).toMatchObject({ incomplete: true });
    expect(lookupManufacturer(bytes(), 0)).toBeNull();
  });

  it('names a vendor SysEx and keeps its data length', () => {
    const ev = describeMessage(bytes(0xF0, 0x43, 0x10, 0x4C, 0x00, 0x00, 0x7E, 0x00, 0xF7));
    expect(ev).toMatchObject({ manufacturer: 'Yamaha', manufacturerId: '43', length: 7, complete: true });
  });

  it('marks a SysEx without F7 as truncated', () => {
    const ev = describeMessage(bytes(0xF0, 0x43, 0x10));
    expect(ev).toMatchObject({ complete: false, manufacturer: 'Yamaha' });
    expect(ev.text.startsWith('[truncated]')).toBe(true);
  });

  it('decodes an identity reply body shorter than required as undecoded', () => {
    expect(decodeIdentityReply(bytes(0x7E, 0x7F, 0x06, 0x02, 0x41, 0x10))).toBeNull();
  });
});

describe('raw byte stream parser', () => {
  it('uses running status for repeated channel messages', () => {
    const msgs = parseStream(bytes(0x90, 0x3C, 0x64, 0x3E, 0x64, 0x40, 0x00));
    expect(msgs.map((m) => Array.from(m.bytes))).toEqual([
      [0x90, 0x3C, 0x64], [0x90, 0x3E, 0x64], [0x90, 0x40, 0x00],
    ]);
  });

  it('emits real-time bytes in the middle of a message without losing the message', () => {
    const msgs = parseStream(bytes(0x90, 0x3C, 0xF8, 0x64));
    expect(msgs.map((m) => Array.from(m.bytes))).toEqual([[0xF8], [0x90, 0x3C, 0x64]]);
  });

  it('cancels running status on system common messages', () => {
    const msgs = parseStream(bytes(0x90, 0x3C, 0x64, 0xF1, 0x10, 0x40, 0x00));
    expect(msgs.map((m) => Array.from(m.bytes))).toEqual([[0x90, 0x3C, 0x64], [0xF1, 0x10]]);
  });

  it('cancels running status after SysEx', () => {
    const msgs = parseStream(bytes(0x90, 0x3C, 0x64, 0xF0, 0x7E, 0xF7, 0x3E, 0x64));
    expect(msgs.map((m) => Array.from(m.bytes))).toEqual([[0x90, 0x3C, 0x64], [0xF0, 0x7E, 0xF7]]);
  });

  it('ends an unterminated SysEx at a status byte and keeps parsing', () => {
    const msgs = parseStream(bytes(0xF0, 0x7E, 0x90, 0x3C, 0x64));
    expect(msgs[0]).toMatchObject({ complete: false });
    expect(Array.from(msgs[0].bytes)).toEqual([0xF0, 0x7E]);
    expect(Array.from(msgs[1].bytes)).toEqual([0x90, 0x3C, 0x64]);
  });

  it('keeps real-time bytes inside SysEx as their own messages', () => {
    const msgs = parseStream(bytes(0xF0, 0x7E, 0xF8, 0x7F, 0xF7));
    expect(msgs.map((m) => Array.from(m.bytes))).toEqual([[0xF8], [0xF0, 0x7E, 0x7F, 0xF7]]);
  });

  it('keeps state across chunks and ignores data bytes with no status', () => {
    const p = new MidiStreamParser();
    expect(p.feed(bytes(0x3C, 0x64))).toEqual([]);
    expect(p.feed(bytes(0x90))).toEqual([]);
    const out = p.feed(bytes(0x3C, 0x64));
    expect(Array.from(out[0].bytes)).toEqual([0x90, 0x3C, 0x64]);
  });

  it('flushes an open SysEx at end of input', () => {
    const msgs = parseStream(bytes(0xF0, 0x01, 0x02));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ complete: false });
  });
});

describe('.syx splitting', () => {
  it('splits messages, ignores leading bytes and flags a truncated tail', () => {
    const file = bytes(0x55, 0xF0, 0x43, 0x10, 0xF7, 0xF0, 0x41, 0x00, 0x01, 0xF7, 0xF0, 0x7E, 0x90, 0x3C, 0x64);
    const parts = splitSyx(file);
    expect(parts.map((p) => [Array.from(p.bytes), p.complete])).toEqual([
      [[0xF0, 0x43, 0x10, 0xF7], true],
      [[0xF0, 0x41, 0x00, 0x01, 0xF7], true],
      [[0xF0, 0x7E], false],
    ]);
  });

  it('keeps real-time bytes that sit inside a dump', () => {
    const parts = splitSyx(bytes(0xF0, 0x7E, 0xF8, 0x06, 0xF7));
    expect(parts).toHaveLength(1);
    expect(Array.from(parts[0].bytes)).toEqual([0xF0, 0x7E, 0xF8, 0x06, 0xF7]);
  });

  it('starts a new message on F0 without an F7 before it', () => {
    const parts = splitSyx(bytes(0xF0, 0x01, 0xF0, 0x02, 0xF7));
    expect(parts.map((p) => p.complete)).toEqual([false, true]);
    expect(Array.from(parts[1].bytes)).toEqual([0xF0, 0x02, 0xF7]);
  });

  it('round-trips through buildSyx', () => {
    const file = bytes(0xF0, 0x43, 0x10, 0xF7, 0xF0, 0x41, 0x00, 0x01, 0xF7);
    const parts = splitSyx(file).map((p) => p.bytes);
    expect(Array.from(buildSyx(parts))).toEqual(Array.from(file));
  });
});

describe('hex parsing', () => {
  it('accepts spaces, commas, 0x prefixes and packed hex', () => {
    expect(Array.from(parseHexBytes('90 3C 7F'))).toEqual([0x90, 0x3C, 0x7F]);
    expect(Array.from(parseHexBytes('0x90,0x3c,0x7f'))).toEqual([0x90, 0x3C, 0x7F]);
    expect(Array.from(parseHexBytes('903C7F'))).toEqual([0x90, 0x3C, 0x7F]);
    expect(parseHexBytes('').length).toBe(0);
  });

  it('rejects odd digit counts and non-hex characters', () => {
    expect(() => parseHexBytes('903')).toThrow(/Odd/);
    expect(() => parseHexBytes('9G')).toThrow(/hex/);
  });
});

describe('latency statistics', () => {
  it('computes min, median, mean, max and population std dev', () => {
    const s = latencyStats([4, 1, 3, 2]);
    expect(s.count).toBe(4);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.mean).toBeCloseTo(2.5, 10);
    expect(s.median).toBeCloseTo(2.5, 10);
    expect(s.stdev).toBeCloseTo(Math.sqrt(1.25), 10);
  });

  it('uses the middle sample for an odd count and ignores non-finite values', () => {
    const s = latencyStats([5, NaN, 1, 3]);
    expect(s.count).toBe(3);
    expect(s.median).toBe(3);
  });

  it('reports no samples as count 0', () => {
    expect(latencyStats([])).toEqual({ count: 0 });
  });
});

describe('computer keyboard map', () => {
  it('maps the DAW piano-key row, and returns null for other keys', () => {
    expect(keyboardOffset('KeyA')).toBe(0);
    expect(keyboardOffset('KeyW')).toBe(1);
    expect(keyboardOffset('KeyK')).toBe(12);
    expect(keyboardOffset('Semicolon')).toBe(16);
    expect(keyboardOffset('KeyZ')).toBeNull();
    expect(keyboardOffset('constructor')).toBeNull();
  });
});
