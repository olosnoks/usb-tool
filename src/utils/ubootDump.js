// Memory dump over a U-Boot console with `md.b`.
//
// Reads the replies straight from the port (borrow it from SerialContext),
// because a React text prop only carries the latest chunk and loses data.
// Each command ends with a bare "\n": U-Boot repeats the previous command on
// an empty line, so "\r\n" would re-run `md` and shift the dump.
//
// md.b output: "80000000: 27 05 19 56 a1 b2 ...    '..V..'" (up to 16 bytes/line).

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bytes from one md.b line, or null if it isn't one. */
export function parseMdLine(line) {
  const m = line.match(/^\s*([0-9a-fA-F]{4,16}):\s+(.*)$/);
  if (!m) return null;
  const hexPart = m[2].split(/\s{2,}/)[0].trim();
  const toks = hexPart.split(/\s+/);
  if (!toks.length || !toks.every((t) => /^[0-9a-fA-F]{2}$/.test(t))) return null;
  return { address: parseInt(m[1], 16), bytes: toks.map((t) => parseInt(t, 16)) };
}

/**
 * @param {object} port        open SerialPort (not locked by anyone else)
 * @param {number} start
 * @param {number} length
 * @param {object} [opts]
 * @param {number} [opts.chunk=256]           bytes per md.b command
 * @param {number} [opts.timeoutMs=4000]      per command
 * @param {(read:number,total:number)=>void} [opts.onProgress]
 * @param {() => boolean} [opts.isCancelled]
 * @returns {Promise<Uint8Array>}
 */
export async function dumpUbootMemory(port, start, length, opts = {}) {
  const { chunk = 256, timeoutMs = 4000, onProgress, isCancelled } = opts;
  const out = new Uint8Array(length);
  const have = new Uint8Array(length);   // 1 where a byte was received
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  let text = '';
  let readErr = null;
  let wake = null;
  const loop = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (wake) { const w = wake; wake = null; w(); }
      }
    } catch (e) { readErr = e; }
  })();

  const take = (lo, hi) => {
    let nl;
    while ((nl = text.indexOf('\n')) >= 0) {
      const line = text.slice(0, nl).replace(/\r$/, '');
      text = text.slice(nl + 1);
      const p = parseMdLine(line);
      if (!p) continue;
      p.bytes.forEach((b, i) => {
        const at = p.address + i - start;
        if (p.address + i >= lo && p.address + i < hi && at >= 0 && at < length) { out[at] = b; have[at] = 1; }
      });
    }
  };

  try {
    for (let addr = start; addr < start + length; addr += chunk) {
      if (isCancelled && isCancelled()) throw new Error('dump cancelled');
      const n = Math.min(chunk, start + length - addr);
      text = '';
      await writer.write(enc.encode(`md.b 0x${addr.toString(16)} 0x${n.toString(16)}\n`));
      const deadline = Date.now() + timeoutMs;
      const done = () => { for (let i = addr - start; i < addr - start + n; i++) if (!have[i]) return false; return true; };
      while (!done()) {
        take(addr, addr + n);
        if (done()) break;
        if (readErr) throw readErr;
        const left = deadline - Date.now();
        if (left <= 0) {
          let firstMissing = addr - start;
          while (have[firstMissing]) firstMissing++;
          throw new Error(`no md.b data for 0x${(start + firstMissing).toString(16)} (is the console at the U-Boot prompt?)`);
        }
        await Promise.race([new Promise((r) => { wake = r; }), sleep(Math.min(left, 100))]);
      }
      if (onProgress) onProgress(addr + n - start, length);
    }
    return out;
  } finally {
    try { await reader.cancel(); } catch (e) { /* ignore */ }
    try { await loop; } catch (e) { /* ignore */ }
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
    try { writer.releaseLock(); } catch (e) { /* ignore */ }
  }
}
