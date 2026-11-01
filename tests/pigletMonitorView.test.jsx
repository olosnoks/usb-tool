import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import PigletMonitor from '../src/components/workbenches/piglet/PigletMonitor';

// A minimal client stub: the monitor only calls these inside effects (which do
// not run under renderToString), so render-time just needs them to exist.
const stubClient = () => ({
  connected: true,
  onLine: () => () => {},
  isIdle: () => true,
  stat: async () => ({}),
  meshIdent: () => {},
  meshGroup: () => {}
});

describe('PigletMonitor view', () => {
  it('shows the empty prompt when disconnected', () => {
    const html = renderToString(<PigletMonitor client={{ onLine: () => () => {}, isIdle: () => true, stat: async () => ({}) }} connected={false} info="" />);
    expect(html).toContain('Connect a WarHog over USB to see live telemetry');
    expect(html).not.toContain('>Resources<');
  });

  it('renders the Resources pane above the Mesh pane when connected', () => {
    const html = renderToString(<PigletMonitor client={stubClient()} connected info="fw=2.84 model=c5 proto=1" />);
    const r = html.indexOf('>Resources<');
    const m = html.indexOf('>Mesh<');
    expect(r).toBeGreaterThan(-1);
    expect(m).toBeGreaterThan(-1);
    expect(r).toBeLessThan(m);                               // resources first, mesh under it
    // the board / firmware chips read from the HELLO info
    expect(html).toContain('>c5<');
    expect(html).toContain('>2.84<');
    // mesh roster explains it needs a Core
    expect(html).toContain('Mesh roster appears when this board runs as a Core');
  });
});
