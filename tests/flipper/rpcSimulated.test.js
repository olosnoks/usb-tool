import { describe, it, expect } from 'vitest';
import { FlipperZeroDriver, readVarint, encodeVarint } from '../../src/utils/flipperDriver';
import { _resetPortManager } from '../../src/utils/portManager';

// ---------------------------------------------------------------------------
//  Minimal protobuf helpers for the fake device
// ---------------------------------------------------------------------------
const enc = new TextEncoder(), dec = new TextDecoder();

function parse(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const tag = readVarint(bytes, i); i += tag.bytesRead;
    const field = Number(tag.value >> 3n), wire = Number(tag.value & 7n);
    if (wire === 0) { const v = readVarint(bytes, i); i += v.bytesRead; out.push({ field, value: Number(v.value) }); }
    else if (wire === 2) { const l = readVarint(bytes, i); i += l.bytesRead; const n = Number(l.value); out.push({ field, data: bytes.subarray(i, i + n) }); i += n; }
    else throw new Error('wire type ' + wire);
  }
  return out;
}
const key = (f, w) => Array.from(encodeVarint((f << 3) | w));
const vint = (f, v) => [...key(f, 0), ...Array.from(encodeVarint(v))];
const blob = (f, b) => [...key(f, 2), ...Array.from(encodeVarint(b.length)), ...b];
const str = (f, s) => blob(f, Array.from(enc.encode(s)));
function frame({ id = 0, status = 0, hasNext = false, field, body = [] }) {
  const main = [...(id ? vint(1, id) : []), ...(status ? vint(2, status) : []), ...(hasNext ? vint(3, 1) : []), ...(field ? blob(field, body) : [])];
  return Uint8Array.from([...Array.from(encodeVarint(main.length)), ...main]);
}

// ---------------------------------------------------------------------------
//  Fake Flipper Zero: CLI until start_rpc_session, then storage RPC with the
//  firmware's rules (rpc_storage.c): list/read answer in parts with has_next;
//  a write is one command_id over several has_next chunks and is answered
//  once, after the last chunk; a new command_id mid-write restarts the file.
// ---------------------------------------------------------------------------
function makeFakeFlipper(files = {}) {
  const fs = new Map(Object.entries(files).map(([p, v]) => [p, typeof v === 'string' ? enc.encode(v) : v]));
  const dirs = new Set(['/ext', '/ext/subghz']);
  let controller, rpc = false, cli = '', buf = new Uint8Array(0);
  let write = null;           // { id, path, parts[] }
  const log = { writeReplies: 0, requests: [] };
  const emit = (b) => controller.enqueue(b);

  function handleMain(m) {
    const f = parse(m);
    const id = (f.find((x) => x.field === 1) || {}).value || 0;
    const hasNext = !!(f.find((x) => x.field === 3) || {}).value;
    const req = f.find((x) => x.field > 3);
    log.requests.push({ id, field: req && req.field, hasNext });
    const inner = req && req.data ? parse(req.data) : [];
    const path = inner.find((x) => x.field === 1);
    const p = path ? dec.decode(path.data) : '';
    switch (req && req.field) {
      case 7: { // list
        const kids = [];
        for (const d of dirs) if (d !== p && d.startsWith(p + '/') && !d.slice(p.length + 1).includes('/')) kids.push({ type: 1, name: d.slice(p.length + 1), size: 0 });
        for (const [fp, b] of fs) if (fp.startsWith(p + '/') && !fp.slice(p.length + 1).includes('/')) kids.push({ type: 0, name: fp.slice(p.length + 1), size: b.length });
        if (!dirs.has(p)) { emit(frame({ id, status: 6 })); return; }
        for (let i = 0; i < kids.length || i === 0; i += 2) {   // 2 entries per part
          const part = kids.slice(i, i + 2);
          const body = part.flatMap((k) => blob(1, [...vint(1, k.type), ...str(2, k.name), ...vint(3, k.size)]));
          emit(frame({ id, hasNext: i + 2 < kids.length, field: 8, body }));
          if (!kids.length) break;
        }
        return;
      }
      case 9: { // read
        const b = fs.get(p);
        if (!b) { emit(frame({ id, status: 6 })); return; }
        for (let i = 0; i < b.length || i === 0; i += 512) {
          const chunk = Array.from(b.subarray(i, i + 512));
          emit(frame({ id, hasNext: i + 512 < b.length, field: 10, body: blob(1, blob(4, chunk)) }));
          if (!b.length) break;
        }
        return;
      }
      case 11: { // write
        const fileMsg = inner.find((x) => x.field === 2);
        const data = fileMsg ? (parse(fileMsg.data).find((x) => x.field === 4) || { data: new Uint8Array(0) }).data : new Uint8Array(0);
        if (!write || write.id !== id) write = { id, path: p, parts: [] };   // new command_id: file reopened (truncated)
        write.parts.push(Array.from(data));
        fs.set(write.path, Uint8Array.from(write.parts.flat()));
        if (!hasNext) { emit(frame({ id })); log.writeReplies++; write = null; }
        return;
      }
      case 12: fs.delete(p); [...dirs].filter((d) => d === p || d.startsWith(p + '/')).forEach((d) => dirs.delete(d)); emit(frame({ id })); return;
      case 13: dirs.add(p); emit(frame({ id })); return;
      default: emit(frame({ id })); return;   // device info, power info, ... : empty OK
    }
  }

  const port = {
    readable: null, writable: null,
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({
        write(chunk) {
          if (!rpc) {
            cli += dec.decode(chunk);
            if (cli.includes('start_rpc_session\r')) { emit(enc.encode('start_rpc_session\r\n')); rpc = true; cli = ''; }
            return;
          }
          const c = new Uint8Array(buf.length + chunk.length); c.set(buf); c.set(chunk, buf.length); buf = c;
          while (buf.length) {
            const l = readVarint(buf, 0); if (!l) break;
            const n = Number(l.value); if (buf.length < l.bytesRead + n) break;
            const m = buf.slice(l.bytesRead, l.bytesRead + n); buf = buf.slice(l.bytesRead + n);
            handleMain(m);
          }
        }
      });
    },
    async close() { this.readable = null; this.writable = null; }
  };
  return { port, fs, log };
}

