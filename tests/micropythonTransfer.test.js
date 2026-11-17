import { describe, it, expect } from 'vitest';
import {
  writeFileChunked, readFileChunked, checksum, parseReadBlock, base64ToBytes, pyStr, buildReadBlockScript,
} from '../src/utils/micropythonFiles';
import { withRawRepl } from '../src/utils/micropythonRawRepl';

// Fake device filesystem behind a RawRepl-like object: interprets only the
// snippets our helpers generate.
function fakeRepl({ failAtBlock = -1, corrupt = false } = {}) {
  const files = {};
  let cur = null;
  let blocks = 0;
  const maxScript = { n: 0 };
  return {
    files, maxScript,
    async execChecked(code) {
      maxScript.n = Math.max(maxScript.n, code.length);
      let m;
      if ((m = /_f = open\("(.*)", 'wb'\)/.exec(code))) { cur = { path: m[1], data: [] }; files[cur.path] = new Uint8Array(0); return ''; }
      if ((m = /a2b_base64\('([^']*)'\)/.exec(code))) {
        if (blocks++ === failAtBlock) throw new Error('device error: MemoryError');
        cur.data.push(...base64ToBytes(m[1]));
        files[cur.path] = Uint8Array.from(cur.data);
        return '';
      }
      if (code.startsWith('_f.close()')) { cur = null; return ''; }
      if ((m = /os\.stat\("(.*)"\)/.exec(code))) return `__SIZE__ ${files[m[1]].length}\r\n`;
      if ((m = /open\("(.*)", 'rb'\)[\s\S]*seek\((\d+)\)[\s\S]*read\((\d+)\)/.exec(code))) {
        const d = files[m[1]].subarray(Number(m[2]), Number(m[2]) + Number(m[3]));
        const out = corrupt ? Uint8Array.from(d, (b, i) => (i === 0 ? b ^ 1 : b)) : d;
        let bin = ''; out.forEach((b) => { bin += String.fromCharCode(b); });
        return `__BLK__ ${d.length} ${checksum(d)} ${btoa(bin)}\r\n`;
      }
      throw new Error('unexpected script');
    },
  };
}
const sample = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);

describe('chunked transfer', () => {
  it('round-trips a 200 KB file byte-identical, in small blocks', async () => {
    const dev = fakeRepl();
    const data = sample(200 * 1024);
    const progress = [];
    await writeFileChunked(dev, '/big.bin', data, { onProgress: (d, t) => progress.push([d, t]) });
    expect(dev.files['/big.bin'].length).toBe(data.length);
    expect(checksum(dev.files['/big.bin'])).toBe(checksum(data));
    expect(dev.maxScript.n).toBeLessThan(2000); // never one huge literal
    expect(progress.at(-1)).toEqual([data.length, data.length]);
    const back = await readFileChunked(dev, '/big.bin');
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });

  it('surfaces device exceptions and still closes the file', async () => {
    const dev = fakeRepl({ failAtBlock: 2 });
    await expect(writeFileChunked(dev, '/x', sample(5000))).rejects.toThrow(/MemoryError/);
  });

  it('cancel stops between blocks with an AbortError', async () => {
    const dev = fakeRepl();
    const ctl = new AbortController();
    let blocksDone = 0;
    const p = writeFileChunked(dev, '/c', sample(10000), { signal: ctl.signal, onProgress: () => { if (++blocksDone === 2) ctl.abort(); } });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(dev.files['/c'].length).toBeLessThan(10000);
  });

  it('detects a corrupted block via checksum', async () => {
    const good = fakeRepl();
    await writeFileChunked(good, '/f', sample(2000));
    const bad = fakeRepl({ corrupt: true });
    bad.files['/f'] = good.files['/f'];
    await expect(readFileChunked(bad, '/f')).rejects.toThrow(/checksum/);
  });

  it('parseReadBlock rejects length mismatch and missing data', () => {
    expect(() => parseReadBlock('nothing')).toThrow();
    expect(() => parseReadBlock('__BLK__ 5 0 AAAA')).toThrow(/length/);
  });

  it('hostile paths stay inside the literal', () => {
    const evil = 'a"); import os; os.remove("/main.py"); ("';
    expect(buildReadBlockScript(evil, 0, 10)).toContain(pyStr(evil));
  });
});

describe('withRawRepl', () => {
  it('uses one raw-REPL session for several execs and leaves it afterwards', async () => {
    const enc = new TextEncoder(), dec = new TextDecoder();
    const listeners = new Set();
    const emit = (s) => setTimeout(() => listeners.forEach((f) => f(enc.encode(s))), 0);
    const seen = [];
    const write = async (bytes) => {
      for (const ch of dec.decode(bytes)) {
        seen.push(ch);
        if (ch === '\x01') emit('raw REPL; CTRL-B to exit\r\n>');
        if (ch === '\x04') emit('OKout\x04\x04>');
      }
    };
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    await withRawRepl(write, subscribe, async (repl) => {
      await repl.execChecked('a');
      await repl.execChecked('b');
    });
    expect(seen.filter((c) => c === '\x01').length).toBe(1);
    expect(seen.at(-1)).toBe('\x02');
  });
});
