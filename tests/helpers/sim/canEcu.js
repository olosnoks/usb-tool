// Test-only simulated UDS/OBD ECU. Relocated from src/utils/canTools.js when
// the CAN Bus tool's demo mode was removed; a fake ECU peer the real IsoTp/UDS/OBD
// code is tested against. Not imported by app code.
import { IsoTpChannel } from '../../../src/utils/canTools.js';

export class SimulatedEcu {
  /** emit(frame) delivers the ECU's frames back to the tool. */
  constructor(emit, { requestId = 0x7e0, responseId = 0x7e8 } = {}) {
    this.emit = emit;
    this.requestId = requestId;
    this.responseId = responseId;
    this.session = 1;
    this.dtcs = [[0x04, 0x20, 0x00, 0x2f], [0x01, 0x71, 0x00, 0x24]]; // P0420, P0171
    this.dids = {
      0xf187: '8V0907115B', 0xf189: 'SW 0450', 0xf18a: 'Demo Supplier', 0xf18c: 'SN00012345',
      0xf190: 'WVWZZZ1KZDM900001', 0xf191: 'HW H13', 0xf197: 'ENGINE CONTROL'
    };
    const out = (f) => setTimeout(() => this.emit(f), 2);
    // Physical requests and flow control arrive on requestId; functional OBD requests on 0x7DF.
    this.tx = new IsoTpChannel(out, { txId: responseId, rxId: requestId, padding: 0x55 });
    this.functional = new IsoTpChannel(out, { txId: responseId, rxId: 0x7df, padding: 0x55 });
    const reply = (req) => { this.tx.sendMessage(this.answer(req)).catch(() => {}); };
    this.tx.onMessage = reply;
    this.functional.onMessage = reply;
  }

  onFrame(f) {
    this.tx.onFrame(f);
    this.functional.onFrame(f);
  }

  answer(req) {
    const sid = req[0];
    const neg = (nrc) => [0x7f, sid, nrc];
    switch (sid) {
      case 0x01: {
        const pid = req[1];
        if (pid === 0x00) return [0x41, 0x00, 0x18, 0x3b, 0x80, 0x11];
        const values = { 0x0c: [0x1a, 0xf8], 0x0d: [0x2a], 0x05: [0x7b], 0x04: [0x50], 0x11: [0x30], 0x42: [0x37, 0x1c] };
        return values[pid] ? [0x41, pid, ...values[pid]] : neg(0x12);
      }
      case 0x09: return req[1] === 0x02 ? [0x49, 0x02, 0x01, ...new TextEncoder().encode(this.dids[0xf190])] : neg(0x12);
      case 0x10: this.session = req[1]; return [0x50, req[1], 0x00, 0x32, 0x01, 0xf4];
      case 0x11: return [0x51, req[1]];
      case 0x3e: return [0x7e, 0x00];
      case 0x22: {
        const did = (req[1] << 8) | req[2];
        if (did === 0xf186) return [0x62, req[1], req[2], this.session];
        const v = this.dids[did];
        return v ? [0x62, req[1], req[2], ...new TextEncoder().encode(v)] : neg(0x31);
      }
      case 0x19: return req[1] === 0x02 ? [0x59, 0x02, 0xff, ...this.dtcs.flat()] : neg(0x12);
      case 0x14: this.dtcs = []; return [0x54];
      case 0x03: return [0x43, this.dtcs.length, ...this.dtcs.flatMap((d) => [d[0], d[1]])];
      case 0x04: this.dtcs = []; return [0x44];
      default: return neg(0x11);
    }
  }
}
