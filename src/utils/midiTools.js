/**
 * MIDI protocol helpers for the MIDI Monitor & SysEx Librarian.
 *
 * Pure functions only (no Web MIDI calls here) so they can be unit-tested without hardware:
 *  - message decoding (channel voice, system common, real-time, SysEx),
 *  - a stateful raw byte-stream parser with running status,
 *  - RPN / NRPN assembly from CC 99/98/101/100/6/38,
 *  - MIDI clock BPM estimation from 0xF8 timing, MTC quarter-frame timecode,
 *  - manufacturer ID lookup (1-byte and 00 xx xx forms), Universal SysEx identity reply,
 *  - .syx splitting / joining, hex parsing, latency statistics, computer-keyboard note map.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Octave naming conventions. Middle C is MIDI note 60 in both; only the label differs. */
export const OCTAVE_CONVENTIONS = {
  C4: { id: 'C4', label: 'C4 = 60 (scientific, most hardware manuals)', octaveOffset: -1 },
  C3: { id: 'C3', label: 'C3 = 60 (Yamaha / Ableton / Logic style)', octaveOffset: -2 },
};

/** Note name for a MIDI note number, e.g. 60 -> "C4" (or "C3" with the C3 convention). */
export function noteName(note, convention = 'C4') {
  if (!Number.isInteger(note) || note < 0 || note > 127) return '?';
  const conv = OCTAVE_CONVENTIONS[convention] || OCTAVE_CONVENTIONS.C4;
  const octave = Math.floor(note / 12) + conv.octaveOffset;
  return `${NOTE_NAMES[note % 12]}${octave}`;
}

/** MIDI 1.0 control change names (controllers 0-127). 32-63 are LSBs of 0-31. */
export const CC_NAMES = {
  0: 'Bank Select (MSB)', 1: 'Modulation Wheel', 2: 'Breath Controller', 4: 'Foot Controller',
  5: 'Portamento Time', 6: 'Data Entry (MSB)', 7: 'Channel Volume', 8: 'Balance', 10: 'Pan',
  11: 'Expression', 12: 'Effect Control 1', 13: 'Effect Control 2',
  16: 'General Purpose 1', 17: 'General Purpose 2', 18: 'General Purpose 3', 19: 'General Purpose 4',
  32: 'Bank Select (LSB)', 38: 'Data Entry (LSB)',
  64: 'Sustain Pedal', 65: 'Portamento On/Off', 66: 'Sostenuto', 67: 'Soft Pedal', 68: 'Legato Footswitch',
  69: 'Hold 2', 70: 'Sound Variation', 71: 'Resonance (Timbre)', 72: 'Release Time', 73: 'Attack Time',
  74: 'Brightness (Cutoff)', 75: 'Sound Controller 6', 76: 'Sound Controller 7', 77: 'Sound Controller 8',
  78: 'Sound Controller 9', 79: 'Sound Controller 10',
  80: 'General Purpose 5', 81: 'General Purpose 6', 82: 'General Purpose 7', 83: 'General Purpose 8',
  84: 'Portamento Control', 91: 'Reverb Send', 92: 'Tremolo Depth', 93: 'Chorus Send', 94: 'Celeste Depth',
  95: 'Phaser Depth', 96: 'Data Increment', 97: 'Data Decrement',
  98: 'NRPN (LSB)', 99: 'NRPN (MSB)', 100: 'RPN (LSB)', 101: 'RPN (MSB)',
  120: 'All Sound Off', 121: 'Reset All Controllers', 122: 'Local Control', 123: 'All Notes Off',
  124: 'Omni Mode Off', 125: 'Omni Mode On', 126: 'Mono Mode On', 127: 'Poly Mode On',
};

export function ccName(cc) {
  if (CC_NAMES[cc]) return CC_NAMES[cc];
  if (cc >= 32 && cc <= 63) return `LSB of CC ${cc - 32}${CC_NAMES[cc - 32] ? ` (${CC_NAMES[cc - 32]})` : ''}`;
  return 'Undefined';
}

