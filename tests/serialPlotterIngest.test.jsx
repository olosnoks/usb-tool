import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { cleanups, makeFakeSerial } from './helpers/runEffects.js';

vi.mock('react', async (orig) => (await import('./helpers/runEffects.js')).mockReactEffects(await orig()));
const serial = { current: null };
vi.mock('../src/context/SerialContext', () => ({ useSerial: () => serial.current }));

const { default: SerialPlotter } = await import('../src/components/SerialPlotter.jsx');

function mount() {
  serial.current = makeFakeSerial();
  const engineRef = { current: null };
  const html = renderToString(<SerialPlotter isConnected engineRef={engineRef} />).replace(/<!-- -->/g, '');
  return { fake: serial.current, engine: engineRef.current, html };
}

describe('SerialPlotter ingestion through subscribeRx', () => {
  beforeEach(() => { cleanups.length = 0; });

  it('renders an empty state with no fabricated channels', () => {
    const { html, fake } = mount();
    expect(fake.count()).toBe(1);
    expect(html).toContain('No active numeric channels detected');
    expect(html).toContain('0 / 50,000 samples');
  });

  it('plots exactly 10 000 samples when 10 000 lines arrive as 7-byte chunks', () => {
    const { fake, engine } = mount();
    const bytes = new TextEncoder().encode(Array.from({ length: 10000 }, (_, i) => `${i % 90},${i % 7}`).join('\n') + '\n');
    for (let i = 0; i < bytes.length; i += 7) fake.emit(bytes.slice(i, i + 7));
    expect(engine.points.length).toBe(10000);
    expect(engine.points[9999].values).toEqual([9999 % 90, 9999 % 7]);
  });

  it('adds a sample for every repeated identical line and joins split lines', () => {
    const { fake, engine } = mount();
    fake.emit('512\n');
    fake.emit('512\n');
    fake.emit('51');
    fake.emit('2\n');
    expect(engine.points.map((p) => p.values[0])).toEqual([512, 512, 512]);
  });

  it('exposes the trigger controls once enabled and the FFT/XY mode switches', () => {
    const { html } = mount();
    expect(html).toContain('aria-label="Enable trigger"');
    expect(html).toContain('>time<');
    expect(html).toContain('>fft<');
    expect(html).toContain('>xy<');
  });
});
