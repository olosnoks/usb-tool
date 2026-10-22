import React, { useState, useRef } from 'react';
import { 
  Play, 
  Square, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus, 
  Trash2, 
  Download, 
  Sparkles,
  Bot
} from 'lucide-react';
import { alertSynth } from '../utils/audioAlert';

const TEMPLATE_SUITES = [
  {
    name: 'AT Command Modem Test',
    steps: [
      { id: '1', send: 'AT\r\n', expect: 'OK', timeoutMs: 1000 },
      { id: '2', send: 'ATE0\r\n', expect: 'OK', timeoutMs: 1000 },
      { id: '3', send: 'AT+CSQ\r\n', expect: '+CSQ:', timeoutMs: 2000 }
    ]
  },
  {
    name: 'MicroPython REPL Handshake',
    steps: [
      { id: '1', send: '\x03\x03', expect: '>>>', timeoutMs: 1500 },
      { id: '2', send: 'import sys; print(sys.platform)\r\n', expect: 'esp', timeoutMs: 1500 }
    ]
  },
  {
    name: 'U-Boot Bootloader Interrupt',
    steps: [
      { id: '1', send: '\x20\x20\x20', expect: '=>', timeoutMs: 2000 },
      { id: '2', send: 'version\r\n', expect: 'U-Boot', timeoutMs: 1500 }
    ]
  }
];

