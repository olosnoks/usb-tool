import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import ElectronicsCalcWorkbench from '../src/components/tools/ElectronicsCalcWorkbench.jsx';

// Server render of the idle tool (default UART tab): proves the module loads without a browser
// and shows the tab bar and the default UART inputs with real computed results.
describe('ElectronicsCalcWorkbench', () => {
  it('renders the tab bar and the UART calculator', () => {
    const html = renderToString(<ElectronicsCalcWorkbench />);
    expect(html).toContain('Electronics Calculators');
    for (const label of ['UART baud', 'I2C pull-up', 'Resistors', 'RC / RLC', '555 / Reg', 'Battery', 'PCB &amp; Ohm', 'ADC']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('AVR USART, normal');
    expect(html).toContain('Standard bauds');
  });
});
