import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import MeshtasticWorkbench from '../src/components/tools/MeshtasticWorkbench.jsx';
import { SerialProvider } from '../src/context/SerialContext.jsx';

// Server render: proves the module loads without a browser (no navigator/serial access at
// import or render time) and shows the idle state, both with and without the shared port.
describe('MeshtasticWorkbench', () => {
  it('renders the idle state inside the serial provider', () => {
    const html = renderToString(
      <SerialProvider>
        <MeshtasticWorkbench />
      </SerialProvider>,
    );
    expect(html).toContain('Meshtastic Client');
    expect(html).toContain('CONNECT &amp; SYNC');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('No nodes yet');
  });

  it('explains the shared port requirement when no provider is mounted', () => {
    const html = renderToString(<MeshtasticWorkbench />);
    expect(html).toContain('shared serial port');
  });
});
