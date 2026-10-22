import React, { useState } from 'react';
import { 
  Command, 
  Terminal, 
  RotateCcw, 
  Radio, 
  Sparkles, 
  Send, 
  Edit3, 
  Check, 
  Trash2,
  Cpu,
  Zap
} from 'lucide-react';

const DEFAULT_CUSTOM_MACROS = [
  { id: '1', label: 'ESP Info', command: 'AT+GMR', ending: '\r\n', color: 'amber' },
  { id: '2', label: 'WiFi Scan', command: 'AT+CWLAP', ending: '\r\n', color: 'cyan' },
  { id: '3', label: 'Mem Free', command: 'import gc; print("Free:", gc.mem_free())', ending: '\r\n', color: 'emerald' },
  { id: '4', label: 'Sys Info', command: 'import sys; print(sys.implementation)', ending: '\r\n', color: 'purple' },
  { id: '5', label: 'Soft Reset', command: 'import machine; machine.reset()', ending: '\r\n', color: 'rose' },
  { id: '6', label: 'IP Query', command: 'AT+CIFSR', ending: '\r\n', color: 'cyan' },
  { id: '7', label: 'Modem Signal', command: 'AT+CSQ', ending: '\r\n', color: 'amber' },
  { id: '8', label: 'Modules Help', command: 'help("modules")', ending: '\r\n', color: 'emerald' },
];

