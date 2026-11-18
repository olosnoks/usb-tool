import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import EspBacktraceWorkbench from '../src/components/tools/EspBacktraceWorkbench.jsx';

// Server render of the idle state (no ELF, no crash text, no serial provider).
describe('EspBacktraceWorkbench', () => {
  it('renders the idle state without a browser or serial context', () => {
    const html = renderToString(<EspBacktraceWorkbench />);
    expect(html).toContain('Choose .elf file');
    expect(html).toContain('Use latest from serial');
    expect(html).toContain('Connect the serial port in the header');
    expect(html).toContain('Paste crash text');
  });
});
