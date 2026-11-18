import { describe, it, expect } from 'vitest';
import {
  createAtEngine, parseFinalLine, cmeErrorText, cmsErrorText, splitAtFields,
  csqToDbm, csqBerText, parseCsq, parseCesq, cesqRsrqDb, cesqRsrpDbm,
  parseQeng, parseCpsi, parseRegistration, parseCops, parseCgdcont, buildCgdcont,
  parseCmgl, parseCmgr, parseCmti, parseCmgs, validateSmsNumber, smsPartCount,
  parseGnssCoord, parseCgpsinfo, parseQgpsloc, riskyReason, parseIccid, parseImei,
  detectFamily, parseQuickCommandText,
} from '../src/utils/atModem.js';

const enc = (s) => new TextEncoder().encode(s);

/** A fake modem: records every write and answers each one with the next scripted reply (async). */
function fakeModem(replies) {
  const writes = [];
  let engine = null;
  const write = (bytes) => {
    writes.push(new TextDecoder().decode(bytes));
    const reply = replies.shift();
    if (reply !== undefined) queueMicrotask(() => engine.feed(reply));
  };
  return {
    writes,
    attach(e) { engine = e; },
    write,
  };
}

describe('AT final result lines', () => {
  it('recognises OK, ERROR, and the call-state finals', () => {
    expect(parseFinalLine('OK')).toMatchObject({ final: 'OK', ok: true, error: null });
    expect(parseFinalLine('ERROR')).toMatchObject({ final: 'ERROR', ok: false });
    expect(parseFinalLine('NO CARRIER')).toMatchObject({ final: 'NO CARRIER', ok: false });
    expect(parseFinalLine('+CSQ: 1,2')).toBeNull();
  });

  it('decodes +CME ERROR numeric codes and quoted text', () => {
    expect(parseFinalLine('+CME ERROR: 10').error).toMatchObject({ type: 'CME', code: 10, text: 'SIM not inserted' });
    expect(parseFinalLine('+CME ERROR: "no network service"').error).toMatchObject({ type: 'CME', code: null, text: 'no network service' });
  });

  it('decodes +CMS ERROR codes', () => {
    expect(parseFinalLine('+CMS ERROR: 322').error).toMatchObject({ type: 'CMS', code: 322, text: 'Memory full' });
  });
});

describe('error code tables', () => {
  it('has the common CME and CMS entries and marks unknown ones', () => {
    expect(cmeErrorText(11)).toBe('SIM PIN required');
    expect(cmeErrorText(30)).toBe('No network service');
    expect(cmeErrorText(999)).toBe('Unknown CME error 999');
    expect(cmsErrorText(330)).toBe('SMSC address unknown');
    expect(cmsErrorText(4242)).toBe('Unknown CMS error 4242');
  });
});

describe('field splitting', () => {
  it('keeps commas inside quotes and strips the quotes', () => {
    expect(splitAtFields('1,"REC READ","+1555","","24/11/10,12:00:00+04"')).toEqual(
      ['1', 'REC READ', '+1555', '', '24/11/10,12:00:00+04'],
    );
  });
});

describe('signal: CSQ', () => {
  it('maps RSSI index to dBm with the 3GPP endpoints', () => {
    expect(csqToDbm(0)).toBe(-113);
    expect(csqToDbm(1)).toBe(-111);
    expect(csqToDbm(23)).toBe(-67);
    expect(csqToDbm(31)).toBe(-51);
    expect(csqToDbm(99)).toBeNull();
    expect(csqToDbm(40)).toBeNull();
  });

  it('maps BER index to the RXQUAL percentage ranges', () => {
    expect(csqBerText(0)).toBe('< 0.2%');
    expect(csqBerText(7)).toBe('>= 12.8%');
    expect(csqBerText(99)).toBe('unknown');
  });

  it('parses a reply and its quality', () => {
    expect(parseCsq('+CSQ: 23,0')).toMatchObject({ rssi: 23, dbm: -67, ber: 0, berText: '< 0.2%', quality: 'excellent' });
    expect(parseCsq('+CSQ: 99,99')).toMatchObject({ rssi: 99, dbm: null, berText: 'unknown', quality: 'unknown' });
    expect(parseCsq('OK')).toBeNull();
  });
});

describe('signal: CESQ', () => {
  it('converts LTE RSRP and RSRQ indexes and marks 255 unknown', () => {
    expect(cesqRsrpDbm(52)).toBe(-89);
    expect(cesqRsrqDb(20)).toBeCloseTo(-10, 5);
    expect(cesqRsrpDbm(255)).toBeNull();
    expect(cesqRsrqDb(255)).toBeNull();
    expect(parseCesq('+CESQ: 99,99,255,255,20,52')).toMatchObject({ rxlev: 99, rxlevDbm: null, rsrq: 20, rsrqDb: -10, rsrp: 52, rsrpDbm: -89 });
    expect(parseCesq('+CESQ: 99,99,255,255,255,255')).toMatchObject({ rsrpDbm: null, rsrqDb: null });
  });
});

