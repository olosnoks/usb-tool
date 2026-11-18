import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PowerProfilerWorkbench from '../src/components/tools/PowerProfilerWorkbench.jsx';

// Server render of the idle (no PPK2 connected) tool: proves the module loads without a browser
// and shows only the disconnected state, with no readings.
describe('PowerProfilerWorkbench', () => {
  it('renders the disconnected state without readings', () => {
    const html = renderToString(<PowerProfilerWorkbench />);
    expect(html).toContain('Battery life');
    expect(html).toContain('Activity analysis');
    expect(html).toContain('DISCONNECTED');
    expect(html).toContain('Connect PPK2');
    expect(html).toContain('Source meter');
    expect(html).toContain('Ampere meter');
    expect(html).toContain('Drag on the chart');
    expect(html).not.toContain('MEASURING');
  });
});
