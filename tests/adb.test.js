import { describe, it, expect } from 'vitest';
import {
  AdbConnection, packMessage, parseHeader, checksum, syncPacket, findAdbInterface, ADB_COMMANDS
} from '../src/utils/adbDriver';
import { generateAdbKey } from '../src/utils/adbCrypto';

const { A_CNXN, A_AUTH, A_OPEN, A_OKAY, A_CLSE, A_WRTE } = ADB_COMMANDS;
const te = new TextEncoder();
const td = new TextDecoder();

// A fake adbd that speaks the transport protocol over an injected pipe.
function fakeAdbd({ requireAuth = false, files = {}, shellOutputs = {} } = {}) {
  let inBuf = new Uint8Array(0);
  const outQueue = []; // framed device->host messages
  const state = { connected: false, files: { ...files }, streams: {}, remoteCounter: 100, rebooted: null, authToken: null, gotPublicKey: false, tcpipPort: null };
  const send = (cmd, a0, a1, payload) => outQueue.push(packMessage(cmd, a0, a1, payload));

  const sendCnxn = () => send(A_CNXN, 0x01000001, 256 * 1024, te.encode('device::ro.product.name=sim;features=shell_v2\u0000'));

  const handleSyncWrite = (st, data) => {
    const merged = new Uint8Array(st.buf.length + data.length);
    merged.set(st.buf); merged.set(data, st.buf.length); st.buf = merged;
    for (;;) {
      if (st.buf.length < 8) break;
      const dv = new DataView(st.buf.buffer, st.buf.byteOffset, 8);
      const id = String.fromCharCode(st.buf[0], st.buf[1], st.buf[2], st.buf[3]);
      // DONE carries an mtime in the length slot and has no body.
      if (id === 'DONE') {
        st.buf = st.buf.slice(8);
        let total = 0; st.fileBuf.forEach((c) => (total += c.length));
        const all = new Uint8Array(total); let o = 0; st.fileBuf.forEach((c) => { all.set(c, o); o += c.length; });
        state.files[st.sendPath] = all;
        send(A_WRTE, st.remoteId, st.localId, syncPacket('OKAY'));
        continue;
      }
      const len = dv.getUint32(4, true);
      if (st.buf.length < 8 + len) break;
      const body = st.buf.slice(8, 8 + len);
      st.buf = st.buf.slice(8 + len);
      if (id === 'SEND') { const [path] = td.decode(body).split(','); st.sendPath = path; st.fileBuf = []; }
      else if (id === 'DATA') { st.fileBuf.push(body); }
      else if (id === 'RECV') {
        const path = td.decode(body);
        const f = state.files[path];
        if (!f) { send(A_WRTE, st.remoteId, st.localId, syncPacket('FAIL', te.encode('No such file'))); }
        else {
          for (let off = 0; off < f.length; off += 64 * 1024) send(A_WRTE, st.remoteId, st.localId, syncPacket('DATA', f.subarray(off, off + 64 * 1024)));
          send(A_WRTE, st.remoteId, st.localId, syncPacket('DONE'));
        }
      } else if (id === 'QUIT') { send(A_CLSE, st.remoteId, st.localId); }
    }
  };

  const onMessage = (m) => {
    if (m.command === A_CNXN) {
      if (requireAuth) { state.authToken = Uint8Array.from({ length: 20 }, (_, i) => (i * 11 + 1) & 0xff); send(A_AUTH, 1, 0, state.authToken); }
      else { state.connected = true; sendCnxn(); }
    } else if (m.command === A_AUTH && m.arg0 === 2) {
      // signature; pretend we don't know this key yet -> re-challenge
      send(A_AUTH, 1, 0, state.authToken);
    } else if (m.command === A_AUTH && m.arg0 === 3) {
      state.gotPublicKey = td.decode(m.data);
      state.connected = true; sendCnxn();
    } else if (m.command === A_OPEN) {
      const service = td.decode(m.data).replace(/\u0000+$/, '');
      const localId = m.arg0;
      const remoteId = state.remoteCounter++;
      send(A_OKAY, remoteId, localId);
      const st = { service, localId, remoteId, buf: new Uint8Array(0) };
      state.streams[remoteId] = st;
      if (service.startsWith('shell:')) {
        const cmd = service.slice(6);
        const out = shellOutputs[cmd] ?? `ran: ${cmd}\n`;
        send(A_WRTE, remoteId, localId, te.encode(out));
        send(A_CLSE, remoteId, localId);
      } else if (service.startsWith('tcpip:')) {
        state.tcpipPort = Number(service.slice(6));
        send(A_WRTE, remoteId, localId, te.encode(`restarting in TCP mode port: ${state.tcpipPort}\n`));
        send(A_CLSE, remoteId, localId);
      } else if (service.startsWith('reboot:')) {
        state.rebooted = service.slice(7);
        send(A_CLSE, remoteId, localId);
      } // sync: stays open
    } else if (m.command === A_WRTE) {
      const st = state.streams[m.arg1];
      if (st) {
        send(A_OKAY, st.remoteId, st.localId); // ACK the host's write
        if (st.service === 'sync:') handleSyncWrite(st, m.data);
      }
    } else if (m.command === A_CLSE) {
      // host closed; nothing more to do
    }
  };

  const transport = {
    state,
    async open() {},
    async close() { state.closedByHost = true; },
    async write(bytes) {
      const merged = new Uint8Array(inBuf.length + bytes.length);
      merged.set(inBuf); merged.set(bytes, inBuf.length); inBuf = merged;
      for (;;) {
        if (inBuf.length < 24) break;
        const h = parseHeader(inBuf.slice(0, 24));
        if (inBuf.length < 24 + h.length) break;
        const data = inBuf.slice(24, 24 + h.length);
        inBuf = inBuf.slice(24 + h.length);
        onMessage({ ...h, data });
      }
    },
    async read() { return outQueue.length ? outQueue.shift() : new Uint8Array(); }
  };
  return { transport, state };
}

