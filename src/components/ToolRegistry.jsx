// Maps a tool id to the component that renders it, plus its title / icon / accent for window chrome. App.jsx used to hold this as one long switch; the window manager renders several tools at once, so it lives here.
import React from 'react';
import { SIDEBAR_SECTIONS } from './layout/Sidebar';
import { windowKeyFor } from '../utils/windowManager';

// Primary Tabs
import TerminalTab from './tabs/TerminalTab';
import FlasherTab from './tabs/FlasherTab';
import HardwareControlsTab from './tabs/HardwareControlsTab';
import HelpTroubleshootingTab from './tabs/HelpTroubleshootingTab';

// Specialized Modules
import SerialPlotter from './SerialPlotter';
import SerialBridgeDeck from './SerialBridgeDeck';
import MicroPythonFileManager from './MicroPythonFileManager';
import ImprovWifiDeck from './ImprovWifiDeck';
import TelemetryDashboard from './TelemetryDashboard';

// Lazy-loaded workbenches keep the initial load light.
const CanBusWorkbench = React.lazy(() => import('./tools/CanBusWorkbench'));
const NmapScannerWorkbench = React.lazy(() => import('./tools/NmapScannerWorkbench'));
const HashcatCrackerWorkbench = React.lazy(() => import('./tools/HashcatCrackerWorkbench'));
const HttpWorkbench = React.lazy(() => import('./tools/HttpWorkbench'));
const AircrackWifiWorkbench = React.lazy(() => import('./tools/AircrackWifiWorkbench'));
const HydraBruteforceWorkbench = React.lazy(() => import('./tools/HydraBruteforceWorkbench'));
const TcpdumpViewerWorkbench = React.lazy(() => import('./tools/TcpdumpViewerWorkbench'));
const DnsToolkitWorkbench = React.lazy(() => import('./tools/DnsToolkitWorkbench'));
const PwnedPasswordsCheckerWorkbench = React.lazy(() => import('./tools/PwnedPasswordsCheckerWorkbench'));
const CertInspectWorkbench = React.lazy(() => import('./tools/CertInspectWorkbench'));
const DbBrowserWorkbench = React.lazy(() => import('./tools/DbBrowserWorkbench'));
const RegexTesterWorkbench = React.lazy(() => import('./tools/RegexTesterWorkbench'));
const JwtInspectorWorkbench = React.lazy(() => import('./tools/JwtInspectorWorkbench'));
const IpCalculatorWorkbench = React.lazy(() => import('./tools/IpCalculatorWorkbench'));
const HashCalculatorWorkbench = React.lazy(() => import('./tools/HashCalculatorWorkbench'));
const CrtShFinderWorkbench = React.lazy(() => import('./tools/CrtShFinderWorkbench'));
const OsintClientsWorkbench = React.lazy(() => import('./tools/OsintClientsWorkbench'));
const WebAnalyzerWorkbench = React.lazy(() => import('./tools/WebAnalyzerWorkbench'));

