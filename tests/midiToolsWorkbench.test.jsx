import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import MidiMonitorWorkbench from '../src/components/tools/MidiMonitorWorkbench.jsx';

// Server render of the idle (no MIDI access yet) tool: proves the module loads without
// navigator.requestMIDIAccess and shows the permission explanation before anything is requested.
describe('MidiMonitorWorkbench', () => {
  it('renders the idle state with the Enable MIDI control and permission note', () => {
    const html = renderToString(<MidiMonitorWorkbench />);
    expect(html).toContain('MIDI Monitor');
    expect(html).toContain('Enable MIDI');
    expect(html).toContain('SysEx');
    expect(html).toContain('Monitor');
    expect(html).toContain('SysEx Library');
    expect(html).toContain('Latency');
  });
});
