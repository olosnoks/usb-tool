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
