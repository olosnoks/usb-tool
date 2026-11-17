/**
 * Meshtastic serial framing.
 *
 * Each protobuf message travels as: 0x94 0xC3, big-endian 16-bit payload length, payload.
 * Any bytes that are not part of a valid frame are debug console text from the firmware
 * and are returned as log text instead.
 */

export const START1 = 0x94;
export const START2 = 0xc3;
export const MAX_FRAME_PAYLOAD = 512;

/** Wrap a protobuf payload in a serial frame. */
export function encodeFrame(payload) {
  if (!(payload instanceof Uint8Array)) throw new TypeError('payload must be a Uint8Array');
  if (payload.length === 0 || payload.length > MAX_FRAME_PAYLOAD) {
    throw new RangeError(`Frame payload must be 1..${MAX_FRAME_PAYLOAD} bytes, got ${payload.length}`);
  }
  const out = new Uint8Array(4 + payload.length);
  out[0] = START1;
  out[1] = START2;
  out[2] = (payload.length >> 8) & 0xff;
  out[3] = payload.length & 0xff;
  out.set(payload, 4);
  return out;
}

/**
 * Incremental parser for the device-to-host byte stream. Feed it whatever chunks the serial
 * port delivers (frames may be split anywhere, and log text may sit between frames).
 *
 *   push(chunk) -> [{ type: 'frame', payload: Uint8Array } | { type: 'log', text: string }]
 *
 * Log text is decoded as UTF-8 across chunk boundaries. A partial frame or a trailing
 * 0x94 is held until the next chunk arrives.
 */
export class FrameParser {
  constructor() {
    this.pending = new Uint8Array(0);
    this.logDecoder = new TextDecoder('utf-8', { fatal: false });
  }

  reset() {
    this.pending = new Uint8Array(0);
    this.logDecoder = new TextDecoder('utf-8', { fatal: false });
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return [];
    const data = concat(this.pending, chunk);
    const events = [];
    let logRun = [];
    const flushLog = () => {
      if (logRun.length === 0) return;
      const text = this.logDecoder.decode(Uint8Array.from(logRun), { stream: true });
      logRun = [];
      if (text) events.push({ type: 'log', text });
    };

    let i = 0;
    let keep = -1; // index from which bytes are held for the next push
    while (i < data.length) {
      if (data[i] !== START1) {
        logRun.push(data[i]);
        i++;
        continue;
      }
      // A 0x94 at the very end could be the start of a frame: hold it.
      if (i + 1 >= data.length) { keep = i; break; }
      if (data[i + 1] !== START2) {
        logRun.push(data[i]);
        i++;
        continue;
      }
      if (i + 3 >= data.length) { keep = i; break; }
      const len = (data[i + 2] << 8) | data[i + 3];
      if (len === 0 || len > MAX_FRAME_PAYLOAD) {
        // Not a plausible header: this 0x94 is console text.
        logRun.push(data[i]);
        i++;
        continue;
      }
      if (i + 4 + len > data.length) { keep = i; break; }
      flushLog();
      events.push({ type: 'frame', payload: data.slice(i + 4, i + 4 + len) });
      i += 4 + len;
    }
    flushLog();
    this.pending = keep >= 0 ? data.slice(keep) : new Uint8Array(0);
    return events;
  }
}

function concat(a, b) {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Split accumulated log text into complete lines. Returns { lines, rest } where rest is the
 * unterminated tail that the caller should keep and prepend to the next chunk.
 */
export function splitLogLines(buffered, text) {
  const joined = buffered + text;
  const parts = joined.split(/\r?\n/);
  const rest = parts.pop();
  return { lines: parts, rest };
}
