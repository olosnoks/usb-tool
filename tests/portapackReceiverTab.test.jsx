import { vi, describe, it, expect } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet.heat', () => ({}));
import React from 'react';
import { renderToString } from 'react-dom/server';
import PortapackWorkbench from '../src/components/tools/PortapackWorkbench.jsx';
import NativeReceiver from '../src/components/tools/portapack/NativeReceiver.jsx';

// The native WebUSB receiver (ReceiverDeck, FREQMAN, ADS-B map, console) is reachable again as a tab.
describe('PortaPack built-in receiver tab', () => {
  it('offers the Built-in Receiver tab next to Mayhem Mobile and the flasher', () => {
    const html = renderToString(<PortapackWorkbench />);
    expect(html).toContain('Built-in Receiver');
    expect(html).toContain('Mayhem Mobile SDR');
    expect(html).toContain('SPI Flasher');
  });

  it('renders the receiver with its FREQMAN tab and no duplicate flasher tab', () => {
    const html = renderToString(<NativeReceiver />);
    expect(html).toContain('FREQMAN');
    expect(html).not.toContain('Flash &amp; Setup');
  });
});