export default function MacroDecks({
  isConnected,
  onSendRawByte,
  onSendString,
  onLogMessage
}) {
  const [activeDeck, setActiveDeck] = useState('micropython'); // 'micropython' | 'at-commands' | 'custom'
  const [customMacros, setCustomMacros] = useState(() => {
    try {
      const stored = localStorage.getItem('skon_custom_macros');
      return stored ? JSON.parse(stored) : DEFAULT_CUSTOM_MACROS;
    } catch {
      return DEFAULT_CUSTOM_MACROS;
    }
  });

  const [editingMacroId, setEditingMacroId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCmd, setEditCmd] = useState('');

  // Send single control byte
  const sendControlCode = async (byteVal, label) => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }
    try {
      await onSendRawByte(new Uint8Array([byteVal]));
      onLogMessage?.(`[MACRO] Sent ${label} (0x${byteVal.toString(16).padStart(2, '0').toUpperCase()})`, 'tx');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[MACRO ERROR] ${err.message}`, 'sys');
    }
  };

  // Send text string command
  const sendMacroCommand = async (cmd, ending = '\r\n', label = '') => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }
    try {
      await onSendString(cmd, ending);
      onLogMessage?.(`[MACRO] Executed: ${label || cmd}`, 'tx');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[MACRO ERROR] ${err.message}`, 'sys');
    }
  };

  const startEditMacro = (macro) => {
    setEditingMacroId(macro.id);
    setEditLabel(macro.label);
    setEditCmd(macro.command);
  };

  const saveEditMacro = (id) => {
    const updated = customMacros.map(m => {
      if (m.id === id) {
        return { ...m, label: editLabel, command: editCmd };
      }
      return m;
    });
    setCustomMacros(updated);
    setEditingMacroId(null);
    try {
      localStorage.setItem('skon_custom_macros', JSON.stringify(updated));
    } catch (e) {}
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Command className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">HARDWARE HACKER MACRO DECKS</h2>
        </div>

        {/* Deck Switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
          <button
            onClick={() => setActiveDeck('micropython')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeDeck === 'micropython' ? 'bg-amber-500/20 text-cyber-amber' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            MicroPython REPL
          </button>
          <button
            onClick={() => setActiveDeck('at-commands')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeDeck === 'at-commands' ? 'bg-cyan-500/20 text-cyber-cyan' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Modem / AT Commands
          </button>
          <button
            onClick={() => setActiveDeck('custom')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeDeck === 'custom' ? 'bg-emerald-500/20 text-cyber-emerald' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Custom Macro Bank
          </button>
        </div>
      </div>

      {/* Deck 1: MicroPython / CircuitPython REPL */}
      {activeDeck === 'micropython' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <p className="text-slate-400 text-[11px]">
            Direct control keycodes for MicroPython, CircuitPython, NodeMCU, and embedded interactive shells.
          </p>

          {/* REPL Control Keys */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={() => sendControlCode(0x03, 'Ctrl+C (KeyboardInterrupt)')}
              disabled={!isConnected}
              className="flex flex-col items-center justify-center p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold transition-all disabled:opacity-40"
            >
              <span className="text-xs">Ctrl + C</span>
              <span className="text-[9px] text-rose-400/80 font-normal">Interrupt / Stop</span>
            </button>

            <button
              onClick={() => sendControlCode(0x04, 'Ctrl+D (Soft Reboot)')}
              disabled={!isConnected}
              className="flex flex-col items-center justify-center p-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-cyber-amber border border-amber-500/30 font-bold transition-all disabled:opacity-40"
            >
              <span className="text-xs">Ctrl + D</span>
              <span className="text-[9px] text-amber-400/80 font-normal">Soft Reboot</span>
            </button>

            <button
              onClick={() => sendControlCode(0x01, 'Ctrl+A (Raw REPL)')}
              disabled={!isConnected}
              className="flex flex-col items-center justify-center p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyber-cyan border border-cyan-500/30 font-bold transition-all disabled:opacity-40"
            >
              <span className="text-xs">Ctrl + A</span>
              <span className="text-[9px] text-cyan-400/80 font-normal">Raw REPL</span>
            </button>

            <button
              onClick={() => sendControlCode(0x02, 'Ctrl+B (Normal REPL)')}
              disabled={!isConnected}
              className="flex flex-col items-center justify-center p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-cyber-emerald border border-emerald-500/30 font-bold transition-all disabled:opacity-40"
            >
              <span className="text-xs">Ctrl + B</span>
              <span className="text-[9px] text-emerald-400/80 font-normal">Normal REPL</span>
            </button>

            <button
              onClick={() => sendControlCode(0x05, 'Ctrl+E (Paste Mode)')}
              disabled={!isConnected}
              className="flex flex-col items-center justify-center p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold transition-all disabled:opacity-40"
            >
              <span className="text-xs">Ctrl + E</span>
              <span className="text-[9px] text-purple-400/80 font-normal">Paste Mode</span>
            </button>
          </div>

          {/* Quick Code Snippets */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
              COMMON REPL DIAGNOSTIC ONE-LINERS
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => sendMacroCommand('import sys; print(sys.implementation)', '\r\n', 'System Implementation')}
                disabled={!isConnected}
                className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 transition-colors flex items-center justify-between group disabled:opacity-40"
              >
                <div>
                  <span className="font-semibold text-cyber-amber block">Python Sys Implementation</span>
                  <span className="text-[10px] text-slate-500">import sys; print(sys.implementation)</span>
                </div>
                <Send className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyber-amber transition-colors" />
              </button>

              <button
                onClick={() => sendMacroCommand('import gc; print("Free RAM:", gc.mem_free(), "Alloc:", gc.mem_alloc())', '\r\n', 'GC Memory Check')}
                disabled={!isConnected}
                className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 transition-colors flex items-center justify-between group disabled:opacity-40"
              >
                <div>
                  <span className="font-semibold text-cyber-cyan block">Garbage Collector RAM Stats</span>
                  <span className="text-[10px] text-slate-500">gc.mem_free(), gc.mem_alloc()</span>
                </div>
                <Send className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyber-cyan transition-colors" />
              </button>

              <button
                onClick={() => sendMacroCommand('import machine; machine.reset()', '\r\n', 'Hardware MCU Reset')}
                disabled={!isConnected}
                className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 transition-colors flex items-center justify-between group disabled:opacity-40"
              >
                <div>
                  <span className="font-semibold text-rose-400 block">Hardware MCU Reset</span>
                  <span className="text-[10px] text-slate-500">machine.reset()</span>
                </div>
                <Send className="w-3.5 h-3.5 text-slate-600 group-hover:text-rose-400 transition-colors" />
              </button>

              <button
                onClick={() => sendMacroCommand('help("modules")', '\r\n', 'Installed Modules')}
                disabled={!isConnected}
                className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 transition-colors flex items-center justify-between group disabled:opacity-40"
              >
                <div>
                  <span className="font-semibold text-cyber-emerald block">List Built-in Modules</span>
                  <span className="text-[10px] text-slate-500">help("modules")</span>
                </div>
                <Send className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyber-emerald transition-colors" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deck 2: AT Commands (Cellular / ESP / Modems) */}
      {activeDeck === 'at-commands' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <p className="text-slate-400 text-[11px]">
            Standard Hayes AT Command set for ESP8266/ESP32 AT firmware, SIMCOM cellular modems, Quectel, HC-05 Bluetooth, etc.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { cmd: 'AT', desc: 'Ping / Test OK' },
              { cmd: 'AT+GMR', desc: 'Firmware & SDK Version' },
              { cmd: 'AT+RST', desc: 'Module Software Reset' },
              { cmd: 'AT+CSQ', desc: 'Cellular Signal Quality' },
              { cmd: 'AT+CWMODE=1', desc: 'Set Station (Client) Mode' },
              { cmd: 'AT+CWLAP', desc: 'Scan Available WiFi APs' },
              { cmd: 'AT+CIFSR', desc: 'Query Local IP Address' },
              { cmd: 'AT+RESTORE', desc: 'Factory Default Reset' }
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={() => sendMacroCommand(item.cmd, '\r\n', item.cmd)}
                disabled={!isConnected}
                className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-cyan text-slate-200 transition-all group disabled:opacity-40"
              >
                <div className="font-bold text-cyber-cyan group-hover:text-cyan-300">{item.cmd}</div>
                <div className="text-[10px] text-slate-500">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Deck 3: Custom Programmable Macro Bank */}
      {activeDeck === 'custom' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Quick-access macro triggers. Click the pencil icon to customize slots.</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {customMacros.map((macro) => (
              <div 
                key={macro.id}
                className="relative bg-slate-950 border border-slate-800 rounded-lg p-2 flex flex-col justify-between hover:border-slate-700 transition-colors group"
              >
                {editingMacroId === macro.id ? (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-cyber-amber outline-none"
                    />
                    <input
                      type="text"
                      value={editCmd}
                      onChange={(e) => setEditCmd(e.target.value)}
                      placeholder="Command string"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-200 outline-none"
                    />
                    <button
                      onClick={() => saveEditMacro(macro.id)}
                      className="w-full py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Save
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => sendMacroCommand(macro.command, macro.ending || '\r\n', macro.label)}
                      disabled={!isConnected}
                      className="text-left w-full h-full disabled:opacity-40"
                    >
                      <div className="font-bold text-cyber-amber group-hover:text-amber-300">
                        {macro.label}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[120px]">
                        {macro.command}
                      </div>
                    </button>

                    <button
                      onClick={() => startEditMacro(macro)}
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-200 transition-opacity"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
