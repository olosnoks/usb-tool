import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import GpsNavigationSuite from '../src/components/tools/GpsNavigationSuite';

describe('GPS toolkit tab', () => {
  it('renders decoder cards', () => {
    const html = renderToString(<SerialProvider><GpsNavigationSuite initialTab="toolkit" /></SerialProvider>);
    expect(html).toContain('NMEA checksum and field decoder');
    expect(html).toContain('checksum OK');
    expect(html).toContain('UBX frame builder and decoder');
    expect(html).toContain('Coordinate converter and distance');
  });
});
