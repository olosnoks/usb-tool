import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import SmartCardWorkbench from '../src/components/tools/SmartCardWorkbench.jsx';

// Server render: the component loads without a browser and states up front that it
// cannot drive a reader, so nothing reads as live hardware.
describe('SmartCardWorkbench', () => {
  it('renders the offline notice and the ATR tab with the example parsed', () => {
    const html = renderToString(<SmartCardWorkbench />);
    expect(html).toContain('Smart Card toolkit');
    expect(html).toContain('cannot drive a smart-card reader');
    expect(html).toContain('WebUSB');
    expect(html).toContain('Convention (TS)');
    expect(html).toContain('Historical bytes');
  });
});
