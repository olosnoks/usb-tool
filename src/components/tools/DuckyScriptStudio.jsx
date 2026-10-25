import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Terminal, 
  Play, 
  Square, 
  Copy, 
  Check, 
  Download, 
  Upload, 
  FileCode, 
  Sparkles, 
  HardDrive, 
  ShieldCheck, 
  Zap, 
  AlertCircle, 
  RotateCcw,
  Sliders,
  Send,
  Keyboard,
  Info
} from 'lucide-react';
import { getFlipperDriver } from '../../utils/flipperDriver';

const DUCKY_PRESETS = [
  {
    name: 'Quick System Hardware Audit (Admin)',
    desc: 'Opens PowerShell and collects system hardware, CPU, and memory stats.',
    script: `REM System Diagnostic and Hardware Audit
DEFAULT_DELAY 250
GUI r
DELAY 500
STRING powershell -NoExit -Command "Get-ComputerInfo | Select-Object WindowsProductName, OsHardwareAbstractionLayer, CsProcessors, CsTotalPhysicalMemory"
ENTER
`
  },
  {
    name: 'Network Adapter & Ping Diagnostic',
    desc: 'Runs IP configuration, ping test to gateway, and DNS diagnostics.',
    script: `REM Network Diagnostics & Gateway Ping
DEFAULT_DELAY 200
GUI r
DELAY 400
STRING cmd /k "ipconfig /all & ping -n 4 8.8.8.8"
ENTER
`
  },
  {
    name: 'Diagnostic Notepad Scratchpad',
    desc: 'Launches notepad and writes a verification banner to test USB HID keyboard typing speed.',
    script: `REM Launch Notepad & Verify Typing Speed
DEFAULT_DELAY 200
GUI r
DELAY 400
STRING notepad
ENTER
DELAY 600
STRING [SKON'S USB TOOL] DuckyScript BadUSB HID Protocol Verified!
ENTER
STRING Hardware latency: 15ms. Keystroke test complete.
`
  },
  {
    name: 'Lock Workstation',
    desc: 'Sends Windows+L shortcut to instantly lock the desktop.',
    script: `REM Instant Workstation Lock
DELAY 300
GUI l
`
  }
];

