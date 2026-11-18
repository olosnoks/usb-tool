import { describe, it, expect } from 'vitest';
import {
  parseHex, toHex, parseAtr, fiDiToBaud, swInfo, insName, decodeCommandApdu, decodeResponseApdu,
  parseTrace, parseTlv, tagName, EMV_TAGS, PIV_TAGS, KNOWN_AIDS, buildApdu, buildSelectByAid,
  buildGetResponse, buildReadRecord, buildGetData, VERIFY_NOTE, EXAMPLES,
} from '../src/utils/smartcardTools.js';

const rev = (b) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };

describe('parseHex', () => {
  it('accepts spaces, colons, 0x prefixes and mixed case', () => {
    expect(toHex(parseHex('3b 8F:80,0x01'))).toBe('3B 8F 80 01');
    expect(toHex(parseHex('3b8f80'))).toBe('3B 8F 80');
    expect(toHex(parseHex(''))).toBe('');
  });
  it('rejects odd length and non-hex', () => {
    expect(() => parseHex('3B8')).toThrow(/odd/);
    expect(() => parseHex('3G')).toThrow(/Not a hex/);
  });
});

describe('ATR (ISO 7816-3)', () => {
  it('parses a T=0 only ATR with 14 historical bytes and no TCK', () => {
    const a = parseAtr('3B 6E 00 00 80 31 80 66 B1 84 0C 01 6E 01 83 00 90 00');
    expect(a.ok).toBe(true);
    expect(a.convention).toBe('direct');
    expect(a.K).toBe(14);
    expect(a.protocols).toEqual([]);
    expect(a.tck.required).toBe(false);
    expect(a.historical.hex).toBe('80 31 80 66 B1 84 0C 01 6E 01 83 00 90 00');
    expect(a.historical.category).toBe(0x80);
    expect(a.historical.compactTlv).toEqual([
      { tag: 3, len: 1, value: '80' },
      { tag: 6, len: 6, value: 'B1 84 0C 01 6E 01' },
      { tag: 8, len: 3, value: '00 90 00' },
    ]);
    expect(a.fiDi.baud).toBe(9600);
    expect(a.fiDi.defaulted).toBe(true);
  });

  it('decodes TA1 (FI/DI) and T=1 with a TCK that XORs to zero', () => {
    const a = parseAtr(EXAMPLES.atrT1);
    expect(a.ok).toBe(true);
    expect(a.interface.map((g) => g.TA)).toEqual([0x11, null]);
    expect(a.protocols).toEqual([1, 1]); // TD1 and TD2 both indicate T=1
    expect(a.tck.required).toBe(true);
    expect(a.tck.present).toBe(true);
    expect(a.tck.ok).toBe(true);
    expect(a.historical.hex).toBe('AA BB CC DD EE');
    expect(a.fiDi).toMatchObject({ FI: 1, DI: 1, F: 372, D: 1, baud: 9600, defaulted: false });
  });

  it('flags a bad TCK', () => {
    const bad = parseAtr('3B 95 11 81 01 AA BB CC DD EE 00');
    expect(bad.ok).toBe(false);
    expect(bad.tck.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/TCK check failed/);
  });

  it('recognises the PC/SC pseudo-ATR for a contactless tag', () => {
    const a = parseAtr(EXAMPLES.trace.split('\n')[0].replace(/^<<\s*/, ''));
    expect(a.ok).toBe(true);
    expect(a.protocols).toEqual([0, 1]);
    expect(a.tck.ok).toBe(true);
    expect(a.patterns.map((p) => p.id)).toContain('pcsc-pseudo-atr');
    expect(a.historical.category).toBe(0x80);
  });

  it('reports truncation and bad TS', () => {
    const t = parseAtr('3B 6E 00');
    expect(t.ok).toBe(false);
    expect(t.errors.join(' ')).toMatch(/truncated|historical/);
    const ts = parseAtr('3C 6E 00');
    expect(ts.ok).toBe(false);
    expect(ts.errors[0]).toMatch(/TS must be 3B/);
  });

  it('parses the inverse convention the same as the direct one', () => {
    const direct = parseAtr(EXAMPLES.atrT1);
    const raw = parseHex(EXAMPLES.atrT1);
    const inverse = Uint8Array.from(raw, (b, i) => (i === 0 ? 0x3f : rev(b)));
    const inv = parseAtr(inverse);
    expect(inv.convention).toBe('inverse');
    expect(inv.ok).toBe(true);
    expect(inv.protocols).toEqual(direct.protocols);
    expect(inv.historical.hex).toBe(toHex(inverse.slice(inverse.length - 6, inverse.length - 1)));
    expect(inv.fiDi.baud).toBe(9600);
  });

  it('computes FI/DI baud estimates and leaves untabulated Fi as null', () => {
    expect(fiDiToBaud(0x11)).toMatchObject({ F: 372, D: 1, baud: 9600 });
    expect(fiDiToBaud(0x96)).toMatchObject({ F: 512, D: 32, baud: 223200 });
    expect(fiDiToBaud(0xb1)).toMatchObject({ F: null, baud: null });
  });
});

