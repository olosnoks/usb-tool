import { describe, it, expect } from 'vitest';
import {
  parseCapture,
  analyzeCapture,
  buildGattModel,
  decodeH4,
  decodeAtt,
  parseAdStructures,
  buildBtsnoopFile,
  makeExampleCapture,
  filterPackets,
  packetsToCsv,
  parseHandle,
  uuidStr,
} from '../src/utils/btsnoop.js';

const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const addrLE = (s) => s.split(':').reverse().map((x) => parseInt(x, 16));
const cmd = (opcode, params) => [0x01, ...le16(opcode), params.length, ...params];
const evt = (code, params) => [0x04, code, params.length, ...params];
const acl = (handle, pb, l2cap) => [0x02, ...le16(handle | (pb << 12)), ...le16(l2cap.length), ...l2cap];
const l2cap = (cid, payload) => [...le16(payload.length), ...le16(cid), ...payload];
const u8 = (arr) => Uint8Array.from(arr);

// Build a btsnoop file (v1, H4) from a small list of packets, base time 2024-01-01T00:00:00Z.
const BASE_US = 1704067200000000n;
function btsnoopOf(packets) {
  return buildBtsnoopFile(
    packets.map((p, i) => ({ direction: p.dir, h4: u8(p.h4), unixUs: BASE_US + BigInt(i) * 1000n })),
  );
}

