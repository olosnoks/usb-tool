import { describe, it, expect } from 'vitest';
import { improvFrame, improvRpc, improvWifiSettings, improvStrings, ImprovParser, IMPROV_TYPE, IMPROV_CMD,
  parseCwlapLine, parseMicropythonScan } from '../src/utils/improvSerial';

const enc = new TextEncoder();
const result = (cmd, strings) => { const s = improvStrings(strings); return improvFrame(IMPROV_TYPE.RESULT, [cmd, s.length, ...s]); };

describe('Improv serial', () => {
  it('builds the scan command per the spec (command, length, checksum)', () => {
    const f = improvRpc(IMPROV_CMD.SCAN);
    expect(Array.from(f.slice(0, 6))).toEqual(Array.from(enc.encode('IMPROV')));
    expect(Array.from(f.slice(6))).toEqual([0x01, 0x03, 0x02, 0x04, 0x00, (Array.from(f.slice(0, 11)).reduce((a, b) => a + b, 0)) & 0xff]);
  });

  it('builds Wi-Fi settings with a length byte after the command', () => {
    const f = improvWifiSettings('Lab', 'pw12');
    // data: 01 | len(9) | 03 'Lab' | 04 'pw12'
    expect(Array.from(f.slice(9, 9 + f[8]))).toEqual([0x01, 9, 3, ...enc.encode('Lab'), 4, ...enc.encode('pw12')]);
  });

  it('parses packets out of log noise, across chunks, and rejects bad checksums', () => {
    const p = new ImprovParser();
    const state = improvFrame(IMPROV_TYPE.STATE, [0x02]);
    const bad = improvFrame(IMPROV_TYPE.STATE, [0x04]); bad[bad.length - 1] ^= 0xff;
    const scan1 = result(IMPROV_CMD.SCAN, ['Home', '-52', 'YES']);
    const all = Uint8Array.from([...enc.encode('I (123) boot: log line\n'), ...state, ...bad, ...enc.encode('IMPRO'), ...scan1, 0x0a]);
    const out = [...p.push(all.subarray(0, 20)), ...p.push(all.subarray(20, 47)), ...p.push(all.subarray(47))];
    expect(out).toEqual([
      { kind: 'state', state: 0x02 },
      { kind: 'result', command: IMPROV_CMD.SCAN, strings: ['Home', '-52', 'YES'] }
    ]);
  });

  it('decodes error packets', () => {
    const [e] = new ImprovParser().push(improvFrame(IMPROV_TYPE.ERROR, [0x03]));
    expect(e).toEqual({ kind: 'error', code: 3, message: 'unable to connect to the network' });
  });

  it('parses ESP-AT and MicroPython scan replies', () => {
    expect(parseCwlapLine('+CWLAP:(3,"Cafe \\"Net\\"",-61,"aa:bb:cc:dd:ee:ff",6,-12,0)')).toEqual({ ssid: 'Cafe "Net"', rssi: -61, secure: true });
    expect(parseCwlapLine('+CWLAP:(0,"Open",-80,"aa:bb:cc:dd:ee:00",1)')).toEqual({ ssid: 'Open', rssi: -80, secure: false });
    expect(parseCwlapLine('OK')).toBe(null);
    const mp = parseMicropythonScan("SCAN_RES: [(b'Home', b'\\x12\\x34V\\x78\\x9a\\xbc', 6, -48, 3, False), (b'Guest', b'\\x00\\x11\"3DU', 11, -77, 0, False)]");
    expect(mp).toEqual([{ ssid: 'Home', rssi: -48, secure: true }, { ssid: 'Guest', rssi: -77, secure: false }]);
  });
});
