import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import AtModemWorkbench from '../src/components/tools/AtModemWorkbench.jsx';

// Server render of the idle tool (no serial provider, no browser APIs): proves the module loads
// and shows the not-connected state with real, unsimulated controls.
describe('AtModemWorkbench', () => {
  it('renders the idle state without a serial context', () => {
    const html = renderToString(<AtModemWorkbench />);
    expect(html).toContain('AT Modem Console');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('This view has no serial context');
    expect(html).toContain('Identify module');
    expect(html).not.toContain('Simulated');
  });
});