describe('cell info: QENG and CPSI', () => {
  it('parses a Quectel LTE serving cell', () => {
    const r = parseQeng('+QENG: "servingcell","NOCONN","LTE","FDD",460,00,2E4F2A1,350,1300,3,5,5,AB12,-95,-9,-65,15');
    expect(r).toMatchObject({
      rat: 'LTE', mcc: '460', mnc: '00', cellId: '2E4F2A1', pci: 350, earfcn: 1300,
      band: 'B3', tac: 'AB12', rsrp: -95, rsrq: -9, rssi: -65, sinr: 15,
    });
  });

  it('ignores neighbour-cell rows and reports a search state', () => {
    expect(parseQeng('+QENG: "neighbourcell intra","LTE",1300,350,-100,-10')).toBeNull();
    expect(parseQeng('+QENG: "servingcell","SEARCH"')).toMatchObject({ searching: true });
  });

  it('parses a SIMCom LTE CPSI line', () => {
    const r = parseCpsi('+CPSI: LTE,Online,460-00,0x1F6B,93632001,260,EUTRAN-BAND8,3050,5,5,-65,-10,-43,15');
    expect(r).toMatchObject({
      system: 'LTE', operation: 'Online', mcc: '460', mnc: '00', tac: '0x1F6B', cellId: '93632001',
      pci: 260, band: 'B8', earfcn: 3050, dlBw: 5, ulBw: 5, rsrp: -65, rsrq: -10, rssi: -43,
    });
  });

  it('reports NO SERVICE from CPSI', () => {
    expect(parseCpsi('+CPSI: NO SERVICE,Online')).toMatchObject({ noService: true });
  });
});

describe('registration and operator', () => {
  it('decodes a query reply (n, stat, lac, ci)', () => {
    expect(parseRegistration('+CREG: 0,1', { query: true })).toMatchObject({ kind: 'CREG', n: 0, stat: 1, registered: true });
    expect(parseRegistration('+CGREG: 1,1,"1A2B","3C4D",7', { query: true })).toMatchObject({
      kind: 'CGREG', n: 1, stat: 1, lac: '1A2B', ci: '3C4D', act: 7, registered: true,
    });
  });

  it('decodes an unsolicited reply (stat only)', () => {
    expect(parseRegistration('+CEREG: 5')).toMatchObject({ kind: 'CEREG', stat: 5, statusText: 'registered, roaming', registered: true });
    expect(parseRegistration('+CEREG: 2')).toMatchObject({ stat: 2, statusText: 'not registered, searching', registered: false });
    expect(parseRegistration('+CREG: 3')).toMatchObject({ statusText: 'registration denied' });
    expect(parseRegistration('OK')).toBeNull();
  });

  it('parses COPS with operator and access technology', () => {
    expect(parseCops('+COPS: 0,0,"T-Mobile",7')).toMatchObject({ mode: 0, operator: 'T-Mobile', act: 7, actText: 'E-UTRAN (LTE)' });
    expect(parseCops('+COPS: 0')).toMatchObject({ mode: 0, operator: null, act: null });
  });
});

describe('APN and PDP', () => {
  it('parses +CGDCONT? lines', () => {
    expect(parseCgdcont(['+CGDCONT: 1,"IP","internet","0.0.0.0",0,0,0,0', 'OK'])).toEqual([
      { cid: 1, type: 'IP', apn: 'internet', addr: '0.0.0.0' },
    ]);
  });

  it('builds a set command and rejects bad input', () => {
    expect(buildCgdcont(1, 'IP', 'fast.t-mobile.com')).toEqual({ cmd: 'AT+CGDCONT=1,"IP","fast.t-mobile.com"' });
    expect(buildCgdcont(0, 'IP', 'x').error).toMatch(/1 to 16/);
    expect(buildCgdcont(1, 'PPP', 'x').error).toMatch(/IPV4V6/);
    expect(buildCgdcont(1, 'IP', 'a"b').error).toMatch(/quotes/);
  });
});