export default function ScriptRunner({
  isConnected,
  onSendString,
  latestRxText = '',
  onLogMessage
}) {
  const [suiteName, setSuiteName] = useState('Custom Test Suite');
  const [steps, setSteps] = useState(TEMPLATE_SUITES[0].steps);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [results, setResults] = useState({}); // { [stepId]: { status: 'pass'|'fail'|'timeout', timeMs } }

  const isRunningRef = useRef(false);
  const rxBufferRef = useRef('');

  // Accumulate RX text for assertions
  const handleRxAccumulator = (newText) => {
    rxBufferRef.current += newText;
  };

  const runSuite = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }
    if (steps.length === 0) return;

    setIsRunning(true);
    isRunningRef.current = true;
    setResults({});
    onLogMessage?.(`[TEST RUNNER] Starting test suite: "${suiteName}" (${steps.length} steps)...`, 'sys');

    let allPassed = true;

    for (let i = 0; i < steps.length; i++) {
      if (!isRunningRef.current) break;

      const step = steps[i];
      setCurrentStepIndex(i);
      setResults(prev => ({ ...prev, [step.id]: { status: 'running', timeMs: 0 } }));

      rxBufferRef.current = '';
      const startTime = Date.now();

      // Transmit test step command
      await onSendString(step.send, '');

      // Wait for expected response with timeout
      let passed = false;
      const deadline = Date.now() + step.timeoutMs;

      while (Date.now() < deadline && isRunningRef.current) {
        // Check if latest received text matches
        if (latestRxText.includes(step.expect) || rxBufferRef.current.includes(step.expect)) {
          passed = true;
          break;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      const elapsed = Date.now() - startTime;
      if (passed) {
        setResults(prev => ({ ...prev, [step.id]: { status: 'pass', timeMs: elapsed } }));
        onLogMessage?.(`[TEST PASS] Step ${i + 1}: Found "${step.expect}" (+${elapsed}ms)`, 'sys');
      } else {
        allPassed = false;
        setResults(prev => ({ ...prev, [step.id]: { status: 'fail', timeMs: elapsed } }));
        onLogMessage?.(`[TEST FAIL] Step ${i + 1}: Expected "${step.expect}" timed out (${step.timeoutMs}ms)`, 'sys');
      }

      // Small delay between steps
      await new Promise(r => setTimeout(r, 200));
    }

    setIsRunning(false);
    isRunningRef.current = false;
    setCurrentStepIndex(-1);

    if (allPassed) {
      alertSynth.playSuccessChime();
      onLogMessage?.(`[TEST RUNNER] SUITE PASSED! All ${steps.length} assertions succeeded.`, 'sys');
    } else {
      alertSynth.playWarningChirp();
      onLogMessage?.(`[TEST RUNNER] SUITE COMPLETED WITH FAILURES.`, 'sys');
    }
  };

  const abortSuite = () => {
    isRunningRef.current = false;
    setIsRunning(false);
    setCurrentStepIndex(-1);
    onLogMessage?.(`[TEST RUNNER] Test suite aborted by user.`, 'sys');
  };

  const addStep = () => {
    const newId = String(Date.now());
    setSteps(prev => [...prev, { id: newId, send: 'AT\r\n', expect: 'OK', timeoutMs: 1000 }]);
  };

  const removeStep = (id) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  const updateStep = (id, field, value) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const loadTemplate = (tmpl) => {
    setSuiteName(tmpl.name);
    setSteps(tmpl.steps);
    setResults({});
  };

  const exportReport = () => {
    const report = {
      suite: suiteName,
      timestamp: new Date().toISOString(),
      steps: steps.map(s => ({
        ...s,
        result: results[s.id] || { status: 'untested' }
      }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test_report_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">AUTOMATED SERIAL TEST RUNNER & SCRIPTING</h2>
        </div>

        {/* Templates */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[10px] text-slate-500 uppercase font-bold">Presets:</span>
          {TEMPLATE_SUITES.map((t, idx) => (
            <button
              key={idx}
              onClick={() => loadTemplate(t)}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] border border-slate-800"
            >
              {t.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#030712] border border-slate-800 rounded-lg p-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={isRunning ? abortSuite : runSuite}
            disabled={!isConnected && !isRunning}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs transition-all shadow-md ${
              isRunning 
                ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse' 
                : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 hover:brightness-110 shadow-emerald-glow'
            } disabled:opacity-40`}
          >
            {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isRunning ? 'ABORT SUITE' : 'RUN TEST SUITE'}</span>
          </button>

          <button
            onClick={addStep}
            disabled={isRunning}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-cyan border border-slate-800 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Step</span>
          </button>
        </div>

        <button
          onClick={exportReport}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Audit Report</span>
        </button>
      </div>

      {/* Step Sequence Table */}
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        {steps.map((step, idx) => {
          const res = results[step.id];
          const isCurrent = currentStepIndex === idx;

          return (
            <div
              key={step.id}
              className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border transition-all ${
                isCurrent
                  ? 'bg-cyan-950/30 border-cyan-500 shadow-cyan-glow'
                  : res?.status === 'pass'
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                  : res?.status === 'fail'
                  ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-500 w-6">#{idx + 1}</span>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Send:</span>
                  <input
                    type="text"
                    value={step.send}
                    onChange={(e) => updateStep(step.id, 'send', e.target.value)}
                    disabled={isRunning}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-100 font-mono w-36 outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Expect:</span>
                  <input
                    type="text"
                    value={step.expect}
                    onChange={(e) => updateStep(step.id, 'expect', e.target.value)}
                    disabled={isRunning}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-cyber-amber font-mono w-32 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 uppercase">Timeout:</span>
                  <input
                    type="number"
                    value={step.timeoutMs}
                    onChange={(e) => updateStep(step.id, 'timeoutMs', Number(e.target.value))}
                    disabled={isRunning}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-100 font-mono w-16 outline-none text-center"
                  />
                  <span className="text-[10px] text-slate-500">ms</span>
                </div>
              </div>

              {/* Status Indicator */}
              <div className="flex items-center gap-2">
                {res?.status === 'running' && (
                  <span className="text-[10px] text-cyber-cyan animate-pulse font-bold">
                    EXECUTING...
                  </span>
                )}
                {res?.status === 'pass' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/40">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>PASSED ({res.timeMs}ms)</span>
                  </span>
                )}
                {res?.status === 'fail' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/40">
                    <XCircle className="w-3 h-3" />
                    <span>FAILED ({res.timeMs}ms)</span>
                  </span>
                )}

                {steps.length > 1 && (
                  <button
                    onClick={() => removeStep(step.id)}
                    disabled={isRunning}
                    className="text-slate-600 hover:text-rose-400 p-1 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
