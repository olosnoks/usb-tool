import { describe, it, expect } from 'vitest';
import { parsePcap, compileFilter } from '../src/utils/pcap';
import {
  captureSummary, endpoints, ioBuckets, niceInterval, tcpStreamKey, followTcpStream,
  bytesToAscii, conversationsToCsv, endpointsToCsv,
} from '../src/utils/pcapAnalysis';

const flat = (a) => a.flatMap((x) => (Array.isArray(x) || ArrayBuffer.isView(x) ? flat([...x]) : [x]));
const B = (...a) => Uint8Array.from(flat(a));
const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const mac = (n) => [2, 0, 0, 0, 0, n];

const IPA = [10, 0, 0, 1];
const IPB = [10, 0, 0, 2];
function tcpFrame(from, sp, dp, seq, flags, payload = '') {
  const [src, dst, sm, dm] = from === 'A' ? [IPA, IPB, 1, 2] : [IPB, IPA, 2, 1];
  const seg = B(be16(sp), be16(dp), be32(seq), be32(0), 0x50, flags, be16(8192), 0, 0, 0, 0, ascii(payload));
  const ip = B(0x45, 0, be16(20 + seg.length), 0, 1, 0, 0, 64, 6, 0, 0, src, dst, seg);
  return B(mac(dm), mac(sm), be16(0x0800), ip);
}
function pcap(frames, step = 1) {
  const parts = [le32(0xa1b2c3d4), [2, 0, 4, 0], le32(0), le32(0), le32(65535), le32(1)];
  frames.forEach((f, i) => parts.push(le32(1700000000 + Math.floor(i * step)), le32(0), le32(f.length), le32(f.length), f));
  return B(parts).buffer;
}

const stream = () => [
  tcpFrame('A', 40000, 80, 100, 0x02),
  tcpFrame('B', 80, 40000, 500, 0x12),
  tcpFrame('A', 40000, 80, 101, 0x18, 'GET / HTTP/1.1\r\n\r\n'),
  tcpFrame('A', 40000, 80, 101, 0x18, 'GET / HTTP/1.1\r\n\r\n'), // retransmission
  tcpFrame('B', 80, 40000, 501, 0x18, 'HTTP/1.1 200 OK\r\n\r\nhi'),
];

describe('pcap analysis', () => {
  const res = parsePcap(pcap(stream(), 2));
  const pk = res.packets;

  it('records TCP details', () => {
    expect(pk[2].tcp.plen).toBe(18);
    expect(pk[0].tcp.flagBits & 2).toBe(2);
  });

  it('summarises', () => {
    const s = captureSummary(pk);
    expect(s.packets).toBe(5);
    expect(s.duration).toBe(8);
    expect(s.pps).toBeCloseTo(5 / 8);
    expect(captureSummary([]).packets).toBe(0);
  });

  it('counts endpoints tx/rx', () => {
    const e = endpoints(pk);
    expect(e).toHaveLength(2);
    const a = e.find((x) => x.address === '10.0.0.1');
    expect(a.txPackets).toBe(3);
    expect(a.rxPackets).toBe(2);
    expect(a.packets).toBe(5);
  });

  it('buckets by time', () => {
    const { buckets, interval } = ioBuckets(pk, 2);
    expect(interval).toBe(2);
    expect(buckets).toHaveLength(5);
    expect(buckets.reduce((n, b) => n + b.packets, 0)).toBe(5);
    expect(niceInterval(100, 10)).toBe(10);
    expect(ioBuckets([], 1).buckets).toEqual([]);
  });

  it('follows a stream, dropping retransmissions', () => {
    const key = tcpStreamKey(pk[0]);
    expect(tcpStreamKey(pk[1])).toBe(key);
    const f = followTcpStream(pk, key);
    expect(f.retransmissions).toBe(1);
    expect(f.missing).toBe(0);
    expect(f.chunks.map((c) => c.dir)).toEqual(['A', 'B']);
    expect(bytesToAscii(f.chunks[0].bytes)).toBe('GET / HTTP/1.1\n\n');
    expect(f.bytesB).toBe(21);
  });

  it('reports missing data and null for unknown streams', () => {
    const r = parsePcap(pcap([
      tcpFrame('A', 1, 2, 10, 0x18, 'abc'),
      tcpFrame('A', 1, 2, 20, 0x18, 'def'),
    ])).packets;
    const f = followTcpStream(r, tcpStreamKey(r[0]));
    expect(f.missing).toBe(7);
    expect(followTcpStream(r, 'nope')).toBeNull();
  });

  it('exports CSV', () => {
    expect(endpointsToCsv(endpoints(pk)).split('\r\n')[0]).toBe('Address,Packets,Bytes,Tx packets,Tx bytes,Rx packets,Rx bytes');
    expect(conversationsToCsv([{ proto: 'TCP', a: 'x', b: 'y', packets: 1, bytes: 2, duration: 0 }])).toContain('TCP,x,y,1,2,0.000000');
  });
});

describe('extended filter', () => {
  const pk = parsePcap(pcap(stream())).packets;
  const n = (q) => pk.filter(compileFilter(q)).length;
  it('supports src/dst', () => {
    expect(n('src 10.0.0.2')).toBe(2);
    expect(n('dst 10.0.0.2')).toBe(3);
  });
  it('supports not and or', () => {
    expect(n('not syn')).toBe(3);
    expect(n('!syn')).toBe(3);
    expect(n('syn or port 99')).toBe(2);
    expect(n('tcp and port 80 and not src 10.0.0.1')).toBe(2);
  });
  it('supports flags and length', () => {
    expect(n('syn')).toBe(2);
    expect(n('rst')).toBe(0);
    expect(n('len > 60')).toBe(3);
    expect(n('len <= 60')).toBe(2);
  });
});
