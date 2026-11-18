import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import FirmwareConverterWorkbench from '../src/components/tools/FirmwareConverterWorkbench.jsx';

// Server render of the idle state: the module loads without a browser and shows the
// offline notice, the input drop zone, and the no-file hint instead of any results.
describe('FirmwareConverterWorkbench', () => {
  it('renders the idle state without any file loaded', () => {
    const html = renderToString(<FirmwareConverterWorkbench />);
    expect(html).toContain('Firmware File Converter');
    expect(html).toContain('OFFLINE');
    expect(html).toContain('Drop firmware files here');
    expect(html).toContain('Load a file to see its segment map');
    expect(html).not.toContain('CRC-32');
  });
});
