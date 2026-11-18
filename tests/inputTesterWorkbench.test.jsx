import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import InputTesterWorkbench from '../src/components/tools/InputTesterWorkbench.jsx';

// Server render of the idle state: the module loads without navigator.getGamepads,
// navigator.hid or pointer APIs, and shows its tabs and the honest unsupported message.
describe('InputTesterWorkbench', () => {
  it('renders the idle gamepad tab without a browser', () => {
    const html = renderToString(<InputTesterWorkbench />);
    expect(html).toContain('nothing is simulated');
    expect(html).toContain('Gamepad');
    expect(html).toContain('Mouse');
    expect(html).toContain('The Gamepad API is not available in this browser or context.');
  });
});
