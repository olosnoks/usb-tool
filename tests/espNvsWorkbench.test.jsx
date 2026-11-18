import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import EspPartitionEditorWorkbench from '../src/components/tools/EspPartitionEditorWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser and shows the empty state.
describe('EspPartitionEditorWorkbench', () => {
  it('renders the idle state with no image loaded', () => {
    const html = renderToString(<EspPartitionEditorWorkbench />);
    expect(html).toContain('Layout preset');
    expect(html).toContain('Flash size');
    expect(html).toContain('PARTITION TABLE');
    expect(html).toContain('NVS STORAGE');
    expect(html).toContain('Open a dump or partitions.bin, or start from CSV.');
    expect(html).toContain('or pick a preset.');
  });
});
