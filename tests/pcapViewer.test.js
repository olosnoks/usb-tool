import { describe, it, expect } from 'vitest';
import {
  parsePcap, fmtIPv6, compileFilter, conversations, protocolHierarchy, packetsToCsv, writePcap, decodePacketDetail,
} from '../src/utils/pcap';

const flat = (a) => a.flatMap((x) => (Array.isArray(x) || ArrayBuffer.isView(x) ? flat([...x]) : [x]));
const B = (...a) => Uint8Array.from(flat(a));
const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

const ETH = (dst, src, etype, payload) => B(dst, src, be16(etype), payload);
const mac = (n) => [2, 0, 0, 0, 0, n];

function ipv4(proto, src, dst, payload, flagsFrag = 0) {
  const len = 20 + payload.length;
  return B(0x45, 0, be16(len), 0, 1, be16(flagsFrag), 64, proto, 0, 0, src, dst, payload);
}
const udp = (sp, dp, payload) => B(be16(sp), be16(dp), be16(8 + payload.length), 0, 0, payload);
const tcp = (sp, dp, flags, payload = []) => B(be16(sp), be16(dp), be32(1), be32(0), 0x50, flags, be16(8192), 0, 0, 0, 0, payload);

function dnsQuery(name, qtype = 1) {
  const q = name.split('.').flatMap((l) => [l.length, ...ascii(l)]);
  return B(be16(0x1234), be16(0x0100), be16(1), be16(0), be16(0), be16(0), q, 0, be16(qtype), be16(1));
}
function clientHello(sni) {
  const host = ascii(sni);
  const sniExt = B(be16(0), be16(host.length + 5), be16(host.length + 3), 0, be16(host.length), host);
  const supVer = B(be16(43), be16(3), 2, 3, 4);
  const ext = B(sniExt, supVer);
  const body = B(3, 3, new Array(32).fill(7), 0, be16(2), be16(0x1301), 1, 0, be16(ext.length), ext);
  const hs = B(1, 0, be16(body.length), body);
  return B(0x16, 3, 1, be16(hs.length), hs);
}

const IPA = [10, 0, 0, 1];
const IPB = [10, 0, 0, 2];
const dnsFrame = () => ETH(mac(2), mac(1), 0x0800, ipv4(17, IPA, IPB, udp(40000, 53, dnsQuery('example.com'))));
const tlsFrame = () => ETH(mac(2), mac(1), 0x0800, ipv4(6, IPA, IPB, tcp(50000, 443, 0x18, clientHello('secure.example.org'))));
const synFrame = () => ETH(mac(1), mac(2), 0x0800, ipv4(6, IPB, IPA, tcp(443, 50000, 0x12)));

function pcap(frames, { le = true, linktype = 1 } = {}) {
  const w16 = le ? le16 : be16;
  const w32 = le ? le32 : be32;
  const parts = [w32(0xa1b2c3d4), w16(2), w16(4), w32(0), w32(0), w32(65535), w32(linktype)];
  frames.forEach((f, i) => parts.push(w32(1700000000 + i), w32(500000), w32(f.length), w32(f.length), f));
  return B(parts).buffer;
}

function pcapng(frames, { le = true, linktype = 1, tsresol } = {}) {
  const w16 = le ? le16 : be16;
  const w32 = le ? le32 : be32;
  const pad = (a) => [...a, ...new Array((4 - (a.length % 4)) % 4).fill(0)];
  const block = (type, body) => { const b = pad(flat(body)); return [w32(type), w32(b.length + 12), b, w32(b.length + 12)]; };
  const shb = block(0x0a0d0d0a, [w32(0x1a2b3c4d), w16(1), w16(0), w32(0xffffffff), w32(0xffffffff)]);
  const opts = tsresol === undefined ? [] : [w16(9), w16(1), pad([tsresol]), w16(0), w16(0)];
  const idb = block(1, [w16(linktype), w16(0), w32(65535), opts]);
  const epbs = frames.map((f, i) => block(6, [w32(0), w32(0), w32(tsresol === 9 ? 1700000000 + i : 1700000000 * 1e6 % 4294967296 + i), w32(f.length), w32(f.length), pad([...f])]));
  return B(shb, idb, epbs).buffer;
}

