import { describe, it, expect, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';

// Import all tools/workbenches rendered in App.jsx
import Ch341aProgrammer from '../src/components/tools/Ch341aProgrammer';
import CmsisDapDebugger from '../src/components/tools/CmsisDapDebugger';
import CanBusWorkbench from '../src/components/tools/CanBusWorkbench';
import LogicAnalyzerWorkbench from '../src/components/tools/LogicAnalyzerWorkbench';
import UsbPdWorkbench from '../src/components/tools/UsbPdWorkbench';
import BusExplorerWorkbench from '../src/components/tools/BusExplorerWorkbench';
import JtagWorkbench from '../src/components/tools/JtagWorkbench';
import ModbusWorkbench from '../src/components/tools/ModbusWorkbench';
import AvrIspWorkbench from '../src/components/tools/AvrIspWorkbench';
import PortapackWorkbench from '../src/components/tools/PortapackWorkbench';
import FlipperWorkbench from '../src/components/tools/flipper/FlipperWorkbench';
import ProxmarkWorkbench from '../src/components/tools/proxmark/ProxmarkWorkbench';
import CyberChefWorkbench from '../src/components/tools/CyberChefWorkbench';
import DuckyScriptStudio from '../src/components/tools/DuckyScriptStudio';
import PacketAnalyzerWorkbench from '../src/components/tools/PacketAnalyzerWorkbench';
import GpsWardriverDeck from '../src/components/GpsWardriverDeck';
import CrashAlertDeck from '../src/components/CrashAlertDeck';
import ScriptRunner from '../src/components/ScriptRunner';
import UsbReconDeck from '../src/components/UsbReconDeck';
import EspMemoryInspector from '../src/components/EspMemoryInspector';
import AlfaWifiWorkbench from '../src/components/workbenches/AlfaWifiWorkbench';
import TopologyView from '../src/components/workbenches/TopologyView';
import SignalMapView from '../src/components/workbenches/SignalMapView';
import GeospatialMap from '../src/components/workbenches/GeospatialMap';

// Composite Tool Suites
import BadUsbPayloadSuite from '../src/components/tools/BadUsbPayloadSuite';
import ProtocolPacketLab from '../src/components/tools/ProtocolPacketLab';
import GpsNavigationSuite from '../src/components/tools/GpsNavigationSuite';
import HardwareProgrammersSuite from '../src/components/tools/HardwareProgrammersSuite';

// Layout & Core Tabs
import TerminalDeck from '../src/components/tabs/TerminalTab';
import FlasherTab from '../src/components/tabs/FlasherTab';
import HardwareControlsTab from '../src/components/tabs/HardwareControlsTab';
import SerialBridgeDeck from '../src/components/SerialBridgeDeck';
import UbxConfigDeck from '../src/components/UbxConfigDeck';
import MicroPythonFileManager from '../src/components/MicroPythonFileManager';
import ImprovWifiDeck from '../src/components/ImprovWifiDeck';
import TelemetryDashboard from '../src/components/TelemetryDashboard';
import HelpTroubleshootingTab from '../src/components/tabs/HelpTroubleshootingTab';
import SerialPlotter from '../src/components/SerialPlotter';

describe('UI Workbench Render Sanity Check', () => {
  const components = [
    { name: 'Ch341aProgrammer', comp: <Ch341aProgrammer /> },
    { name: 'CmsisDapDebugger', comp: <CmsisDapDebugger /> },
    { name: 'CanBusWorkbench', comp: <CanBusWorkbench /> },
    { name: 'LogicAnalyzerWorkbench', comp: <LogicAnalyzerWorkbench /> },
    { name: 'UsbPdWorkbench', comp: <UsbPdWorkbench /> },
    { name: 'BusExplorerWorkbench', comp: <BusExplorerWorkbench /> },
    { name: 'JtagWorkbench', comp: <JtagWorkbench /> },
    { name: 'ModbusWorkbench', comp: <ModbusWorkbench /> },
    { name: 'AvrIspWorkbench', comp: <AvrIspWorkbench /> },
    { name: 'PortapackWorkbench', comp: <PortapackWorkbench /> },
    { name: 'FlipperWorkbench', comp: <FlipperWorkbench /> },
    { name: 'ProxmarkWorkbench', comp: <ProxmarkWorkbench /> },
    { name: 'AlfaWifiWorkbench', comp: <AlfaWifiWorkbench /> },
    { name: 'TopologyView', comp: <TopologyView devices={{}} clients={{}} /> },
    { name: 'CyberChefWorkbench', comp: <CyberChefWorkbench /> },
    { name: 'DuckyScriptStudio', comp: <DuckyScriptStudio /> },
    { name: 'PacketAnalyzerWorkbench', comp: <PacketAnalyzerWorkbench /> },
    { name: 'GpsWardriverDeck', comp: <GpsWardriverDeck latestTextStream="" isConnected={false} /> },
    { name: 'CrashAlertDeck', comp: <CrashAlertDeck latestTextStream="" /> },
    { name: 'ScriptRunner', comp: <ScriptRunner isConnected={false} /> },
    { name: 'UsbReconDeck', comp: <UsbReconDeck isConnected={false} /> },
    { name: 'EspMemoryInspector', comp: <EspMemoryInspector isConnected={false} /> },
    { name: 'BadUsbPayloadSuite (ducky)', comp: <BadUsbPayloadSuite initialTab="ducky" /> },
    { name: 'BadUsbPayloadSuite (cyberchef)', comp: <BadUsbPayloadSuite initialTab="cyberchef" /> },
    { name: 'ProtocolPacketLab (analyzer)', comp: <ProtocolPacketLab initialTab="analyzer" /> },
    { name: 'ProtocolPacketLab (hex)', comp: <ProtocolPacketLab initialTab="hex" hexByteStream={[]} /> },
    { name: 'ProtocolPacketLab (packets)', comp: <ProtocolPacketLab initialTab="packets" hexByteStream={[]} /> },
    { name: 'GpsNavigationSuite (wardrive)', comp: <GpsNavigationSuite initialTab="wardrive" /> },
    { name: 'GpsNavigationSuite (ubx)', comp: <GpsNavigationSuite initialTab="ubx" /> },
    { name: 'HardwareProgrammersSuite (ch341a)', comp: <HardwareProgrammersSuite initialTab="ch341a" /> },
    { name: 'HardwareProgrammersSuite (cmsis-dap)', comp: <HardwareProgrammersSuite initialTab="cmsis-dap" /> },
    { name: 'HardwareProgrammersSuite (jtag)', comp: <HardwareProgrammersSuite initialTab="jtag" /> },
    { name: 'HardwareProgrammersSuite (avr)', comp: <HardwareProgrammersSuite initialTab="avr" /> },
    { name: 'TerminalDeck', comp: <TerminalDeck logs={[]} isConnected={false} /> },
    { name: 'FlasherTab', comp: <FlasherTab isConnected={false} /> },
    { name: 'HardwareControlsTab', comp: <HardwareControlsTab isConnected={false} /> },
    { name: 'SerialBridgeDeck', comp: <SerialBridgeDeck boards={[]} bridgeConfig={{ active: false }} /> },
    { name: 'UbxConfigDeck', comp: <UbxConfigDeck isConnected={false} /> },
    { name: 'MicroPythonFileManager', comp: <MicroPythonFileManager isConnected={false} /> },
    { name: 'ImprovWifiDeck', comp: <ImprovWifiDeck isConnected={false} /> },
    { name: 'TelemetryDashboard', comp: <TelemetryDashboard isConnected={false} /> },
    { name: 'HelpTroubleshootingTab', comp: <HelpTroubleshootingTab /> },
    { name: 'SerialPlotter', comp: <SerialPlotter isConnected={false} /> },
    { name: 'SignalMapView', comp: <SignalMapView /> },
    { name: 'GeospatialMap', comp: <GeospatialMap /> }
  ];

  for (const { name, comp } of components) {
    it(`renders ${name} without throwing exceptions`, () => {
      expect(() => renderToString(<SerialProvider>{comp}</SerialProvider>)).not.toThrow();
    });
  }

  it('renders Panda PAU09 (RT5572) frontend adapter toggles in AlfaWifiWorkbench and GpsWardriverDeck', () => {
    const alfaHtml = renderToString(<SerialProvider><AlfaWifiWorkbench /></SerialProvider>);
    expect(alfaHtml).toContain('Panda PAU09');
    expect(alfaHtml).toContain('RT5572');
    expect(alfaHtml).toContain('Wardriving Mode');

    const wardriveHtml = renderToString(<SerialProvider><GpsWardriverDeck isConnected={false} /></SerialProvider>);
    expect(wardriveHtml).toContain('Panda PAU09');
    expect(wardriveHtml).toContain('RT5572');
    expect(wardriveHtml).toContain('Warhog CYD');
    expect(wardriveHtml).toContain('SGT WARHOG');
    expect(wardriveHtml).toContain('Piglet');
    expect(wardriveHtml).toContain('ESP32-C5');
    expect(wardriveHtml).toContain('Import SD .wigle.csv');
    expect(wardriveHtml).toContain('Connect PAU09 (WebUSB)');
    expect(wardriveHtml).toContain('Simulate Wardrive Stream');
  });
});
