import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import IsmDecoderWorkbench from '../src/components/tools/IsmDecoderWorkbench.jsx';

// Server render of the idle state: the module loads without a browser and shows
// only the empty state (no recording loaded, so no results).
describe('IsmDecoderWorkbench', () => {
  it('renders the idle state with no results', () => {
    const html = renderToString(<IsmDecoderWorkbench />);
    expect(html).toContain('Load IQ recording');
    expect(html).toContain('Load an IQ recording to analyze');
    expect(html).toContain('250.0 kS/s');
    expect(html).toContain('2.048 MS/s');
    expect(html).not.toContain('device decode');
  });
});
