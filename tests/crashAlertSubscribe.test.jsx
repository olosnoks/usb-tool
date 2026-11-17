import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { cleanups, makeFakeSerial } from './helpers/runEffects.js';

vi.mock('react', async (orig) => (await import('./helpers/runEffects.js')).mockReactEffects(await orig()));
const serial = { current: null };
vi.mock('../src/context/SerialContext', () => ({ useSerial: () => serial.current }));
const playCrashAlarm = vi.fn();
vi.mock('../src/utils/audioAlert', () => ({ alertSynth: { playCrashAlarm: (...a) => playCrashAlarm(...a) } }));

const { default: CrashAlertDeck } = await import('../src/components/CrashAlertDeck.jsx');

function mount(props = {}) {
  serial.current = makeFakeSerial();
  const onLogMessage = vi.fn();
  const onPauseTerminal = vi.fn();
  const html = renderToString(<CrashAlertDeck onLogMessage={onLogMessage} onPauseTerminal={onPauseTerminal} {...props} />);
  return { fake: serial.current, onLogMessage, onPauseTerminal, html };
}

describe('CrashAlertDeck feeds from subscribeRx', () => {
  beforeEach(() => { playCrashAlarm.mockClear(); cleanups.length = 0; });

  it('subscribes once and renders the idle state', () => {
    const { fake, html } = mount();
    expect(fake.count()).toBe(1);
    expect(html).toContain('No crashes detected');
  });

  it('re-fires for two identical consecutive chunks', () => {
    const { fake, onLogMessage, onPauseTerminal } = mount();
    fake.emit('Kernel panic - not syncing\n');
    fake.emit('Kernel panic - not syncing\n');
    expect(onLogMessage).toHaveBeenCalledTimes(2);
    expect(onPauseTerminal).toHaveBeenCalledTimes(2);
    expect(playCrashAlarm).toHaveBeenCalledTimes(2);
  });

  it('fires exactly once for a panic delivered in three chunks in one tick', () => {
    const { fake, onLogMessage } = mount();
    fake.emit('Guru Med');
    fake.emit('itation Er');
    fake.emit('ror: Core 0 panic\n');
    expect(onLogMessage).toHaveBeenCalledTimes(1);
    expect(onLogMessage.mock.calls[0][0]).toContain('Guru Meditation Error');
  });

  it('decodes a multibyte character split across chunks without breaking the match', () => {
    const { fake, onLogMessage } = mount();
    const bytes = new TextEncoder().encode('é HardFault\n');
    fake.emit(bytes.slice(0, 1));
    fake.emit(bytes.slice(1));
    expect(onLogMessage).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on ordinary output', () => {
    const { fake, onLogMessage } = mount();
    fake.emit('all fine\nstill fine\n');
    expect(onLogMessage).not.toHaveBeenCalled();
  });
});
