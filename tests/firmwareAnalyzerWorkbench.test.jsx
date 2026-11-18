import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import FirmwareAnalyzerWorkbench from '../src/components/tools/FirmwareAnalyzerWorkbench.jsx';

// Server render of the idle state (no file chosen): the module loads without a browser
// and shows the drop zone and the offline note.
describe('FirmwareAnalyzerWorkbench', () => {
  it('renders the idle state', () => {
    const html = renderToString(<FirmwareAnalyzerWorkbench />);
    expect(html).toContain('Firmware Image Analyzer');
    expect(html).toContain('Choose firmware file');
    expect(html).toContain('Drop a firmware image here');
    expect(html).toContain('Nothing is uploaded');
  });
});