describe('status words', () => {
  it('maps the common SW values', () => {
    expect(swInfo(0x90, 0x00)).toMatchObject({ sw: '90 00', kind: 'success' });
    expect(swInfo(0x61, 0x22).meaning).toMatch(/34 more response byte/);
    expect(swInfo(0x61, 0x00).meaning).toMatch(/256 more/);
    expect(swInfo(0x6c, 0x10).meaning).toMatch(/exact length is 16/);
    expect(swInfo(0x63, 0xc3).meaning).toMatch(/Counter 3/);
    expect(swInfo(0x6a, 0x82).meaning).toMatch(/not found/);
    expect(swInfo(0x69, 0x82).meaning).toMatch(/Security status not satisfied/);
    expect(swInfo(0x6d, 0x00).meaning).toMatch(/INS/);
    expect(swInfo(0x6e, 0x00).meaning).toMatch(/CLA/);
    expect(swInfo(0x91, 0x05).meaning).toMatch(/5 byte/);
    expect(swInfo(0x12, 0x34).kind).toBe('error');
  });
});

describe('command APDU decode (cases 1-4, short and extended)', () => {
  it('case 1: header only', () => {
    const c = decodeCommandApdu('00 A4 04 00');
    expect(c).toMatchObject({ ok: true, case: 1, cla: '00', ins: 'A4', p1: '04', p2: '00' });
    expect(c.insInfo.name).toMatch(/SELECT/);
    expect(c.le).toBeNull();
  });
  it('case 2 short: Le, with 00 meaning 256', () => {
    expect(decodeCommandApdu('00 B0 00 00 10')).toMatchObject({ case: 2, le: 16, encoding: 'short' });
    expect(decodeCommandApdu('00 B0 00 00 00').le).toBe(256);
  });
  it('case 3 short: Lc and data', () => {
    const c = decodeCommandApdu('00 A4 04 00 08 A0 00 00 03 08 00 00 10');
    expect(c).toMatchObject({ case: 3, lc: 8, le: null, encoding: 'short' });
    expect(toHex(c.data)).toBe('A0 00 00 03 08 00 00 10');
  });
  it('case 4 short: Lc, data and Le', () => {
    const c = decodeCommandApdu('00 A4 04 00 08 A0 00 00 03 08 00 00 10 00');
    expect(c).toMatchObject({ case: 4, lc: 8, le: 256 });
    expect(toHex(c.data)).toBe('A0 00 00 03 08 00 00 10');
  });
  it('case 2 extended: 00 + 2-byte Le, 0000 means 65536', () => {
    expect(decodeCommandApdu('00 B0 00 00 00 01 00')).toMatchObject({ case: 2, le: 256, encoding: 'extended' });
    expect(decodeCommandApdu('00 B0 00 00 00 00 00').le).toBe(65536);
  });
  it('case 3 extended: 00 + 2-byte Lc + data', () => {
    expect(decodeCommandApdu('00 D6 00 00 00 00 03 AA BB CC')).toMatchObject({ case: 3, lc: 3, encoding: 'extended' });
  });
  it('case 4 extended: Lc, data, then 2-byte Le', () => {
    const c = decodeCommandApdu('00 D6 00 00 00 00 03 AA BB CC 01 00');
    expect(c).toMatchObject({ case: 4, lc: 3, le: 256, encoding: 'extended' });
    expect(toHex(c.data)).toBe('AA BB CC');
  });
  it('rejects too-short and ambiguous input', () => {
    expect(decodeCommandApdu('00 A4 04').ok).toBe(false);
    expect(decodeCommandApdu('00 A4 04 00 00 01').ok).toBe(false);
    expect(decodeCommandApdu('00 A4 04 00 08 A0 00').ok).toBe(false);
  });
  it('describes the CLA secure-messaging and channel bits', () => {
    const c = decodeCommandApdu('0C B0 00 00 04');
    expect(c.classInfo.secureMessaging).toMatch(/header authenticated/);
    expect(decodeCommandApdu('81 20 00 00').classInfo.kind).toMatch(/Proprietary/);
    expect(decodeCommandApdu('01 A4 04 00').classInfo.logicalChannel).toBe(1);
  });
  it('lists family names for common INS values', () => {
    expect(insName(0xa8).name).toMatch(/GET PROCESSING OPTIONS/);
    expect(insName(0x50).families).toMatch(/GlobalPlatform/);
    expect(insName(0x47).families).toMatch(/PIV/);
    expect(insName(0x99).name).toMatch(/Unknown/);
  });
});

