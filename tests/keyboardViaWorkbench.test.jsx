import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import KeyboardTesterWorkbench from '../src/components/tools/KeyboardTesterWorkbench.jsx';

// Server render of the idle tool: no navigator.hid or window access at module load,
// key tester shows its empty state, and the VIA panel shows the disconnected state.
describe('KeyboardTesterWorkbench', () => {
  it('renders the idle key tester and VIA panel', () => {
    const html = renderToString(<KeyboardTesterWorkbench />);
    expect(html).toContain('KEY TESTER');
    expect(html).toContain('No events yet.');
    expect(html).toContain('VIA KEYBOARD (WEBHID)');
    expect(html).toContain('OPEN VIA KEYBOARD');
    expect(html).not.toContain('Connected');
  });
});
