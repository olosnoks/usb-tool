import React, { useState, useEffect } from 'react';
import { SerialProvider, useSerial } from './context/SerialContext';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import TerminalDrawer from './components/layout/TerminalDrawer';
import WorkspacePresets, { WORKSPACE_PRESETS } from './components/layout/WorkspacePresets';

// Primary Tabs
import TerminalTab from './components/tabs/TerminalTab';
import FlasherTab from './components/tabs/FlasherTab';
import HardwareControlsTab from './components/tabs/HardwareControlsTab';
import HelpTroubleshootingTab from './components/tabs/HelpTroubleshootingTab';

// Specialized Modules
import SerialPlotter from './components/SerialPlotter';
import HexViewer from './components/common/HexViewer';
import PacketFramer from './components/PacketFramer';
import SerialBridgeDeck from './components/SerialBridgeDeck';
import UbxConfigDeck from './components/UbxConfigDeck';
import MicroPythonFileManager from './components/MicroPythonFileManager';
import ImprovWifiDeck from './components/ImprovWifiDeck';
import TelemetryDashboard from './components/TelemetryDashboard';
// Lazy-loaded Specialized Workbenches to keep initial load lightweight
const Ch341aProgrammer = React.lazy(() => import('./components/tools/Ch341aProgrammer'));
const CmsisDapDebugger = React.lazy(() => import('./components/tools/CmsisDapDebugger'));
const CanBusWorkbench = React.lazy(() => import('./components/tools/CanBusWorkbench'));
const LogicAnalyzerWorkbench = React.lazy(() => import('./components/tools/LogicAnalyzerWorkbench'));
const UsbPdWorkbench = React.lazy(() => import('./components/tools/UsbPdWorkbench'));
const BusExplorerWorkbench = React.lazy(() => import('./components/tools/BusExplorerWorkbench'));
const JtagWorkbench = React.lazy(() => import('./components/tools/JtagWorkbench'));
const ModbusWorkbench = React.lazy(() => import('./components/tools/ModbusWorkbench'));
const AvrIspWorkbench = React.lazy(() => import('./components/tools/AvrIspWorkbench'));
const PortapackWorkbench = React.lazy(() => import('./components/tools/PortapackWorkbench'));
const FlipperWorkbench = React.lazy(() => import('./components/tools/flipper/FlipperWorkbench'));
const ProxmarkWorkbench = React.lazy(() => import('./components/tools/proxmark/ProxmarkWorkbench'));
const CyberChefWorkbench = React.lazy(() => import('./components/tools/CyberChefWorkbench'));
const DuckyScriptStudio = React.lazy(() => import('./components/tools/DuckyScriptStudio'));
const PacketAnalyzerWorkbench = React.lazy(() => import('./components/tools/PacketAnalyzerWorkbench'));
const GpsWardriverDeck = React.lazy(() => import('./components/GpsWardriverDeck'));
const CrashAlertDeck = React.lazy(() => import('./components/CrashAlertDeck'));
const ScriptRunner = React.lazy(() => import('./components/ScriptRunner'));
const UsbReconDeck = React.lazy(() => import('./components/UsbReconDeck'));
const EspMemoryInspector = React.lazy(() => import('./components/EspMemoryInspector'));

// Composite Tool Suites
const BadUsbPayloadSuite = React.lazy(() => import('./components/tools/BadUsbPayloadSuite'));
const ProtocolPacketLab = React.lazy(() => import('./components/tools/ProtocolPacketLab'));
const GpsNavigationSuite = React.lazy(() => import('./components/tools/GpsNavigationSuite'));
const HardwareProgrammersSuite = React.lazy(() => import('./components/tools/HardwareProgrammersSuite'));

// Modals
import CommandPalette from './components/CommandPalette';
import HardwareIntelligenceModal from './components/HardwareIntelligenceModal';
import PinoutModal from './components/PinoutModal';

