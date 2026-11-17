import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import ElfSizeWorkbench from '../src/components/tools/ElfSizeWorkbench.jsx';

// Server render of the idle state (no files loaded): proves the module loads without a browser
// and the empty states describe what to load.
describe('ElfSizeWorkbench', () => {
  it('renders the idle state with both build slots and the empty summary', () => {
    const html = renderToString(<ElfSizeWorkbench />);
    expect(html).toContain('ELF / Map Size Analyzer');
    expect(html).toContain('Build A (primary)');
    expect(html).toContain('Build B (compare)');
    expect(html).toContain('Choose ELF and/or .map');
    expect(html).toContain('Load an ELF (.elf, .axf, .out) and/or a GNU ld map (.map) for build A.');
  });
});
