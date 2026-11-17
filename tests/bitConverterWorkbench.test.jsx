import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BitConverterWorkbench from '../src/components/tools/BitConverterWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser and shows the
// offline intro, the tab strip and the default Number view.
describe('BitConverterWorkbench', () => {
  it('renders the idle Number tab without a browser', () => {
    const html = renderToString(<BitConverterWorkbench />);
    expect(html).toContain('Bits &amp; Numbers Converter');
    expect(html).toContain('Offline.');
    expect(html).toContain('Number');
    expect(html).toContain('Bits &amp; fields');
    expect(html).toContain('Fixed-point');
    expect(html).toContain('0xDEADBEEF');
  });
});