describe('fmtIPv6', () => {
  const v6 = (...g) => B(g.flatMap((x) => be16(x)));
  it('compresses canonically', () => {
    expect(fmtIPv6(v6(0, 0, 0, 0, 0, 0, 0, 1), 0)).toBe('::1');
    expect(fmtIPv6(v6(0xfe80, 0, 0, 0, 0, 0, 0, 1), 0)).toBe('fe80::1');
    expect(fmtIPv6(v6(0x2001, 0xdb8, 0, 0, 1, 0, 0, 1), 0)).toBe('2001:db8::1:0:0:1');
    expect(fmtIPv6(v6(0, 0, 0, 0, 0, 0, 0, 0), 0)).toBe('::');
    expect(fmtIPv6(v6(1, 0, 2, 3, 4, 5, 6, 7), 0)).toBe('1:0:2:3:4:5:6:7');
  });
});

describe('parsePcap', () => {
  it('decodes DNS, TLS SNI and TCP flags from classic pcap', () => {
    const r = parsePcap(pcap([dnsFrame(), tlsFrame(), synFrame()]));
    expect(r).toMatchObject({ format: 'pcap', packetCount: 3, totalPackets: 3, truncated: false });
    expect(r.packets[0]).toMatchObject({ proto: 'DNS', l4: 'UDP', info: 'A example.com', src: '10.0.0.1', dport: 53 });
    expect(r.packets[1].info).toContain('SNI=secure.example.org');
    expect(r.packets[1].info).toContain('TLS 1.3');
    expect(r.packets[2]).toMatchObject({ proto: 'TCP', info: 'SYN,ACK' });
  });
  it('pcapng (LE, one IDB) gives the same packets as the classic conversion', () => {
    const frames = [dnsFrame(), tlsFrame(), synFrame()];
    const a = parsePcap(pcap(frames));
    const b = parsePcap(pcapng(frames));
    expect(b.format).toBe('pcapng');
    expect(b.packetCount).toBe(3);
    const strip = (p) => ({ ...p, ts: undefined, data: Array.from(p.data) });
    expect(b.packets.map(strip)).toEqual(a.packets.map(strip));
  });
  it('honours if_tsresol and big-endian sections', () => {
    const r = parsePcap(pcapng([dnsFrame(), dnsFrame()], { le: false, tsresol: 9 }));
    expect(r.packetCount).toBe(2);
    expect(r.packets[0].ts).toBeCloseTo(1.7, 6); // 1700000000 ticks of 1 ns
    expect(r.packets[1].ts - r.packets[0].ts).toBeCloseTo(1e-9, 12);
  });
  it('reads big-endian classic pcap', () => {
    expect(parsePcap(pcap([dnsFrame()], { le: false })).packets[0].info).toBe('A example.com');
  });
  it('decodes VLAN-tagged and SLL frames', () => {
    const inner = ipv4(17, IPA, IPB, udp(1, 53, dnsQuery('vlan.test')));
    const vlan = ETH(mac(2), mac(1), 0x8100, B(be16(0x0064), be16(0x0800), inner));
    expect(parsePcap(pcap([vlan])).packets[0]).toMatchObject({ vlan: 100, proto: 'DNS', info: 'A vlan.test' });
    const sll = B(be16(0), be16(1), be16(6), mac(1), [0, 0], be16(0x0800), inner);
    expect(parsePcap(pcap([sll], { linktype: 113 })).packets[0]).toMatchObject({ proto: 'DNS', ethSrc: '02:00:00:00:00:01' });
  });
  it('walks IPv6 extension headers and flags IPv4 fragments', () => {
    const v6 = (nh, payload) => B(0x60, 0, 0, 0, be16(payload.length), nh, 64, new Array(15).fill(0), 1, new Array(15).fill(0), 2, payload);
    const hop = B(17, 0, 0, 0, 0, 0, 0, 0);
    const f = ETH(mac(2), mac(1), 0x86dd, v6(0, B(hop, udp(5, 53, dnsQuery('v6.test')))));
    expect(parsePcap(pcap([f])).packets[0]).toMatchObject({ l3: 'IPv6', src: '::1', dst: '::2', proto: 'DNS' });
    const frag = ETH(mac(2), mac(1), 0x0800, ipv4(17, IPA, IPB, udp(1, 53, dnsQuery('x.y')), 0x2000));
    expect(parsePcap(pcap([frag])).packets[0]).toMatchObject({ frag: true });
  });
  it('decodes ARP and HTTP one-liners', () => {
    const arp = B(be16(1), be16(0x0800), 6, 4, be16(1), mac(1), IPA, [0, 0, 0, 0, 0, 0], IPB);
    expect(parsePcap(pcap([ETH([255, 255, 255, 255, 255, 255], mac(1), 0x0806, arp)])).packets[0].info).toBe('Who has 10.0.0.2? Tell 10.0.0.1');
    const http = ETH(mac(2), mac(1), 0x0800, ipv4(6, IPA, IPB, tcp(50001, 80, 0x18, ascii('GET /index.html HTTP/1.1\r\nHost: a\r\n\r\n'))));
    expect(parsePcap(pcap([http])).packets[0]).toMatchObject({ proto: 'HTTP', info: 'GET /index.html HTTP/1.1' });
  });
  it('reports truncation explicitly instead of silently capping', () => {
    const frames = Array.from({ length: 20000 }, () => synFrame());
    const all = parsePcap(pcap(frames));
    expect(all.packetCount).toBe(20000);
    expect(all.truncated).toBe(false);
    const cut = parsePcap(pcap(frames), 5000);
    expect(cut).toMatchObject({ packetCount: 5000, totalPackets: 20000, truncated: true });
  });
  it('gives clear errors or partial decode for garbage and truncated input', () => {
    expect(() => parsePcap(new Uint8Array(100).buffer)).toThrow(/Not a pcap/);
    expect(() => parsePcap(new Uint8Array(4).buffer)).toThrow(/too small/);
    const good = new Uint8Array(pcap([dnsFrame(), tlsFrame()]));
    const r = parsePcap(good.slice(0, good.length - 10));
    expect(r.packetCount).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
    const ng = new Uint8Array(pcapng([dnsFrame(), tlsFrame()]));
    const r2 = parsePcap(ng.slice(0, ng.length - 10));
    expect(r2.packetCount).toBe(1);
    expect(r2.warnings.length).toBeGreaterThan(0);
    expect(() => parsePcap(pcap([B(1, 2, 3)]))).not.toThrow();
  });
});

