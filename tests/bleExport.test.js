import { describe, it, expect } from 'vitest';
import { gattToJson, gattToMarkdown, notificationsToCsv, pushBounded, numericValue, NOTIFY_HISTORY_CAP } from '../src/utils/bleExport';

const CH = '00002a19-0000-1000-8000-00805f9b34fb';
const DESC = '00002902-0000-1000-8000-00805f9b34fb';
const tree = [
  {
    uuid: '0000180f-0000-1000-8000-00805f9b34fb',
    name: 'Battery',
    assigned: true,
    characteristics: [
      {
        uuid: CH,
        name: 'Battery Level',
        properties: { read: true, notify: true, write: false },
        _ref: { live: true },
        descriptors: [{ uuid: DESC, name: 'CCCD', _ref: {} }]
      }
    ]
  },
  { uuid: 'aaaa0000-0000-1000-8000-00805f9b34fb', name: 'Vendor', assigned: false, characteristics: [] }
];
const values = {
  [CH]: { hex: '5a', byteLength: 1, decoded: { label: 'Battery', text: '90 %' }, ts: 1700000000000 },
  [`${CH}/${DESC}`]: { error: 'denied' }
};
const device = { name: 'Dev|1', id: 'abc' };

describe('gatt exporters', () => {
  it('JSON has every service, characteristic, properties and values, no live handles', () => {
    const j = gattToJson(device, tree, values, { toolVersion: '9.9.9', exportedAt: 'T' });
    expect(j.toolVersion).toBe('9.9.9');
    expect(j.services).toHaveLength(2);
    const c = j.services[0].characteristics[0];
    expect(c.properties).toEqual(['read', 'notify']);
    expect(c.value).toMatchObject({ hex: '5a', decoded: 'Battery: 90 %', timestamp: '2023-11-14T22:13:20.000Z' });
    expect(c.descriptors[0].value).toEqual({ error: 'denied' });
    expect(JSON.stringify(j)).not.toContain('_ref');
  });
  it('Markdown lists services and escapes pipes', () => {
    const md = gattToMarkdown(device, tree, values, { toolVersion: '1', exportedAt: 'T' });
    expect(md).toContain('# GATT dump: Dev|1');
    expect(md).toContain('## Battery');
    expect(md).toContain('`5a`');
    expect(md).toContain('No characteristics exposed');
    expect(md).toContain('read, notify');
  });
});

describe('notificationsToCsv', () => {
  it('has the header, sorts by time and escapes', () => {
    const csv = notificationsToCsv({
      u: [
        { ts: 2000, characteristic: 'u', hex: '01', decoded: 'a,"b"' },
        { ts: 1000, characteristic: 'u', hex: '00', decoded: '=SUM(1)' }
      ]
    });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time,characteristic,hex,decoded');
    expect(lines[1]).toBe("1970-01-01T00:00:01.000Z,u,00,'=SUM(1)");
    expect(lines[2]).toBe('1970-01-01T00:00:02.000Z,u,01,"a,""b"""');
  });
});

describe('helpers', () => {
  it('pushBounded caps the list', () => {
    const l = [];
    for (let i = 0; i < NOTIFY_HISTORY_CAP + 50; i += 1) pushBounded(l, i);
    expect(l).toHaveLength(NOTIFY_HISTORY_CAP);
    expect(l[0]).toBe(50);
  });
  it('numericValue', () => {
    expect(numericValue({ decoded: { text: '90 %' } })).toBe(90);
    expect(numericValue({ numbers: [['uint8', 7]] })).toBe(7);
    expect(numericValue({ error: 'x' })).toBeNull();
    expect(numericValue({ hex: 'aabbcc' })).toBeNull();
  });
});

import { vi } from 'vitest';
import { teardownSubscriptions, releaseBleSession } from '../src/utils/bleExport';

describe('unmount cleanup', () => {
  const makeSession = (connected = true) => {
    const characteristic = { removeEventListener: vi.fn(), stopNotifications: vi.fn().mockResolvedValue() };
    const handler = () => {};
    const dev = { gatt: { connected, disconnect: vi.fn() }, removeEventListener: vi.fn() };
    const fn = () => {};
    return { characteristic, handler, dev, fn };
  };
  it('stops notifications, removes listeners and disconnects', () => {
    const { characteristic, handler, dev, fn } = makeSession();
    const closed = releaseBleSession({
      subs: { a: { characteristic, handler } },
      device: dev,
      disconnectListener: { dev, fn }
    });
    expect(characteristic.removeEventListener).toHaveBeenCalledWith('characteristicvaluechanged', handler);
    expect(characteristic.stopNotifications).toHaveBeenCalled();
    expect(dev.removeEventListener).toHaveBeenCalledWith('gattserverdisconnected', fn);
    expect(dev.gatt.disconnect).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
  });
  it('keeps the link when it is handed to the serial port, and never throws', () => {
    const { dev } = makeSession();
    expect(releaseBleSession({ subs: null, device: dev, keepLink: true })).toBe(false);
    expect(dev.gatt.disconnect).not.toHaveBeenCalled();
    const bad = { characteristic: { removeEventListener() { throw new Error('x'); }, stopNotifications() { throw new Error('y'); } }, handler() {} };
    expect(teardownSubscriptions({ a: bad })).toBe(1);
    expect(releaseBleSession({ subs: {}, device: null })).toBe(false);
  });
});
