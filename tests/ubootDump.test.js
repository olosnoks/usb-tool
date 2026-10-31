import { describe, it, expect } from 'vitest';
import { dumpUbootMemory, parseMdLine } from '../src/utils/ubootDump';

const enc = new TextEncoder(), dec = new TextDecoder();

// Fake U-Boot console: echoes, answers md.b like U-Boot, repeats the last
// command on an empty line (like the real thing), prompts with "=> ".
function makeFakeUboot(mem, base, { silentAfter = Infinity } = {}) {
  let controller, pending = '', last = '', count = 0;
  const sent = [];
  const emit = (s) => { const b = enc.encode(s); for (let i = 0; i < b.length; i += 23) controller.enqueue(b.slice(i, i + 23)); };
  function run(line) {
    sent.push(line);
    const cmd = line.trim() === '' ? last : line.trim();
    last = cmd;
    let out = line + '\r\n';
    const m = cmd.match(/^md\.b 0x([0-9a-f]+) 0x([0-9a-f]+)$/);
    if (m && ++count <= silentAfter) {
      const a = parseInt(m[1], 16), n = parseInt(m[2], 16);
      for (let off = 0; off < n; off += 16) {
        const row = Array.from(mem.subarray(a - base + off, a - base + Math.min(off + 16, n)));
        const ascii = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
        out += `${(a + off).toString(16).padStart(8, '0')}: ${row.map((b) => b.toString(16).padStart(2, '0')).join(' ')}    ${ascii}\r\n`;
      }
    }
    emit(out + '=> ');
  }
  const port = {
    readable: null, writable: null,
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({ write(ch) {
        pending += dec.decode(ch);
        let i;
        while ((i = pending.search(/[\r\n]/)) >= 0) { const l = pending.slice(0, i); pending = pending.slice(i + 1); setTimeout(() => run(l), 2); }
      } });
    }
  };
  return { port, sent };
}

describe('U-Boot md.b dump', () => {
  it('parses md.b lines and ignores everything else', () => {
    expect(parseMdLine("80000000: 27 05 19 56 a1 b2    '..V..'")).toEqual({ address: 0x80000000, bytes: [0x27, 0x05, 0x19, 0x56, 0xa1, 0xb2] });
    expect(parseMdLine('md.b 0x80000000 0x100')).toBe(null);
    expect(parseMdLine('=> ')).toBe(null);
  });

  it('dumps real memory contents across several md.b commands', async () => {
    const base = 0x80000000;
    const mem = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13 + 5) & 0xff);
    const { port, sent } = makeFakeUboot(mem, base);
    await port.open();
    const progress = [];
    const data = await dumpUbootMemory(port, base, 1000, { onProgress: (r, t) => progress.push([r, t]) });
    expect(Array.from(data)).toEqual(Array.from(mem));
    expect(sent.filter((s) => s.startsWith('md.b')).length).toBe(4);
    expect(sent.every((s) => s !== '')).toBe(true);           // never an empty line (U-Boot would repeat md)
    expect(progress[progress.length - 1]).toEqual([1000, 1000]);
    expect(port.readable.locked).toBe(false);                 // hands the port back
  });

  it('fails with the missing address when the console stops answering', async () => {
    const base = 0x1000;
    const { port } = makeFakeUboot(new Uint8Array(1024), base, { silentAfter: 2 });
    await port.open();
    await expect(dumpUbootMemory(port, base, 1024, { timeoutMs: 300 })).rejects.toThrow(/no md.b data for 0x1200/);
    expect(port.readable.locked).toBe(false);
  });
});
