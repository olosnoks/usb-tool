import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CmsisDapClient, CMSIS_DAP_HW_UNSUPPORTED } from '../src/utils/cmsisDapDriver';
import { UsbPdClient } from '../src/utils/usbPdDriver';
import { JtagClient } from '../src/utils/jtagDriver';
import SensorHubDeck from '../src/components/tools/hackrf/SensorHubDeck';
import HamRadioDeck from '../src/components/tools/hackrf/HamRadioDeck';
import LookingGlassDeck from '../src/components/tools/hackrf/LookingGlassDeck';
import KismetStudioWorkbench from '../src/components/tools/KismetStudioWorkbench';

// Tools must never report hardware results they did not get from hardware.
describe('simulated data is never passed off as hardware', () => {
  it('CMSIS-DAP refuses real probes instead of faking halt / step / writes', async () => {
    const c = new CmsisDapClient(() => {});
    await expect(c.connectHid()).rejects.toThrow(CMSIS_DAP_HW_UNSUPPORTED);
    // Even if something marks it connected without the simulator, nothing fakes success.
    c.connected = true; c.simulated = false;
    await expect(c.halt()).rejects.toThrow(/not supported/);
    await expect(c.resume()).rejects.toThrow(/not supported/);
    await expect(c.step()).rejects.toThrow(/not supported/);
    await expect(c.readRegisters()).rejects.toThrow(/not supported/);
    await expect(c.readMemory()).rejects.toThrow(/not supported/);
    await expect(c.writeMemoryWord(0x20000000, 1)).rejects.toThrow(/not supported/);
  });

  it('CMSIS-DAP demo still works', async () => {
    const c = new CmsisDapClient(() => {});
    c.connectSimulation();
    const regs = await c.halt();
    expect(regs.length).toBeGreaterThan(0);
  });

  it('USB-PD refuses hardware instead of showing simulated VBUS readings', async () => {
    const c = new UsbPdClient(() => {});
    await expect(c.connectHardware()).rejects.toThrow(/not supported yet/);
  });

  it('JTAG SVF playback says it was simulated, not that TDO passed', async () => {
    const logs = [];
    const c = new JtagClient((m) => logs.push(m));
    c.connectSimulation();
    await c.playSvf('SIR 8 TDI (FE);\nSDR 32 TDI (00000000) TDO (12345678);');
    const last = logs[logs.length - 1];
    expect(last).toMatch(/Simulated run/);
    expect(logs.join('\n')).not.toMatch(/verification PASSED/);
  });

  it('HackRF decoder decks show no invented data on real hardware', () => {
    const sensorsHw = renderToString(<SensorHubDeck centerFreq={433920000} onTuneFreq={() => {}} isDemo={false} />);
    expect(sensorsHw).not.toContain('KeeLoq HCS301');
    expect(sensorsHw).toContain('Demo only');

    const sensorsDemo = renderToString(<SensorHubDeck centerFreq={433920000} onTuneFreq={() => {}} isDemo />);
    expect(sensorsDemo).toContain('KeeLoq HCS301');
    expect(sensorsDemo).toContain('Simulated data');

    const hamHw = renderToString(<HamRadioDeck centerFreq={14074000} onTuneFreq={() => {}} isDemo={false} />);
    expect(hamHw).not.toContain('CQ K1HTV FM18');
    const hamDemo = renderToString(<HamRadioDeck centerFreq={14074000} onTuneFreq={() => {}} isDemo />);
    expect(hamDemo).toContain('CQ K1HTV FM18');

    const sweepHw = renderToString(<LookingGlassDeck driver={null} centerFreq={100000000} sampleRate={2000000} onTuneFreq={() => {}} isDemo={false} />);
    expect(sweepHw).not.toContain('Simulated data');
    const sweepDemo = renderToString(<LookingGlassDeck driver={null} centerFreq={100000000} sampleRate={2000000} onTuneFreq={() => {}} isDemo />);
    expect(sweepDemo).toContain('Simulated data');
  });

  it('Kismet Studio starts with demo mode off and no mock devices', () => {
    const html = renderToString(<KismetStudioWorkbench />);
    expect(html).not.toContain('Corporate_Corp_Sec5G');
  });
});
