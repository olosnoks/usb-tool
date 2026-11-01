import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SerialProvider, useSerial } from './context/SerialContext';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import Desktop from './components/layout/Desktop';
import { setCurrentTool, record } from './utils/sessionLog';
import TerminalDrawer from './components/layout/TerminalDrawer';
import { WORKSPACE_PRESETS } from './components/layout/WorkspacePresets';
import { renderTool, toolMeta } from './components/ToolRegistry';
import {
  createInitialState, openWindow, closeWindow, closeAll, focusWindow, minimizeWindow, toggleMaximize,
  moveWindow, resizeWindow, tileWindows, cascadeWindows, focusedWindow, clampToViewport, loadState, saveState
} from './utils/windowManager';

// Modals
import CommandPalette from './components/CommandPalette';
import HardwareIntelligenceModal from './components/HardwareIntelligenceModal';
import PinoutModal from './components/PinoutModal';

/** The tool named in the URL (?tool= or #tool=), if any. */
function toolFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTool = params.get('tool');
    if (urlTool && !urlTool.endsWith('-modal')) return urlTool;
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('tool=')) return hash.replace('tool=', '');
  } catch (e) { /* no window */ }
  return null;
}

/** A first guess at the desktop size before it has been measured. */
function guessViewport() {
  try { return { width: Math.max(600, window.innerWidth - 280), height: Math.max(400, window.innerHeight - 120) }; }
  catch (e) { return { width: 1200, height: 760 }; }
}

