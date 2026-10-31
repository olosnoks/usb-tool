import { describe, it, expect } from 'vitest';
import { fetchKismetDevices, fetchKismetAlerts, fetchKismetStatus, mapKismetDevice, KISMET_DEVICE_FIELDS } from '../src/utils/kismetClient';

const now = Math.floor(Date.now() / 1000);
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
  return { impl, calls };
}

describe('Kismet client', () => {
  it('requests only the needed fields and maps devices', async () => {
    const { impl, calls } = fakeFetch({
      '/devices/last-time/-600/devices.json': [
        { mac: 'aa:bb:cc:dd:ee:ff', name: 'CafeNet', type: 'Wi-Fi AP', channel: '36', freqKhz: 5180000, crypt: 'WPA2-PSK',
          manuf: 'Ubiquiti', rssi: -51, packets: 1200, first: now - 300, last: now - 2, clients: 2,
          clientMap: { '11:22:33:44:55:66': 'k1', '77:88:99:aa:bb:cc': 'k2' } },
        { mac: '11:22:33:44:55:66', name: '11:22:33:44:55:66', type: 'Wi-Fi Client', channel: '36', freqKhz: 5180000,
          crypt: '', manuf: 'Apple', rssi: -70, packets: 40, first: now - 60, last: now - 10 }
      ]
    });
    const devs = await fetchKismetDevices('http://localhost:2501/', 'abc123', { fetchImpl: impl });
    expect(devs).toHaveLength(2);
    expect(devs[0]).toMatchObject({ bssid: 'AA:BB:CC:DD:EE:FF', ssid: 'CafeNet', type: 'AP', channel: 36, band: '5GHz',
      signal: -51, crypto: 'WPA2-PSK', clients: 2 });
    expect(devs[0].lastSeen).toMatch(/^[23]s ago$/);
    expect(devs[0].clientList).toEqual(['11:22:33:44:55:66', '77:88:99:AA:BB:CC']);
    expect(devs[1]).toMatchObject({ type: 'STA', ssid: '', crypto: 'Open' });
    // API key as KISMET param, field list posted as form-encoded json
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('KISMET')).toBe('abc123');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(new URLSearchParams(calls[0].init.body).get('json'));
    expect(body.fields).toEqual(KISMET_DEVICE_FIELDS);
  });

  it('uses Basic auth for user:password', async () => {
    const { impl, calls } = fakeFetch({ '/system/status.json': { 'kismet.system.timestamp.start_sec': now - 3725, 'kismet.system.timestamp.sec': now, 'kismet.system.version': '2023-07-R1' } });
    const s = await fetchKismetStatus('http://localhost:2501', 'kismet:secret', { fetchImpl: impl });
    expect(s).toEqual({ uptime: '01:02:05', version: '2023-07-R1' });
    expect(calls[0].init.headers.Authorization).toBe('Basic ' + btoa('kismet:secret'));
    expect(new URL(calls[0].url).searchParams.has('KISMET')).toBe(false);
  });

  it('maps alerts with severity and newest first', async () => {
    const { impl } = fakeFetch({ '/alerts/last-time/0/alerts.json': [
      { 'kismet.alert.header': 'DEAUTHFLOOD', 'kismet.alert.text': 'Deauth flood', 'kismet.alert.severity': 15, 'kismet.alert.timestamp': now - 100,
        'kismet.alert.source_mac': 'AA:AA:AA:AA:AA:AA', 'kismet.alert.dest_mac': 'FF:FF:FF:FF:FF:FF', 'kismet.alert.channel': '6' },
      { 'kismet.alert.header': 'APSPOOF', 'kismet.alert.text': 'Spoofed AP', 'kismet.alert.severity': 10, 'kismet.alert.timestamp': now - 5 }
    ] });
    const alerts = await fetchKismetAlerts('http://localhost:2501', '', { fetchImpl: impl });
    expect(alerts.map((a) => [a.type, a.severity])).toEqual([['APSPOOF', 'WARN'], ['DEAUTHFLOOD', 'CRITICAL']]);
    expect(alerts[1].target).toBe('AA:AA:AA:AA:AA:AA → FF:FF:FF:FF:FF:FF');
  });

  it('turns network and auth failures into clear errors', async () => {
    const down = async () => { throw new TypeError('Failed to fetch'); };
    await expect(fetchKismetDevices('http://localhost:2501', '', { fetchImpl: down })).rejects.toThrow(/CORS/);
    const { impl } = fakeFetch({ '/devices/last-time/-600/devices.json': 401 });
    await expect(fetchKismetDevices('http://localhost:2501', 'bad', { fetchImpl: impl })).rejects.toThrow(/refused the login/);
  });

  it('treats a missing signal as unknown, not 0 dBm', () => {
    expect(mapKismetDevice({ mac: 'aa:aa:aa:aa:aa:aa', rssi: 0 }).signal).toBe(null);
  });
});
