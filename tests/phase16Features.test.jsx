import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import AlfaWifiWorkbench from '../src/components/workbenches/AlfaWifiWorkbench';
import { SerialProvider } from '../src/context/SerialContext';

describe('Phase 16 UI Feature Integration', () => {
  it('renders AlfaWifiWorkbench with Roaming tab and Upload PCAP button', () => {
    const rawHtml = renderToString(
      <SerialProvider>
        <AlfaWifiWorkbench />
      </SerialProvider>
    );
    // Strip react comments
    const html = rawHtml.replace(/<!--.*?-->/g, '');

    // Verify Roaming tab button is present
    expect(html).toContain('Roaming');

    // Verify Upload PCAP button is present in Action Bar
    expect(html).toContain('Upload PCAP');

    // Verify Connect via WebUSB button is present
    expect(html).toContain('Connect via WebUSB');
  });
});