describe('response APDU decode', () => {
  it('splits data and SW', () => {
    const r = decodeResponseApdu('6F 02 AB CD 90 00');
    expect(r.dataHex).toBe('6F 02 AB CD');
    expect(r.sw.kind).toBe('success');
    expect(decodeResponseApdu('6A 82').data.length).toBe(0);
    expect(decodeResponseApdu('90').ok).toBe(false);
  });
});

describe('trace log parser', () => {
  it('builds a conversation from the sample trace', () => {
    const t = parseTrace(EXAMPLES.trace);
    expect(t.steps.map((s) => s.dir)).toEqual(['atr', 'cmd', 'rsp', 'cmd', 'rsp', 'cmd', 'rsp', 'cmd', 'rsp']);
    expect(t.commands).toBe(4);
    expect(t.steps[1].apdu.insInfo.name).toMatch(/SELECT/);
    expect(t.steps[2].rapdu.sw.meaning).toMatch(/34 more/);
    expect(t.steps[4].rapdu.dataHex.startsWith('6F 20 84 0B')).toBe(true);
    expect(t.steps[6].rapdu.sw.meaning).toMatch(/Counter 2/);
    expect(t.steps[8].rapdu.sw.meaning).toMatch(/not found/);
  });
  it('ignores timestamps, trailing comments and unmarked lines', () => {
    const t = parseTrace('[00:00.001] >> 00 C0 00 00 12 (18 bytes requested)\nhello\n[00:00.002] << 90 00');
    expect(t.steps.length).toBe(2);
    expect(t.steps[0].hex).toBe('00 C0 00 00 12');
    expect(t.steps[1].rapdu.sw.sw).toBe('90 00');
    expect(t.ignored).toBe(1);
  });
  it('keeps a command with no response and notes it', () => {
    const t = parseTrace('>> 00 A4 04 00\n>> 00 B0 00 00 10');
    expect(t.steps.length).toBe(2);
    expect(t.steps.every((s) => s.noResponse)).toBe(true);
  });
});

describe('BER-TLV decoder', () => {
  it('decodes a constructed EMV-style record with names from the dictionary', () => {
    const { nodes, errors } = parseTlv(EXAMPLES.tlv);
    expect(errors).toEqual([]);
    expect(nodes.length).toBe(1);
    const root = nodes[0];
    expect(root.tag).toBe('70');
    expect(root.constructed).toBe(true);
    expect(root.children.map((c) => c.tag)).toEqual(['5A', '5F24', '9F36']);
    expect(root.children[0].name).toBe('Application Primary Account Number (PAN)');
    expect(root.children[2].name).toBe('Application Transaction Counter (ATC)');
    expect(root.children[2].hex).toBe('00 4D');
  });
  it('handles nesting inside a constructed template', () => {
    const { nodes } = parseTlv(EXAMPLES.tlvNested);
    expect(nodes[0].tag).toBe('77');
    expect(nodes[0].children.map((c) => c.tag)).toEqual(['82', '94']);
    expect(nodes[0].children[0].name).toMatch(/Interchange Profile/);
  });
  it('reads multi-byte tags and long-form lengths', () => {
    const multi = parseTlv('9F 81 01 02 AA BB').nodes[0];
    expect(multi.tag).toBe('9F8101');
    expect(multi.length).toBe(2);
    expect(multi.name).toBeNull();

    const bytes = Uint8Array.from([0x80, 0x81, 0x80, ...Array(128).fill(0x11)]);
    const long = parseTlv(bytes).nodes[0];
    expect(long.length).toBe(128);
    expect(long.lengthEncoding).toMatch(/long/);
    expect(long.value.length).toBe(128);

    const two = Uint8Array.from([0x80, 0x82, 0x01, 0x00, ...Array(256).fill(0)]);
    expect(parseTlv(two).nodes[0].length).toBe(256);
  });
  it('skips padding at top level and reports truncation and indefinite length', () => {
    const p = parseTlv('00 00 70 02 5A 00');
    expect(p.errors).toEqual([]);
    expect(p.nodes[0].tag).toBe('70');
    expect(p.nodes[0].children[0].tag).toBe('5A');

    const trunc = parseTlv('70 10 5A 08 47 61');
    expect(trunc.errors.join(' ')).toMatch(/claims 16 bytes/);
    expect(trunc.nodes[0].truncated).toBe(true);

    const indef = parseTlv('30 80 02 01 01 00 00');
    expect(indef.errors.join(' ')).toMatch(/Indefinite length/);
  });
  it('has a dictionary of about 80 EMV tags plus PIV tags', () => {
    expect(Object.keys(EMV_TAGS).length).toBeGreaterThanOrEqual(80);
    expect(tagName('9F26')).toEqual({ name: EMV_TAGS['9f26'], dictionary: 'EMV' });
    expect(tagName('5FC105').dictionary).toBe('PIV');
    expect(tagName('FFFF')).toEqual({ name: null, dictionary: null });
    expect(PIV_TAGS['5fc102']).toMatch(/CHUID/);
  });
});

