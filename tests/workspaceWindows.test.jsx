import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import Desktop from '../src/components/layout/Desktop';
import ToolWindow from '../src/components/layout/ToolWindow';
import Sidebar from '../src/components/layout/Sidebar';
import { toolMeta, renderTool, KNOWN_TOOL_IDS } from '../src/components/ToolRegistry';
import { createInitialState, openWindow, minimizeWindow, toggleMaximize, setZoom, toggleFit } from '../src/utils/windowManager';

const VP = { width: 1400, height: 900 };
const noop = () => {};

describe('windowed workspace', () => {
  it('renders every open tool in its own window with a taskbar entry; minimized windows stay mounted but hidden', () => {
    let s = createInitialState();
    s = openWindow(s, 'mayhem', toolMeta('mayhem'), VP);
    s = openWindow(s, 'terminal', toolMeta('terminal'), VP);
    s = minimizeWindow(s, 'terminal');
    const html = renderToString(
      <Desktop state={s} viewport={VP} onViewport={noop} renderTool={(id) => <div data-tool={id}>{`tool:${id}`}</div>} metaFor={() => ({ icon: null, naturalWidth: 1100 })}
        onFocus={noop} onMove={noop} onResize={noop} onMinimize={noop} onToggleMaximize={noop} onClose={noop} onTile={noop} onCascade={noop} onCloseAll={noop} />
    );
    expect(html).toContain('data-window="mayhem"');
    expect(html).toContain('data-window="terminal"');
    expect(html).toContain('tool:mayhem');
    expect(html).toContain('tool:terminal');                 // still mounted (device connections survive)
    expect(html).toMatch(/data-window="terminal"[^>]*class="[^"]*hidden/);
    expect(html).toContain('data-testid="taskbar"');
    expect(html).toContain('PortaPack Mayhem SDR');
    expect(html).toContain('Terminal &amp; Console');
    expect(html).not.toContain('WORKSPACE EMPTY');
  });

  it('shows the empty-desktop hint and a taskbar with just the Start button when nothing is open', () => {
    const html = renderToString(
      <Desktop state={createInitialState()} viewport={VP} onViewport={noop} renderTool={() => null} metaFor={() => ({ icon: null, naturalWidth: 1100 })}
        onFocus={noop} onMove={noop} onResize={noop} onMinimize={noop} onToggleMaximize={noop} onClose={noop} onTile={noop} onCascade={noop} onCloseAll={noop} />
    );
    expect(html).toContain('WORKSPACE EMPTY');
    expect(html).toContain('data-testid="taskbar"');
    expect(html).toContain('data-testid="start-button"');
  });

  it('a window has eight resize handles unless maximized, and is positioned by its geometry', () => {
    let s = openWindow(createInitialState(), 'flipper', toolMeta('flipper'), VP);
    const win = s.windows[0];
    let html = renderToString(<ToolWindow win={win} focused><p>body</p></ToolWindow>);
    expect((html.match(/data-resize="/g) || []).length).toBe(8);
    expect(html).toContain(`left:${win.x}px`);
    expect(html).toContain(`width:${win.w}px`);
    expect(html).toContain('Flipper Zero Suite');
    s = toggleMaximize(s, 'flipper', VP);
    html = renderToString(<ToolWindow win={s.windows[0]} focused><p>body</p></ToolWindow>);
    expect(html).not.toContain('data-resize=');
    expect(html).toContain('width:100%');
    // narrow screens force every window full-size and drop the maximize button
    html = renderToString(<ToolWindow win={win} focused forceMaximized><p>body</p></ToolWindow>);
    expect(html).toContain('width:100%');
    expect(html).not.toContain('title="Maximize"');
  });

  it('a window applies its content zoom with CSS zoom on a container-query wrapper, and shows the percentage', () => {
    let s = openWindow(createInitialState(), 'terminal', toolMeta('terminal'), VP);
    let html = renderToString(<ToolWindow win={s.windows[0]} focused><p>body</p></ToolWindow>);
    expect(html).toContain('data-tool-zoom="100"');
    expect(html).toContain('@container');
    expect(html).not.toContain('style="zoom');
    expect(html).toContain('>100%<');
    s = setZoom(s, 'terminal', 0.75);
    html = renderToString(<ToolWindow win={s.windows[0]} focused><p>body</p></ToolWindow>);
    expect(html).toContain('style="zoom:0.75"');
    expect(html).toContain('>75%<');
    s = toggleFit(s, 'terminal');
    html = renderToString(<ToolWindow win={s.windows[0]} focused naturalWidth={900}><p>body</p></ToolWindow>);
    expect(html).toMatch(/>FIT \d+%</);
    expect(toolMeta('mayhem').naturalWidth).toBe(1180);
    expect(toolMeta('hex').naturalWidth).toBe(1200);        // alias -> packet lab
    expect(toolMeta('fido2').naturalWidth).toBe(1100);      // default
  });

  it('the sidebar marks tools that already have a window open (aliases included)', () => {
    const html = renderToString(
      <Sidebar activeTool="mayhem" openTools={['mayhem', 'packet-analyzer']} onSelectTool={noop} isCollapsed={false} onToggleCollapse={noop} />
    );
    expect((html.match(/data-open-dot/g) || []).length).toBe(2);
    expect(html).toContain('click to bring its window to the front');
  });

  it('toolMeta resolves titles for every tool id, aliases through their workbench', () => {
    expect(toolMeta('hex').title).toBe('Packet &amp; Protocol Lab'.replace('&amp;', '&'));
    expect(toolMeta('cmsis-dap').title).toBe('Hardware Programmers');
    expect(toolMeta('mayhem').accent).toBe('purple');
    expect(toolMeta('made-up').title).toBe('made-up');
    const serial = {
      isConnected: false, port: null, latestRxText: '', hexByteStream: [], clearHexStream: noop, sendString: noop, sendRawBytes: noop,
      toggleSignal: noop, setBaudRate: noop, baudRate: 115200, addLog: noop, boards: [], activeBoardId: null, setActiveBoardId: noop, setConsolePaused: noop
    };
    for (const id of KNOWN_TOOL_IDS) expect(React.isValidElement(renderTool(id, serial)), id).toBe(true);
    expect(renderToString(renderTool('nope', serial))).toContain('Unknown tool');
  });
});
