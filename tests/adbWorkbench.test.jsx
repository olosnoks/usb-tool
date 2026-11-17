import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import AdbWorkbench from '../src/components/tools/AdbWorkbench.jsx';

// Server render of the idle (not connected) tool: proves the module loads with the new
// transfer/shell imports and that the intro describes only what exists.
describe('AdbWorkbench', () => {
  it('renders the disconnected state', () => {
    const html = renderToString(<AdbWorkbench />);
    expect(html).toContain('CONNECT ADB (WEBUSB)');
    expect(html).toContain('interactive shell');
    expect(html).toContain('No ADB device connected');
  });
});
