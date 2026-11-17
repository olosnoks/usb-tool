import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  record, getEntries, clearLog, subscribe, setCurrentTool, confirmAction, installDeviceCapture,
  exportMarkdown, exportJson, parseJsonLog, describeDevice, deviceLabel, _resetForTests
} from '../src/utils/sessionLog';

beforeEach(() => _resetForTests());

describe('session log', () => {
  it('records entries, attributes them to the current tool and folds quick repeats', () => {
    setCurrentTool('ADB');
    record(undefined, 'info', 'Connected');
    record('Fastboot', 'err', 'boom');
    record('Fastboot', 'error', 'boom');
    record('Fastboot', 'info', '   ');
    const list = getEntries();
    expect(list.map((e) => [e.tool, e.level, e.text, e.count])).toEqual([
      ['ADB', 'info', 'Connected', undefined],
      ['Fastboot', 'error', 'boom', 2]
    ]);
  });

  it('notifies subscribers and clears', () => {
    const seen = [];
    const off = subscribe((l) => seen.push(l.length));
    record('X', 'ok', 'a');
    clearLog();
    off();
    record('X', 'ok', 'b');
    expect(seen).toEqual([1, 0]);
  });

  it('records the answer to a destructive confirmation', () => {
    const spy = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.stubGlobal('window', { confirm: spy });
    expect(confirmAction('Erase the whole chip?\n\nThis cannot be undone.', 'CH341A')).toBe(true);
    expect(confirmAction('Flash boot_a?', 'Fastboot')).toBe(false);
    vi.unstubAllGlobals();
    expect(getEntries().map((e) => e.text)).toEqual(['Confirmed: Erase the whole chip?', 'Declined: Flash boot_a?']);
    expect(getEntries().every((e) => e.level === 'action')).toBe(true);
  });

  it('wraps the device pickers and records the chosen device', async () => {
    const usbDev = { vendorId: 0x18d1, productId: 0x4ee0, manufacturerName: 'Google', productName: 'Pixel', serialNumber: 'ABC' };
    let disconnect = null;
    const nav = {
      usb: { requestDevice: async () => usbDev, addEventListener: (t, fn) => { if (t === 'disconnect') disconnect = fn; } },
      hid: { requestDevice: async () => [{ vendorId: 0x046d, productId: 0xc52b, productName: 'Receiver' }] },
      serial: { requestPort: async () => { throw Object.assign(new Error('No port selected'), { name: 'NotFoundError' }); } }
    };
    setCurrentTool('Fastboot');
    installDeviceCapture(nav);
    expect(await nav.usb.requestDevice({ filters: [] })).toBe(usbDev);
    await nav.hid.requestDevice({ filters: [] });
    await expect(nav.serial.requestPort()).rejects.toThrow(/No port/);
    disconnect({ device: usbDev });
    expect(getEntries().map((e) => e.text)).toEqual([
      'Selected USB Google Pixel (18d1:4ee0)',
      'Selected HID Receiver (046d:c52b)',
      'Unplugged USB Google Pixel (18d1:4ee0)'
    ]);
    expect(getEntries()[0].data).toMatchObject({ kind: 'usb', vid: '18d1', serial: 'ABC' });
  });

  it('describes serial and Bluetooth devices', () => {
    expect(deviceLabel(describeDevice('serial', { getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) }))).toBe('SERIAL (1a86:7523)');
    expect(deviceLabel(describeDevice('bluetooth', { name: 'DfuTarg', id: 'abcdefghij' }))).toBe('BLUETOOTH DfuTarg (id abcdefgh)');
  });

  it('exports a Markdown report and JSON that reads back', () => {
    record('ADB', 'device', 'Selected USB Pixel (18d1:4ee0)', { kind: 'usb', vid: '18d1', pid: '4ee0', name: 'Pixel' });
    record('ADB', 'action', 'Confirmed: Uninstall com.example?');
    record('ADB', 'error', 'Shell closed');
    record('ADB', 'info', 'has ``` fence');
    const md = exportMarkdown(getEntries(), { userAgent: 'TestBrowser' });
    expect(md).toContain('- **Tools:** ADB');
    expect(md).toContain('(1 errors, 0 warnings, 1 confirmations)');
    expect(md).toContain('## Devices\n\n- USB Pixel (18d1:4ee0) — ADB');
    expect(md).toMatch(/\*\*ADB\*\* ERROR: Shell closed/);
    expect(md).toContain("has ''' fence");
    expect(md).toContain('**Browser:** TestBrowser');
    const back = parseJsonLog(exportJson(getEntries()));
    expect(back.map((e) => e.text)).toEqual(getEntries().map((e) => e.text));
    expect(() => parseJsonLog('{"entries":[]}')).toThrow(/Not a session log/);
    expect(exportMarkdown([])).toContain('No entries.');
  });
});

