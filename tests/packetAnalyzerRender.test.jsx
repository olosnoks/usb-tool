import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import PacketAnalyzerWorkbench from '../src/components/tools/PacketAnalyzerWorkbench';

describe('PacketAnalyzerWorkbench initial state', () => {
  const html = renderToString(<SerialProvider><PacketAnalyzerWorkbench /></SerialProvider>);
  it('starts empty, idle and without demo data or LIVE MONITORING', () => {
    expect(html).not.toContain('LIVE MONITORING');
    expect(html).not.toContain('DEMO DATA');
    expect(html).not.toContain('Home_IoT_Secure');
    expect(html).toContain('No frames loaded');
    expect(html).toContain('IDLE');
    expect(html).toContain('Frames: <strong class="text-purple-300">0</strong>');
  });
  it('offers open capture and a labelled demo button', () => {
    expect(html).toContain('Open capture');
    expect(html).toContain('Load demo frames');
  });
});