describe('SMS (text mode)', () => {
  it('parses a CMGL listing with multi-line bodies', () => {
    const msgs = parseCmgl([
      '+CMGL: 1,"REC UNREAD","+15551234567","","24/11/10,12:00:00+04"',
      'Hello there',
      '+CMGL: 2,"REC READ","+15557654321","","24/11/10,13:05:00+04"',
      'Line one',
      '',
      'Line two',
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ index: 1, status: 'REC UNREAD', sender: '+15551234567', timestamp: '24/11/10,12:00:00+04', body: 'Hello there' });
    expect(msgs[1]).toMatchObject({ index: 2, status: 'REC READ', body: 'Line one\n\nLine two' });
  });

  it('parses a CMGR read reply without an index', () => {
    expect(parseCmgr(['+CMGR: "REC READ","+15551234567",,"24/11/10,12:00:00+04"', 'Body text'])).toMatchObject({
      index: null, status: 'REC READ', sender: '+15551234567', body: 'Body text', timestamp: '24/11/10,12:00:00+04',
    });
    expect(parseCmgr(['OK'])).toBeNull();
  });

  it('parses +CMTI, +CMGS and validates destination numbers', () => {
    expect(parseCmti('+CMTI: "SM",3')).toEqual({ mem: 'SM', index: 3 });
    expect(parseCmgs(['+CMGS: 12'])).toBe(12);
    expect(validateSmsNumber('+15551234567')).toBeNull();
    expect(validateSmsNumber('555-1234')).toMatch(/digits/);
    expect(validateSmsNumber('')).toMatch(/Enter/);
  });

  it('counts message parts', () => {
    expect(smsPartCount('a'.repeat(160))).toBe(1);
    expect(smsPartCount('a'.repeat(161))).toBe(2);
    expect(smsPartCount('')).toBe(0);
  });
});

describe('GNSS', () => {
  it('converts ddmm.mmmm with hemisphere to signed decimal degrees', () => {
    expect(parseGnssCoord('3149.6781', 'N')).toBeCloseTo(31.827968, 5);
    expect(parseGnssCoord('11711.9342', 'W')).toBeCloseTo(-117.198903, 5);
    expect(parseGnssCoord('31.1234')).toBeCloseTo(31.1234, 6);
    expect(parseGnssCoord('-120.5')).toBeCloseTo(-120.5, 6);
    expect(parseGnssCoord('')).toBeNull();
  });

  it('parses SIMCom +CGPSINFO with and without a fix', () => {
    const r = parseCgpsinfo('+CGPSINFO: 3149.6781,N,11711.9342,W,101120,103000.0,250.5,0.5,90.0');
    expect(r.fix).toBe(true);
    expect(r.lat).toBeCloseTo(31.827968, 5);
    expect(r.lon).toBeCloseTo(-117.198903, 5);
    expect(r.date).toBe('101120');
    expect(r.alt).toBe(250.5);
    expect(parseCgpsinfo('+CGPSINFO: ,,,,,,,,')).toEqual({ fix: false });
  });

  it('parses Quectel +QGPSLOC', () => {
    expect(parseQgpsloc('+QGPSLOC: 064752.0,31.1234,121.5678,0.9,50.1,3,0.0,0.0,0.0,101120,08')).toMatchObject({
      fix: true, lat: 31.1234, lon: 121.5678, fixType: '3', satellites: 8, alt: 50.1,
    });
  });
});

describe('safety, identity and helpers', () => {
  it('flags commands that drop the radio, reset, or delete SMS in bulk', () => {
    expect(riskyReason('AT+CFUN=1,1')).toMatch(/radio/);
    expect(riskyReason('AT+CMGD=1,4')).toMatch(/bulk/);
    expect(riskyReason('AT+CMGD=3')).toMatch(/deletes an SMS/);
    expect(riskyReason('AT+CSQ')).toBeNull();
  });

  it('reads ICCID, IMEI and guesses the family', () => {
    expect(parseIccid(['+QCCID: 89014103211118510720'])).toBe('89014103211118510720');
    expect(parseIccid(['+CCID: 89014103211118510720'])).toBe('89014103211118510720');
    expect(parseImei(['867530012345678'])).toBe('867530012345678');
    expect(detectFamily('Quectel', 'EC25')).toBe('quectel');
    expect(detectFamily('SIMCOM_Ltd', 'SIMCOM_SIM7600E')).toBe('simcom');
    expect(detectFamily('u-blox', 'SARA-R410M')).toBe('ublox');
    expect(detectFamily('', '')).toBe('unknown');
  });

  it('parses custom quick-command text', () => {
    expect(parseQuickCommandText('AT\n# comment\n\n AT+CSQ \r\n')).toEqual(['AT', 'AT+CSQ']);
  });
});