import { redact, redactEntries, describeEnvironment } from '../src/utils/sessionLog';

describe('session log redaction (DAT-9)', () => {
  it('masks common secret shapes', () => {
    expect(redact('Authorization: Bearer abcdef1234567890XYZ')).toBe('Authorization: Bearer [REDACTED]');
    expect(redact('GET /x?api_key=SECRET123&b=2')).toBe('GET /x?api_key=[REDACTED]&b=2');
    expect(redact('password=hunter2 user=bob')).toBe('password=[REDACTED] user=bob');
    expect(redact('token: "abc def"')).toBe('token: [REDACTED]');
    expect(redact('hash 5f4dcc3b5aa765d61d8327deb882cf99 found')).toBe('hash [REDACTED] found');
    expect(redact('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-x end')).toBe('jwt [REDACTED] end');
    expect(redact('k=QWxhZGRpbjpvcGVuIHNlc2FtZVF1aWNrQnJvd25Gb3hKdW1wcw1234')).toContain('[REDACTED]');
    expect(redact('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----')).toBe('[REDACTED]');
  });
  it('leaves benign text untouched', () => {
    for (const s of ['Selected USB Google Pixel (18d1:4ee0)', 'Connected at 115200 baud', 'Flashed firmware.bin 1048576 bytes', 'Erase the whole chip?', 'reading /dev/ttyUSB0 token count 5']) {
      expect(redact(s)).toBe(s);
    }
  });
  it('masks MACs and SSIDs only when asked', () => {
    expect(redact('AP aa:bb:cc:dd:ee:ff SSID=HomeNet')).toBe('AP aa:bb:cc:dd:ee:ff SSID=HomeNet');
    expect(redact('AP aa:bb:cc:dd:ee:ff SSID=HomeNet', { network: true })).toBe('AP XX:XX:XX:XX:XX:XX SSID=[REDACTED]');
  });
  it('exports are redacted by default and raw only on explicit opt-out', () => {
    record('Hashcat', 'info', 'note password=hunter2');
    const md = exportMarkdown(getEntries());
    expect(md).not.toContain('hunter2');
    expect(md).toContain('Redaction:** on');
    expect(JSON.parse(exportJson(getEntries())).entries[0].text).toBe('note password=[REDACTED]');
    expect(exportMarkdown(getEntries(), { redact: false })).toContain('hunter2');
    expect(exportJson(getEntries(), {}, false)).toContain('hunter2');
  });
  it('redacts strings inside entry data without mutating the live log', () => {
    record('x', 'device', 'd', { serial: 'abcdef0123456789abcdef0123456789abcd' });
    expect(redactEntries(getEntries())[0].data.serial).toBe('[REDACTED]');
    expect(getEntries()[0].data.serial).toMatch(/^abcdef/);
  });
  it('adds an environment header', () => {
    const env = describeEnvironment({ userAgent: 'UA/1', serial: {}, usb: {} }, '1.2.3');
    expect(env).toEqual({ appVersion: '1.2.3', userAgent: 'UA/1', webSerial: true, webUsb: true, webHid: false });
    record('x', 'info', 'hi');
    const md = exportMarkdown(getEntries(), { environment: env });
    expect(md).toContain('**App version:** 1.2.3');
    expect(md).toContain('Web Serial / WebUSB / WebHID:** yes / yes / no');
  });
});
