import { describe, it, expect } from 'vitest';
import {
  AdbConnection, AdbUsbTransport, explainUsbError, parseBannerFeatures, hostBanner, HOST_FEATURES,
  packShellPacket, ShellPacketDecoder, SHELL, blobChunks, defaultKeyStore
} from '../src/utils/adbDriver';
import { generateAdbKey } from '../src/utils/adbCrypto';
import { createSimulatedAdb } from './helpers/sim/adb';

const key = await generateAdbKey();
const keyStore = { async get() { return key; } };
const te = new TextEncoder();

async function conn(opts) {
  const transport = createSimulatedAdb(opts);
  const c = new AdbConnection(transport, { keyStore });
  await c.connect();
  return { c, state: transport.state };
}

const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
const waitFor = async (cond, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); }
};

describe('feature advertising', () => {
  it('only advertises features that are implemented', async () => {
    expect(HOST_FEATURES).toEqual(['shell_v2', 'stat_v2']);
    expect(hostBanner()).toBe('host::features=shell_v2,stat_v2');
    const { state } = await conn();
    expect(state.hostBanner).toBe('host::features=shell_v2,stat_v2');
    expect(state.hostBanner).not.toMatch(/\bcmd\b/);
  });

  it('parses the device feature list', async () => {
    expect([...parseBannerFeatures('device::ro.product.name=x;features=shell_v2,cmd,stat_v2')]).toEqual(['shell_v2', 'cmd', 'stat_v2']);
    expect(parseBannerFeatures('device::').size).toBe(0);
    const { c } = await conn();
    expect(c.hasFeature('stat_v2')).toBe(true);
  });
});

describe('shell_v2 framing', () => {
  it('reassembles packets split across chunks', () => {
    const all = new Uint8Array([...packShellPacket(SHELL.STDOUT, 'hello'), ...packShellPacket(SHELL.EXIT, new Uint8Array([7]))]);
    const dec = new ShellPacketDecoder();
    const got = [];
    for (let i = 0; i < all.length; i += 3) got.push(...dec.push(all.subarray(i, i + 3)));
    expect(got.map((p) => p.id)).toEqual([SHELL.STDOUT, SHELL.EXIT]);
    expect(new TextDecoder().decode(got[0].data)).toBe('hello');
    expect(got[1].data[0]).toBe(7);
  });

  it('runs one command with separate stdout, stderr and exit status', async () => {
    const { c } = await conn();
    expect(await c.shellV2('echo hi')).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    expect(await c.shellV2('echo err >&2')).toEqual({ stdout: '', stderr: 'err\n', exitCode: 0 });
    expect((await c.shellV2('false')).exitCode).toBe(1);
  });

  it('refuses shell_v2 on a device that does not advertise it', async () => {
    const { c } = await conn({ features: 'cmd' });
    await expect(c.openShell()).rejects.toThrow(/shell_v2/);
    await expect(c.shellV2('id')).rejects.toThrow(/shell_v2/);
  });
});

describe('interactive shell', () => {
  it('streams a prompt, echoes typed input, runs commands and exits', async () => {
    const { c, state } = await conn();
    let out = '';
    const sh = await c.openShell({ rows: 30, cols: 100, onData: (t) => { out += t; } });
    await waitFor(() => out.includes('sim:/ $ '));
    expect(state.winsize).toBe('30x100,0x0');
    await sh.write('echo hi\r');
    await waitFor(() => out.includes('hi\r\n'));
    expect(out).toContain('echo hi'); // the pty echo of what was typed
    await sh.write('exit\r');
    const res = await sh.done;
    expect(res.exitCode).toBe(0);
    expect(sh.closed).toBe(true);
  });

  it('sends Ctrl-C as the interrupt byte and Ctrl-D as end-of-input', async () => {
    const { c, state } = await conn();
    let out = '';
    const sh = await c.openShell({ onData: (t) => { out += t; } });
    await waitFor(() => out.includes('$ '));
    await sh.write('sleep 99');
    await sh.interrupt();
    await waitFor(() => out.includes('^C'));
    expect(state.interrupts).toBe(1);
    expect(state.shellStdin.some((d) => d.includes(0x03))).toBe(true);
    await sh.sendEof();
    expect((await sh.done).exitCode).toBe(0);
  });

  it('keeps working while another command runs on the same connection', async () => {
    const { c } = await conn();
    let out = '';
    const sh = await c.openShell({ onData: (t) => { out += t; } });
    await waitFor(() => out.includes('$ '));
    expect(await c.shell('echo hi')).toBe('hi\n');
    expect((await c.stat('/sdcard/Download')).isDir).toBe(true);
    await sh.write('echo still\r');
    await waitFor(() => out.includes('still'));
    await sh.close();
  });
});

describe('streaming pull', () => {
  it('writes chunks as they arrive and reports real progress', async () => {
    const { c, state } = await conn();
    const data = bytes(300000);
    state.files['/sdcard/a.bin'] = data;
    const chunks = [];
    const marks = [];
    const n = await c.pullTo('/sdcard/a.bin', { write: (ch) => { chunks.push(ch.slice()); } }, { onProgress: (f, b, t) => marks.push([f, b, t]) });
    expect(n).toBe(300000);
    expect(chunks.length).toBeGreaterThan(3); // not one big buffer
    const joined = new Uint8Array(300000); let o = 0; chunks.forEach((ch) => { joined.set(ch, o); o += ch.length; });
    expect(joined).toEqual(data);
    expect(marks.at(-1)).toEqual([1, 300000, 300000]);
    expect(marks[0][2]).toBe(300000);
  });

  it('can be cancelled mid-transfer', async () => {
    const { c, state } = await conn();
    state.files['/sdcard/a.bin'] = bytes(300000);
    const ctl = new AbortController();
    let got = 0;
    await expect(c.pullTo('/sdcard/a.bin', { write: (ch) => { got += ch.length; ctl.abort(); } }, { signal: ctl.signal })).rejects.toThrow(/Cancelled/);
    expect(got).toBeLessThan(300000);
  });

  it('reports a missing file', async () => {
    const { c } = await conn();
    await expect(c.pullTo('/nope', { write() {} })).rejects.toThrow(/No such file/);
  });
});

