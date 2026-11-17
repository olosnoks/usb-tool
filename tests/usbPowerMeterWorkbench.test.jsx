import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import UsbPowerMeterWorkbench from '../src/components/tools/UsbPowerMeterWorkbench.jsx';

// Server render of the idle (not connected) tool: proves the module loads without
// browser APIs and that the idle state shows no readings.
describe('UsbPowerMeterWorkbench', () => {
  it('renders the disconnected state with both meter families and no readings', () => {
    const html = renderToString(<UsbPowerMeterWorkbench />);
    expect(html).toContain('RuiDeng UM24C / UM25C / UM34C');
    expect(html).toContain('FNIRSI FNB48 / FNB58 / C1');
    expect(html).toContain('Not connected');
    expect(html).toContain('Only real readings from the meter are shown');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Samples:');
    expect(html).not.toMatch(/Receiving/);
  });
});
