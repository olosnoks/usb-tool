import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import ModbusWorkbench from '../src/components/tools/ModbusWorkbench';
import { ModbusClient, frameWithCrc } from '../src/utils/modbusDriver';
import { READ_TABLES, buildRegisterRows } from '../src/utils/modbusTypes';

const frame = (b) => frameWithCrc(Uint8Array.from(b));

describe('ModbusWorkbench rendering (B8)', () => {
  const html = renderToString(<SerialProvider><ModbusWorkbench /></SerialProvider>);

  it('has no hard-coded inverter labels or units before or without a map', () => {
    expect(html).not.toMatch(/AC Grid|Active Output Power|Inverter Temp|Daily Yield|Lifetime Yield|Power Factor/);
    expect(html).not.toMatch(/V AC|kWh/);
  });
  it('intro text matches what is implemented', () => {
    expect(html).toMatch(/Modbus RTU master/i);
    expect(html).toContain('Holding registers (FC03)');
    expect(html).toContain('Discrete inputs (FC02)');
    expect(html).toContain('REQUEST FRAME');
    expect(html).toContain('Parity:');
    expect(html).toContain("value=\"230400\"");
    expect(html).toContain("value=\"1200\"");
    expect(html).toContain('SCAN SLAVE IDs');
  });
});

describe('table switching and unmapped devices', () => {
  it('each table selects the right function code and quantity limit', () => {
    const sent = [];
    const c = new ModbusClient(() => {});
    c.connectLive(async (tx) => { sent.push(tx[1]); return new Uint8Array(0); }, 1, 9600);
    return Promise.all(Object.values(READ_TABLES).map((t) => c.request(t.fc, 0, 1))).then(() => {
      expect(sent).toEqual([3, 4, 1, 2]);
      expect(READ_TABLES.coils.max).toBe(2000);
      expect(READ_TABLES.holding.max).toBe(125);
    });
  });
  it('a device with no map gets generic labels for any start address', async () => {
    const c = new ModbusClient(() => {});
    c.connectLive(async () => frame([1, 3, 4, 0, 5, 0, 6]), 1, 9600);
    const r = await c.request(3, 100, 2);
    const rows = buildRegisterRows(100, r.words, null);
    expect(rows.map((x) => x.label)).toEqual(['Register 100', 'Register 101']);
  });
});

describe('slave scan cancel', () => {
  it('stops probing once the signal is aborted', async () => {
    const probed = [];
    const c = new ModbusClient(() => {});
    c.connectLive(async (tx) => { probed.push(tx[0]); return new Uint8Array(0); }, 1, 9600);
    const signal = { aborted: false };
    const p = c.scan({ from: 1, to: 247, timeoutMs: 5, signal, onProgress: ({ slaveId }) => { if (slaveId === 3) signal.aborted = true; } });
    const found = await p;
    expect(found).toEqual([]);
    expect(probed).toEqual([1, 2, 3]);
  });
});