/** Registered RPN parameters (MIDI 1.0 / RP-000..RP-005). Key = 14-bit number. */
export const RPN_NAMES = {
  0x0000: 'Pitch Bend Range', 0x0001: 'Fine Tuning', 0x0002: 'Coarse Tuning',
  0x0003: 'Tuning Program Change', 0x0004: 'Tuning Bank Select', 0x0005: 'Modulation Depth Range',
};

/**
 * Manufacturer IDs. Partial list of well-known IDs; anything not here is shown as unknown
 * with its raw ID. Check the MIDI Manufacturers Association list for a complete picture.
 */
const MANUFACTURERS_1 = {
  0x01: 'Sequential Circuits', 0x04: 'Moog Music', 0x07: 'Kurzweil', 0x0F: 'Ensoniq', 0x10: 'Oberheim',
  0x11: 'Apple Computer', 0x13: 'Digidesign', 0x18: 'E-mu Systems', 0x1C: 'Eventide', 0x29: 'PPG',
  0x40: 'Kawai', 0x41: 'Roland', 0x42: 'Korg', 0x43: 'Yamaha', 0x44: 'Casio', 0x47: 'Akai',
  0x7D: 'Non-commercial / educational', 0x7E: 'Universal Non-Realtime', 0x7F: 'Universal Realtime',
};
const MANUFACTURERS_3 = {
  '00000E': 'Alesis',
  '002029': 'Focusrite / Novation',
  '002032': 'Behringer',
};