function AppContent() {
  const serial = useSerial();
  const { isConnected, connect, disconnect, clearLogs, setBaudRate, portInfo, boards } = serial;

  // ---- window manager --------------------------------------------------------
  const viewportRef = useRef(guessViewport());
  const [viewport, setViewportState] = useState(viewportRef.current);
  const [wm, setWm] = useState(() => {
    const vp = viewportRef.current;
    const saved = loadState(vp);
    const urlTool = toolFromUrl();
    // Fresh visit: an empty desktop. A ?tool= link opens that tool; a saved
    // layout from the last visit comes back as it was.
    let s = saved || createInitialState();
    if (urlTool) s = openWindow(s, urlTool, toolMeta(urlTool), vp);
    return s;
  });

  const onViewport = useCallback((vp) => {
    if (!vp || vp.width <= 0 || vp.height <= 0) return;
    const prev = viewportRef.current;
    if (prev.width === vp.width && prev.height === vp.height) return;
    viewportRef.current = vp;
    setViewportState(vp);
    // Keep every window reachable when the desktop shrinks.
    setWm((s) => ({ ...s, windows: s.windows.map((w) => (w.maximized ? w : clampToViewport(w, vp))) }));
  }, []);

  // Persist the layout (a short debounce so dragging doesn't hammer storage).
  useEffect(() => {
    const t = setTimeout(() => saveState(wm), 150);
    return () => clearTimeout(t);
  }, [wm]);

  const open = useCallback((toolId) => setWm((s) => openWindow(s, toolId, toolMeta(toolId), viewportRef.current)), []);
  const onFocus = useCallback((id) => setWm((s) => focusWindow(s, id)), []);
  const onClose = useCallback((id) => setWm((s) => closeWindow(s, id)), []);
  const onMinimize = useCallback((id) => setWm((s) => minimizeWindow(s, id)), []);
  const onToggleMaximize = useCallback((id) => setWm((s) => toggleMaximize(s, id, viewportRef.current)), []);
  const onMove = useCallback((id, x, y) => setWm((s) => moveWindow(s, id, x, y, viewportRef.current)), []);
  const onResize = useCallback((id, geo) => setWm((s) => resizeWindow(s, id, geo, viewportRef.current)), []);
  const onTile = useCallback(() => setWm((s) => tileWindows(s, viewportRef.current)), []);
  const onCascade = useCallback(() => setWm((s) => cascadeWindows(s, viewportRef.current)), []);
  const onCloseAll = useCallback(() => setWm((s) => closeAll(s)), []);

  const focused = focusedWindow(wm);
  const activeTool = focused?.toolId || null;           // the tool whose window has focus
  const openTools = useMemo(() => wm.windows.map((w) => w.id), [wm.windows]);
  const iconFor = useCallback((toolId) => toolMeta(toolId).icon, []);
  const renderToolInWindow = useCallback((toolId) => renderTool(toolId, serial), [serial]);

  // Sidebar collapse state (persisted)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('skon_sidebar_collapsed') === 'true'; } catch (e) { return false; }
  });
  const handleToggleSidebar = (collapsed) => {
    setIsSidebarCollapsed(collapsed);
    try { localStorage.setItem('skon_sidebar_collapsed', String(collapsed)); } catch (e) { /* ignore */ }
  };

  // Live Terminal Drawer state (closed by default)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Modals
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHardwareIntelOpen, setIsHardwareIntelOpen] = useState(false);
  const [isPinoutModalOpen, setIsPinoutModalOpen] = useState(false);

  // Attribute session-log entries (device picks, confirmations) to the focused tool
  const lastOpened = useRef(null);
  useEffect(() => {
    if (!activeTool || activeTool === 'session-log' || lastOpened.current === activeTool) return;
    lastOpened.current = activeTool;
    const name = toolMeta(activeTool).title;
    if (!['programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp'].includes(activeTool)) setCurrentTool(name);
    record(name, 'info', `Opened ${name}`);
  }, [activeTool]);

  // Check URL params for modal triggers
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTool = params.get('tool');
      if (urlTool === 'pinouts-modal') setIsPinoutModalOpen(true);
      if (urlTool === 'intel-modal') setIsHardwareIntelOpen(true);
    } catch (e) { /* ignore */ }
  }, []);

  // Handle preset selection
  const handleSelectPreset = useCallback((preset) => {
    open(preset.toolId);
    if (preset.openDrawer !== undefined) setIsDrawerOpen(preset.openDrawer);
  }, [open]);

  // Global hotkeys (Ctrl+K, Ctrl+`, Alt+1..6)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Command Palette (Ctrl+K or Cmd+K)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }
      // Toggle Terminal Drawer (Ctrl+` or Ctrl+J)
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key.toLowerCase() === 'j')) {
        e.preventDefault();
        setIsDrawerOpen((prev) => !prev);
        return;
      }
      // Quick Workspace Presets (Alt+1 .. Alt+6)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= WORKSPACE_PRESETS.length) {
          e.preventDefault();
          handleSelectPreset(WORKSPACE_PRESETS[num - 1]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectPreset]);

  // Find active preset matching the focused tool
  const currentActivePreset = WORKSPACE_PRESETS.find((p) => p.toolId === activeTool)?.id;

  return (
    <div className="h-screen bg-cyber-darkest text-slate-200 flex flex-col font-mono selection:bg-cyan-500/30 selection:text-cyan-300 overflow-hidden">
      {/* 1. Global Persistent Header */}
      <Header
        activeTool={activeTool || 'flasher'}
        activePreset={currentActivePreset}
        onSelectPreset={handleSelectPreset}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        onOpenPinouts={() => setIsPinoutModalOpen(true)}
      />

      {/* 2. Main Workspace Layout: Sidebar + windowed desktop */}
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar
          activeTool={activeTool}
          openTools={openTools}
          onSelectTool={(toolId) => {
            open(toolId);
            // The full terminal makes the drawer redundant
            if (toolId === 'terminal') setIsDrawerOpen(false);
          }}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onOpenPinouts={() => setIsPinoutModalOpen(true)}
          onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        />

        {/* Desktop with the tool windows, and the bottom terminal drawer */}
        <div className="flex-1 flex flex-col overflow-hidden bg-cyber-darkest min-w-0">
          <Desktop
            state={wm} viewport={viewport} onViewport={onViewport}
            renderTool={renderToolInWindow} iconFor={iconFor}
            onFocus={onFocus} onMove={onMove} onResize={onResize} onMinimize={onMinimize}
            onToggleMaximize={onToggleMaximize} onClose={onClose}
            onTile={onTile} onCascade={onCascade} onCloseAll={onCloseAll}
          />

          <TerminalDrawer
            isOpen={isDrawerOpen}
            onToggleOpen={() => setIsDrawerOpen(!isDrawerOpen)}
            onNavigateToFullTerminal={() => { open('terminal'); setIsDrawerOpen(false); }}
          />
        </div>
      </div>

      {/* Global Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={(tabId) => { open(tabId); setIsCommandPaletteOpen(false); }}
        onConnect={connect}
        onDisconnect={disconnect}
        onClearLogs={clearLogs}
        onSetBaud={setBaudRate}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        onOpenPinouts={() => setIsPinoutModalOpen(true)}
        onExportSession={() => {
          // Every board's settings and log, as JSON.
          const session = {
            exportedAt: new Date().toISOString(),
            boards: boards.map((b) => ({
              id: b.id, name: b.name, baudRate: b.baudRate, serialConfig: b.serialConfig,
              portInfo: b.portInfo, isConnected: b.isConnected,
              entries: (b.entries || []).map((e) => ({ timestamp: e.timestamp, type: e.type, text: e.text }))
            }))
          };
          const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = `usb-tool-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
        isConnected={isConnected}
      />

      <HardwareIntelligenceModal isOpen={isHardwareIntelOpen} onClose={() => setIsHardwareIntelOpen(false)} portInfo={portInfo} />
      <PinoutModal isOpen={isPinoutModalOpen} onClose={() => setIsPinoutModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <SerialProvider>
      <AppContent />
    </SerialProvider>
  );
}
