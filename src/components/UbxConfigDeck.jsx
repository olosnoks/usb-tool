import React, { useState } from 'react';
import { 
  Navigation, 
  Send, 
  Save, 
  Sliders, 
  CheckCircle2, 
  Radio, 
  Zap, 
  Compass,
  Cpu
} from 'lucide-react';
import { 
  buildCfgRate, 
  buildCfgPrtUart, 
  buildCfgSave, 
  buildCfgNav5, 
  buildCfgNmeaMsg 
} from '../utils/ubxProtocol';

export default function UbxConfigDeck({
  isConnected,
  onSendRawBytes,
  onLogMessage
}) {
  const [lastSentHex, setLastSentHex] = useState('');
  const [selectedBaud, setSelectedBaud] = useState(115200);

  const sendUbxCommand = async (ubxBytes, description) => {
    if (!isConnected) {
      alert('Please connect to a GPS serial port first.');
      return;
    }

    const hexStr = Array.from(ubxBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    setLastSentHex(hexStr);

    onLogMessage?.(`[UBX TX] ${description} (${ubxBytes.length} bytes): ${hexStr}`, 'tx', ubxBytes);
    await onSendRawBytes(ubxBytes);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Navigation className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">u-blox GPS BINARY CONFIGURATOR (UBX PROTOCOL)</h2>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          SUPPORTS NEO-6M / 7M / 8M / 9M / M10
        </span>
      </div>

      {/* Preset Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Update Rate Card */}
        <div className="bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Navigation Update Rate (UBX-CFG-RATE)
            </span>
            <p className="text-[11px] text-slate-400 leading-tight">
              Boost GPS fix refresh rate from 1 Hz up to 10 Hz for high-speed tracking.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              onClick={() => sendUbxCommand(buildCfgRate(100), 'Set 10 Hz Update Rate (100ms)')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-cyan font-bold border border-slate-700 hover:border-cyan-500 text-xs transition-all"
            >
              10 Hz (Fast)
            </button>
            <button
              onClick={() => sendUbxCommand(buildCfgRate(200), 'Set 5 Hz Update Rate (200ms)')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-amber font-bold border border-slate-700 hover:border-amber-500 text-xs transition-all"
            >
              5 Hz
            </button>
            <button
              onClick={() => sendUbxCommand(buildCfgRate(1000), 'Set 1 Hz Update Rate (1000ms)')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold border border-slate-700 text-xs transition-all"
            >
              1 Hz (Default)
            </button>
          </div>
        </div>

        {/* Baud Rate Config */}
        <div className="bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              UART Baud Rate (UBX-CFG-PRT)
            </span>
            <p className="text-[11px] text-slate-400 leading-tight">
              Reconfigure receiver baud rate to 115200 to prevent buffer overrun at 10 Hz.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => sendUbxCommand(buildCfgPrtUart(115200), 'Set UART1 Baud to 115200 bps')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-emerald font-bold border border-slate-700 hover:border-emerald-500 text-xs transition-all"
            >
              115,200 bps
            </button>
            <button
              onClick={() => sendUbxCommand(buildCfgPrtUart(9600), 'Set UART1 Baud to 9600 bps')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold border border-slate-700 text-xs transition-all"
            >
              9,600 bps (Default)
            </button>
          </div>
        </div>

        {/* Dynamic Platform & Save */}
        <div className="bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Platform & Non-Volatile Memory
            </span>
            <p className="text-[11px] text-slate-400 leading-tight">
              Set Kalman filter dynamics and save changes permanently to EEPROM.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => sendUbxCommand(buildCfgNav5(4), 'Set Dynamic Model to Automotive (4)')}
              className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-bold transition-all"
            >
              Automotive Mode
            </button>
            <button
              onClick={() => sendUbxCommand(buildCfgSave(), 'Save Settings to Flash / EEPROM')}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold hover:brightness-110 shadow-amber-glow text-xs transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>SAVE TO FLASH</span>
            </button>
          </div>
        </div>
      </div>

      {/* Frame Preview Footer */}
      {lastSentHex && (
        <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold">LAST TRANSMITTED UBX FRAME:</span>
            <code className="text-cyber-cyan font-mono text-[11px]">{lastSentHex}</code>
          </div>
          <span className="text-[10px] text-emerald-400 font-bold">✓ CHECKSUM COMPUTED</span>
        </div>
      )}
    </div>
  );
}
