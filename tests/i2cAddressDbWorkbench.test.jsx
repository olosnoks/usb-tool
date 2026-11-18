import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import I2cAddressRefWorkbench from '../src/components/tools/I2cAddressRefWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser and shows the
// address map with its honest "reference only, no bus access" statement.
describe('I2cAddressRefWorkbench', () => {
  it('renders the address map idle state', () => {
    const html = renderToString(<I2cAddressRefWorkbench />);
    expect(html).toContain('I2C Address Reference');
    expect(html).toContain('This tool does not talk to any bus.');
    expect(html).toContain('Click an address to see the parts that use it.');
    expect(html).toContain('reserved by the I2C spec');
    expect(html).toContain('Paste scan result');
  });
});