describe('filter, summaries, export', () => {
  const pk = parsePcap(pcap([dnsFrame(), tlsFrame(), synFrame(), synFrame()])).packets;
  it('filter parser', () => {
    const n = (f) => pk.filter(compileFilter(f)).length;
    expect(n('')).toBe(4);
    expect(n('tcp')).toBe(3);
    expect(n('udp')).toBe(1);
    expect(n('dns')).toBe(1);
    expect(n('port 443')).toBe(3);
    expect(n('host 10.0.0.2')).toBe(4);
    expect(n('host 10.0.0.9')).toBe(0);
    expect(n('tcp and port 53')).toBe(0);
    expect(n('example.com')).toBe(1);
  });
  it('conversation totals match the packet list', () => {
    const c = conversations(pk);
    expect(c.reduce((n, x) => n + x.packets, 0)).toBe(pk.length);
    expect(c.reduce((n, x) => n + x.bytes, 0)).toBe(pk.reduce((n, p) => n + p.origlen, 0));
    expect(c.find((x) => x.proto === 'TCP').packets).toBe(3);
    expect(protocolHierarchy(pk).reduce((n, x) => n + x.packets, 0)).toBe(pk.length);
  });
  it('csv and filtered pcap round trip', () => {
    expect(packetsToCsv(pk).trim().split('\r\n')).toHaveLength(5);
    const tcpOnly = pk.filter(compileFilter('tcp'));
    const out = writePcap(tcpOnly);
    expect(out.written).toBe(3);
    const back = parsePcap(out.bytes);
    expect(back.packetCount).toBe(3);
    expect(back.packets[0].info).toBe(tcpOnly[0].info);
  });
  it('detail pane gets a layer tree', () => {
    expect(decodePacketDetail(pk[0]).map((l) => l.name)).toEqual(['Frame', 'Ethernet', 'IPv4', 'UDP', 'DNS']);
  });
});
