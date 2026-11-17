import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import FlightControllerWorkbench from '../src/components/tools/FlightControllerWorkbench.jsx';
import { SerialProvider } from '../src/context/SerialContext.jsx';

// Server render (no browser APIs): the tool loads and shows its idle, disconnected state.
describe('FlightControllerWorkbench', () => {
  it('renders the disconnected idle state inside the serial provider', () => {
    const html = renderToString(
      <SerialProvider>
        <FlightControllerWorkbench />
      </SerialProvider>,
    );
    expect(html).toContain('Flight Controller Configurator');
    expect(html).toContain('DISCONNECTED');
    expect(html).toContain('Connect serial port');
    expect(html).toContain('Read identity');
    expect(html).toContain('Nothing is shown until the flight controller answers');
  });

  it('shows a clear message when the serial context is missing', () => {
    const html = renderToString(<FlightControllerWorkbench />);
    expect(html).toContain('need the app');
  });
});
