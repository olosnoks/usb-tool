/**
 * iq.js — RTL-SDR sample helpers: unsigned 8-bit IQ conversion and the .cu8 recorder.
 *
 * RTL-SDR streams interleaved UNSIGNED 8-bit I,Q with the zero level at 127.5
 * (librtlsdr's native format, also the .cu8 file format). The shared DSP
 * (hackrfDsp.js / hackrfDemod.js) expects SIGNED int8 with zero at 0, so
 * u8ToInt8() re-centres the bytes; u8ToFloat() gives -1..+1 floats.
 */

/** Unsigned IQ bytes -> signed Int8Array (x - 128). Input is not modified. */
export function u8ToInt8(u8) {
  const out = new Int8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = u8[i] - 128;
  return out;
}

/** Unsigned IQ bytes -> Float32Array of interleaved I,Q in [-1, +1) ((x - 127.5) / 127.5). */
export function u8ToFloat(u8) {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = (u8[i] - 127.5) / 127.5;
  return out;
}

/** Default recording cap: 1 GiB of cu8 (about 4.4 minutes at 2.048 MS/s, which is 4.1 MB/s). */
export const DEFAULT_RECORD_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Accumulates raw cu8 chunks for a download. Chunks are copied, because the
 * USB buffers passed in may be reused by the caller.
 */
export class IqRecorder {
  constructor({ maxBytes = DEFAULT_RECORD_MAX_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.bytes = 0;
    this.truncated = false;
  }

  /** Append a chunk; returns false once the cap is reached (the rest is dropped). */
  push(u8) {
    if (this.truncated) return false;
    const room = this.maxBytes - this.bytes;
    if (u8.length > room) {
      if (room > 0) { this.chunks.push(new Uint8Array(u8.subarray(0, room))); this.bytes += room; }
      this.truncated = true;
      return false;
    }
    this.chunks.push(new Uint8Array(u8));
    this.bytes += u8.length;
    return true;
  }

  /** A Blob of the recorded cu8 bytes (application/octet-stream). */
  toBlob() {
    return new Blob(this.chunks, { type: 'application/octet-stream' });
  }

  clear() {
    this.chunks = [];
    this.bytes = 0;
    this.truncated = false;
  }
}

/** File name for a recording, e.g. rtlsdr_100000000Hz_2048000sps.cu8. */
export function cu8FileName(centerHz, sampleRate) {
  return `rtlsdr_${Math.round(centerHz)}Hz_${Math.round(sampleRate)}sps.cu8`;
}
