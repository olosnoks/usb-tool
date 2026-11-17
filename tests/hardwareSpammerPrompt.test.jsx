import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import HardwareControlsTab from '../src/components/tabs/HardwareControlsTab';
import { createSpammer } from '../src/utils/resetProfiles';

const enc = (s) => new TextEncoder().encode(s);

function setup(prompts = ['=>', 'u-boot>', '# ']) {
  vi.useFakeTimers();
  let listener = null;
  const sent = [];
  const caught = [];
  const subscribeRx = (fn) => { listener = fn; return () => { listener = null; }; };
  const spammer = createSpammer({
    send: async (p) => { sent.push(p); },
    subscribeRx,
    prompts,
    payload: new Uint8Array([0x20]),
    intervalMs: 25,
    onCatch: (p) => caught.push(p)
  });
  return { spammer, sent, caught, rx: (s) => listener && listener(enc(s)), isSubscribed: () => listener !== null };
}

describe('U-Boot spammer prompt catching', () => {
  it('sends bursts at the interval until stopped', async () => {
    const { spammer, sent } = setup();
    spammer.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.length).toBe(4);
    spammer.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.length).toBe(4);
    vi.useRealTimers();
  });

  it('halts exactly once on a prompt split across chunks without a newline', async () => {
    const { spammer, sent, caught, rx, isSubscribed } = setup();
    spammer.start();
    await vi.advanceTimersByTimeAsync(50);
    rx('Hit any key to stop autoboot:  0\r\n');
    expect(caught).toEqual([]);
    rx('U-Bo');
    rx('ot');
    rx('> ');
    expect(caught).toEqual(['u-boot>']);
    const before = sent.length;
    rx('=>');
    await vi.advanceTimersByTimeAsync(200);
    expect(caught).toHaveLength(1);
    expect(sent.length).toBe(before); // no burst after the catch
    expect(spammer.running).toBe(false);
    expect(isSubscribed()).toBe(false);
    vi.useRealTimers();
  });

  it('catches a bare => prompt in a single chunk', async () => {
    const { spammer, caught, rx } = setup();
    spammer.start();
    rx('=>');
    expect(caught).toEqual(['=>']);
    vi.useRealTimers();
  });

  it('stops and reports when a send fails', async () => {
    vi.useFakeTimers();
    const errors = [];
    const sp = createSpammer({
      send: async () => { throw new Error('port closed'); },
      subscribeRx: () => () => {},
      prompts: ['=>'],
      payload: new Uint8Array([1]),
      intervalMs: 10,
      onError: (e) => errors.push(e.message)
    });
    sp.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toEqual(['port closed']);
    expect(sp.running).toBe(false);
    vi.useRealTimers();
  });
});

describe('HardwareControlsTab', () => {
  it('renders the reset profile panel with all platforms and no console errors', () => {
    const html = renderToString(<SerialProvider><HardwareControlsTab /></SerialProvider>);
    expect(html).toContain('RESET &amp; BOOTLOADER PROFILES');
    expect(html).toContain('Arduino');
    expect(html).toContain('STM32');
    expect(html).toContain('1200-baud touch');
    expect(html).toContain('TRIGGER ESP32 BOOTLOADER MODE');
  });
});
