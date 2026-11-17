import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { cleanups, makeFakeSerial } from './helpers/runEffects.js';

vi.mock('react', async (orig) => (await import('./helpers/runEffects.js')).mockReactEffects(await orig()));
const serial = { current: null };
vi.mock('../src/context/SerialContext', () => ({ useSerial: () => serial.current }));

const { default: TelemetryDashboard } = await import('../src/components/TelemetryDashboard.jsx');

describe('TelemetryDashboard honesty and wiring', () => {
  beforeEach(() => { cleanups.length = 0; serial.current = makeFakeSerial(); });

  it('shows no channel or value before data arrives', () => {
    const html = renderToString(<TelemetryDashboard />).replace(/<!-- -->/g, '');
    expect(html).toContain('LIVE TELEMETRY FEEDS (0)');
    expect(html).toContain('Waiting for data');
    for (const fake of ['2400', '24.5', '12.1', '145']) expect(html).not.toContain(`>${fake}<`);
    expect(html).not.toContain('RPM');
  });

  it('subscribes to the raw RX stream and survives chunked input', () => {
    renderToString(<TelemetryDashboard />);
    expect(serial.current.count()).toBe(1);
    expect(() => {
      serial.current.emit('temp:2');
      serial.current.emit('4.5\n{"rpm":3200}\n');
    }).not.toThrow();
  });
});
