import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import EspPartitionEditorWorkbench from '../src/components/tools/EspPartitionEditorWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser and shows the empty state.
describe('EspPartitionEditorWorkbench', () => {
  it('renders the idle state with no image loaded', () => {
    const html = renderToString(<EspPartitionEditorWorkbench />);
    expect(html).toContain('ESP32 PARTITION TABLE');
    expect(html).toContain('PARTITION TABLE');
    expect(html).toContain('NVS STORAGE');
    expect(html).toContain('Open a dump or partitions.bin, or start from CSV.');
    expect(html).toContain('Nothing is shown until a file or CSV is provided.');
  });
});
