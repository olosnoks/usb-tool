// Pure helpers for the MicroPython file manager: safe Python literals and
// byte-exact base64 (no btoa/atob on strings, which corrupt non-Latin1 data).

/** Quote a string as a Python string literal ("..."). Backslashes, quotes,
 *  newlines and other control characters are escaped, so a file name can't
 *  break out of the literal or inject code. */
export function pyStr(value) {
  let out = '"';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c === 0x2028 || c === 0x2029) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** Uint8Array -> base64 (chunked so large files don't overflow the stack). */
export function bytesToBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** base64 -> Uint8Array. */
export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Text (UTF-8) or bytes -> bytes. */
export function toBytes(content) {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

export function buildReadScript(path) {
  return `
import ubinascii
try:
    with open(${pyStr(path)}, 'rb') as f:
        print("__FILE_DATA_START__")
        print(ubinascii.b2a_base64(f.read()).decode().strip())
        print("__FILE_DATA_END__")
except Exception as e:
    print("__FILE_DATA_ERROR__", str(e))
`.trim();
}

export function buildWriteScript(path, content) {
  const b64 = bytesToBase64(toBytes(content));
  return `
import ubinascii
try:
    with open(${pyStr(path)}, 'wb') as f:
        f.write(ubinascii.a2b_base64('${b64}'))
    print("__FILE_WRITE_SUCCESS__")
except Exception as e:
    print("__FILE_WRITE_ERROR__", str(e))
`.trim();
}

export function buildDeleteScript(path) {
  return `
import os
try:
    os.remove(${pyStr(path)})
    print("__FILE_DEL_SUCCESS__")
except Exception as e:
    print("__FILE_DEL_ERROR__", str(e))
`.trim();
}

/** Pull the base64 payload out of REPL output and decode it; null if absent. */
export function parseFileOutput(output) {
  const s = output.indexOf('__FILE_DATA_START__');
  const e = output.indexOf('__FILE_DATA_END__');
  if (s === -1 || e === -1) return null;
  return base64ToBytes(output.substring(s + '__FILE_DATA_START__'.length, e));
}

// ---- Chunked transfer (SER-7 / B11) ---------------------------------------
// Instead of compiling one huge base64 literal on the device, files move in
// small blocks inside a single raw-REPL session.

export const DEFAULT_BLOCK = 768;

/** Simple additive checksum shared by host and device (sum of bytes mod 2^32). */
export function checksum(bytes) {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s = (s + bytes[i]) >>> 0;
  return s;
}

export function buildOpenWriteScript(path) {
  return `import ubinascii, os
_f = open(${pyStr(path)}, 'wb')`;
}
export function buildWriteBlockScript(block) {
  return `_f.write(ubinascii.a2b_base64('${bytesToBase64(block)}'))`;
}
export function buildCloseScript() {
  return `_f.close()
del _f`;
}
export function buildSizeScript(path) {
  return `import os
print("__SIZE__", os.stat(${pyStr(path)})[6])`;
}
export function buildReadBlockScript(path, offset, length) {
  return `import ubinascii
with open(${pyStr(path)}, 'rb') as f:
    f.seek(${offset | 0})
    d = f.read(${length | 0})
print("__BLK__", len(d), sum(d) & 0xFFFFFFFF, ubinascii.b2a_base64(d).decode().strip())`;
}

/** Parse a read-block reply; throws on missing line, length or checksum mismatch. */
export function parseReadBlock(output) {
  const m = /__BLK__ (\d+) (\d+) ([A-Za-z0-9+/=]*)/.exec(output);
  if (!m) throw new Error('no data block in device reply');
  const bytes = base64ToBytes(m[3]);
  if (bytes.length !== Number(m[1])) throw new Error(`block length mismatch (device ${m[1]}, got ${bytes.length})`);
  if (checksum(bytes) !== Number(m[2])) throw new Error('block checksum mismatch');
  return bytes;
}

const isAborted = (signal) => !!(signal && signal.aborted);

/**
 * Write `content` to `path` in blocks over an open RawRepl session.
 * Cancel (AbortSignal) closes the file and rejects with name 'AbortError'.
 */
export async function writeFileChunked(repl, path, content, { blockSize = DEFAULT_BLOCK, onProgress, signal } = {}) {
  const bytes = toBytes(content);
  await repl.execChecked(buildOpenWriteScript(path));
  try {
    let done = 0;
    for (let i = 0; i < bytes.length; i += blockSize) {
      if (isAborted(signal)) { const e = new Error('transfer cancelled'); e.name = 'AbortError'; throw e; }
      await repl.execChecked(buildWriteBlockScript(bytes.subarray(i, i + blockSize)));
      done = Math.min(bytes.length, i + blockSize);
      onProgress?.(done, bytes.length);
    }
    onProgress?.(bytes.length, bytes.length);
  } finally {
    await repl.execChecked(buildCloseScript()).catch(() => {});
  }
  return bytes.length;
}

/** Read `path` in blocks with per-block length + checksum verification. */
export async function readFileChunked(repl, path, { blockSize = DEFAULT_BLOCK, onProgress, signal } = {}) {
  const sizeOut = await repl.execChecked(buildSizeScript(path));
  const m = /__SIZE__ (\d+)/.exec(sizeOut);
  if (!m) throw new Error('could not determine file size');
  const total = Number(m[1]);
  const out = new Uint8Array(total);
  let off = 0;
  while (off < total) {
    if (isAborted(signal)) { const e = new Error('transfer cancelled'); e.name = 'AbortError'; throw e; }
    const want = Math.min(blockSize, total - off);
    const block = parseReadBlock(await repl.execChecked(buildReadBlockScript(path, off, want)));
    if (block.length !== want) throw new Error(`short read at offset ${off}`);
    out.set(block, off);
    off += block.length;
    onProgress?.(off, total);
  }
  onProgress?.(total, total);
  return out;
}
