import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import WebNfcWorkbench from '../src/components/tools/WebNfcWorkbench.jsx';

// Server render of the idle tool (no navigator, no NDEFReader): proves the module loads,
// the Read tab is the default, and the desktop/unavailable explanation is shown.
describe('WebNfcWorkbench', () => {
  it('renders the idle Read tab without a browser', () => {
    const html = renderToString(<WebNfcWorkbench />);
    expect(html).toContain('Web NFC Reader / Writer');
    expect(html).toContain('Web NFC unavailable here');
    expect(html).toContain('Read tag');
    expect(html).toContain('Write tag');
    expect(html).toContain('Offline NDEF');
    expect(html).toContain('No tag read yet in this session.');
  });
});
