import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import AlfaWifiWorkbench from '../src/components/workbenches/AlfaWifiWorkbench';
import CyberChefWorkbench from '../src/components/tools/CyberChefWorkbench';
import UsbPdWorkbench from '../src/components/tools/UsbPdWorkbench';

describe('previously unreachable UI is wired up', () => {
  it('Alfa renders an Export dropdown trigger, disabled with nothing captured, and no simulate mode', () => {
    const html = renderToString(<SerialProvider><AlfaWifiWorkbench /></SerialProvider>);
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>/);
    const exportBtn = html.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)[0];
    expect(exportBtn).toContain('disabled');
    expect(html).toContain('Export');
    expect(html).not.toMatch(/Simulate RF|Simulated/);
  });

  it('CyberChef renders a Presentation mode toggle in the toolbar', () => {
    const html = renderToString(<SerialProvider><CyberChefWorkbench /></SerialProvider>);
    expect(html).toContain('Presentation mode');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('Exit Presentation');
  });

  it('USB-PD no longer renders permanently disabled simulated PDO buttons', () => {
    const html = renderToString(<UsbPdWorkbench />);
    expect(html).not.toContain('FIXED VOLTAGE CONTRACTS');
    expect(html).not.toContain('PPS VARIABLE VOLTAGE');
  });
});