describe('btsnoop container', () => {
  it('parses the header, direction flags and relative timestamps', () => {
    const file = btsnoopOf([
      { dir: 'sent', h4: cmd(0x0c03, []) },
      { dir: 'received', h4: evt(0x0e, [0x01, 0x03, 0x0c, 0x00]) },
    ]);
    // Magic, version 1 and datalink 1002 in big-endian at offsets 8 and 12.
    expect(String.fromCharCode(...file.subarray(0, 7))).toBe('btsnoop');
    expect(file[7]).toBe(0);
    expect([...file.subarray(8, 16)]).toEqual([0, 0, 0, 1, 0, 0, 3, 0xea]);
    const cap = parseCapture(file);
    expect(cap.format).toBe('btsnoop');
    expect(cap.linkType).toBe(1002);
    expect(cap.records.map((r) => r.direction)).toEqual(['sent', 'received']);
    expect(cap.records[0].relUs).toBe(0);
    expect(cap.records[1].relUs).toBe(1000);
  });

  it('rebuilds the indicator for H1 (1001) records from the flags', () => {
    const data = [0x01, 0x03, 0x0c, 0x00];
    const rec = (flags, body) => {
      const r = new Uint8Array(24);
      const dv = new DataView(r.buffer);
      dv.setUint32(0, body.length);
      dv.setUint32(4, body.length);
      dv.setUint32(8, flags);
      dv.setBigUint64(16, 0x00dcddb30f2f8000n + BASE_US);
      return [...r, ...body];
    };
    const head = [...'btsnoop\0'].map((c) => c.charCodeAt(0));
    const file = u8([...head, 0, 0, 0, 1, 0, 0, 3, 0xe9, ...rec(2, data), ...rec(3, [0x00])]);
    const cap = parseCapture(file);
    expect(cap.records[0].h4[0]).toBe(0x01);
    expect(cap.records[1].h4[0]).toBe(0x04);
    expect(cap.records[1].direction).toBe('received');
  });

  it('throws on an unknown magic and on unsupported datalinks', () => {
    expect(() => parseCapture(u8([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toThrow(/Not a btsnoop/);
    const head = [...'btsnoop\0'].map((c) => c.charCodeAt(0));
    expect(() => parseCapture(u8([...head, 0, 0, 0, 1, 0, 0, 0, 9]))).toThrow(/Unsupported btsnoop datalink/);
  });

  it('reads pcap with LINKTYPE 201 (direction in the pseudo header)', () => {
    const pcap = [];
    const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    pcap.push(...le32(0xa1b2c3d4), ...[2, 0, 4, 0], ...le32(0), ...le32(0), ...le32(65535), ...le32(201));
    const pkt = [...be32(1), ...evt(0x0e, [0x01, 0x03, 0x0c, 0x00])];
    pcap.push(...le32(1700000000), ...le32(250000), ...le32(pkt.length), ...le32(pkt.length), ...pkt);
    const pkt2 = [...be32(0), ...cmd(0x0c03, [])];
    pcap.push(...le32(1700000001), ...le32(0), ...le32(pkt2.length), ...le32(pkt2.length), ...pkt2);
    const cap = parseCapture(u8(pcap));
    expect(cap.format).toBe('pcap');
    expect(cap.records.map((r) => r.direction)).toEqual(['received', 'sent']);
    expect(cap.records[0].h4[0]).toBe(0x04);
    expect(cap.records[1].relUs).toBe(750000);
  });

  it('reads a simple pcapng with an IDB (link 201) and an EPB', () => {
    const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const le16b = (n) => [n & 0xff, (n >> 8) & 0xff];
    const block = (type, body) => {
      const total = 12 + body.length;
      return [...le32(type), ...le32(total), ...body, ...le32(total)];
    };
    const shb = block(0x0a0d0d0a, [...le32(0x1a2b3c4d), 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const idb = block(1, [...le16b(201), 0, 0, ...le32(65535)]);
    // Pseudo header (direction 0 = sent) followed by an HCI Reset command.
    const pkt = [0, 0, 0, 0, ...cmd(0x0c03, [])];
    // Default if_tsresol is microseconds: split the 64-bit tick count into two 32-bit words.
    const ticks = 1700000000n * 1000000n;
    const hi = Number(ticks >> 32n);
    const lo = Number(ticks & 0xffffffffn);
    const epb = block(6, [...le32(0), ...le32(hi), ...le32(lo), ...le32(pkt.length), ...le32(pkt.length), ...pkt]);
    const cap = parseCapture(u8([...shb, ...idb, ...epb]));
    expect(cap.format).toBe('pcapng');
    expect(cap.records).toHaveLength(1);
    expect(cap.records[0].h4[0]).toBe(0x01);
    expect(cap.records[0].direction).toBe('sent');
    expect(cap.records[0].unixUs).toBe(ticks);
  });
});

describe('H4 decoding', () => {
  it('decodes an HCI command with OGF/OCF name and parameters', () => {
    const d = decodeH4(u8(cmd(0x0406, [0x40, 0x00, 0x13])));
    expect(d.type).toBe('cmd');
    expect(d.name).toBe('Disconnect');
    expect(d.summary).toContain('0x0406');
    expect(d.fields.some(([k, v]) => k === 'Reason' && v.includes('0x13'))).toBe(true);
  });

  it('decodes LE Create Connection parameters', () => {
    const params = [0x60, 0x00, 0x30, 0x00, 0x00, 0x00, ...addrLE('AA:BB:CC:DD:EE:01'), 0x00, 0x18, 0x00, 0x28, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x00, 0x00];
    const d = decodeH4(u8(cmd(0x200d, params)));
    expect(d.name).toBe('LE Create Connection');
    expect(d.fields).toContainEqual(['Peer address', 'AA:BB:CC:DD:EE:01']);
    expect(d.fields).toContainEqual(['Scan interval', '60.000 ms']);
  });

  it('decodes Command Complete for Read BD_ADDR and unknown events without throwing', () => {
    const cc = decodeH4(u8(evt(0x0e, [0x01, 0x09, 0x10, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66])));
    expect(cc.name).toBe('Command Complete');
    expect(cc.summary).toContain('Read BD_ADDR');
    expect(cc.fields).toContainEqual(['BD_ADDR', '66:55:44:33:22:11']);
    expect(decodeH4(u8(evt(0x77, [1, 2]))).name).toBe('Event 0x77');
    expect(decodeH4(u8([0x09, 0x00])).type).toBe('unknown');
  });

  it('decodes Disconnection Complete and LE Connection Complete', () => {
    const dc = decodeH4(u8(evt(0x05, [0x00, 0x40, 0x00, 0x16])));
    expect(dc.handle).toBe(0x40);
    expect(dc.conn).toEqual({ kind: 'disconnect', handle: 0x40, status: 0, reason: 0x16 });
    const lc = decodeH4(u8(evt(0x3e, [0x01, 0x00, 0x41, 0x00, 0x01, 0x01, ...addrLE('C0:FF:EE:00:00:01'), 0x18, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00])));
    expect(lc.name).toBe('LE Meta: LE Connection Complete');
    expect(lc.conn).toMatchObject({ kind: 'connect', transport: 'LE', handle: 0x41, role: 1, peerAddr: 'C0:FF:EE:00:00:01', peerAddrType: 1 });
    expect(lc.fields).toContainEqual(['Connection interval', '30.00 ms']);
  });
});

describe('advertising reports and AD structures', () => {
  it('decodes flags, complete name, 16-bit UUIDs, TX power and manufacturer data with company name', () => {
    const ad = [
      0x02, 0x01, 0x06, // flags: LE general discoverable, BR/EDR not supported
      0x05, 0x09, 0x54, 0x6f, 0x6f, 0x6c, // "Tool"
      0x03, 0x03, 0x0f, 0x18, // complete 16-bit list: 0x180F battery
      0x02, 0x0a, 0xf4, // TX power -12 dBm
      0x04, 0xff, 0x4c, 0x00, 0x10, // manufacturer data, Apple (0x004C)
    ];
    const items = parseAdStructures(u8(ad));
    expect(items.map((i) => i.typeName)).toEqual([
      'Flags',
      'Complete local name',
      'Complete list of 16-bit service UUIDs',
      'TX power level',
      'Manufacturer specific data',
    ]);
    expect(items[0].value).toContain('LE General Discoverable');
    expect(items[0].value).toContain('BR/EDR not supported');
    expect(items[1].value).toBe('Tool');
    expect(items[2].value).toContain('0x180f Battery Service');
    expect(items[3].value).toBe('-12 dBm');
    expect(items[4].value).toContain('Apple Inc.');
    expect(items[4].value).toContain('10');
  });

  it('flags a truncated AD structure instead of throwing', () => {
    const items = parseAdStructures(u8([0x09, 0x09, 0x41]));
    expect(items[0].typeName).toBe('Truncated AD structure');
  });

  it('decodes a full advertising report event into the packet tree', () => {
    const report = [0x01, 0x00, 0x00, ...addrLE('AA:BB:CC:DD:EE:01'), 3, 0x02, 0x01, 0x06, 0xc4];
    const d = decodeH4(u8(evt(0x3e, [0x02, ...report])));
    expect(d.adv).toHaveLength(1);
    expect(d.adv[0]).toMatchObject({ addr: 'AA:BB:CC:DD:EE:01', rssi: -60, evTypeName: 'ADV_IND' });
    expect(d.sub[0].sub[0].title).toContain('Flags');
  });
});

describe('ACL, L2CAP reassembly and ATT', () => {
  it('reassembles an L2CAP SDU split across a start and a continuation fragment', () => {
    const att = [0x11, 0x06, 0x01, 0x00, 0x07, 0x00, 0x00, 0x18, 0x08, 0x00, 0x0b, 0x00, 0x0f, 0x18];
    const full = l2cap(0x0004, att);
    const cap = parseCapture(
      btsnoopOf([
        { dir: 'sent', h4: acl(0x40, 0, l2cap(0x0004, [0x10, 0x01, 0x00, 0xff, 0xff, 0x00, 0x28])) },
        { dir: 'received', h4: acl(0x40, 2, full.slice(0, 10)) },
        { dir: 'received', h4: acl(0x40, 1, full.slice(10)) },
      ]),
    );
    const an = analyzeCapture(cap);
    expect(an.packets[1].fragment).toEqual({ state: 'partial', got: 10, total: 18 });
    const done = an.packets[2];
    expect(done.l2cap).toMatchObject({ cid: 0x0004, length: 14, fragments: 2, firstNo: 2, lastNo: 3 });
    expect(done.att.name).toBe('Read By Group Type Response');
    expect(done.summary).toContain('(2 fragments)');
  });

  it('reports an orphan continuation fragment and a discarded incomplete SDU', () => {
    const cap = parseCapture(btsnoopOf([{ dir: 'received', h4: acl(0x40, 1, [0x01, 0x02]) }]));
    const an = analyzeCapture(cap);
    expect(an.packets[0].fragment).toEqual({ state: 'orphan' });
    expect(an.warnings.length).toBe(1);
  });

  it('parses ATT request and response PDUs', () => {
    expect(decodeAtt(u8([0x0a, 0x03, 0x00])).handle).toBe(3);
    const rsp = decodeAtt(u8([0x0b, 0x54, 0x6f, 0x6f, 0x6c]));
    expect(rsp.name).toBe('Read Response');
    expect(rsp.fields).toContainEqual(['Value (UTF-8)', 'Tool']);
    const err = decodeAtt(u8([0x01, 0x0a, 0x03, 0x00, 0x0a]));
    expect(err.reqOp).toBe(0x0a);
    expect(err.errorName).toBe('Attribute Not Found');
    const notif = decodeAtt(u8([0x1b, 0x0a, 0x00, 0x5a]));
    expect(notif.handle).toBe(0x0a);
    expect([...notif.value]).toEqual([0x5a]);
    const wr = decodeAtt(u8([0x52, 0x0b, 0x00, 0x01, 0x00]));
    expect(wr.name).toBe('Write Command');
    expect(wr.handle).toBe(0x0b);
    expect(decodeAtt(u8([0x09, 0x07, 0x02, 0x00, 0x02, 0x03, 0x00, 0x00, 0x2a])).entries[0]).toMatchObject({ handle: 2 });
  });

  it('decodes an SMP pairing request and a pairing failed reason', () => {
    const cap = parseCapture(btsnoopOf([{ dir: 'sent', h4: acl(0x40, 0, l2cap(0x0006, [0x01, 0x03, 0x00, 0x2d, 0x10, 0x03, 0x03])) }]));
    const an = analyzeCapture(cap);
    expect(an.packets[0].smp.name).toBe('Pairing Request');
    expect(an.packets[0].smp.fields).toContainEqual(['IO capability', 'NoInputNoOutput']);
    expect(an.packets[0].smp.fields).toContainEqual(['Secure Connections', 'yes']);
  });
});

describe('connections, GATT model and the example capture', () => {
  it('builds the connection list and a GATT model from the example session', () => {
    const an = analyzeCapture(parseCapture(makeExampleCapture()));
    expect(an.warnings).toEqual([]);
    expect(an.stats.attOps).toBe(11);
    expect(an.connections).toHaveLength(1);
    const c = an.connections[0];
    expect(c).toMatchObject({ handle: 0x40, peerAddr: 'AA:BB:CC:DD:EE:01', role: 0, startNo: 4, endNo: 17 });
    expect(c.reason).toContain('0x13');
    const g = buildGattModel(c);
    expect(g.services.map((s) => [s.startHandle, s.endHandle, s.uuid])).toEqual([
      [1, 7, '0x1800'],
      [8, 11, '0x180f'],
    ]);
    expect(g.characteristics.map((ch) => [ch.declHandle, ch.valueHandle, ch.uuid])).toEqual([
      [2, 3, '0x2a00'],
      [4, 5, '0x2a01'],
      [9, 10, '0x2a19'],
    ]);
    const name = g.handles.find((h) => h.handle === 3);
    expect(name.name).toBe('Value: Device Name');
    expect(name.reads).toBe(1);
    expect(utf8(name.last)).toBe('Tool');
    const notify = g.handles.find((h) => h.handle === 10);
    expect(notify.notifies).toBe(1);
    const cccd = g.handles.find((h) => h.handle === 11);
    expect(cccd.writes).toBe(1);
    expect(cccd.values[0]).toMatchObject({ kind: 'write', status: 'ok' });
  });

  it('keeps the write response status on the write event', () => {
    const an = analyzeCapture(parseCapture(makeExampleCapture()));
    const write = an.connections[0].gatt.events.find((e) => e.kind === 'write');
    expect(write.status).toBe('ok');
  });

  it('filters by type, handle and text, parses handles and exports CSV', () => {
    const an = analyzeCapture(parseCapture(makeExampleCapture()));
    expect(filterPackets(an.packets, { type: 'evt' })).toHaveLength(4);
    expect(filterPackets(an.packets, { handle: 0x40, type: 'acl' })).toHaveLength(12);
    expect(filterPackets(an.packets, { text: 'notification' }).length).toBeGreaterThan(0);
    expect(parseHandle('0x0040')).toBe(0x40);
    expect(parseHandle('zz')).toBeNull();
    const csv = packetsToCsv(filterPackets(an.packets, { type: 'evt' }));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('no,time_s,utc,direction,type,handle,connection,l2cap_cid,att_opcode,summary');
    expect(lines).toHaveLength(5);
    expect(csv).toContain('"');
  });

  it('formats 16-bit and 128-bit UUIDs', () => {
    expect(uuidStr(u8([0x00, 0x28]))).toBe('0x2800');
    const full = u8([0xfb, 0x34, 0x9b, 0x5f, 0x80, 0x00, 0x00, 0x80, 0x00, 0x10, 0x00, 0x00, 0x0f, 0x18, 0x00, 0x00]);
    expect(uuidStr(full)).toBe('0x180f');
  });
});

function utf8(bytes) {
  return new TextDecoder().decode(bytes);
}
