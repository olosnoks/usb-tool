import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import ArduinoUploaderWorkbench from '../src/components/tools/ArduinoUploaderWorkbench.jsx';

// Server render of the idle tool: proves the module loads without a browser
// (no navigator.serial at import or render time) and shows the empty state.
describe('ArduinoUploaderWorkbench', () => {
  it('renders the idle state with no firmware loaded and nothing written', () => {
    const html = renderToString(<ArduinoUploaderWorkbench />);
    expect(html).toContain('Arduino Bootloader Uploader');
    expect(html).toContain('No file loaded');
    expect(html).toContain('Write and verify sketch');
    expect(html).toContain('Read flash back');
    expect(html).toContain('Arduino Uno (ATmega328P, Optiboot)');
    expect(html).toContain('No activity yet.');
  });

  it('says plainly that Web Serial is missing when the browser has no navigator.serial', () => {
    const html = renderToString(<ArduinoUploaderWorkbench />);
    expect(html).toContain('Web Serial is not available here');
  });
});