const LogicAnalyzerWorkbench = React.lazy(() => import('./tools/LogicAnalyzerWorkbench'));
const UsbPdWorkbench = React.lazy(() => import('./tools/UsbPdWorkbench'));
const BusExplorerWorkbench = React.lazy(() => import('./tools/BusExplorerWorkbench'));
const ModbusWorkbench = React.lazy(() => import('./tools/ModbusWorkbench'));
const PortapackWorkbench = React.lazy(() => import('./tools/PortapackWorkbench'));
const FlipperWorkbench = React.lazy(() => import('./tools/flipper/FlipperWorkbench'));
const ProxmarkWorkbench = React.lazy(() => import('./tools/proxmark/ProxmarkWorkbench'));
const CrashAlertDeck = React.lazy(() => import('./CrashAlertDeck'));
const ScriptRunner = React.lazy(() => import('./ScriptRunner'));
const EspMemoryInspector = React.lazy(() => import('./EspMemoryInspector'));
const AlfaWifiWorkbench = React.lazy(() => import('./workbenches/AlfaWifiWorkbench'));
const WarhogPigletWorkbench = React.lazy(() => import('./workbenches/WarhogPigletWorkbench'));
const DuckyScriptStudio = React.lazy(() => import('./tools/DuckyScriptStudio'));
const CyberChefWorkbench = React.lazy(() => import('./tools/CyberChefWorkbench'));
const BadUsbPayloadSuite = React.lazy(() => import('./tools/BadUsbPayloadSuite'));
const ProtocolPacketLab = React.lazy(() => import('./tools/ProtocolPacketLab'));
const GpsNavigationSuite = React.lazy(() => import('./tools/GpsNavigationSuite'));
const HardwareProgrammersSuite = React.lazy(() => import('./tools/HardwareProgrammersSuite'));
const DfuFlasher = React.lazy(() => import('./tools/DfuFlasher'));
const FastbootWorkbench = React.lazy(() => import('./tools/FastbootWorkbench'));
const UsbInspectorWorkbench = React.lazy(() => import('./tools/UsbInspectorWorkbench'));
const AdbWorkbench = React.lazy(() => import('./tools/AdbWorkbench'));
const AndroidWorkbench = React.lazy(() => import('./tools/AndroidWorkbench'));
const UsbReaWorkbench = React.lazy(() => import('./tools/UsbReaWorkbench'));
const HidInspectorWorkbench = React.lazy(() => import('./tools/HidInspectorWorkbench'));
const UsbTmcWorkbench = React.lazy(() => import('./tools/UsbTmcWorkbench'));
const MassStorageWorkbench = React.lazy(() => import('./tools/MassStorageWorkbench'));
const PtpWorkbench = React.lazy(() => import('./tools/PtpWorkbench'));
const Fido2Workbench = React.lazy(() => import('./tools/Fido2Workbench'));
const SessionLogPanel = React.lazy(() => import('./tools/SessionLogPanel'));
const BleExplorer = React.lazy(() => import('./tools/BleExplorer'));
const WardriveGeneratorWorkbench = React.lazy(() => import('./tools/WardriveGeneratorWorkbench'));

const ALL_ITEMS = SIDEBAR_SECTIONS.flatMap((s) => s.items || []);

/**
 * The width (CSS px) at which a tool's layout is comfortable. Fit-to-width
 * scales the tool down so this width fits the window.
 */
export const DEFAULT_NATURAL_WIDTH = 1100;
export const TOOL_NATURAL_WIDTH = {
  mayhem: 1180, 'alfa-wifi': 1280, 'warhog-piglet': 1200, 'logic-analyzer': 1200, 'packet-analyzer': 1200,
  terminal: 900, flasher: 1000, hardware: 900, setup: 900, 'session-log': 900,
  cyberchef: 1200, ducky: 1000, 'http-workbench': 1200, 'web-analyzer': 1150,
};

/** Title, icon and accent for a tool id (aliases resolve to their group's entry). */
export function toolMeta(toolId) {
  if (!toolId || toolId === 'workspace') {
    return { title: 'Workspace', icon: null, accent: 'indigo', id: 'workspace', naturalWidth: DEFAULT_NATURAL_WIDTH };
  }
  const item = ALL_ITEMS.find((i) => i.id === toolId) || ALL_ITEMS.find((i) => i.id === windowKeyFor(toolId));
  const key = windowKeyFor(toolId);
  return { title: item?.name || toolId, icon: item?.icon || null, accent: item?.accent || 'cyan', id: toolId, naturalWidth: TOOL_NATURAL_WIDTH[key] || DEFAULT_NATURAL_WIDTH };
}

/** Every id renderTool knows, including workbench-tab aliases. */
export const KNOWN_TOOL_IDS = [
  'flasher', 'terminal', 'hardware', 'setup', 'plotter', 'packet-analyzer', 'hex', 'packets', 'kismet', 'bridge',
  'micropython', 'improv', 'telemetry', 'wardrive', 'ubx', 'alerts', 'automation', 'autopsy', 'esp-dump',
  'programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp', 'can-bus', 'logic-analyzer', 'usb-pd', 'dfu',
  'android', 'fastboot', 'adb', 'usb-inspector', 'usb-descriptors', 'usb-rea', 'hid', 'usbtmc', 'mass-storage', 'ptp', 'fido2', 'session-log', 'ble',
  'bus-explorer', 'modbus-rtu', 'alfa-wifi', 'wifi-scanner', 'warhog-piglet', 'mayhem', 'flipper', 'proxmark', 'rfid-nfc',
  'ducky', 'cyberchef', 'wardrive-generator',
  // New hacker tools
  'nmap-scanner', 'hashcat-cracker', 'http-workbench', 'burp-proxy', 'aircrack-wifi',
  'nikto-scanner', 'hydra-bruteforce', 'tcpdump-viewer', 'dns-toolkit', 'dns-enumerator', 'dns-mail-doctor',
  'owasp-zap', 'pwned-passwords', 'cert-inspect', 'api-client',
  'db-browser', 'regex-tester', 'jwt-inspector',
  'ip-calculator', 'hash-calculator', 'crtsh-finder', 'osint-clients', 'web-analyzer', 'url-inspector',
  'warhog-sd', 'warhog-config', 'warhog-console', 'warhog-flasher', 'warhog-pinouts'
];

