import { describe, it, expect } from 'vitest';
import { decodeSmsPdu, signalHistoryToCsv, logToText, searchAtReference, gsm7ToString, unpackSeptets } from '../src/utils/atModemExtras.js';

describe('decodeSmsPdu', () => {
  it('decodes a GSM 7-bit SMS-DELIVER', () => {
    const r = decodeSmsPdu('07911326040000F0040B911346610089F60000208062917314080CC8F71D14969741F977FD07');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('SMS-DELIVER');
    expect(r.smsc).toBe('+31624000000');
    expect(r.address).toBe('+31641600986');
    expect(r.text).toBe('How are you?');
    expect(r.alphabet).toBe('gsm7');
    expect(r.time).toBe('2002-08-26 19:37:41 +00:00');
  });

  it('decodes UCS2 text without an SMSC field', () => {
    const r = decodeSmsPdu('0405812143F5000802809000000000060048006920AC', { hasSmsc: false });
    expect(r.ok).toBe(true);
    expect(r.alphabet).toBe('ucs2');
    expect(r.address).toBe('12345');
    expect(r.text).toBe('Hi€');
  });

  it('rejects bad input', () => {
    expect(decodeSmsPdu('').ok).toBe(false);
    expect(decodeSmsPdu('ZZ').error).toMatch(/hex/);
    expect(decodeSmsPdu('0791132').error).toMatch(/odd/);
    expect(decodeSmsPdu('07911326040000F0040B91134661').ok).toBe(false);
  });

  it('reads concatenation info and skips the UDH in 7-bit text', () => {
    const r = decodeSmsPdu('0044' + '0B911346610089F6' + '0000' + '20806291731400' + '08' + '0500' + '03AB0201' + '82');
    expect(r.ok).toBe(true);
    expect(r.concat).toEqual({ ref: 0xab, total: 2, part: 1 });
    expect(r.text).toBe('A');
  });
});

describe('gsm7 helpers', () => {
  it('unpacks septets and maps the extension table', () => {
    expect(gsm7ToString(unpackSeptets([0xc8, 0x34], 2))).toBe('Hi');
    expect(gsm7ToString([0x1b, 0x65, 0x1b, 0x3c])).toBe('€[');
  });
});

describe('exports and reference', () => {
  it('builds CSV with empty cells for missing values', () => {
    const csv = signalHistoryToCsv([{ t: 0, rssi: -77, rsrp: null }]);
    expect(csv).toBe('time_iso,rssi_dbm,rsrp_dbm\n1970-01-01T00:00:00.000Z,-77,\n');
  });

  it('filters log text by direction', () => {
    const log = [{ ts: 't', dir: 'tx', text: 'AT' }, { ts: 't', dir: 'rx', text: 'OK' }];
    expect(logToText(log)).toBe('t TX AT\nt RX OK');
    expect(logToText(log, ['rx'])).toBe('t RX OK');
  });

  it('searches the command reference', () => {
    expect(searchAtReference('imei').some(([c]) => c === 'AT+CGSN')).toBe(true);
    expect(searchAtReference('zzzz')).toEqual([]);
  });
});
