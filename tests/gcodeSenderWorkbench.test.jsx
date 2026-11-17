import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import GcodeSenderWorkbench from '../src/components/tools/GcodeSenderWorkbench.jsx';

// Server render of the idle (no serial port) tool: proves the module loads without a browser
// and shows only the idle state, with no temperatures, positions or replies invented.
describe('GcodeSenderWorkbench', () => {
  it('renders the idle state without a serial context', () => {
    const html = renderToString(<GcodeSenderWorkbench />);
    expect(html).toContain('G-CODE SENDER');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('not detected');
    expect(html).toContain('The serial context is not available here');
    expect(html).toContain('Nothing yet. Replies from the device');
    expect(html).toContain('no file loaded');
  });

  it('shows no device readings before a device has replied', () => {
    const html = renderToString(<GcodeSenderWorkbench />);
    expect(html).not.toContain('Hotend');
    expect(html).not.toContain('TEMPERATURE');
    expect(html).not.toContain('MPos');
  });
});
