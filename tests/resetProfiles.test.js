import { describe, it, expect } from 'vitest';
import {
  RESET_PROFILES, buildProfileSteps, buildStm32Sequence, invertSteps, normalizeSteps,
  parseSequence, serializeSequence, runSignalSequence, touch1200, portTouchDeps, suggestProfile,
  createPromptWatcher
} from '../src/utils/resetProfiles';

// Fake SerialPort recording every call with a fake clock
function fakePort(clock) {
  const calls = [];
  return {
    calls,
    setSignals: async (s) => { calls.push({ t: clock.now, call: 'setSignals', s }); },
    open: async (o) => { calls.push({ t: clock.now, call: 'open', o }); },
    close: async () => { calls.push({ t: clock.now, call: 'close' }); }
  };
}
const makeClock = () => {
  const clock = { now: 0 };
  clock.sleep = async (ms) => { clock.now += ms; };
  clock.read = () => clock.now;
  return clock;
};

describe('profile sequences issue the documented setSignals', () => {
  it('ESP32 classic bootloader: EN low/IO0 low, release EN, release IO0', async () => {
    const clock = makeClock();
    const port = fakePort(clock);
    const steps = buildProfileSteps('esp32-classic', 'bootloader', { timing: { resetMs: 150, bootHoldMs: 50 } });
    const t = await runSignalSequence(port, steps, { sleep: clock.sleep, now: clock.read });
    expect(port.calls.map((c) => c.s)).toEqual([
      { dataTerminalReady: false, requestToSend: true },
      { dataTerminalReady: true, requestToSend: false },
      { dataTerminalReady: false, requestToSend: false }
    ]);
    expect(t.map((x) => x.actualMs)).toEqual([150, 50, 0]);
    expect(port.calls.map((c) => c.t)).toEqual([0, 150, 200]);
  });

  it('ESP32 classic reset is a single RTS pulse', () => {
    expect(buildProfileSteps('esp32-classic', 'reset')).toEqual([
      { dtr: false, rts: true, waitMs: 120 },
      { dtr: false, rts: false, waitMs: 50 }
    ]);
  });

  it('ESP32 native USB follows the USB-Serial/JTAG sequence', () => {
    expect(buildProfileSteps('esp32-native', 'bootloader')).toEqual([
      { dtr: false, rts: false, waitMs: 100 },
      { dtr: true, rts: false, waitMs: 100 },
      { dtr: false, rts: true, waitMs: 100 },
      { dtr: false, rts: false, waitMs: 0 }
    ]);
  });

  it('Arduino pulses DTR and releases', async () => {
    const clock = makeClock();
    const port = fakePort(clock);
    await runSignalSequence(port, buildProfileSteps('arduino', 'reset'), { sleep: clock.sleep, now: clock.read });
    const dtr = port.calls.map((c) => c.s.dataTerminalReady);
    expect(dtr).toEqual([false, true, false]);
    expect(port.calls[2].t - port.calls[1].t).toBe(250);
  });

  it('STM32 maps BOOT0/NRST with polarity options', () => {
    // Default: BOOT0 on DTR, NRST on RTS, asserted = pin low
    expect(buildStm32Sequence('bootloader')).toEqual([
      { waitMs: 100, dtr: false, rts: true },   // BOOT0 high (released), NRST low (asserted)
      { waitMs: 50, dtr: false, rts: false }    // NRST released, BOOT0 still high
    ]);
    expect(buildStm32Sequence('reset')).toEqual([
      { waitMs: 100, dtr: true, rts: true },    // BOOT0 low, NRST low
      { waitMs: 50, dtr: true, rts: false }
    ]);
    // Swapped pins and inverted BOOT0
    expect(buildStm32Sequence('bootloader', { boot0: 'rts', invertBoot0: true })).toEqual([
      { waitMs: 100, rts: true, dtr: true },
      { waitMs: 50, rts: true, dtr: false }
    ]);
  });

  it('invert flips every defined level', () => {
    expect(invertSteps([{ dtr: true, waitMs: 5 }, { rts: false, waitMs: 1 }])).toEqual([{ dtr: false, waitMs: 5 }, { rts: true, waitMs: 1 }]);
    expect(buildProfileSteps('arduino', 'reset', { invert: true })[1]).toMatchObject({ dtr: false, rts: true });
  });

  it('lists a touch profile without signal steps', () => {
    expect(RESET_PROFILES.map((p) => p.id)).toEqual(['esp32-classic', 'esp32-native', 'arduino', 'stm32', 'touch1200']);
    expect(buildProfileSteps('touch1200', 'bootloader')).toBeNull();
  });
});

describe('1200-baud touch', () => {
  it('opens at 1200, drops DTR, closes, and asks for a new port', async () => {
    const clock = makeClock();
    const port = fakePort(clock);
    const res = await touch1200(portTouchDeps(port, { sleep: clock.sleep }), { holdMs: 100, settleMs: 250 });
    const seq = port.calls.map((c) => c.call);
    expect(seq.slice(-3)).toEqual(['open', 'setSignals', 'close']);
    expect(port.calls.find((c) => c.call === 'open').o).toEqual({ baudRate: 1200 });
    expect(port.calls.find((c) => c.call === 'setSignals').s).toEqual({ dataTerminalReady: false, requestToSend: false });
    expect(res.needsNewPort).toBe(true);
    expect(res.calls).toEqual(['open(1200)', 'setSignals(dtr=false,rts=false)', 'close()']);
    expect(clock.now).toBe(350);
  });
});

describe('suggest by USB id', () => {
  it('suggests, never decides', () => {
    expect(suggestProfile({ usbVendorId: 0x2E8A })).toBe('touch1200');
    expect(suggestProfile({ usbVendorId: 0x303A, usbProductId: 0x1001 })).toBe('esp32-native');
    expect(suggestProfile({ usbVendorId: 0x2341 })).toBe('arduino');
    expect(suggestProfile({ usbVendorId: 0x0483 })).toBe('stm32');
    expect(suggestProfile({ usbVendorId: 0x10C4 })).toBe('esp32-classic');
    expect(suggestProfile({ usbVendorId: 0x9999 })).toBeNull();
    expect(suggestProfile(null)).toBeNull();
  });
});

describe('user-defined sequences', () => {
  it('round-trips JSON and rejects bad input', () => {
    const steps = [{ dtr: true, waitMs: 20 }, { rts: false, waitMs: 0 }];
    const text = serializeSequence('mine', steps);
    expect(parseSequence(text)).toEqual({ name: 'mine', steps });
    expect(parseSequence('[{"dtr":true,"waitMs":10}]').steps).toEqual([{ dtr: true, waitMs: 10 }]);
    expect(() => normalizeSteps([])).toThrow();
    expect(() => normalizeSteps([{ dtr: 'yes', waitMs: 1 }])).toThrow(/true or false/);
    expect(() => normalizeSteps([{ waitMs: 99999 }])).toThrow(/waitMs/);
    expect(() => parseSequence('nope')).toThrow(/Invalid JSON/);
  });
});

describe('prompt watcher', () => {
  const enc = (s) => new TextEncoder().encode(s);
  it('catches a prompt with no newline, split across chunks, exactly once', () => {
    const w = createPromptWatcher(['=>', 'u-boot>']);
    expect(w.push(enc('Hit any key to stop autoboot:  0\r\n'))).toBeNull();
    expect(w.push(enc('U-Boo'))).toBeNull();
    expect(w.push(enc('t> '))).toBe('u-boot>');
    expect(w.push(enc('=>'))).toBeNull();
    expect(w.fired).toBe(true);
  });
});
