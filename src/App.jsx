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
import GpsWardriverDeck from './components/GpsWardriverDeck';
import CrashAlertDeck from './components/CrashAlertDeck';
import ScriptRunner from './components/ScriptRunner';
import UsbReconDeck from './components/UsbReconDeck';
import EspMemoryInspector from './components/EspMemoryInspector';

// New Advanced Hardware & Protocol Workbenches
import Ch341aProgrammer from './components/tools/Ch341aProgrammer';
import CmsisDapDebugger from './components/tools/CmsisDapDebugger';
import CanBusWorkbench from './components/tools/CanBusWorkbench';
import LogicAnalyzerWorkbench from './components/tools/LogicAnalyzerWorkbench';
import UsbPdWorkbench from './components/tools/UsbPdWorkbench';
import BusExplorerWorkbench from './components/tools/BusExplorerWorkbench';
import JtagWorkbench from './components/tools/JtagWorkbench';
import ModbusWorkbench from './components/tools/ModbusWorkbench';
import AvrIspWorkbench from './components/tools/AvrIspWorkbench';
import RfidNfcWorkbench from './components/tools/RfidNfcWorkbench';
import PortapackWorkbench from './components/tools/PortapackWorkbench';

// Common & Guide Components
import ToolGuide from './components/common/ToolGuide';

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

  // Active Tool identifier (defaults to 'flasher')
  const [activeTool, setActiveTool] = useState('flasher');

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

  // Live Terminal Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  // Modals
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHardwareIntelOpen, setIsHardwareIntelOpen] = useState(false);
  const [isPinoutModalOpen, setIsPinoutModalOpen] = useState(false);

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
            {/* Contextual How-To Dropdown Guide for Active Tool */}
            <ToolGuide toolId={activeTool} />

            {activeTool === 'flasher' && <FlasherTab />}
            {activeTool === 'terminal' && <TerminalTab />}
            {activeTool === 'hardware' && <HardwareControlsTab />}
            {activeTool === 'setup' && <HelpTroubleshootingTab />}

            {/* Specialized Modules direct rendering */}
            {activeTool === 'plotter' && (
              <div className="max-w-6xl mx-auto">
                <SerialPlotter
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                />
              </div>
            )}

            {activeTool === 'hex' && (
              <div className="max-w-6xl mx-auto">
                <HexViewer
                  byteStream={hexByteStream}
                  onClear={clearHexStream}
                  maxDisplayBytes={4096}
                />
              </div>
            )}

            {activeTool === 'packets' && (
              <div className="max-w-6xl mx-auto">
                <PacketFramer
                  activeHexByteStream={hexByteStream}
                  isConnected={isConnected}
                />
              </div>
            )}

            {activeTool === 'bridge' && (
              <div className="max-w-6xl mx-auto">
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

            {activeTool === 'ubx' && (
              <div className="max-w-6xl mx-auto">
                <UbxConfigDeck
                  isConnected={isConnected}
                  onSendRawBytes={sendRawBytes}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'micropython' && (
              <div className="max-w-6xl mx-auto">
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
              <div className="max-w-6xl mx-auto">
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
              <div className="max-w-6xl mx-auto">
                <TelemetryDashboard
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onSelectBoard={setActiveBoardId}
                />
              </div>
            )}

            {activeTool === 'wardrive' && (
              <div className="max-w-6xl mx-auto">
                <GpsWardriverDeck
                  latestTextStream={latestRxText}
                  isConnected={isConnected}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'alerts' && (
              <div className="max-w-6xl mx-auto">
                <CrashAlertDeck
                  latestTextStream={latestRxText}
                  onPauseTerminal={() => {}}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'automation' && (
              <div className="max-w-6xl mx-auto">
                <ScriptRunner
                  isConnected={isConnected}
                  onSendString={sendString}
                  latestRxText={latestRxText}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {activeTool === 'autopsy' && (
              <div className="max-w-6xl mx-auto">
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
              <div className="max-w-6xl mx-auto">
                <EspMemoryInspector
                  isConnected={isConnected}
                  port={port}
                  onLogMessage={addLog}
                />
              </div>
            )}

            {/* 4 New Hardware Diagnostic Tools */}
            {activeTool === 'ch341a' && (
              <div className="max-w-6xl mx-auto">
                <Ch341aProgrammer />
              </div>
            )}

            {activeTool === 'cmsis-dap' && (
              <div className="max-w-6xl mx-auto">
                <CmsisDapDebugger />
              </div>
            )}

            {activeTool === 'can-bus' && (
              <div className="max-w-6xl mx-auto">
                <CanBusWorkbench />
              </div>
            )}

            {activeTool === 'logic-analyzer' && (
              <div className="max-w-6xl mx-auto">
                <LogicAnalyzerWorkbench />
              </div>
            )}

            {/* 6 New Hardware Workbenches */}
            {activeTool === 'usb-pd' && (
              <div className="max-w-6xl mx-auto">
                <UsbPdWorkbench />
              </div>
            )}

            {activeTool === 'bus-explorer' && (
              <div className="max-w-6xl mx-auto">
                <BusExplorerWorkbench />
              </div>
            )}

            {activeTool === 'jtag-programmer' && (
              <div className="max-w-6xl mx-auto">
                <JtagWorkbench />
              </div>
            )}

            {activeTool === 'modbus-rtu' && (
              <div className="max-w-6xl mx-auto">
                <ModbusWorkbench />
              </div>
            )}

            {activeTool === 'avr-isp' && (
              <div className="max-w-6xl mx-auto">
                <AvrIspWorkbench />
              </div>
            )}

            {activeTool === 'rfid-nfc' && (
              <div className="max-w-6xl mx-auto">
                <RfidNfcWorkbench />
              </div>
            )}

            {activeTool === 'mayhem' && (
              <div className="max-w-6xl mx-auto">
                <PortapackWorkbench />
              </div>
            )}
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
