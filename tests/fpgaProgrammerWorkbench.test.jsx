import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import FpgaProgrammerWorkbench from '../src/components/tools/FpgaProgrammerWorkbench.jsx';

// Server render of the idle (not connected) tool: proves the module loads without a browser
// and that it shows only the not-connected state, with the untested-on-hardware warning.
describe('FpgaProgrammerWorkbench', () => {
  it('renders the disconnected state', () => {
    const html = renderToString(<FpgaProgrammerWorkbench />);
    expect(html).toContain('CONNECT FTDI (WEBUSB)');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('Written without hardware access');
    expect(html).toContain('iCEstick (HX1K)');
  });
});
