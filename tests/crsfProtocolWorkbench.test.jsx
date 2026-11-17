import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import CrsfTelemetryWorkbench from '../src/components/tools/CrsfTelemetryWorkbench.jsx';

// Server render of the idle (no port) tool: proves the module loads without a browser
// and that the idle view shows no telemetry.
describe('CrsfTelemetryWorkbench', () => {
  it('renders the idle state without a serial provider or browser APIs', () => {
    const html = renderToString(<CrsfTelemetryWorkbench />);
    expect(html).toContain('ELRS / CRSF');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('LIVE TELEMETRY');
    expect(html).toContain('DEVICE PARAMETERS');
    expect(html).toContain('RAW FRAMES');
    expect(html).toContain('shared serial port is not available');
  });
});