const noKeyStore = async () => ({ get: async () => await generateAdbKey() });

describe('ADB message framing', () => {
  it('packs and parses a header with the right checksum and magic', () => {
    const payload = te.encode('hello');
    const msg = packMessage(A_WRTE, 7, 9, payload);
    const h = parseHeader(msg.slice(0, 24));
    expect(h.command).toBe(A_WRTE);
    expect(h.arg0).toBe(7);
    expect(h.arg1).toBe(9);
    expect(h.length).toBe(5);
    expect(h.checksum).toBe(checksum(payload));
    expect(h.magic).toBe((A_WRTE ^ 0xffffffff) >>> 0);
  });
});

describe('findAdbInterface', () => {
  it('matches class ff / 42 / 01', () => {
    const cfg = { interfaces: [{ interfaceNumber: 1, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: 0x01, endpoints: [
      { type: 'bulk', direction: 'out', endpointNumber: 2 }, { type: 'bulk', direction: 'in', endpointNumber: 2 }
    ] }] }] };
    expect(findAdbInterface(cfg)).toMatchObject({ interfaceNumber: 1, epOut: 2, epIn: 2 });
  });
});

describe('ADB connection', () => {
  it('connects without auth and reads the device banner', async () => {
    const fake = fakeAdbd();
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    const { banner } = await adb.connect();
    expect(banner).toMatch(/ro.product.name=sim/);
  });

  it('completes the RSA auth handshake and shows the prompt when the key is new', async () => {
    const fake = fakeAdbd({ requireAuth: true });
    let prompted = false;
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    await adb.connect({ onPrompt: () => { prompted = true; } });
    expect(adb.connected).toBe(true);
    expect(prompted).toBe(true);
    expect(fake.state.gotPublicKey).toMatch(/ web@adb/);
  });

  it('runs a shell command and returns its output', async () => {
    const fake = fakeAdbd({ shellOutputs: { 'getprop ro.product.model': 'Pixel 3\n' } });
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    await adb.connect();
    expect(await adb.shell('getprop ro.product.model')).toBe('Pixel 3\n');
    expect((await adb.shell('echo hi')).length).toBeGreaterThan(0);
  });

  it('pushes a file and reads it back with pull', async () => {
    const fake = fakeAdbd();
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    await adb.connect();
    const data = Uint8Array.from({ length: 100000 }, (_, i) => i & 0xff); // spans sync 64K chunks
    await adb.push('/data/local/tmp/app.bin', data);
    expect(fake.state.files['/data/local/tmp/app.bin']).toEqual(data);
    expect(await adb.pull('/data/local/tmp/app.bin')).toEqual(data);
  });

  it('reports a missing file on pull', async () => {
    const fake = fakeAdbd();
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    await adb.connect();
    await expect(adb.pull('/nope')).rejects.toThrow(/No such file/);
  });

  it('switches to TCP/IP mode and reboots', async () => {
    const fake = fakeAdbd();
    const adb = new AdbConnection(fake.transport, { keyStore: await noKeyStore() });
    await adb.connect();
    expect(await adb.tcpip(5555)).toMatch(/TCP mode/);
    expect(fake.state.tcpipPort).toBe(5555);
    await adb.reboot('bootloader');
    expect(fake.state.rebooted).toBe('bootloader');
  });
});
