// Test-only simulated FIDO2/CTAPHID authenticator. Recovered from fido2Driver.js
// (commit 1ec15c4^); exercises the real CTAPHID framing without a security key.
// Not imported by app code.
import { buildPackets, BROADCAST_CID, CTAPHID, CTAP2_CMD } from '../../../src/utils/fido2Driver.js';

function cborBytes(...parts) { let n = 0; parts.forEach((p) => (n += p.length)); const o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; }
function cborText(s) { const u = new TextEncoder().encode(s); return cborBytes(Uint8Array.from([0x60 | u.length]), u); }
function cborArray(items) { return cborBytes(Uint8Array.from([0x80 | items.length]), ...items); }

export function createSimulatedFido2() {
  const state = { simulated: true, cid: 0x11223344 };
  let pending = [];
  const reply = (cid, cmd, data) => { for (const p of buildPackets(cid, cmd, data)) pending.push(p); };
  const aaguid = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const getInfoCbor = cborBytes(
    Uint8Array.from([0x00]),
    Uint8Array.from([0xa3]),
    Uint8Array.from([0x01]), cborArray([cborText('U2F_V2'), cborText('FIDO_2_0'), cborText('FIDO_2_1')]),
    Uint8Array.from([0x03]), cborBytes(Uint8Array.from([0x50]), aaguid),
    Uint8Array.from([0x04]), cborBytes(Uint8Array.from([0xa2]), cborText('rk'), Uint8Array.from([0xf5]), cborText('uv'), Uint8Array.from([0xf5]))
  );
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if ((bytes[4] & 0x80) === 0) return;
      const bcnt = dv.getUint16(5, false);
      const data = bytes.slice(7, 7 + bcnt);
      if (bytes[4] === CTAPHID.INIT) {
        const resp = new Uint8Array(17);
        resp.set(data.subarray(0, 8), 0);
        new DataView(resp.buffer).setUint32(8, state.cid, false);
        resp[12] = 2; resp[13] = 5; resp[14] = 2; resp[15] = 4; resp[16] = 0x04 | 0x08;
        reply(BROADCAST_CID, CTAPHID.INIT, resp);
      } else if (bytes[4] === CTAPHID.CBOR) {
        if (data[0] === CTAP2_CMD.GET_INFO) reply(state.cid, CTAPHID.CBOR, getInfoCbor);
        else reply(state.cid, CTAPHID.CBOR, Uint8Array.from([0x01]));
      } else if (bytes[4] === CTAPHID.PING) {
        reply(state.cid, CTAPHID.PING, data);
      }
    },
    async read() { return pending.length ? pending.shift() : new Uint8Array(64); }
  };
}