describe('AID list and APDU builder', () => {
  it('known AIDs are 5 to 16 bytes and the PPSE names are spelled correctly', () => {
    for (const a of KNOWN_AIDS) {
      const n = parseHex(a.aid).length;
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(16);
    }
    expect(KNOWN_AIDS.find((a) => a.id === 'ppse-contactless').aid).toBe(Buffer.from('2PAY.SYS.DDF01').toString('hex').toUpperCase());
    expect(KNOWN_AIDS.find((a) => a.id === 'ppse-contact').aid).toBe(Buffer.from('1PAY.SYS.DDF01').toString('hex').toUpperCase());
  });
  it('builds SELECT by AID (case 4 with Le=00)', () => {
    const piv = KNOWN_AIDS.find((a) => a.id === 'piv').aid;
    const s = buildSelectByAid(piv);
    expect(s.hex).toBe('00A404000B' + piv + '00');
    expect(decodeCommandApdu(s.hex)).toMatchObject({ case: 4, lc: 11, le: 256 });
  });
  it('builds GET RESPONSE, READ RECORD and GET DATA', () => {
    expect(buildGetResponse(0x22).hex).toBe('00C0000022');
    expect(buildReadRecord({ record: 1, sfi: 1, le: 0 }).hex).toBe('00B2010C00');
    expect(buildReadRecord({ record: 3, sfi: 0, le: 0x20 }).hex).toBe('00B2030420');
    expect(buildGetData({ tag: '9F7F', le: 0 }).hex).toBe('00CA9F7F00');
    expect(() => buildGetData({ tag: '5FC102' })).toThrow(/1 or 2 bytes/);
    expect(() => buildReadRecord({ record: 0 })).toThrow();
  });
  it('switches to extended length when data or Le need it, and round-trips', () => {
    const big = new Uint8Array(300).fill(0xab);
    const b = buildApdu({ cla: 0, ins: 0xd6, p1: 0, p2: 0, data: big });
    expect(b.encoding).toBe('extended');
    expect(b.bytes.slice(4, 7)).toEqual(Uint8Array.from([0x00, 0x01, 0x2c]));
    expect(decodeCommandApdu(b.hex)).toMatchObject({ case: 3, lc: 300 });

    const ext = buildApdu({ cla: 0, ins: 0xb0, p1: 0, p2: 0, le: 65536 });
    expect(ext.hex).toBe('00B00000000000');
    expect(decodeCommandApdu(ext.hex).le).toBe(65536);
    expect(() => buildApdu({ data: new Uint8Array(70000) })).toThrow(/65535|too long|extended/i);
  });
  it('does not build a VERIFY template; the note says so', () => {
    expect(VERIFY_NOTE).toMatch(/does not build PIN APDUs/);
  });
});

describe('examples', () => {
  it('every example parses without throwing', () => {
    expect(() => parseAtr(EXAMPLES.atr)).not.toThrow();
    expect(() => parseAtr(EXAMPLES.atrT1)).not.toThrow();
    expect(() => parseTrace(EXAMPLES.trace)).not.toThrow();
    expect(parseTlv(EXAMPLES.tlv).errors).toEqual([]);
    expect(parseTlv(EXAMPLES.tlvNested).errors).toEqual([]);
    expect(decodeCommandApdu(EXAMPLES.apdu).ok).toBe(true);
  });
});
