/**
 * Byte-stuffing and framing: COBS, COBS/R, SLIP (RFC 1055) and HDLC-style flag/escape
 * stuffing (0x7E flag, 0x7D escape, XOR 0x20). Encoders produce frames without a
 * trailing delimiter except SLIP (END at both ends); splitters find frames in a stream.
 */
import { DecodeError } from './bytes.js';

// ---------- COBS ----------

/** Standard COBS encode (no trailing 0x00 delimiter). */
export function cobsEncode(data) {
  const out = [0];
  let codeIdx = 0;
  let code = 1;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte !== 0) {
      out.push(byte);
      code++;
      if (code === 0xff) {
        out[codeIdx] = code;
        codeIdx = out.length;
        out.push(0);
        code = 1;
      }
    } else {
      out[codeIdx] = code;
      codeIdx = out.length;
      out.push(0);
      code = 1;
    }
  }
  out[codeIdx] = code;
  return Uint8Array.from(out);
}

/** Strip the single optional trailing 0x00 delimiter from a COBS frame. */
function stripDelimiter(frame) {
  if (frame.length && frame[frame.length - 1] === 0) return frame.subarray(0, frame.length - 1);
  return frame;
}

/** Standard COBS decode. Accepts the frame with or without its trailing 0x00. */
export function cobsDecode(frame) {
  const data = stripDelimiter(frame);
  const out = [];
  let i = 0;
  while (i < data.length) {
    const code = data[i++];
    if (code === 0) throw new DecodeError('COBS: zero byte inside frame', i - 1);
    for (let k = 1; k < code; k++) {
      if (i >= data.length) throw new DecodeError('COBS: truncated block', i);
      const b = data[i++];
      if (b === 0) throw new DecodeError('COBS: zero byte inside block', i - 1);
      out.push(b);
    }
    if (code !== 0xff && i < data.length) out.push(0);
  }
  return Uint8Array.from(out);
}

// ---------- COBS/R (reduced) ----------

/**
 * COBS/R encode: standard COBS, except that when the final block carries data whose
 * last byte is >= its normal code value, that byte is moved into the code position and
 * dropped from the end (saving one byte). Inputs ending in 0x00 encode exactly as COBS.
 */
export function cobsrEncode(data) {
  const out = [0];
  let codeIdx = 0;
  let code = 1;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte !== 0) {
      out.push(byte);
      code++;
      if (code === 0xff) {
        out[codeIdx] = code;
        codeIdx = out.length;
        out.push(0);
        code = 1;
      }
    } else {
      out[codeIdx] = code;
      codeIdx = out.length;
      out.push(0);
      code = 1;
    }
  }
  out[codeIdx] = code;
  // final block: has data if something follows its code byte
  const lastBlockHasData = out.length - 1 > codeIdx;
  if (lastBlockHasData && code !== 0xff) {
    const lastByte = out[out.length - 1];
    if (lastByte >= code) {
      out[codeIdx] = lastByte;
      out.pop();
    }
  }
  return Uint8Array.from(out);
}

/** COBS/R decode (inverse of cobsrEncode). A final code greater than the bytes that follow it marks the reduced final block. */
export function cobsrDecode(frame) {
  const data = stripDelimiter(frame);
  const out = [];
  let i = 0;
  while (i < data.length) {
    const code = data[i++];
    if (code === 0) throw new DecodeError('COBS/R: zero byte inside frame', i - 1);
    const remaining = data.length - i;
    if (code > remaining + 1) {
      // reduced final block: the bytes that follow, then the code value itself
      for (let k = i; k < data.length; k++) out.push(data[k]);
      out.push(code);
      i = data.length;
      break;
    }
    for (let k = 1; k < code; k++) {
      if (i >= data.length) throw new DecodeError('COBS/R: truncated block', i);
      const b = data[i++];
      if (b === 0) throw new DecodeError('COBS/R: zero byte inside block', i - 1);
      out.push(b);
    }
    if (code !== 0xff && i < data.length) out.push(0);
  }
  return Uint8Array.from(out);
}

// ---------- SLIP (RFC 1055) ----------

export const SLIP_END = 0xc0;
export const SLIP_ESC = 0xdb;
export const SLIP_ESC_END = 0xdc;
export const SLIP_ESC_ESC = 0xdd;

/** SLIP encode: END, escaped payload, END. */
export function slipEncode(data) {
  const out = [SLIP_END];
  for (const b of data) {
    if (b === SLIP_END) out.push(SLIP_ESC, SLIP_ESC_END);
    else if (b === SLIP_ESC) out.push(SLIP_ESC, SLIP_ESC_ESC);
    else out.push(b);
  }
  out.push(SLIP_END);
  return Uint8Array.from(out);
}

