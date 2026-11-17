import { describe, it, expect } from 'vitest';
import { parsePcap } from '../src/utils/pcapReader';
import { generatePcapBuffer } from '../src/utils/pcapExporter';
import { recordToFrame, classifyFrame, frameToCsvRow, framesToCsv, framesToPcap, serialToFrame } from '../src/utils/packetFrames';

const flat = (a) => a.flatMap((x) => (Array.isArray(x) || ArrayBuffer.isView(x) ? flat([...x]) : [x]));
const bytes = (...a) => Uint8Array.from(flat(a));
const mac = (n) => [0x02, 0, 0, 0, 0, n];
const rt = (freq, rssi) => bytes(0, 0, 13, 0, 0x28, 0, 0, 0, freq & 255, freq >> 8, 0xa0, 0, (rssi + 256) & 255);

function beacon(ssid, bssid = 0xaa) {
  const s = [...ssid].map((c) => c.charCodeAt(0));
  return bytes(rt(2437, -50), 0x80, 0, 0, 0, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    mac(bssid), mac(bssid), 0, 0, new Array(12).fill(0), 0, s.length, s, 3, 1, 6);
}
function eapolM1() {
  const llc = [0xaa, 0xaa, 3, 0, 0, 0, 0x88, 0x8e];
  const eapol = [2, 3, 0, 95, 2, 0x00, 0x8a, 0, 16]; // keyinfo 0x008a: ack + pairwise
  return bytes(rt(2437, -54), 0x08, 0x02, 0, 0, mac(1), mac(2), mac(2), 0, 0, llc, eapol, new Array(20).fill(0));
}
const capture = (pkts) => generatePcapBuffer(pkts.map((d, i) => ({ data: d, timestamp: 1700000000000 + i * 250 })));

describe('classifyFrame', () => {
  it('classifies beacon and probe request', () => {
    expect(classifyFrame(bytes(0x80, 0, new Array(30).fill(0)))).toMatchObject({ type: 'Management', subtype: 'Beacon' });
    expect(classifyFrame(bytes(0x40, 0, new Array(30).fill(0)))).toMatchObject({ subtype: 'Probe Request' });
  });
  it('detects EAPOL message 1', () => {
    const f = eapolM1();
    expect(classifyFrame(f, 13)).toMatchObject({ type: 'Data', subtype: 'EAPOL Key', eapol: 1, protocol: 'EAPOL 4-Way #1' });
  });
  it('returns null for runt frames', () => {
    expect(classifyFrame(bytes(1, 2, 3))).toBeNull();
  });
});

describe('recordToFrame', () => {
  const { packetRecords } = parsePcap(capture([beacon('Lab_Net'), eapolM1()]));
  const frames = packetRecords.map((r, i) => recordToFrame(r, i + 1, packetRecords[0].timestamp.timeMs));

  it('decodes beacon subtype, SSID, BSSID, channel, RSSI', () => {
    expect(frames[0]).toMatchObject({ subtype: 'Beacon', ssid: 'Lab_Net', bssid: '02:00:00:00:00:AA', channel: 6, rssi: -50, origin: 'pcap' });
    expect(frames[0].time).toBe('00:00:00.000');
  });
  it('decodes EAPOL and relative time', () => {
    expect(frames[1]).toMatchObject({ protocol: 'EAPOL 4-Way #1', type: 'Data', source: '02:00:00:00:00:02', dest: '02:00:00:00:00:01' });
    expect(frames[1].time).toBe('00:00:00.250');
  });
});

describe('export', () => {
  it('pcap round trip keeps the frame count', () => {
    const { packetRecords } = parsePcap(capture([beacon('A'), beacon('B'), eapolM1()]));
    const frames = packetRecords.map((r, i) => recordToFrame(r, i + 1));
    const { bytes: out, count } = framesToPcap(frames);
    expect(count).toBe(3);
    expect(parsePcap(out).packetRecords).toHaveLength(3);
  });
  it('csv has one row per frame plus a header and guards formulas', () => {
    const f = serialToFrame(bytes([...'=1+1'].map((c) => c.charCodeAt(0))), 1, 0);
    const csv = framesToCsv([f, f]).trim().split('\r\n');
    expect(csv).toHaveLength(3);
    expect(frameToCsvRow(f)).toHaveLength(13);
    expect(csv[1]).toContain("'=1+1");
  });
  it('serial frames are not exported as packets', () => {
    expect(framesToPcap([serialToFrame(bytes(65, 10), 1, 0)]).count).toBe(0);
  });
});

describe('pcapReader errors', () => {
  it('rejects non-pcap bytes', () => {
    expect(() => parsePcap(new Uint8Array(64))).toThrow(/magic/i);
  });
});