async function connected(files) {
  _resetPortManager();
  const dev = makeFakeFlipper(files);
  const d = new FlipperZeroDriver();
  d.log = () => {};
  await d.connectPort(dev.port);
  return { d, dev };
}

describe('Flipper Zero RPC against a simulated Flipper', () => {
  it('lists a directory delivered in several has_next parts', async () => {
    const { d } = await connected({ '/ext/a.txt': 'aa', '/ext/b.txt': 'bbbb', '/ext/c.sub': 'x' });
    const items = await d.listRealDirectory('/ext');
    expect(items.map((i) => i.name)).toEqual(['subghz', 'a.txt', 'b.txt', 'c.sub']);
    expect(items[0].isDir).toBe(true);
    expect(items.find((i) => i.name === 'b.txt').sizeBytes).toBe(4);
    await d.disconnect();
  });

  it('reads a file delivered in several has_next parts', async () => {
    const text = 'Filetype: Flipper SubGhz RAW File\n' + 'RAW_Data: 1 -2 3\n'.repeat(80);
    const { d } = await connected({ '/ext/subghz/x.sub': text });
    expect(await d.readRealFile('/ext/subghz/x.sub')).toBe(text);
    await d.disconnect();
  });

  it('writes a small file', async () => {
    const { d, dev } = await connected();
    await d.writeRealFile('/ext/small.txt', 'hello');
    expect(dec.decode(dev.fs.get('/ext/small.txt'))).toBe('hello');
    await d.disconnect();
  });

  it('writes a file larger than one 512-byte chunk as one multi-part request', async () => {
    const { d, dev } = await connected();
    const big = 'line of text for a bigger payload\n'.repeat(60);   // ~2 KB, 4 chunks
    await d.writeRealFile('/ext/big.txt', big);
    expect(dec.decode(dev.fs.get('/ext/big.txt'))).toBe(big);
    expect(dev.log.writeReplies).toBe(1);
    const writes = dev.log.requests.filter((r) => r.field === 11);
    expect(new Set(writes.map((w) => w.id)).size).toBe(1);   // one command_id for every chunk
    expect(writes.map((w) => w.hasNext)).toEqual([true, true, true, false]);
    await d.disconnect();
  }, 15000);

  it('creates and deletes directories', async () => {
    const { d } = await connected();
    await d.createRealDirectory('/ext/new');
    expect((await d.listRealDirectory('/ext')).some((i) => i.name === 'new' && i.isDir)).toBe(true);
    await d.removeRealFile('/ext/new');
    expect((await d.listRealDirectory('/ext')).some((i) => i.name === 'new')).toBe(false);
    await d.disconnect();
  });

  it('reports a missing file as an error instead of empty content', async () => {
    const { d } = await connected();
    expect(await d.readRealFile('/ext/nope.txt')).toMatch(/Error reading file/);
    await d.disconnect();
  });
});
