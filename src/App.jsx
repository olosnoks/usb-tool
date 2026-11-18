import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SerialProvider, useSerial } from './context/SerialContext';
import { TaskbarSerial, TaskbarTray } from './components/layout/TaskbarControls';
import Desktop from './components/layout/Desktop';
import { setCurrentTool, record } from './utils/sessionLog';
import TerminalDrawer from './components/layout/TerminalDrawer';
import { WORKSPACE_PRESETS } from './components/layout/WorkspacePresets';
import { renderTool, toolMeta } from './components/ToolRegistry';
import useIsMobile from './hooks/useIsMobile';
import {
  createInitialState, openWindow, closeWindow, closeAll, focusWindow, minimizeWindow, toggleMaximize,
  moveWindow, resizeWindow, tileWindows, cascadeWindows, focusedWindow, clampToViewport, saveState, zoomStep, toggleFit,
  duplicateWindow, applySnap, setZoom
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
  try { return { width: Math.max(600, window.innerWidth - 24), height: Math.max(400, window.innerHeight - 120) }; }
  catch (e) { return { width: 1200, height: 760 }; }
}

function AppContent() {
  const serial = useSerial();
  const { isConnected, connect, disconnect, clearLogs, setBaudRate, portInfo, boards } = serial;

  // Phone-width sessions open tools at 70% and show the sidebar as an overlay.
  const isMobile = useIsMobile();
  const mobileZoomRef = useRef(isMobile ? 0.7 : 1);
  mobileZoomRef.current = isMobile ? 0.7 : 1;

  // ---- window manager --------------------------------------------------------
  const viewportRef = useRef(guessViewport());
  const [viewport, setViewportState] = useState(viewportRef.current);
  const [wm, setWm] = useState(() => {
    const vp = viewportRef.current;
    const urlTool = toolFromUrl();
    // Fresh visit / hard refresh: start with an empty workspace (no tools open).
    // An explicit ?tool= or #tool= link opens that specific tool.
    let s = createInitialState();
    if (urlTool) s = openWindow(s, urlTool, toolMeta(urlTool), vp, { zoom: mobileZoomRef.current });
    return s;
  });

  // Clear any legacy saved layout so fresh loads / hard refreshes always start with no tools open
  useEffect(() => {
    try { localStorage.removeItem('skon-workspace-windows-v1'); } catch (e) { /* ignore */ }
  }, []);

  const onViewport = useCallback((vp) => {
    if (!vp || vp.width <= 0 || vp.height <= 0) return;
    const prev = viewportRef.current;
    if (prev.width === vp.width && prev.height === vp.height) return;
    viewportRef.current = vp;
    setViewportState(vp);
    // Keep every window reachable when the desktop shrinks.
    setWm((s) => ({ ...s, windows: s.windows.map((w) => (w.maximized ? w : clampToViewport(w, vp))) }));
  }, []);

  // Persist the layout during active sessions (cleans storage when empty).
  useEffect(() => {
    const t = setTimeout(() => {
      if (wm.windows.length > 0) {
        saveState(wm);
      } else {
        try { localStorage.removeItem('skon-workspace-windows-v1'); } catch (e) { /* ignore */ }
      }
    }, 150);
    return () => clearTimeout(t);
  }, [wm]);

  const open = useCallback((toolId, opts) => setWm((s) => openWindow(s, toolId, toolMeta(toolId), viewportRef.current, { zoom: mobileZoomRef.current, ...opts })), []);
  // Start-menu launcher (the old sidebar handler): the full terminal makes the drawer redundant.
  const launchTool = useCallback((toolId, opts) => {
    open(toolId, opts);
    if (toolId === 'terminal') setIsDrawerOpen(false);
  }, [open]);
  const onDuplicate = useCallback((id) => setWm((s) => duplicateWindow(s, id, viewportRef.current)), []);
  const onSnap = useCallback((id, zone) => setWm((s) => applySnap(s, id, zone, viewportRef.current)), []);
  const onFocus = useCallback((id) => setWm((s) => focusWindow(s, id)), []);
  const onClose = useCallback((id) => {
    setWm((s) => {
      const closingWin = s.windows.find((w) => w.id === id);
      if (closingWin) {
        const name = toolMeta(closingWin.toolId)?.title || closingWin.title || closingWin.toolId;
        record(name, 'info', `Closed ${name}`);
      }
      const next = closeWindow(s, id);
      if (!next.windows.length) {
        setCurrentTool(null);
        if (lastOpened.current) lastOpened.current = null;
      }
      return next;
    });
  }, []);
  const onMinimize = useCallback((id) => setWm((s) => minimizeWindow(s, id)), []);
  const onToggleMaximize = useCallback((id) => setWm((s) => toggleMaximize(s, id, viewportRef.current)), []);
  const onMove = useCallback((id, x, y) => setWm((s) => moveWindow(s, id, x, y, viewportRef.current)), []);
  const onResize = useCallback((id, geo) => setWm((s) => resizeWindow(s, id, geo, viewportRef.current)), []);
  const onTile = useCallback(() => setWm((s) => tileWindows(s, viewportRef.current)), []);
  const onCascade = useCallback(() => setWm((s) => cascadeWindows(s, viewportRef.current)), []);
  const onCloseAll = useCallback(() => {
    record('Workspace', 'info', 'Closed all windows');
    setCurrentTool(null);
    if (lastOpened.current) lastOpened.current = null;
    try { localStorage.removeItem('skon-workspace-windows-v1'); } catch (e) { /* ignore */ }
    setWm((s) => closeAll(s));
  }, []);
  const onZoomStep = useCallback((id, dir, currentZoom) => setWm((s) => zoomStep(s, id, dir, currentZoom)), []);
  const onToggleFit = useCallback((id) => setWm((s) => toggleFit(s, id)), []);
  const onResetZoom = useCallback((id) => setWm((s) => setZoom(s, id, 1)), []);

  const focused = focusedWindow(wm);
  const focusedIdRef = useRef(null);
  focusedIdRef.current = focused?.id || null;
  const activeTool = focused?.toolId || null;           // the tool whose window has focus
  const metaFor = useCallback((toolId) => toolMeta(toolId), []);
  const renderToolInWindow = useCallback((toolId) => renderTool(toolId, serial), [serial]);

  // Live Terminal Drawer state (closed by default)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Modals
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHardwareIntelOpen, setIsHardwareIntelOpen] = useState(false);
  const [isPinoutModalOpen, setIsPinoutModalOpen] = useState(false);

  // Attribute session-log entries (device picks, confirmations) to the focused tool
  const lastOpened = useRef(null);
  useEffect(() => {
    if (!activeTool) {
      setCurrentTool(null);
      lastOpened.current = null;
      return;
    }
    if (activeTool === 'session-log' || lastOpened.current === activeTool) return;
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
      // Tile the focused window with Ctrl+Alt+Arrow (left/right half, up = maximize)
      if (e.ctrlKey && e.altKey && !e.metaKey && e.key.startsWith('Arrow')) {
        const id = focusedIdRef.current;
        const zone = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top' }[e.key];
        if (id && zone) { e.preventDefault(); onSnap(id, zone); return; }
        if (id && e.key === 'ArrowDown') { e.preventDefault(); setWm((s) => { const w = s.windows.find((x) => x.id === id); return w && w.maximized ? toggleMaximize(s, id, viewportRef.current) : s; }); return; }
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

  return (
    <div className="h-screen bg-cyber-darkest text-slate-200 flex flex-col font-mono selection:bg-cyan-500/30 selection:text-cyan-300 overflow-hidden">
      {/* Windowed desktop; the taskbar along the bottom holds Start, the serial controls and the tray */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden bg-cyber-darkest min-w-0">
          <Desktop
            state={wm} viewport={viewport} onViewport={onViewport}
            renderTool={renderToolInWindow} metaFor={metaFor}
            onFocus={onFocus} onMove={onMove} onResize={onResize} onMinimize={onMinimize}
            onToggleMaximize={onToggleMaximize} onClose={onClose}
            onTile={onTile} onCascade={onCascade} onCloseAll={onCloseAll}
            onZoomStep={onZoomStep} onToggleFit={onToggleFit} onResetZoom={onResetZoom} onDuplicate={onDuplicate} onSnap={onSnap}
            activeTool={activeTool} onLaunch={launchTool}
            onOpenPinouts={() => setIsPinoutModalOpen(true)} onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
            drawer={
              <TerminalDrawer
                isOpen={isDrawerOpen}
                onToggleOpen={() => setIsDrawerOpen(!isDrawerOpen)}
                onNavigateToFullTerminal={() => { open('terminal'); setIsDrawerOpen(false); }}
              />
            }
            serialControls={<TaskbarSerial isDrawerOpen={isDrawerOpen} onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)} />}
            tray={<TaskbarTray onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />}
          />

        </div>
      </div>

      {/* Global Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={(tabId) => { open(tabId); setIsCommandPaletteOpen(false); }}
        activeTool={activeTool}
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