export function hex2(b) {
  return (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
}

export function toHex(bytes, sep = ' ') {
  return Array.from(bytes, hex2).join(sep);
}

/**
 * Look up the manufacturer ID that starts at bytes[offset]. A leading 0x00 means a 3-byte ID
 * (00 xx xx); otherwise the ID is one byte. Returns null when there is no byte at offset.
 */
export function lookupManufacturer(bytes, offset = 0) {
  if (bytes.length <= offset) return null;
  const b0 = bytes[offset];
  if (b0 === 0x00) {
    if (bytes.length < offset + 3) {
      return { id: toHex(bytes.subarray(offset)), name: 'Incomplete 3-byte ID', length: bytes.length - offset, incomplete: true };
    }
    const key = `${hex2(bytes[offset + 1])}${hex2(bytes[offset + 2])}`;
    const k3 = `00${key}`;
    return {
      id: toHex(bytes.subarray(offset, offset + 3)),
      name: MANUFACTURERS_3[k3] || 'Unknown 3-byte ID',
      length: 3,
    };
  }
  return { id: hex2(b0), name: MANUFACTURERS_1[b0] || 'Unknown ID', length: 1 };
}

/** Parse a Universal SysEx Identity Reply body (starting at 7E dd 06 02). */
export function decodeIdentityReply(body) {
  if (body.length < 5 || body[0] !== 0x7E || body[2] !== 0x06 || body[3] !== 0x02) return null;
  const manu = lookupManufacturer(body, 4);
  if (!manu || manu.incomplete) return null;
  let i = 4 + manu.length;
  if (body.length < i + 8) return null;
  return {
    deviceId: hex2(body[1]),
    manufacturer: manu.name,
    manufacturerId: manu.id,
    family: body[i] | (body[i + 1] << 7),
    model: body[i + 2] | (body[i + 3] << 7),
    version: toHex(body.subarray(i + 4, i + 8)),
  };
}

const MMC_COMMANDS = {
  0x01: 'Stop', 0x02: 'Play', 0x03: 'Deferred Play', 0x04: 'Fast Forward', 0x05: 'Rewind',
  0x06: 'Record Strobe', 0x07: 'Record Exit', 0x08: 'Record Pause', 0x09: 'Pause',
};

/** Decode the body of a SysEx message (bytes between F0 and F7). */
function decodeSysexBody(body) {
  if (body.length === 0) return { text: 'Empty SysEx' };
  if (body[0] === 0x7E || body[0] === 0x7F) {
    const realtime = body[0] === 0x7F;
    const device = body[1];
    const sub1 = body[2];
    const sub2 = body[3];
    const scope = realtime ? 'Universal Realtime' : 'Universal Non-Realtime';
    if (!realtime && sub1 === 0x06 && sub2 === 0x01) {
      return { universal: 'identity-request', text: `${scope}: Identity Request (device ${hex2(device)})` };
    }
    if (!realtime && sub1 === 0x06 && sub2 === 0x02) {
      const identity = decodeIdentityReply(body);
      if (identity) {
        return {
          universal: 'identity-reply', identity,
          text: `Identity Reply from ${identity.manufacturer} (${identity.manufacturerId}): family ${identity.family}, model ${identity.model}, version ${identity.version}`,
        };
      }
      return { universal: 'identity-reply', text: 'Identity Reply (could not decode)' };
    }
    if (realtime && sub1 === 0x04 && sub2 === 0x01 && body.length >= 6) {
      const value = body[4] | (body[5] << 7);
      return { universal: 'master-volume', value, text: `Master Volume = ${value} (of 16383), device ${hex2(device)}` };
    }
    if (sub1 === 0x09) {
      const names = { 0x01: 'GM1 System On', 0x02: 'GM System Off', 0x03: 'GM2 System On' };
      if (names[sub2]) return { universal: 'general-midi', text: `${scope}: ${names[sub2]}` };
    }
    if (realtime && sub1 === 0x06) {
      return { universal: 'mmc', text: `MMC ${MMC_COMMANDS[sub2] || `command ${hex2(sub2)}`} (device ${hex2(device)})` };
    }
    return { universal: 'other', text: `${scope}: sub-ID ${hex2(sub1)} ${hex2(sub2)} (device ${hex2(device)})` };
  }
  const manu = lookupManufacturer(body, 0);
  if (!manu || manu.incomplete) return { text: 'SysEx (manufacturer ID incomplete)' };
  return { manufacturer: manu.name, manufacturerId: manu.id, text: `${manu.name} (${manu.id}), ${body.length - manu.length} data bytes` };
}

/** Clock BPM estimator: 24 pulses per quarter note, averaged over a sliding window. */
export class ClockBpmEstimator {
  constructor(windowTicks = 48) {
    this.windowTicks = windowTicks;
    this.times = [];
  }

  reset() {
    this.times = [];
  }

  /** Feed a 0xF8 arrival time in milliseconds; returns the BPM estimate or null. */
  push(t) {
    this.times.push(t);
    if (this.times.length > this.windowTicks) this.times.shift();
    if (this.times.length < 2) return null;
    const span = this.times[this.times.length - 1] - this.times[0];
    if (!(span > 0)) return null;
    const avgIntervalMs = span / (this.times.length - 1);
    return 60000 / (avgIntervalMs * 24);
  }
}

const MTC_RATES = ['24 fps', '25 fps', '29.97 fps (drop frame)', '30 fps'];

/** Build the 8 quarter-frame messages (F1 nn) for one timecode. rate: 0=24, 1=25, 2=29.97df, 3=30. */
export function mtcQuarterFrameMessages({ hours, minutes, seconds, frames, rate = 3 }) {
  const pieces = [
    frames & 0x0F, (frames >> 4) & 0x01,
    seconds & 0x0F, (seconds >> 4) & 0x07,
    minutes & 0x0F, (minutes >> 4) & 0x07,
    hours & 0x0F, ((hours >> 4) & 0x01) | ((rate & 0x03) << 1),
  ];
  return pieces.map((nib, piece) => Uint8Array.of(0xF1, (piece << 4) | nib));
}

/** Assembles 8 MTC quarter-frame nibbles into a timecode. Feed it the F1 data byte. */
export class MtcAssembler {
  constructor() {
    this.nibbles = new Array(8).fill(0);
    this.expect = 0;
  }

  /** Returns a timecode object when piece 7 completes a full frame, else null. */
  push(dataByte) {
    const piece = (dataByte >> 4) & 0x07;
    const nib = dataByte & 0x0F;
    if (piece === 0) {
      this.nibbles[0] = nib;
      this.expect = 1;
      return null;
    }
    if (piece !== this.expect) {
      this.expect = 0; // out of sequence: wait for the next piece 0
      return null;
    }
    this.nibbles[piece] = nib;
    if (piece === 7) {
      this.expect = 0;
      return decodeMtcNibbles(this.nibbles);
    }
    this.expect = piece + 1;
    return null;
  }
}

function decodeMtcNibbles(n) {
  const frames = (n[1] & 0x01) << 4 | n[0];
  const seconds = (n[3] & 0x07) << 4 | n[2];
  const minutes = (n[5] & 0x07) << 4 | n[4];
  const hours = (n[7] & 0x01) << 4 | n[6];
  const rateCode = (n[7] >> 1) & 0x03;
  const rate = MTC_RATES[rateCode];
  const pad = (v) => String(v).padStart(2, '0');
  return {
    hours, minutes, seconds, frames, rate,
    text: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)} ${rate}`,
  };
}

const SYSCOMMON_DATA_LEN = { 0xF1: 1, 0xF2: 2, 0xF3: 1, 0xF4: 0, 0xF5: 0, 0xF6: 0 };
const CHANNEL_DATA_LEN = (status) => ((status & 0xF0) === 0xC0 || (status & 0xF0) === 0xD0 ? 1 : 2);

/** Fresh decoder state for one MIDI input (RPN/NRPN registers, clock estimator, MTC assembler). */
export function createDecodeState() {
  return {
    rpn: {},          // per channel: { kind, msb, lsb }
    dataMsb: {},      // per channel: last CC 6
    dataLsb: {},      // per channel: last CC 38
    clock: new ClockBpmEstimator(),
    mtc: new MtcAssembler(),
  };
}

const CATEGORY = {
  'note-on': 'note', 'note-off': 'note',
  'control-change': 'cc', rpn: 'cc', nrpn: 'cc',
  'program-change': 'program',
  'pitch-bend': 'pitch',
  'channel-pressure': 'aftertouch', 'poly-pressure': 'aftertouch',
  clock: 'clock', start: 'clock', continue: 'clock', stop: 'clock',
  'active-sensing': 'sensing',
  'mtc-quarter-frame': 'mtc', 'mtc-timecode': 'mtc',
  'song-position': 'system', 'song-select': 'system', 'tune-request': 'system', 'system-reset': 'system',
  sysex: 'sysex',
  unknown: 'other',
};

/** Filter category for a decoded message type (used by the monitor's type filters). */
export function categoryOf(type) {
  return CATEGORY[type] || 'other';
}

export const MESSAGE_CATEGORIES = [
  ['note', 'Notes'], ['cc', 'CC / RPN / NRPN'], ['program', 'Program change'], ['pitch', 'Pitch bend'],
  ['aftertouch', 'Aftertouch'], ['clock', 'Clock / transport'], ['sensing', 'Active sensing'],
  ['mtc', 'MTC'], ['system', 'Song / system'], ['sysex', 'SysEx'], ['other', 'Other'],
];

function noteEvent(type, channel, note, velocity, zeroVelocityNoteOn, opts) {
  const nn = noteName(note, opts.noteConvention);
  return {
    type, category: 'note', channel, note, noteName: nn, velocity,
    viaZeroVelocity: zeroVelocityNoteOn,
    text: `${type === 'note-on' ? 'Note On' : 'Note Off'} ${nn} (${note}) vel ${velocity} ch ${channel}${zeroVelocityNoteOn ? ' [vel 0 note-on]' : ''}`,
  };
}

function decodeControlChange(channel, cc, value, t, st) {
  const base = {
    type: 'control-change', category: 'cc', channel, controller: cc, controllerName: ccName(cc), value,
    text: `CC ${cc} ${ccName(cc)} = ${value} (ch ${channel})`,
  };
  if (cc === 99 || cc === 98 || cc === 101 || cc === 100) {
    const reg = st.rpn[channel] || (st.rpn[channel] = { kind: null, msb: undefined, lsb: undefined });
    if (cc === 99 || cc === 98) reg.kind = 'nrpn';
    else reg.kind = 'rpn';
    if (cc === 99 || cc === 101) reg.msb = value;
    else reg.lsb = value;
    // A new parameter select invalidates the previous data entry.
    st.dataMsb[channel] = undefined;
    st.dataLsb[channel] = undefined;
    return base;
  }
  if (cc === 6 || cc === 38) {
    if (cc === 6) st.dataMsb[channel] = value;
    else st.dataLsb[channel] = value;
    const reg = st.rpn[channel];
    if (!reg || !reg.kind || reg.msb === undefined) return base;
    const msb = reg.msb ?? 0;
    const lsb = reg.lsb ?? 0;
    if (msb === 127 && lsb === 127) return { ...base, text: `${base.text} (RPN/NRPN null)` };
    const number = (msb << 7) | lsb;
    const dataValue = ((st.dataMsb[channel] ?? 0) << 7) | (st.dataLsb[channel] ?? 0);
    const name = reg.kind === 'rpn' ? RPN_NAMES[number] : undefined;
    const label = reg.kind === 'rpn'
      ? `RPN 0x${number.toString(16).toUpperCase().padStart(4, '0')}${name ? ` ${name}` : ''}`
      : `NRPN 0x${number.toString(16).toUpperCase().padStart(4, '0')}`;
    return {
      type: reg.kind, category: 'cc', channel, number, parameterName: name, value: dataValue, controller: cc,
      text: `${label} = ${dataValue} (MSB ${st.dataMsb[channel] ?? 0}, LSB ${st.dataLsb[channel] ?? 0}, ch ${channel})`,
    };
  }
  return base;
}

function decodeVoice(bytes, t, st, opts) {
  const status = bytes[0];
  const kind = status & 0xF0;
  const channel = (status & 0x0F) + 1;
  const need = CHANNEL_DATA_LEN(status);
  if (bytes.length < need + 1) {
    return { type: 'unknown', category: 'other', channel, text: `Incomplete channel message ${toHex(bytes)}` };
  }
  const d1 = bytes[1];
  const d2 = bytes[2];
  switch (kind) {
    case 0x80: return noteEvent('note-off', channel, d1, d2, false, opts);
    case 0x90:
      return d2 === 0 ? noteEvent('note-off', channel, d1, 0, true, opts) : noteEvent('note-on', channel, d1, d2, false, opts);
    case 0xA0: {
      const nn = noteName(d1, opts.noteConvention);
      return { type: 'poly-pressure', category: 'aftertouch', channel, note: d1, noteName: nn, pressure: d2, text: `Poly Pressure ${nn} = ${d2} (ch ${channel})` };
    }
    case 0xB0: return decodeControlChange(channel, d1, d2, t, st);
    case 0xC0: return { type: 'program-change', category: 'program', channel, program: d1, text: `Program Change ${d1} (ch ${channel})` };
    case 0xD0: return { type: 'channel-pressure', category: 'aftertouch', channel, pressure: d1, text: `Channel Pressure ${d1} (ch ${channel})` };
    case 0xE0: {
      const raw = (d2 << 7) | d1;
      const value = raw - 8192;
      const signed = value > 0 ? `+${value}` : String(value);
      return { type: 'pitch-bend', category: 'pitch', channel, value, value14: raw, text: `Pitch Bend ${signed} (14-bit ${raw}, ch ${channel})` };
    }
    default:
      return { type: 'unknown', category: 'other', channel, text: `Unknown status ${hex2(status)}` };
  }
}

function decodeRealtime(status, t, st) {
  switch (status) {
    case 0xF8: {
      const bpm = st.clock.push(t);
      return { type: 'clock', category: 'clock', bpm, text: bpm ? `Clock (~${bpm.toFixed(1)} BPM)` : 'Clock' };
    }
    case 0xFA: st.clock.reset(); return { type: 'start', category: 'clock', text: 'Start' };
    case 0xFB: return { type: 'continue', category: 'clock', text: 'Continue' };
    case 0xFC: return { type: 'stop', category: 'clock', text: 'Stop' };
    case 0xFE: return { type: 'active-sensing', category: 'sensing', text: 'Active Sensing' };
    case 0xFF: return { type: 'system-reset', category: 'system', text: 'System Reset' };
    default: return { type: 'unknown', category: 'other', text: `Undefined real-time ${hex2(status)}` };
  }
}

function decodeSystemCommon(bytes, t, st) {
  const status = bytes[0];
  const need = SYSCOMMON_DATA_LEN[status];
  if (need === undefined) return { type: 'unknown', category: 'other', text: `Stray ${hex2(status)}` };
  if (bytes.length < need + 1) return { type: 'unknown', category: 'other', text: `Incomplete system message ${toHex(bytes)}` };
  if (status === 0xF1) {
    const data = bytes[1];
    const piece = (data >> 4) & 0x07;
    const tc = st.mtc.push(data);
    if (tc) return { type: 'mtc-timecode', category: 'mtc', piece, timecode: tc, text: `MTC ${tc.text}` };
    return { type: 'mtc-quarter-frame', category: 'mtc', piece, nibble: data & 0x0F, text: `MTC quarter frame ${piece} (nibble ${data & 0x0F})` };
  }
  if (status === 0xF2) {
    const beats = bytes[1] | (bytes[2] << 7);
    return { type: 'song-position', category: 'system', beats, text: `Song Position ${beats} (${beats} x 16th notes)` };
  }
  if (status === 0xF3) return { type: 'song-select', category: 'system', song: bytes[1], text: `Song Select ${bytes[1]}` };
  if (status === 0xF6) return { type: 'tune-request', category: 'system', text: 'Tune Request' };
  return { type: 'unknown', category: 'other', text: `Undefined system common ${hex2(status)}` };
}

function decodeSysex(bytes) {
  const complete = bytes.length >= 2 && bytes[bytes.length - 1] === 0xF7;
  const body = bytes.subarray(1, complete ? bytes.length - 1 : bytes.length);
  const info = decodeSysexBody(body);
  const prefix = complete ? '' : '[truncated] ';
  return {
    type: 'sysex', category: 'sysex', length: body.length, complete, ...info,
    text: `${prefix}SysEx ${info.text}`,
  };
}

/**
 * Decode one complete MIDI message (Uint8Array or number array, e.g. Web MIDI event.data).
 * `t` is the arrival time in milliseconds (event.timeStamp), used for clock BPM.
 * `state` is a per-input object from createDecodeState(); keep it across messages.
 */
export function describeMessage(input, { t = 0, state, noteConvention = 'C4' } = {}) {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input);
  if (bytes.length === 0) return null;
  const st = state || createDecodeState();
  const opts = { noteConvention };
  const status = bytes[0];
  let ev;
  if (status === 0xF0) ev = decodeSysex(bytes);
  else if (status >= 0xF8) ev = decodeRealtime(status, t, st);
  else if (status >= 0xF0) ev = decodeSystemCommon(bytes, t, st);
  else if (status >= 0x80) ev = decodeVoice(bytes, t, st, opts);
  else ev = { type: 'unknown', category: 'other', text: `Data byte ${hex2(status)} without status` };
  return { ...ev, t, raw: toHex(bytes) };
}

/**
 * Stateful raw byte-stream parser (for pasted or file bytes). Handles running status, real-time
 * bytes interleaved anywhere (including inside SysEx), SysEx accumulation, and SysEx truncated by
 * a status byte. Returns complete messages as { bytes, t, complete }.
 */
export class MidiStreamParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.running = 0;
    this.cur = null;
    this.sysex = null;
  }

  feed(input, t = 0) {
    const out = [];
    const emit = (arr, complete = true) => out.push({ bytes: Uint8Array.from(arr), t, complete });
    for (const b of input) {
      if (b >= 0xF8) { emit([b]); continue; } // real-time: never changes running status or SysEx
      if (this.sysex) {
        if (b === 0xF7) { this.sysex.push(b); emit(this.sysex); this.sysex = null; continue; }
        if (b < 0x80) { this.sysex.push(b); continue; }
        emit(this.sysex, false); // a status byte ends an unterminated SysEx
        this.sysex = null;
      }
      if (b === 0xF7) continue; // stray end-of-exclusive
      if (b === 0xF0) { this.sysex = [b]; this.running = 0; this.cur = null; continue; }
      if (b >= 0x80) {
        if (b >= 0xF0) {
          this.running = 0; // system common cancels running status
          const need = SYSCOMMON_DATA_LEN[b];
          this.cur = null;
          if (need === 0) emit([b]);
          else if (need !== undefined) this.cur = { status: b, need, data: [] };
        } else {
          this.running = b;
          this.cur = { status: b, need: CHANNEL_DATA_LEN(b), data: [] };
        }
        continue;
      }
      // Data byte.
      if (!this.cur) {
        if (!this.running) continue;
        this.cur = { status: this.running, need: CHANNEL_DATA_LEN(this.running), data: [] };
      }
      this.cur.data.push(b);
      if (this.cur.data.length === this.cur.need) {
        emit([this.cur.status, ...this.cur.data]);
        this.cur = null;
      }
    }
    return out;
  }

  /** Call at end of input: returns an unterminated SysEx, if one is open. */
  flush(t = 0) {
    if (!this.sysex) return null;
    const msg = { bytes: Uint8Array.from(this.sysex), t, complete: false };
    this.sysex = null;
    return msg;
  }
}

/** Parse a whole byte stream into messages. */
export function parseStream(bytes, t = 0) {
  const parser = new MidiStreamParser();
  const msgs = parser.feed(bytes, t);
  const tail = parser.flush(t);
  if (tail) msgs.push(tail);
  return msgs;
}

/**
 * Split a .syx file into SysEx messages. Each message runs from F0 to F7 inclusive. A new F0 or a
 * non-real-time status byte ends an unterminated message, which is returned with complete:false.
 * Bytes before the first F0 are ignored.
 */
export function splitSyx(bytes) {
  const out = [];
  let cur = null;
  const close = (complete) => { out.push({ bytes: Uint8Array.from(cur), complete }); cur = null; };
  for (const b of bytes) {
    if (cur === null) {
      if (b === 0xF0) cur = [b];
      continue;
    }
    if (b === 0xF7) { cur.push(b); close(true); continue; }
    if (b === 0xF0) { close(false); cur = [b]; continue; }
    if (b >= 0x80 && b < 0xF8) { close(false); continue; }
    cur.push(b);
  }
  if (cur !== null) close(false);
  return out;
}

/** Concatenate SysEx messages into .syx file bytes. */
export function buildSyx(messages) {
  const total = messages.reduce((n, m) => n + m.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const m of messages) { out.set(m, off); off += m.length; }
  return out;
}

/** Parse hex text such as "90 3C 7F", "0x90,0x3c", or "903C7F". Throws on invalid input. */
export function parseHexBytes(text) {
  const s = String(text).replace(/0x/gi, '').replace(/[\s,;:\-_]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error('Only hex digits and separators are allowed');
  if (s.length % 2 !== 0) throw new Error('Odd number of hex digits');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** Channel voice message builders. channel is 1-16. */
export function noteOnBytes(channel, note, velocity) {
  return Uint8Array.of(0x90 | ((channel - 1) & 0x0F), note & 0x7F, velocity & 0x7F);
}
export function noteOffBytes(channel, note, velocity = 0) {
  return Uint8Array.of(0x80 | ((channel - 1) & 0x0F), note & 0x7F, velocity & 0x7F);
}
export function controlChangeBytes(channel, controller, value) {
  return Uint8Array.of(0xB0 | ((channel - 1) & 0x0F), controller & 0x7F, value & 0x7F);
}
export function programChangeBytes(channel, program) {
  return Uint8Array.of(0xC0 | ((channel - 1) & 0x0F), program & 0x7F);
}

/** Universal Non-Realtime Identity Request: F0 7E dd 06 01 F7 (dd = 7F for all devices). */
export function identityRequestBytes(deviceId = 0x7F) {
  return Uint8Array.of(0xF0, 0x7E, deviceId & 0x7F, 0x06, 0x01, 0xF7);
}

/** Summary statistics for latency samples in milliseconds. */
export function latencyStats(samplesMs) {
  const xs = samplesMs.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { count: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
  return { count: n, min: xs[0], max: xs[n - 1], mean, median, stdev: Math.sqrt(variance) };
}

/**
 * Computer keyboard to note offset, relative to the base note the user chose. Layout follows the
 * common DAW piano-key mapping: A W S E D F T G Y H U J K O L P ;
 */
export const KEYBOARD_NOTE_KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export function keyboardOffset(code) {
  return Object.prototype.hasOwnProperty.call(KEYBOARD_NOTE_KEYS, code) ? KEYBOARD_NOTE_KEYS[code] : null;
}