function AppContent() {
  const {
    isConnected,
    port,
    connect,
    disconnect,
    clearLogs,
    clearHexStream,
    setBaudRate,
    baudRate,
    portInfo,
    latestRxText,
    hexByteStream,
    sendString,
    sendRawBytes,
    toggleSignal,
    addLog,
    boards,
    activeBoardId,
    setActiveBoardId
  } = useSerial();

  // Active Tool identifier (defaults to 'flasher' or ?tool= param)
  const [activeTool, setActiveTool] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTool = params.get('tool');
      if (urlTool && !urlTool.endsWith('-modal')) return urlTool;
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('tool=')) return hash.replace('tool=', '');
    } catch (e) {}
    return 'flasher';
  });

  // Sidebar collapse state (persisted)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('skon_sidebar_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });

  const handleToggleSidebar = (collapsed) => {
    setIsSidebarCollapsed(collapsed);
    try {
      localStorage.setItem('skon_sidebar_collapsed', String(collapsed));
    } catch (e) {}
  };

  // Live Terminal Drawer state (closed by default)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Modals
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHardwareIntelOpen, setIsHardwareIntelOpen] = useState(false);
  const [isPinoutModalOpen, setIsPinoutModalOpen] = useState(false);

  // Check URL params for modal triggers
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTool = params.get('tool');
      if (urlTool === 'pinouts-modal') setIsPinoutModalOpen(true);
      if (urlTool === 'intel-modal') setIsHardwareIntelOpen(true);
    } catch (e) {}
  }, []);

  // Global hotkeys (Ctrl+K, Ctrl+`, Alt+1..6)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Command Palette (Ctrl+K or Cmd+K)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
        return;
      }

      // Toggle Terminal Drawer (Ctrl+` or Ctrl+J)
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key.toLowerCase() === 'j')) {
        e.preventDefault();
        setIsDrawerOpen(prev => !prev);
        return;
      }

      // Quick Workspace Presets (Alt+1 .. Alt+6)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= WORKSPACE_PRESETS.length) {
          e.preventDefault();
          const targetPreset = WORKSPACE_PRESETS[num - 1];
          handleSelectPreset(targetPreset);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle preset selection
  const handleSelectPreset = (preset) => {
    setActiveTool(preset.toolId);
    if (preset.openDrawer !== undefined) {
      setIsDrawerOpen(preset.openDrawer);
    }
  };

  // Find active preset matching current tool
  const currentActivePreset = WORKSPACE_PRESETS.find(p => p.toolId === activeTool)?.id;

  return (
    <div className="h-screen bg-[#020617] text-slate-200 flex flex-col font-mono selection:bg-cyan-500/30 selection:text-cyan-300 overflow-hidden">
      {/* 1. Global Persistent Header */}
      <Header
        activeTool={activeTool}
        activePreset={currentActivePreset}
        onSelectPreset={handleSelectPreset}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        onOpenPinouts={() => setIsPinoutModalOpen(true)}
      />

      {/* 2. Main Workspace Layout: Sidebar + Operational Canvas */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Collapsible Left Navigation Sidebar */}
        <Sidebar
          activeTool={activeTool}
          onSelectTool={(toolId) => {
            setActiveTool(toolId);
            // If selecting full terminal, collapse drawer to avoid redundant console
            if (toolId === 'terminal') {
              setIsDrawerOpen(false);
            }
          }}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onOpenPinouts={() => setIsPinoutModalOpen(true)}
          onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        />

        {/* Central Workspace Canvas with Bottom Terminal Drawer */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#020617]">
          {/* Active Tool Viewport */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 scrollbar-thin scrollbar-thumb-slate-800">
            <React.Suspense fallback={
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 font-mono text-xs space-y-3">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-cyan-300 tracking-wider">LOADING WORKBENCH MODULE...</span>
              </div>
            }>
              {activeTool === 'flasher' && <FlasherTab />}
              {activeTool === 'terminal' && <TerminalTab />}
              {activeTool === 'hardware' && <HardwareControlsTab />}
              {activeTool === 'setup' && <HelpTroubleshootingTab />}

            {/* Specialized Modules direct rendering */}
            {activeTool === 'plotter' && (
              <div className="w-full">
                <SerialPlotter
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                />
              </div>
            )}

            {['packet-analyzer', 'hex', 'packets'].includes(activeTool) && (
              <div className="w-full">
                <ProtocolPacketLab
                  initialTab={activeTool === 'hex' ? 'hex' : activeTool === 'packets' ? 'packets' : 'analyzer'}
                  hexByteStream={hexByteStream}
                  onClearHex={clearHexStream}
                  isConnected={isConnected}
                />
              </div>
            )}

            {activeTool === 'bridge' && (
              <div className="w-full">
                <SerialBridgeDeck
                  boards={boards}
                  bridgeConfig={{ active: false, boardAId: activeBoardId, boardBId: '' }}
                  onToggleBridge={() => {}}
                  bridgeLog={[]}
                  onClearBridgeLog={() => {}}
                  onSendRawBytes={sendRawBytes}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'micropython' && (
              <div className="w-full">
                <MicroPythonFileManager
                  isConnected={isConnected}
                  onSendString={sendString}
                  latestRxText={latestRxText}
                  onLogMessage={addLog}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onSelectBoard={setActiveBoardId}
                />
              </div>
            )}

            {activeTool === 'improv' && (
              <div className="w-full">
                <ImprovWifiDeck
                  isConnected={isConnected}
                  onSendRawBytes={sendRawBytes}
                  onSendString={sendString}
                  latestRxText={latestRxText}
                  onLogMessage={addLog}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onSelectBoard={setActiveBoardId}
                />
              </div>
            )}

            {activeTool === 'telemetry' && (
              <div className="w-full">
                <TelemetryDashboard
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onSelectBoard={setActiveBoardId}
                />
              </div>
            )}

            {['wardrive', 'ubx'].includes(activeTool) && (
              <div className="w-full">
                <GpsNavigationSuite
                  initialTab={activeTool === 'ubx' ? 'ubx' : 'wardrive'}
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                  onLogMessage={addLog}
                  onSendRawBytes={sendRawBytes}
                />
              </div>
            )}

            {activeTool === 'alerts' && (
              <div className="w-full">
                <CrashAlertDeck
                  latestTextStream={latestRxText}
                  onPauseTerminal={() => {}}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'automation' && (
              <div className="w-full">
                <ScriptRunner
                  isConnected={isConnected}
                  onSendString={sendString}
                  latestRxText={latestRxText}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'autopsy' && (
              <div className="w-full">
                <UsbReconDeck
                  isConnected={isConnected}
                  onSendRawBytes={sendRawBytes}
                  onSendString={sendString}
                  onToggleSignal={toggleSignal}
                  onBaudRateChange={setBaudRate}
                  currentBaudRate={baudRate}
                  onLogMessage={addLog}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onSelectBoard={setActiveBoardId}
                />
              </div>
            )}

            {activeTool === 'esp-dump' && (
              <div className="w-full">
                <EspMemoryInspector
                  isConnected={isConnected}
                  port={port}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {/* Hardware Programmers Suite */}
            {['programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp'].includes(activeTool) && (
              <div className="w-full">
                <HardwareProgrammersSuite initialTab={activeTool} />
              </div>
            )}

            {activeTool === 'can-bus' && (
              <div className="w-full">
                <CanBusWorkbench />
              </div>
            )}

            {activeTool === 'logic-analyzer' && (
              <div className="w-full">
                <LogicAnalyzerWorkbench />
              </div>
            )}

            {/* Hardware Workbenches */}
            {activeTool === 'usb-pd' && (
              <div className="w-full">
                <UsbPdWorkbench />
              </div>
            )}

            {activeTool === 'bus-explorer' && (
              <div className="w-full">
                <BusExplorerWorkbench />
              </div>
            )}

            {activeTool === 'modbus-rtu' && (
              <div className="w-full">
                <ModbusWorkbench />
              </div>
            )}

            {activeTool === 'mayhem' && (
              <div className="w-full">
                <PortapackWorkbench />
              </div>
            )}

            {activeTool === 'flipper' && (
              <div className="w-full">
                <FlipperWorkbench />
              </div>
            )}

            {(activeTool === 'proxmark' || activeTool === 'rfid-nfc') && (
              <div className="w-full">
                <ProxmarkWorkbench />
              </div>
            )}

            {['ducky', 'cyberchef'].includes(activeTool) && (
              <div className="w-full">
                <BadUsbPayloadSuite initialTab={activeTool === 'cyberchef' ? 'cyberchef' : 'ducky'} />
              </div>
            )}
            </React.Suspense>
          </main>

          {/* Persistent Live Terminal Drawer (Docked to bottom) */}
          <TerminalDrawer
            isOpen={isDrawerOpen}
            onToggleOpen={() => setIsDrawerOpen(!isDrawerOpen)}
            onNavigateToFullTerminal={() => {
              setActiveTool('terminal');
              setIsDrawerOpen(false);
            }}
          />
        </div>
      </div>

      {/* Global Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={(tabId) => {
          setActiveTool(tabId);
          setIsCommandPaletteOpen(false);
        }}
        onConnect={connect}
        onDisconnect={disconnect}
        onClearLogs={clearLogs}
        onSetBaud={setBaudRate}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        onOpenPinouts={() => setIsPinoutModalOpen(true)}
        onExportSession={() => {}}
        isConnected={isConnected}
      />

      <HardwareIntelligenceModal
        isOpen={isHardwareIntelOpen}
        onClose={() => setIsHardwareIntelOpen(false)}
        portInfo={portInfo}
      />

      <PinoutModal
        isOpen={isPinoutModalOpen}
        onClose={() => setIsPinoutModalOpen(false)}
      />
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