describe('streaming push', () => {
  it('pushes a Blob in chunks without needing the whole file', async () => {
    const { c, state } = await conn();
    const data = bytes(300000);
    const marks = [];
    await c.pushFrom(new Blob([data]), '/sdcard/b.bin', { onProgress: (f) => marks.push(f) });
    expect(state.files['/sdcard/b.bin']).toEqual(data);
    expect(marks.at(-1)).toBe(1);
    expect(marks.length).toBeGreaterThan(1);
  });

  it('falls back to slice() when the file has no stream()', async () => {
    const { c, state } = await conn();
    const data = bytes(150000);
    const blob = new Blob([data]);
    const noStream = { size: blob.size, slice: (a, b) => blob.slice(a, b) };
    await c.pushFrom(noStream, '/sdcard/c.bin');
    expect(state.files['/sdcard/c.bin']).toEqual(data);
  });

  it('blobChunks never yields more than the chunk size', async () => {
    const sizes = [];
    for await (const ch of blobChunks(new Blob([bytes(200000)]), 65536)) sizes.push(ch.length);
    expect(Math.max(...sizes)).toBe(65536);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(200000);
  });

  it('pushes an empty file and can be cancelled', async () => {
    const { c, state } = await conn();
    await c.pushFrom(new Blob([]), '/sdcard/empty.bin');
    expect(state.files['/sdcard/empty.bin']).toEqual(new Uint8Array());
    const ctl = new AbortController();
    ctl.abort();
    await expect(c.pushFrom(new Blob([bytes(1000)]), '/sdcard/x.bin', { signal: ctl.signal })).rejects.toThrow(/Cancelled/);
  });
});

describe('stat_v2', () => {
  const FIVE_GIB = 5 * 2 ** 30;

  it('reports sizes above 4 GiB exactly when the device has stat_v2', async () => {
    const { c, state } = await conn();
    state.fakeSizes['/sdcard/big.iso'] = FIVE_GIB;
    expect((await c.stat('/sdcard/big.iso')).size).toBe(FIVE_GIB);
    const entry = (await c.list('/sdcard/')).find((e) => e.name === 'big.iso');
    expect(entry.size).toBe(FIVE_GIB);
    expect(entry.isDir).toBe(false);
  });

  it('wraps at 4 GiB on a device without stat_v2 (the legacy protocol limit)', async () => {
    const { c, state } = await conn({ features: 'shell_v2' });
    state.fakeSizes['/sdcard/big.iso'] = FIVE_GIB;
    expect((await c.stat('/sdcard/big.iso')).size).toBe(FIVE_GIB % 2 ** 32);
  });

  it('stat says whether a path exists and what it is', async () => {
    const { c, state } = await conn();
    state.files['/sdcard/Download/n.txt'] = bytes(10);
    expect(await c.stat('/sdcard/Download/n.txt')).toMatchObject({ exists: true, size: 10, isDir: false });
    expect(await c.stat('/sdcard/Download')).toMatchObject({ exists: true, isDir: true });
    expect((await c.stat('/sdcard/missing')).exists).toBe(false);
  });
});

describe('connect hints and key storage', () => {
  it('explains a claimInterface failure', () => {
    const msg = explainUsbError(new Error('Unable to claim interface.'), 'claim');
    expect(msg).toMatch(/adb kill-server/);
    expect(msg).toMatch(/WinUSB/);
  });

  it('the transport turns a claim failure into that hint and closes the device', async () => {
    let closed = false;
    const device = {
      opened: true,
      configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: 1, endpoints: [{ type: 'bulk', direction: 'out', endpointNumber: 1 }, { type: 'bulk', direction: 'in', endpointNumber: 1 }] }] }] },
      claimInterface: async () => { throw new Error('Access denied.'); },
      close: async () => { closed = true; }
    };
    await expect(new AdbUsbTransport(device).open()).rejects.toThrow(/adb kill-server/);
    expect(closed).toBe(true);
  });

  it('the default key store can forget the key', async () => {
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    try {
      const ks = defaultKeyStore('test.adb.key');
      const a = await ks.get();
      expect(store.has('test.adb.key')).toBe(true);
      expect(await ks.get()).toEqual(a);
      ks.clear();
      expect(store.has('test.adb.key')).toBe(false);
    } finally { delete globalThis.localStorage; }
  });

  it('closing the connection stops pending work', async () => {
    const { c } = await conn();
    await c.close();
    await expect(c.shell('echo hi')).rejects.toThrow();
  });
});

describe('shell_v2 helpers', () => {
  it('encodes stdin packets with a little-endian length', () => {
    const p = packShellPacket(SHELL.STDIN, te.encode('ab'));
    expect([...p]).toEqual([0, 2, 0, 0, 0, 97, 98]);
  });
});
