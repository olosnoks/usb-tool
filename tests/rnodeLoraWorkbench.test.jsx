import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import RnodeLoraWorkbench from '../src/components/tools/RnodeLoraWorkbench.jsx';

// Server render of the idle tool (no serial provider, no device): proves the module loads
// and the disconnected RNode tab and the offline calculator both render without a browser.
describe('RnodeLoraWorkbench', () => {
  it('renders the RNode tab in its disconnected state', () => {
    const html = renderToString(<RnodeLoraWorkbench />);
    expect(html).toContain('RNode (Reticulum)');
    expect(html).toContain('LoRa calculator');
    expect(html).toContain('No serial port connected.');
    expect(html).toContain('Firmware Flasher');
  });
});
