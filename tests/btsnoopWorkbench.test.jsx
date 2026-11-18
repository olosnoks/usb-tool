import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BtHciLogWorkbench from '../src/components/tools/BtHciLogWorkbench.jsx';

// Server render of the idle state: the module loads without a browser (no File/Blob access at import time)
// and shows the open/example controls and the offline notice.
describe('BtHciLogWorkbench', () => {
  it('renders the idle state', () => {
    const html = renderToString(<BtHciLogWorkbench />);
    expect(html).toContain('Open capture file');
    expect(html).toContain('Load example');
    expect(html).toContain('nothing is uploaded');
    expect(html).toContain('btsnoop_hci.log');
  });
});