export default function DuckyScriptStudio() {
  const driver = getFlipperDriver();
  const [script, setScript] = useState(DUCKY_PRESETS[0].script);
  const [selectedFormat, setSelectedFormat] = useState('flipper'); // 'flipper' | 'arduino' | 'circuitpython' | 'raw'
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [simCurrentKey, setSimCurrentKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const simTimeoutRef = useRef(null);

  // Convert DuckyScript to Arduino Keyboard HID
  const convertToArduino = (duckyText) => {
    const lines = duckyText.split('\n');
    let code = `#include "Keyboard.h"\n\nvoid setup() {\n  Keyboard.begin();\n  delay(1000);\n\n`;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('REM')) continue;
      if (trimmed.startsWith('DELAY ')) {
        const ms = trimmed.split(' ')[1] || '100';
        code += `  delay(${ms});\n`;
      } else if (trimmed.startsWith('STRING ')) {
        const text = trimmed.substring(7);
        code += `  Keyboard.print("${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");\n`;
      } else if (trimmed === 'ENTER') {
        code += `  Keyboard.write(KEY_RETURN);\n`;
      } else if (trimmed.startsWith('GUI ') || trimmed.startsWith('WINDOWS ')) {
        const key = trimmed.split(' ')[1] || '';
        code += `  Keyboard.press(KEY_LEFT_GUI);\n  Keyboard.press('${key}');\n  delay(50);\n  Keyboard.releaseAll();\n`;
      }
    }
    code += `  Keyboard.end();\n}\n\nvoid loop() {}\n`;
    return code;
  };

  // Convert DuckyScript to CircuitPython / Pico HID
  const convertToCircuitPython = (duckyText) => {
    const lines = duckyText.split('\n');
    let code = `import time\nimport usb_hid\nfrom adafruit_hid.keyboard import Keyboard\nfrom adafruit_hid.keyboard_layout_us import KeyboardLayoutUS\nfrom adafruit_hid.keycode import Keycode\n\ntime.sleep(1)\nkbd = Keyboard(usb_hid.devices)\nlayout = KeyboardLayoutUS(kbd)\n\n`;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('REM')) continue;
      if (trimmed.startsWith('DELAY ')) {
        const ms = parseInt(trimmed.split(' ')[1] || '100', 10);
        code += `time.sleep(${ms / 1000})\n`;
      } else if (trimmed.startsWith('STRING ')) {
        const text = trimmed.substring(7);
        code += `layout.write("${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")\n`;
      } else if (trimmed === 'ENTER') {
        code += `kbd.send(Keycode.ENTER)\n`;
      } else if (trimmed.startsWith('GUI ') || trimmed.startsWith('WINDOWS ')) {
        const key = trimmed.split(' ')[1]?.toUpperCase() || 'R';
        code += `kbd.send(Keycode.GUI, Keycode.${key})\n`;
      }
    }
    return code;
  };

  // Get active export representation
  const generatedCode = () => {
    if (selectedFormat === 'arduino') return convertToArduino(script);
    if (selectedFormat === 'circuitpython') return convertToCircuitPython(script);
    return script;
  };

  // Simulate Keystroke playback in browser
  const runSimulation = () => {
    if (isSimulating) {
      clearTimeout(simTimeoutRef.current);
      setIsSimulating(false);
      setSimCurrentKey('');
      setSimProgress(0);
      return;
    }

    const lines = script.split('\n').filter(l => l.trim() && !l.trim().startsWith('REM'));
    if (lines.length === 0) return;

    setIsSimulating(true);
    let index = 0;

    const playNext = () => {
      if (index >= lines.length) {
        setIsSimulating(false);
        setSimCurrentKey('Playback complete');
        setTimeout(() => setSimCurrentKey(''), 2000);
        return;
      }

      const line = lines[index].trim();
      setSimCurrentKey(line);
      setSimProgress(Math.round(((index + 1) / lines.length) * 100));

      let delay = 200;
      if (line.startsWith('DELAY ')) {
        delay = Math.min(parseInt(line.split(' ')[1], 10) || 200, 1500); // capped for preview
      }

      index++;
      simTimeoutRef.current = setTimeout(playNext, delay);
    };

    playNext();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    const ext = selectedFormat === 'arduino' ? 'ino' : selectedFormat === 'circuitpython' ? 'py' : 'txt';
    const blob = new Blob([generatedCode()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `badusb_payload.${ext}`;
    a.click();
  };

  // Upload directly to connected Flipper Zero's /ext/badusb/ folder
  const uploadToFlipper = async () => {
    if (!driver.isConnected) {
      setStatusMsg({ type: 'error', text: 'Flipper Zero is not connected! Connect in the Flipper tab first.' });
      setTimeout(() => setStatusMsg(null), 4000);
      return;
    }

    try {
      setStatusMsg({ type: 'info', text: 'Uploading to physical Flipper /ext/badusb/skon_script.txt...' });
      const bytes = new TextEncoder().encode(script);
      await driver.writeRealFile('/ext/badusb/skon_script.txt', bytes);
      setStatusMsg({ type: 'success', text: 'Successfully saved to Flipper at /ext/badusb/skon_script.txt!' });
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: 'error', text: `Upload failed: ${err.message}` });
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Header Deck */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Keyboard className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>DUCKYSCRIPT BADUSB STUDIO</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">HID Keystroke Engine</span>
            </h2>
            <p className="text-xs text-slate-400">
              Compose, validate, simulate, and export DuckyScript payloads to Flipper Zero, Arduino, or CircuitPython.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Format selector */}
          <div className="flex items-center gap-1 p-1 bg-[#101216] border border-[#232733] rounded-xl text-xs">
            <button
              onClick={() => setSelectedFormat('flipper')}
              className={`px-2.5 py-1 rounded-lg transition ${selectedFormat === 'flipper' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'}`}
            >
              Flipper (.txt)
            </button>
            <button
              onClick={() => setSelectedFormat('arduino')}
              className={`px-2.5 py-1 rounded-lg transition ${selectedFormat === 'arduino' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'}`}
            >
              Arduino (.ino)
            </button>
            <button
              onClick={() => setSelectedFormat('circuitpython')}
              className={`px-2.5 py-1 rounded-lg transition ${selectedFormat === 'circuitpython' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'}`}
            >
              Pico / Python
            </button>
          </div>

          <button
            onClick={downloadFile}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs transition flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>

          <button
            onClick={uploadToFlipper}
            className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-md shadow-amber-500/20"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Push to Flipper Zero</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
          statusMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
          statusMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
          'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
        }`}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Main Grid: Presets & Editor | Simulator & Target Code */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Presets & Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Quick Presets */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">QUICK PRESET SCRIPTS</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {DUCKY_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setScript(p.script)}
                  className="text-left p-2.5 bg-[#1e212b] hover:bg-[#252a37] border border-[#2b303c] hover:border-amber-500/40 rounded-xl transition text-xs space-y-0.5 group"
                >
                  <span className="font-bold text-slate-200 group-hover:text-amber-300 transition block">{p.name}</span>
                  <span className="text-[10px] text-slate-500 line-clamp-1">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* DuckyScript Editor */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-amber-400" />
                <span>DUCKYSCRIPT EDITOR</span>
              </span>
              <span className="text-[10px] text-slate-500">{script.split('\n').length} lines</span>
            </div>

            <textarea
              rows={14}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-xl p-3 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400 transition leading-relaxed resize-y"
              placeholder="Type DuckyScript commands here (e.g. STRING, DELAY, GUI r, ENTER)..."
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Info className="w-3.5 h-3.5" />
                <span>Commands: REM, STRING, DELAY, ENTER, GUI, WINDOWS, ALT, CTRL, SHIFT, TAB</span>
              </div>
              <button
                onClick={runSimulation}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  isSimulating 
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                    : 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                }`}
              >
                {isSimulating ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isSimulating ? 'Stop Simulator' : 'Simulate Playback'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: Simulation Monitor & Exported Output (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Keystroke Simulator Monitor */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 space-y-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>KEYSTROKE PLAYBACK SIMULATOR</span>
            </span>

            <div className="h-24 bg-[#12141a] border border-[#282d3a] rounded-xl p-3 flex flex-col justify-between">
              <div className="text-[11px] text-slate-500 uppercase font-bold">Simulated HID Event:</div>
              <div className="text-sm font-bold text-cyan-300 truncate">
                {simCurrentKey || (isSimulating ? 'Starting...' : 'Standby - Click "Simulate Playback"')}
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-400 transition-all duration-200" 
                  style={{ width: `${simProgress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Exported Target Code Deck */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 space-y-3 flex flex-col flex-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold uppercase tracking-wider text-[11px] text-slate-200">
                COMPILED {selectedFormat.toUpperCase()} TARGET
              </span>
              <button
                onClick={copyCode}
                className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 rounded-lg border border-[#2b303c] transition flex items-center gap-1 text-[11px]"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <textarea
              readOnly
              rows={13}
              value={generatedCode()}
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-xl p-3 text-xs text-slate-300 font-mono focus:outline-none transition leading-relaxed resize-y"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
