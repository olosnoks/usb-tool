// Extra analysis on top of analyzeCapture() output for the Bluetooth HCI log viewer.
// Pure functions only; nothing here touches the browser.
import { buildBtsnoopFile, commandName, statusText, hex16 } from './btsnoop.js';

const u16 = (b, o) => (o + 1 < b.length ? b[o] | (b[o + 1] << 8) : null);

/** Disconnect reasons that are normal (user ended, remote ended, low resources by choice, power off, local host). */
const NORMAL_DISCONNECT = new Set([0x13, 0x14, 0x15, 0x16]);

/**
 * Pair HCI commands with the first Command Complete or Command Status that names the same opcode.
 * Returns one entry per command, in capture order.
 * @returns {Array<{no:number, opcode:number, name:string, responseNo:number|null, kind:'complete'|'status'|null, status:number|null, latencyMs:number|null}>}
 */
export function pairCommands(packets) {
  const out = [];
  const pending = new Map(); // opcode -> entries waiting for a response (FIFO)
  for (const p of packets) {
    const h = p.h4;
    if (!h || h.length === 0) continue;
    if (h[0] === 0x01 && p.type === 'cmd') {
      const opcode = u16(h, 1);
      if (opcode === null) continue;
      const e = { no: p.no, opcode, name: commandName(opcode), responseNo: null, kind: null, status: null, latencyMs: null, relUs: p.relUs };
      out.push(e);
      if (!pending.has(opcode)) pending.set(opcode, []);
      pending.get(opcode).push(e);
    } else if (h[0] === 0x04 && p.type === 'evt') {
      const code = h[1];
      const params = h.subarray(3);
      let opcode = null;
      let status = null;
      let kind = null;
      if (code === 0x0e) { opcode = u16(params, 1); status = params.length > 3 ? params[3] : null; kind = 'complete'; }
      else if (code === 0x0f) { opcode = u16(params, 2); status = params.length > 0 ? params[0] : null; kind = 'status'; }
      if (opcode === null || opcode === 0) continue; // opcode 0 is the controller's "ready" credit
      const q = pending.get(opcode);
      if (!q || q.length === 0) continue;
      const e = q.shift();
      e.responseNo = p.no;
      e.kind = kind;
      e.status = status;
      e.latencyMs = Math.max(0, (p.relUs - e.relUs) / 1000);
    }
  }
  return out.map(({ relUs, ...rest }) => rest);
}

/**
 * Collect things worth looking at first: failed commands, commands that never got a response,
 * slow commands, abnormal disconnects, failed connections, ATT errors, encryption failures and
 * controller hardware errors.
 * @returns {Array<{no:number, severity:'error'|'warn'|'info', category:string, message:string}>} sorted by packet number
 */
export function findIssues(analysis, { slowMs = 500 } = {}) {
  const issues = [];
  const add = (no, severity, category, message) => issues.push({ no, severity, category, message });

  for (const c of pairCommands(analysis.packets)) {
    if (c.responseNo === null) {
      add(c.no, 'warn', 'Command', `${c.name} got no Command Complete/Status in this capture`);
    } else if (c.status !== null && c.status !== 0) {
      add(c.responseNo, 'error', 'Command', `${c.name} failed: ${statusText(c.status)} (command #${c.no})`);
    } else if (c.latencyMs !== null && c.latencyMs >= slowMs) {
      add(c.responseNo, 'info', 'Slow command', `${c.name} took ${c.latencyMs.toFixed(1)} ms to answer (command #${c.no})`);
    }
  }

  for (const c of analysis.connections) {
    if (c.status) {
      add(c.startNo, 'error', 'Connection', `Connection ${hex16(c.handle)} failed: ${c.reason}`);
    } else if (c.endNo !== null && c.reason && c.reason.startsWith('0x')) {
      const code = parseInt(c.reason, 16);
      if (!NORMAL_DISCONNECT.has(code)) add(c.endNo, 'warn', 'Disconnect', `Connection ${hex16(c.handle)} ended: ${c.reason}`);
    }
    for (const e of c.gatt?.errors || []) {
      add(e.no, 'warn', 'ATT error', `${e.name} on handle ${e.handle === null || e.handle === undefined ? 'n/a' : hex16(e.handle)} (connection #${c.id})`);
    }
  }

  for (const p of analysis.packets) {
    const h = p.h4;
    if (!h || h[0] !== 0x04 || p.type !== 'evt') continue;
    if (h[1] === 0x10) add(p.no, 'error', 'Hardware', p.summary);
    if (h[1] === 0x08 && h.length > 3 && h[3] !== 0) add(p.no, 'error', 'Encryption', `Encryption Change failed: ${statusText(h[3])}`);
  }
  for (const w of analysis.warnings) {
    const m = /^#(\d+):/.exec(w);
    add(m ? Number(m[1]) : 0, 'info', 'Parser', w);
  }
  return issues.sort((a, b) => a.no - b.no);
}

/** Per-connection byte counts, packet counts and average rates, from ACL packets. */
export function connectionTraffic(analysis) {
  const rows = analysis.connections.map((c) => ({
    id: c.id, handle: c.handle, transport: c.transport, peerAddr: c.peerAddr,
    txBytes: 0, rxBytes: 0, txPackets: 0, rxPackets: 0, firstUs: null, lastUs: null,
  }));
  for (const p of analysis.packets) {
    if (p.type !== 'acl' || p.connId === null || p.connId === undefined) continue;
    const r = rows[p.connId];
    if (!r) continue;
    const payload = Math.max(0, (p.h4?.length || 0) - 5); // H4 indicator + 4-byte ACL header
    if (p.direction === 'sent') { r.txBytes += payload; r.txPackets++; } else { r.rxBytes += payload; r.rxPackets++; }
    if (r.firstUs === null) r.firstUs = p.relUs;
    r.lastUs = p.relUs;
  }
  return rows.map((r) => {
    const secs = r.firstUs === null ? 0 : (r.lastUs - r.firstUs) / 1e6;
    return {
      ...r,
      durationS: secs,
      txBps: secs > 0 ? r.txBytes / secs : null,
      rxBps: secs > 0 ? r.rxBytes / secs : null,
    };
  });
}

/** Filter by direction ('all' | 'sent' | 'received'), then keep only listed packet numbers if given. */
export function filterDirection(packets, direction = 'all') {
  return direction === 'all' ? packets : packets.filter((p) => p.direction === direction);
}

/**
 * Write the given analysed packets back out as a btsnoop v1 (H4) file, e.g. to share a trimmed log.
 * Timestamps are preserved when the source had them, otherwise relative times are used.
 */
export function packetsToBtsnoop(packets) {
  return buildBtsnoopFile(
    packets.map((p) => ({
      direction: p.direction === 'received' ? 'received' : 'sent',
      h4: p.h4,
      unixUs: p.unixUs !== null && p.unixUs !== undefined ? p.unixUs : BigInt(Math.round(p.relUs)),
    })),
  );
}

/** Time since the previous packet in the full capture, in ms, keyed by packet number. */
export function deltaMs(packets) {
  const m = new Map();
  let prev = null;
  for (const p of packets) {
    m.set(p.no, prev === null ? 0 : (p.relUs - prev) / 1000);
    prev = p.relUs;
  }
  return m;
}