describe('AT engine', () => {
  it('sends a command and collects the reply lines, dropping the echo', async () => {
    const modem = fakeModem(['AT+CSQ\r\r\n+CSQ: 23,0\r\n\r\nOK\r\n']);
    const engine = createAtEngine({ write: modem.write });
    modem.attach(engine);
    const r = await engine.send('AT+CSQ');
    expect(modem.writes).toEqual(['AT+CSQ\r']);
    expect(r).toMatchObject({ ok: true, final: 'OK', timedOut: false, lines: ['+CSQ: 23,0'] });
  });

  it('handles a reply split across chunks', async () => {
    const engine = createAtEngine({ write: () => {
      queueMicrotask(() => {
        engine.feed(enc('+CS'));
        engine.feed(enc('Q: 2'));
        engine.feed(enc('3,0\r'));
        engine.feed(enc('\nOK\r\n'));
      });
    } });
    const r = await engine.send('AT+CSQ', { prefixes: ['+CSQ:'] });
    expect(r.lines).toEqual(['+CSQ: 23,0']);
  });

  it('reports CME and CMS errors as failures', async () => {
    const modem = fakeModem(['AT+CPIN?\r\n+CME ERROR: 10\r\n', 'AT+CMGR=9\r\n+CMS ERROR: 321\r\n']);
    const engine = createAtEngine({ write: modem.write });
    modem.attach(engine);
    const a = await engine.send('AT+CPIN?');
    expect(a).toMatchObject({ ok: false, final: 'CME ERROR', error: { code: 10, text: 'SIM not inserted' } });
    const b = await engine.send('AT+CMGR=9');
    expect(b).toMatchObject({ ok: false, error: { type: 'CMS', code: 321 } });
  });

  it('times out when the modem stays silent', async () => {
    const engine = createAtEngine({ write: () => {} });
    const r = await engine.send('AT+CSQ', { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, timedOut: true, final: null });
  });

  it('routes unsolicited lines to onLine as URCs and keeps them out of replies', async () => {
    const urcs = [];
    const modem = fakeModem(['AT+COPS?\r\n+CREG: 1\r\n+COPS: 0,0,"Net",7\r\n\r\nOK\r\n']);
    const engine = createAtEngine({ write: modem.write, onLine: (line, isUrc) => { if (isUrc) urcs.push(line); } });
    modem.attach(engine);
    const r = await engine.send('AT+COPS?', { prefixes: ['+COPS:'] });
    expect(r.lines).toEqual(['+COPS: 0,0,"Net",7']);
    expect(urcs).toEqual(['+CREG: 1']);
    // A URC that arrives while idle is also passed to onLine.
    engine.feed('RING\r\n');
    expect(urcs).toEqual(['+CREG: 1', 'RING']);
  });

  it('runs SMS entry: waits for the "> " prompt, then sends body and Ctrl-Z', async () => {
    const modem = fakeModem(['AT+CMGS="+15551234567"\r\n> ', '\r\n+CMGS: 12\r\n\r\nOK\r\n']);
    const engine = createAtEngine({ write: modem.write });
    modem.attach(engine);
    const r = await engine.send('AT+CMGS="+15551234567"', { prompt: 'Hi there', prefixes: ['+CMGS:'] });
    expect(modem.writes).toEqual(['AT+CMGS="+15551234567"\r', 'Hi there\x1a']);
    expect(r).toMatchObject({ ok: true, lines: ['+CMGS: 12'] });
  });

  it('cancels SMS entry with ESC when the prompt never arrives', async () => {
    const writes = [];
    const engine = createAtEngine({ write: (b) => writes.push(new TextDecoder().decode(b)) });
    const r = await engine.send('AT+CMGS="+1555"', { prompt: 'x', timeoutMs: 20 });
    expect(r.timedOut).toBe(true);
    expect(writes[writes.length - 1]).toBe('\x1b');
  });

  it('runs queued commands one at a time', async () => {
    const modem = fakeModem(['AT\r\nOK\r\n', 'AT+CSQ\r\n+CSQ: 1,0\r\nOK\r\n']);
    const engine = createAtEngine({ write: modem.write });
    modem.attach(engine);
    const [a, b] = await Promise.all([engine.send('AT'), engine.send('AT+CSQ')]);
    expect(a.ok).toBe(true);
    expect(b.lines).toEqual(['+CSQ: 1,0']);
    expect(modem.writes).toEqual(['AT\r', 'AT+CSQ\r']);
  });

  it('abort fails the running and queued commands', async () => {
    const engine = createAtEngine({ write: () => {} });
    const first = engine.send('AT');
    const second = engine.send('AT+CSQ');
    engine.abort('Disconnected');
    expect(await first).toMatchObject({ ok: false, error: { type: 'ABORT', text: 'Disconnected' } });
    expect(await second).toMatchObject({ ok: false, error: { type: 'ABORT' } });
    expect(engine.busy).toBe(false);
  });
});
