import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import CrcReverseWorkbench from '../src/components/tools/CrcReverseWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser and shows the calculator.
describe('CrcReverseWorkbench', () => {
  it('renders the calculator tab with its tab bar', () => {
    const html = renderToString(<CrcReverseWorkbench />);
    expect(html).toContain('Calculator');
    expect(html).toContain('Reverse');
    expect(html).toContain('Locate');
    expect(html).toContain('Expected value');
  });
});
