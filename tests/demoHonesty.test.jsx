import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CmsisDapClient } from '../src/utils/cmsisDapDriver';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { UsbPdClient } from '../src/utils/usbPdDriver';
import { JtagClient } from '../src/utils/jtagDriver';
import SensorHubDeck from '../src/components/tools/hackrf/SensorHubDeck';
import HamRadioDeck from '../src/components/tools/hackrf/HamRadioDeck';
import LookingGlassDeck from '../src/components/tools/hackrf/LookingGlassDeck';
import KismetStudioWorkbench from '../src/components/tools/KismetStudioWorkbench';
import { ProxmarkDevice, evaluateCompatibility } from '../src/devices/proxmark';

// Tools must never report hardware results they did not get from hardware.
describe('simulated data is never passed off as hardware', () => {
  it('CMSIS-DAP never reports success without a probe or the simulator', async () => {
    const c = new CmsisDapClient(() => {});
    await expect(c.halt()).rejects.toThrow(/not connected/);
    await expect(c.readMemory()).rejects.toThrow(/not connected/);
    await expect(c.writeMemoryWord(0x20000000, 1)).rejects.toThrow(/not connected/);
  });

  it('CMSIS-DAP demo still works', async () => {
    const c = new CmsisDapClient(() => {});
    c.connectSimulation();
    const regs = await c.halt();
    expect(regs.length).toBeGreaterThan(0);
  });

  it('USB-PD shows no readings when the STUSB4500 path finds no Bus Pirate', async () => {
    const link = new SerialLink(new FakeSerialPort(() => {}));
    await link.open({ baudRate: 115200 });
    const c = new UsbPdClient(() => {});
    await expect(c.connectHardware({ link })).rejects.toThrow(/BBIO1/);
    expect(c.isConnected).toBe(false);
  }, 10000);

  it('JTAG SVF playback says it was simulated, not that TDO passed', async () => {
    const logs = [];
    const c = new JtagClient((m) => logs.push(m));
    c.connectSimulation();
    await c.playSvf('SIR 8 TDI (FE);\nSDR 32 TDI (00000000) TDO (12345678);');
    const last = logs[logs.length - 1];
    expect(last).toMatch(/Simulated run/);
    expect(logs.join('\n')).not.toMatch(/verification PASSED/);
  });

  it('HackRF decoder decks show no invented data (demo removed)', () => {
    const sensors = renderToString(<SensorHubDeck centerFreq={433920000} onTuneFreq={() => {}} />);
    expect(sensors).not.toContain('KeeLoq HCS301');
    expect(sensors).toContain('Demo only'); // honest "not implemented" banner

    const ham = renderToString(<HamRadioDeck centerFreq={14074000} onTuneFreq={() => {}} />);
    expect(ham).not.toContain('CQ K1HTV FM18');
    expect(ham).toContain('Demo only');

    const sweep = renderToString(<LookingGlassDeck driver={null} centerFreq={100000000} sampleRate={2000000} onTuneFreq={() => {}} />);
    expect(sweep).not.toContain('Simulated data');
  });

  it('Kismet Studio starts with demo mode off and no mock devices', () => {
    const html = renderToString(<KismetStudioWorkbench />);
    expect(html).not.toContain('Corporate_Corp_Sec5G');
  });

  it('Proxmark: a device that never answers is UNKNOWN, not a made-up Proxmark3 Easy', async () => {
    const readable = new ReadableStream({ pull() {} });           // silent device
    const writable = new WritableStream({ write() {} });
    const port = {
      readable: null, writable: null,
      open: async () => { port.readable = readable; port.writable = writable; },
      close: async () => { port.readable = null; port.writable = null; }
    };
    const device = new ProxmarkDevice();
    const identity = await device.connect(port);
    expect(identity.hardwareTarget).toBe('UNKNOWN');
    expect(identity.rawVersionString).toMatch(/No answer/);
    expect(evaluateCompatibility(identity)).toBe('unsupported');
    await device.disconnect('test done');
  }, 10000);
});
