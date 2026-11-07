// Test-only simulated USBTMC (SCPI instrument) transport. Recovered from
// usbtmcDriver.js (commit f695098^); exercises the real USBTMC framing/parsing
// without an instrument. Not imported by app code.
import { MSGID } from '../../../src/utils/usbtmcDriver.js';
import { buildIeeeBlock } from '../../../src/utils/scpiTools.js';
import { demoWaveform, demoScreenshotBmp } from './demoSignals.js';

const td = new TextDecoder();
const te = new TextEncoder();
const align4 = (n) => (n + 3) & ~3;

export function createSimulatedUsbTmc() {
  let pending = null;
  const state = { simulated: true, voltage: 1.0, lastWrite: null };
  const answer = (q) => {
    const Q = q.trim().toUpperCase();
    if (Q === '*IDN?') return 'Simulated Instruments,SIM-SCOPE 1000,SN000123,1.0.0';
    if (Q === '*OPC?') return '1';
    if (Q.startsWith('MEAS') || Q.startsWith('MEASURE')) return (3.300 + Math.random() * 0.01).toFixed(4);
    if (Q === 'SYST:ERR?' || Q === 'SYSTEM:ERROR?') return '0,"No error"';
    if (Q === ':WAV:PRE?') return demoWaveform().preamble;
    if (Q === ':WAV:DATA?') return buildIeeeBlock(demoWaveform().data);
    if (Q.startsWith(':DISP:DATA?')) return buildIeeeBlock(demoScreenshotBmp());
    if (Q.endsWith('?')) return `SIMULATED response to ${q.trim()}`;
    return null;
  };
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      if (bytes[0] === MSGID.DEV_DEP_MSG_OUT) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const size = dv.getUint32(4, true);
        const cmd = td.decode(bytes.slice(12, 12 + size));
        state.lastWrite = cmd.trim();
        const resp = answer(cmd);
        pending = resp == null ? null : resp instanceof Uint8Array ? resp : te.encode(resp + '\n');
      } else if (bytes[0] === MSGID.REQUEST_DEV_DEP_MSG_IN) {
        const data = pending || new Uint8Array();
        const out = new Uint8Array(12 + align4(data.length));
        const dv = new DataView(out.buffer);
        out[0] = MSGID.DEV_DEP_MSG_IN; out[1] = bytes[1]; out[2] = (~bytes[1]) & 0xff;
        dv.setUint32(4, data.length, true); out[8] = 0x01; out.set(data, 12);
        pending = out;
      }
    },
    async read() { const out = pending; pending = null; return out || new Uint8Array(); }
  };
}