/** Split a SLIP stream into frames. Empty frames (back-to-back END bytes) are skipped. */
export function slipSplit(stream) {
  const frames = [];
  let cur = null;
  let start = 0;
  let escaping = false;
  let bad = null;
  for (let i = 0; i < stream.length; i++) {
    const b = stream[i];
    if (escaping) {
      escaping = false;
      if (b === SLIP_ESC_END) cur.push(SLIP_END);
      else if (b === SLIP_ESC_ESC) cur.push(SLIP_ESC);
      else {
        bad = { offset: i, message: `SLIP: invalid escape 0xdb 0x${b.toString(16).padStart(2, '0')}` };
        cur.push(b);
      }
      continue;
    }
    if (b === SLIP_END) {
      if (cur && cur.length) frames.push({ offset: start, length: i - start + 1, payload: Uint8Array.from(cur), error: bad?.message });
      cur = null;
      bad = null;
      continue;
    }
    if (!cur) {
      cur = [];
      start = i;
    }
    if (b === SLIP_ESC) escaping = true;
    else cur.push(b);
  }
  if (cur && cur.length) frames.push({ offset: start, length: stream.length - start, payload: Uint8Array.from(cur), error: bad?.message ?? 'SLIP: frame not terminated by END', incomplete: true });
  return frames;
}

// ---------- HDLC-style flag / escape stuffing ----------

export const HDLC_FLAG = 0x7e;
export const HDLC_ESC = 0x7d;

/** Byte-stuff a payload and wrap it in 0x7E flags. */
export function hdlcEncode(data) {
  const out = [HDLC_FLAG];
  for (const b of data) {
    if (b === HDLC_FLAG || b === HDLC_ESC) out.push(HDLC_ESC, b ^ 0x20);
    else out.push(b);
  }
  out.push(HDLC_FLAG);
  return Uint8Array.from(out);
}

/** Split an HDLC-style stream on 0x7E flags and undo the 0x7D escapes. */
export function hdlcSplit(stream) {
  const frames = [];
  let cur = null;
  let start = 0;
  let escaping = false;
  let escAt = 0;
  let bad = null;
  for (let i = 0; i < stream.length; i++) {
    const b = stream[i];
    if (escaping) {
      escaping = false;
      if (b === HDLC_FLAG) {
        bad = { message: 'HDLC: abort sequence 0x7D 0x7E' };
        cur = null;
        continue;
      }
      cur.push(b ^ 0x20);
      continue;
    }
    if (b === HDLC_FLAG) {
      if (cur && cur.length) frames.push({ offset: start, length: i - start + 1, payload: Uint8Array.from(cur), error: bad?.message });
      cur = null;
      bad = null;
      continue;
    }
    if (!cur) {
      cur = [];
      start = i;
    }
    if (b === HDLC_ESC) {
      escaping = true;
      escAt = i;
    } else cur.push(b);
  }
  if (escaping) bad = { message: `HDLC: escape at offset ${escAt} has no following byte` };
  if (cur && cur.length) frames.push({ offset: start, length: stream.length - start, payload: Uint8Array.from(cur), error: bad?.message ?? 'HDLC: frame not terminated by 0x7E', incomplete: true });
  return frames;
}

// ---------- generic helpers ----------

export const FRAMINGS = {
  cobs: { label: 'COBS', encode: cobsEncode, decode: cobsDecode },
  'cobs-r': { label: 'COBS/R', encode: cobsrEncode, decode: cobsrDecode },
  slip: { label: 'SLIP (RFC 1055)', encode: slipEncode, decode: (f) => slipSplit(f)[0]?.payload ?? new Uint8Array(0) },
  hdlc: { label: 'HDLC-style (0x7E/0x7D)', encode: hdlcEncode, decode: (f) => hdlcSplit(f)[0]?.payload ?? new Uint8Array(0) },
};

/**
 * Split a stream into frames for a framing mode. COBS and COBS/R frames are the
 * runs between 0x00 delimiters; each run is decoded to its payload.
 * @returns {{offset:number,length:number,payload?:Uint8Array,error?:string}[]}
 */
export function splitFrames(stream, mode) {
  if (mode === 'slip') return slipSplit(stream);
  if (mode === 'hdlc') return hdlcSplit(stream);
  if (mode === 'cobs' || mode === 'cobs-r') {
    const dec = mode === 'cobs' ? cobsDecode : cobsrDecode;
    const frames = [];
    let start = 0;
    for (let i = 0; i <= stream.length; i++) {
      if (i === stream.length || stream[i] === 0) {
        if (i > start) {
          const chunk = stream.subarray(start, i);
          try {
            frames.push({ offset: start, length: i - start + (i < stream.length ? 1 : 0), payload: dec(chunk) });
          } catch (e) {
            frames.push({ offset: start, length: i - start, payload: new Uint8Array(0), error: e.message });
          }
        }
        start = i + 1;
      }
    }
    return frames;
  }
  throw new Error(`unknown framing "${mode}"`);
}