const WARHOG_SUBTABS = {
  'warhog-sd': 'sd', 'warhog-config': 'config', 'warhog-console': 'live',
  'warhog-flasher': 'flasher', 'warhog-pinouts': 'pinouts'
};

/**
 * Render a tool. `serial` is the SerialContext value (shared serial port
 * state for the tools that use the app-wide port).
 */
export function renderTool(toolId, serial) {
  const {
    isConnected, port, latestRxText, hexByteStream, clearHexStream, sendString, sendRawBytes, toggleSignal,
    setBaudRate, baudRate, addLog, boards, activeBoardId, setActiveBoardId, setConsolePaused
  } = serial;

  switch (toolId) {
    case 'flasher': return <FlasherTab />;
    case 'terminal': return <TerminalTab />;
    case 'hardware': return <HardwareControlsTab />;
    case 'setup': return <HelpTroubleshootingTab />;
    case 'plotter': return <SerialPlotter latestTextStream={latestRxText} isConnected={isConnected} />;
    case 'packet-analyzer':
    case 'hex':
    case 'packets':
    case 'kismet':
      return (
        <ProtocolPacketLab
          initialTab={toolId === 'hex' ? 'hex' : toolId === 'packets' ? 'packets' : toolId === 'kismet' ? 'kismet' : 'analyzer'}
          hexByteStream={hexByteStream}
          onClearHex={clearHexStream}
          isConnected={isConnected}
          onLogMessage={addLog}
        />
      );
    case 'bridge': return <SerialBridgeDeck boards={boards} onSendRawBytes={sendRawBytes} onLogMessage={addLog} />;
    case 'micropython':
      return <MicroPythonFileManager isConnected={isConnected} onSendString={sendString} latestRxText={latestRxText} onLogMessage={addLog} boards={boards} activeBoardId={activeBoardId} onSelectBoard={setActiveBoardId} />;
    case 'improv':
      return <ImprovWifiDeck isConnected={isConnected} onSendRawBytes={sendRawBytes} onSendString={sendString} latestRxText={latestRxText} onLogMessage={addLog} boards={boards} activeBoardId={activeBoardId} onSelectBoard={setActiveBoardId} />;
    case 'telemetry':
      return <TelemetryDashboard latestTextStream={latestRxText} isConnected={isConnected} boards={boards} activeBoardId={activeBoardId} onSelectBoard={setActiveBoardId} />;
    case 'wardrive':
    case 'ubx':
      return <GpsNavigationSuite initialTab={toolId === 'ubx' ? 'ubx' : 'wardrive'} latestTextStream={latestRxText} isConnected={isConnected} onLogMessage={addLog} onSendRawBytes={sendRawBytes} />;
    case 'alerts': return <CrashAlertDeck latestTextStream={latestRxText} onPauseTerminal={setConsolePaused} onLogMessage={addLog} />;
    case 'automation': return <ScriptRunner isConnected={isConnected} onSendString={sendString} latestRxText={latestRxText} onLogMessage={addLog} />;
    case 'usb-inspector':
    case 'autopsy':
    case 'usb-descriptors':
      return <UsbInspectorWorkbench initialTab={toolId === 'usb-descriptors' ? 'descriptors' : 'recon'} isConnected={isConnected} onSendRawBytes={sendRawBytes} onSendString={sendString} onToggleSignal={toggleSignal} onBaudRateChange={setBaudRate} currentBaudRate={baudRate} onLogMessage={addLog} boards={boards} activeBoardId={activeBoardId} onSelectBoard={setActiveBoardId} />;
    case 'esp-dump': return <EspMemoryInspector isConnected={isConnected} port={port} onLogMessage={addLog} />;
    case 'programmers':
    case 'ch341a':
    case 'cmsis-dap':
    case 'jtag-programmer':
    case 'avr-isp':
      return <HardwareProgrammersSuite initialTab={toolId} />;
    case 'can-bus': return <CanBusWorkbench />;
    case 'logic-analyzer': return <LogicAnalyzerWorkbench />;
    case 'usb-pd': return <UsbPdWorkbench />;
    case 'dfu': return <DfuFlasher />;
    case 'android': return <AndroidWorkbench />;
    case 'fastboot': return <AndroidWorkbench initialMode="fastboot" />;
    case 'adb': return <AndroidWorkbench initialMode="adb" />;
    case 'usb-rea': return <UsbReaWorkbench onLogMessage={addLog} />;
    case 'hid': return <HidInspectorWorkbench />;
    case 'usbtmc': return <UsbTmcWorkbench />;
    case 'mass-storage': return <MassStorageWorkbench />;
    case 'ptp': return <PtpWorkbench />;
    case 'fido2': return <Fido2Workbench />;
    case 'session-log': return <SessionLogPanel />;
    case 'ble': return <BleExplorer />;
    case 'bus-explorer': return <BusExplorerWorkbench />;
    case 'modbus-rtu': return <ModbusWorkbench />;
    case 'alfa-wifi':
    case 'wifi-scanner':
      return <div className="w-full min-w-0 max-w-full"><AlfaWifiWorkbench /></div>;
    case 'warhog-piglet':
    case 'warhog-sd':
    case 'warhog-config':
    case 'warhog-console':
    case 'warhog-flasher':
    case 'warhog-pinouts':
      return <div className="w-full min-w-0 max-w-full"><WarhogPigletWorkbench initialTab={WARHOG_SUBTABS[toolId] || 'sd'} /></div>;
    case 'mayhem': return <PortapackWorkbench />;
    case 'flipper': return <FlipperWorkbench />;
    case 'proxmark':
    case 'rfid-nfc': return <ProxmarkWorkbench />;
    case 'ducky': return <DuckyScriptStudio onLogMessage={addLog} />;
    case 'cyberchef': return <CyberChefWorkbench onLogMessage={addLog} />;
    case 'wardrive-generator': return <WardriveGeneratorWorkbench onLogMessage={addLog} />;
    // New hacker tools
    case 'nmap-scanner': return <NmapScannerWorkbench onLogMessage={addLog} />;
    case 'hashcat-cracker': return <HashcatCrackerWorkbench onLogMessage={addLog} />;
    case 'http-workbench': return <HttpWorkbench onLogMessage={addLog} />;
    case 'burp-proxy': return <HttpWorkbench onLogMessage={addLog} initialSection="request" />;
    case 'aircrack-wifi': return <AircrackWifiWorkbench onLogMessage={addLog} />;
    case 'nikto-scanner': return <WebAnalyzerWorkbench onLogMessage={addLog} initialTab="paths" />;
    case 'hydra-bruteforce': return <HydraBruteforceWorkbench onLogMessage={addLog} />;
    case 'tcpdump-viewer': return <TcpdumpViewerWorkbench onLogMessage={addLog} />;
    case 'dns-toolkit': return <DnsToolkitWorkbench onLogMessage={addLog} />;
    case 'dns-enumerator': return <DnsToolkitWorkbench onLogMessage={addLog} initialTab="records" />;
    case 'owasp-zap': return <WebAnalyzerWorkbench onLogMessage={addLog} initialTab="passive" />;
    case 'api-client': return <HttpWorkbench onLogMessage={addLog} initialSection="api" />;
    case 'pwned-passwords': return <PwnedPasswordsCheckerWorkbench onLogMessage={addLog} />;
    case 'cert-inspect': return <CertInspectWorkbench onLogMessage={addLog} />;
    case 'db-browser': return <DbBrowserWorkbench onLogMessage={addLog} />;
    case 'regex-tester': return <RegexTesterWorkbench />;
    case 'jwt-inspector': return <JwtInspectorWorkbench onLogMessage={addLog} />;
    case 'dns-mail-doctor': return <DnsToolkitWorkbench onLogMessage={addLog} initialTab="email" />;
    case 'ip-calculator': return <IpCalculatorWorkbench />;
    case 'hash-calculator': return <HashCalculatorWorkbench onLogMessage={addLog} />;
    case 'crtsh-finder': return <CrtShFinderWorkbench onLogMessage={addLog} />;
    case 'osint-clients': return <OsintClientsWorkbench onLogMessage={addLog} />;
    case 'web-analyzer': return <WebAnalyzerWorkbench onLogMessage={addLog} />;
    case 'url-inspector': return <WebAnalyzerWorkbench onLogMessage={addLog} initialTab="links" />;
    default:
      return (
        <div className="py-16 text-center font-mono text-xs text-slate-500">
          Unknown tool <span className="text-slate-300">{String(toolId)}</span>. Close this window and pick a tool from the sidebar.
        </div>
      );
  }
}
