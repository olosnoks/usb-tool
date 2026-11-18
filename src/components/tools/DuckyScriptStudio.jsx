import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import { DIALECTS, lintDucky, estimateTiming, formatDuration, convertDialect, toArduino, toCircuitPython, expandScript } from '../../utils/duckyScript';

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
  const [selectedFormat, setSelectedFormat] = useState('flipper'); // 'flipper' | 'arduino' | 'circuitpython'
  const [dialect, setDialect] = useState('ducky3');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [simCurrentKey, setSimCurrentKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [convertNotes, setConvertNotes] = useState([]);
  const simTimeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(simTimeoutRef.current), []);

  const issues = useMemo(() => lintDucky(script, dialect), [script, dialect]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const timing = useMemo(() => estimateTiming(script), [script]);
  const exported = useMemo(() => {
    if (selectedFormat === 'arduino') return toArduino(script);
    if (selectedFormat === 'circuitpython') return toCircuitPython(script);
    return { code: script, skipped: [] };
  }, [script, selectedFormat]);

  const applyDialect = (target) => {
    const r = convertDialect(script, target);
    setScript(r.text);
    setConvertNotes(r.notes.length ? r.notes : [`Converted to ${DIALECTS[target]}; no changes needed.`]);
  };

  const runSimulation = () => {
    if (isSimulating) {
      clearTimeout(simTimeoutRef.current);
      setIsSimulating(false);
      setSimCurrentKey('');
      setSimProgress(0);
      return;
    }
    const ops = expandScript(script).filter((o) => o.type !== 'other');
    if (ops.length === 0) return;
    setIsSimulating(true);
    let index = 0;
    const playNext = () => {
      if (index >= ops.length) {
        setIsSimulating(false);
        setSimCurrentKey('Playback complete');
        simTimeoutRef.current = setTimeout(() => setSimCurrentKey(''), 2000);
        return;
      }
      const op = ops[index];
      setSimCurrentKey(op.repeated ? `${op.line} (repeat)` : op.line);
      setSimProgress(Math.round(((index + 1) / ops.length) * 100));
      const real = op.type === 'delay' ? op.ms : op.type === 'string' ? op.text.length * 10 : 20;
      index++;
      simTimeoutRef.current = setTimeout(playNext, Math.min(Math.max(real, 120), 1500)); // capped for preview
    };
    playNext();
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(exported.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    const ext = selectedFormat === 'arduino' ? 'ino' : selectedFormat === 'circuitpython' ? 'py' : 'txt';
    const blob = new Blob([exported.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `badusb_payload.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setScript(await f.text());
    setConvertNotes([]);
    e.target.value = '';
  };

  const flash = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Upload directly to connected Flipper Zero's /ext/badusb/ folder
  const uploadToFlipper = async () => {
    if (!driver.isConnected) {
      flash({ type: 'error', text: 'Flipper Zero is not connected! Connect in the Flipper tab first.' });
      return;
    }
    try {
      setStatusMsg({ type: 'info', text: 'Uploading to physical Flipper /ext/badusb/skon_script.txt...' });
      await driver.writeRealFile('/ext/badusb/skon_script.txt', new TextEncoder().encode(script));
      flash({ type: 'success', text: 'Successfully saved to Flipper at /ext/badusb/skon_script.txt!' });
    } catch (err) {
      console.error(err);
      flash({ type: 'error', text: `Upload failed: ${err.message}` });
    }
  };

  const btn = 'px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-lg text-[11px] transition flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-amber-400';
  const seg = (on) => `px-2 py-0.5 rounded-md transition ${on ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'}`;

  return (
    <div className="flex flex-col gap-2 font-mono">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div role="group" aria-label="Export format" className="flex items-center gap-0.5 p-0.5 bg-[#101216] border border-[#232733] rounded-lg">
          <button onClick={() => setSelectedFormat('flipper')} className={seg(selectedFormat === 'flipper')}>Flipper .txt</button>
          <button onClick={() => setSelectedFormat('arduino')} className={seg(selectedFormat === 'arduino')}>Arduino</button>
          <button onClick={() => setSelectedFormat('circuitpython')} className={seg(selectedFormat === 'circuitpython')}>Pico / Python</button>
        </div>
        <label className="flex items-center gap-1 text-slate-400">
          <span>Dialect</span>
          <select
            aria-label="Script dialect"
            value={dialect}
            onChange={(e) => setDialect(e.target.value)}
            className="bg-[#101216] border border-[#232733] rounded-lg px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-amber-400"
          >
            {Object.entries(DIALECTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button onClick={() => applyDialect(dialect)} className={btn} title="Rewrite the script for the selected dialect (aliases mapped, unsupported lines commented out)">
          <Sliders className="w-3 h-3" /><span>Convert</span>
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <label className={`${btn} cursor-pointer`} title="Open a .txt DuckyScript file">
            <Upload className="w-3 h-3" /><span>Open</span>
            <input type="file" accept=".txt,.ducky,.duck" className="sr-only" onChange={importFile} />
          </label>
          <button onClick={downloadFile} className={btn} title="Download the exported file"><Download className="w-3 h-3" /><span>Save</span></button>
          <button
            onClick={uploadToFlipper}
            className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-[11px] transition flex items-center gap-1"
            title="Write to /ext/badusb/skon_script.txt on a connected Flipper Zero"
          >
            <Bot className="w-3 h-3" /><span>Push to Flipper</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div role="status" className={`p-2 rounded-lg border text-[11px] flex items-center gap-2 ${
          statusMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
          statusMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
          'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
        }`}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 @lg:grid-cols-12 gap-2">
        <div className="@lg:col-span-7 space-y-2 min-w-0">
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="font-bold uppercase tracking-wider flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-amber-400" />Script
              </span>
              <span className="text-[10px] text-slate-500">{script.split('\n').length} lines</span>
            </div>
            <textarea
              rows={12}
              aria-label="DuckyScript editor"
              spellCheck={false}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-lg p-2 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400 transition leading-relaxed resize-y"
              placeholder="STRING, DELAY, GUI r, ENTER ..."
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-[11px]" aria-live="polite">
                <span className={errorCount ? 'text-rose-300' : 'text-emerald-300'}>{errorCount} error{errorCount === 1 ? '' : 's'}</span>
                <span className={warnCount ? 'text-amber-300' : 'text-slate-500'}>{warnCount} warning{warnCount === 1 ? '' : 's'}</span>
                <span className="text-slate-500" title={`${timing.keystrokes} keystrokes, ${timing.typedChars} typed chars (about 10 ms per char, 20 ms per key). Real hardware varies.`}>
                  ~{formatDuration(timing.totalMs)}
                </span>
              </div>
              <button
                onClick={runSimulation}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 ${
                  isSimulating ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                }`}
              >
                {isSimulating ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isSimulating ? 'Stop' : 'Simulate'}</span>
              </button>
            </div>
          </div>

          {(issues.length > 0 || convertNotes.length > 0) && (
            <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 space-y-1 max-h-40 overflow-y-auto" aria-label="Diagnostics">
              {issues.slice(0, 50).map((i, k) => (
                <div key={k} className={`text-[11px] flex gap-1.5 ${i.severity === 'error' ? 'text-rose-300' : i.severity === 'warning' ? 'text-amber-300' : 'text-slate-400'}`}>
                  <span className="shrink-0 text-slate-500">L{i.line}</span><span>{i.message}</span>
                </div>
              ))}
              {issues.length > 50 && <div className="text-[10px] text-slate-500">+{issues.length - 50} more</div>}
              {convertNotes.map((nte, k) => <div key={`n${k}`} className="text-[11px] text-cyan-300">{nte}</div>)}
            </div>
          )}

          <details className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 text-xs">
            <summary className="cursor-pointer text-[11px] font-bold text-slate-400 uppercase tracking-wider">Presets</summary>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-1.5 mt-2">
              {DUCKY_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => { setScript(p.script); setConvertNotes([]); }}
                  className="text-left p-2 bg-[#1e212b] hover:bg-[#252a37] border border-[#2b303c] hover:border-amber-500/40 rounded-lg transition group"
                >
                  <span className="font-bold text-slate-200 group-hover:text-amber-300 block text-[11px]">{p.name}</span>
                  <span className="text-[10px] text-slate-500 line-clamp-1">{p.desc}</span>
                </button>
              ))}
            </div>
          </details>
        </div>

        <div className="@lg:col-span-5 space-y-2 min-w-0">
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 space-y-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />Playback
            </span>
            <div className="bg-[#12141a] border border-[#282d3a] rounded-lg p-2 space-y-1.5">
              <div className="text-xs font-bold text-cyan-300 truncate min-h-[1rem]">
                {simCurrentKey || (isSimulating ? 'Starting...' : 'Standby')}
              </div>
              <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-400 transition-all duration-200" style={{ width: `${simProgress}%` }} />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Preview only; nothing is sent to any device. Delays are capped at 1.5 s.</p>
          </div>

          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-bold uppercase tracking-wider text-slate-200">{selectedFormat === 'flipper' ? 'Flipper .txt' : selectedFormat === 'arduino' ? 'Arduino sketch' : 'CircuitPython'}</span>
              <button onClick={copyCode} className={btn} title="Copy to clipboard">
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <textarea
              readOnly
              rows={10}
              aria-label="Exported code"
              value={exported.code}
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-lg p-2 text-xs text-slate-300 font-mono focus:outline-none leading-relaxed resize-y"
            />
            {exported.skipped.length > 0 && (
              <p className="text-[10px] text-amber-300">
                {exported.skipped.length} line(s) have no equivalent in this export and were skipped: {exported.skipped.slice(0, 3).join(' | ')}{exported.skipped.length > 3 ? ' ...' : ''}
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 flex items-center gap-1"><Info className="w-3 h-3 shrink-0" />For devices you own or are authorised to test. The checker follows the public Hak5 and Flipper docs; always test on the real device.</p>
    </div>
  );
}
