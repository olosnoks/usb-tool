import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

const serial = {
  isConnected: false, isConnecting: false, baudRate: 115200, setBaudRate: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  connectBle: vi.fn(), hasWebBluetoothSupport: true, rxActivity: false, txActivity: false,
  boards: [{ id: 'a', name: 'Board A' }], activeBoardId: 'a', setActiveBoardId: vi.fn(), portInfo: null,
  entries: [{ id: 1, timestamp: '00:00:01', type: 'rx', text: 'hello' }], sendString: vi.fn(), clearLogs: vi.fn(),
};
vi.mock('../src/context/SerialContext', () => ({ useSerial: () => serial }));

const { TaskbarSerial } = await import('../src/components/layout/TaskbarControls.jsx');
const { default: TerminalDrawer } = await import('../src/components/layout/TerminalDrawer.jsx');

// The serial strip lives in the taskbar; the drawer slides up above it and renders nothing when closed.
describe('taskbar serial strip and drawer', () => {
  it('taskbar strip shows the SERIAL toggle and the connection controls', () => {
    const html = renderToString(<TaskbarSerial isDrawerOpen={false} onToggleDrawer={() => {}} />);
    expect(html).toContain('SERIAL');
    expect(html).toContain('CONNECT');
    expect(html).toContain('OFFLINE');
    expect(html).toContain('aria-expanded="false"');
  });

  it('drawer renders nothing when closed and the log + send bar when open', () => {
    expect(renderToString(<TerminalDrawer isOpen={false} onToggleOpen={() => {}} />)).toBe('');
    const html = renderToString(<TerminalDrawer isOpen onToggleOpen={() => {}} onNavigateToFullTerminal={() => {}} />);
    expect(html).toContain('SERIAL TERMINAL');
    expect(html).toContain('hello');
    expect(html).toContain('SEND');
    expect(html).not.toContain('BAUD'); // connection controls are in the taskbar now
  });
});
