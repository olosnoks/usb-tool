import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import RtlSdrWorkbench from '../src/components/tools/RtlSdrWorkbench.jsx';

// Server render of the idle (not connected) tool: proves the module loads without a browser
// (no navigator.usb / AudioContext access at module or render time) and shows the idle state.
describe('RtlSdrWorkbench', () => {
  it('renders the disconnected state with the WebUSB connect button and the Zadig note', () => {
    const html = renderToString(<RtlSdrWorkbench />);
    expect(html).toContain('CONNECT RTL-SDR (WEBUSB)');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('R820T');
    expect(html).toContain('Zadig');
    expect(html).toContain('RECORD IQ (.CU8)');
  });
});
