import React, { useState } from 'react';
import { 
  Activity, 
  ArrowLeftRight, 
  Bot, 
  Command, 
  Compass, 
  Cpu, 
  FileCode, 
  Gauge, 
  HardDrive, 
  Layers, 
  Navigation, 
  Radar, 
  Radio, 
  ShieldAlert, 
  Sliders, 
  Usb, 
  Wifi 
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';

// Import existing workbench sub-components
import SerialPlotter from '../SerialPlotter';
import TelemetryDashboard from '../TelemetryDashboard';
import SerialBridgeDeck from '../SerialBridgeDeck';
import PacketFramer from '../PacketFramer';
import MicroPythonFileManager from '../MicroPythonFileManager';
import UbxConfigDeck from '../UbxConfigDeck';
import GpsWardriverDeck from '../GpsWardriverDeck';
import ImprovWifiDeck from '../ImprovWifiDeck';
import AutoResponderDeck from '../AutoResponderDeck';
import ScriptRunner from '../ScriptRunner';
import CrashAlertDeck from '../CrashAlertDeck';
import UsbReconDeck from '../UsbReconDeck';
import EspMemoryInspector from '../EspMemoryInspector';
import MacroDecks from '../MacroDecks';

const ADVANCED_MODULES = [
  { id: 'plotter', name: 'OSCILLOSCOPE', category: 'debug', icon: Activity, desc: 'Real-time multi-channel waveform plotter' },
  { id: 'telemetry', name: 'TELEMETRY GAUGES', category: 'debug', icon: Gauge, desc: 'Analytic dials and sensor value monitors' },
  { id: 'alerts', name: 'CRASH ALERTS', category: 'debug', icon: ShieldAlert, desc: 'Auto-detect kernel panics, assert errors & guru meditation' },
  
  { id: 'bridge', name: 'MitM BRIDGE', category: 'protocols', icon: ArrowLeftRight, desc: 'Bidirectional bridge between 2 serial ports' },
  { id: 'packets', name: 'PACKET FRAMER', category: 'protocols', icon: Layers, desc: 'SLIP, COBS & custom protocol decoder' },
  { id: 'ubx', name: 'UBX GPS', category: 'protocols', icon: Navigation, desc: 'u-blox binary protocol receiver configuration' },

  { id: 'micropython', name: 'MICROPYTHON FILES', category: 'firmware', icon: FileCode, desc: 'On-device filesystem manager for pyboard / ESP' },
  { id: 'esp-dump', name: 'SILICON & DUMP', category: 'firmware', icon: Cpu, desc: 'Direct memory & eFuse reader' },
  { id: 'improv', name: 'IMPROV WI-FI', category: 'firmware', icon: Wifi, desc: 'Improv standard BLE / Serial Wi-Fi provisioner' },

  { id: 'autopsy', name: 'USB AUTOPSY', category: 'automation', icon: Usb, desc: 'Deep USB descriptor analyzer & endpoint mapper' },
  { id: 'responder', name: 'AUTO-RESPONDER', category: 'automation', icon: Bot, desc: 'Automated conditional rule engine' },
  { id: 'scripting', name: 'TEST RUNNER', category: 'automation', icon: Bot, desc: 'Run automated JavaScript test sequences' },
  { id: 'wardrive', name: 'WARDRIVE / GPS', category: 'automation', icon: Compass, desc: 'NMEA sentence parser & wardriving tools' },
  { id: 'macros', name: 'MACRO DECKS', category: 'automation', icon: Command, desc: 'Quick transmission macro pads' }
];

export default function AdvancedLabTab() {
  const {
    isConnected,
    port,
    latestRxText,
    hexByteStream,
    sendString,
    sendRawBytes,
    toggleSignal,
    setBaudRate,
    baudRate,
    addLog,
    boards,
    activeBoardId,
    setActiveBoardId
  } = useSerial();

  const [activeModule, setActiveModule] = useState('plotter');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const filteredModules = ADVANCED_MODULES.filter(
    m => selectedCategory === 'all' || m.category === selectedCategory
  );

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Category selector & Module tabs */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 shadow-xl">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          {[
            { id: 'all', name: 'ALL' },
            { id: 'debug', name: 'DEBUG & GAUGES' },
            { id: 'protocols', name: 'PROTOCOLS & BUS' },
            { id: 'firmware', name: 'FIRMWARE TOOLS' },
            { id: 'automation', name: 'AUTOMATION & RE' }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                selectedCategory === cat.id
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Module Sub-Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto max-w-full text-xs">
          {filteredModules.map(m => {
            const Icon = m.icon;
            const isActive = activeModule === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all shrink-0 ${
                  isActive
                    ? 'bg-slate-800 text-rose-300 border-rose-500/60 shadow-rose-glow'
                    : 'bg-slate-950 text-slate-400 border-slate-850 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Render Active Specialized Module */}
      <div className="pt-1">
        {activeModule === 'plotter' && (
          <SerialPlotter
            latestTextStream={latestRxText}
            isConnected={isConnected}
          />
        )}

        {activeModule === 'telemetry' && (
          <TelemetryDashboard
            latestTextStream={latestRxText}
            isConnected={isConnected}
            boards={boards}
            activeBoardId={activeBoardId}
            onSelectBoard={setActiveBoardId}
          />
        )}

        {activeModule === 'alerts' && (
          <CrashAlertDeck
            latestTextStream={latestRxText}
            onPauseTerminal={() => {}}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'bridge' && (
          <SerialBridgeDeck
            boards={boards}
            onSendRawBytes={sendRawBytes}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'packets' && (
          <PacketFramer
            activeHexByteStream={hexByteStream}
            isConnected={isConnected}
          />
        )}

        {activeModule === 'ubx' && (
          <UbxConfigDeck
            isConnected={isConnected}
            onSendRawBytes={sendRawBytes}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'micropython' && (
          <MicroPythonFileManager
            isConnected={isConnected}
            onSendString={sendString}
            latestRxText={latestRxText}
            onLogMessage={addLog}
            boards={boards}
            activeBoardId={activeBoardId}
            onSelectBoard={setActiveBoardId}
          />
        )}

        {activeModule === 'esp-dump' && (
          <EspMemoryInspector
            isConnected={isConnected}
            port={port}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'improv' && (
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
        )}

        {activeModule === 'autopsy' && (
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
        )}

        {activeModule === 'responder' && (
          <AutoResponderDeck
            isConnected={isConnected}
            latestRxText={latestRxText}
            onSendString={sendString}
            onLogMessage={addLog}
            boards={boards}
            activeBoardId={activeBoardId}
            onSelectBoard={setActiveBoardId}
          />
        )}

        {activeModule === 'scripting' && (
          <ScriptRunner
            isConnected={isConnected}
            onSendString={sendString}
            latestRxText={latestRxText}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'wardrive' && (
          <GpsWardriverDeck
            latestTextStream={latestRxText}
            isConnected={isConnected}
            onLogMessage={addLog}
          />
        )}

        {activeModule === 'macros' && (
          <MacroDecks
            isConnected={isConnected}
            onSendRawByte={sendRawBytes}
            onSendString={sendString}
            onLogMessage={addLog}
          />
        )}
      </div>
    </div>
  );
}
