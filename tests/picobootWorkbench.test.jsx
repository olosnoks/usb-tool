import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PicobootWorkbench from '../src/components/tools/PicobootWorkbench.jsx';

// Server render of the idle (not connected) tool: no navigator.usb at module load, idle copy shown.
describe('PicobootWorkbench', () => {
  it('renders the disconnected state and says it is untested on hardware', () => {
    const html = renderToString(<PicobootWorkbench />);
    expect(html).toContain('CONNECT PICOBOOT (WEBUSB)');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('UNTESTED ON HARDWARE');
    expect(html).toContain('mass-storage');
  });
});
