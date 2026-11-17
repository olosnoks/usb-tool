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
