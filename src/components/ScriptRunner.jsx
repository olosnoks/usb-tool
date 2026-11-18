import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Download,
  SkipForward,
  FileCode,
  ArrowUp,
  ArrowDown,
  Copy,
  Save,
  Upload
} from 'lucide-react';
import { alertSynth } from '../utils/audioAlert';
import { useSerial } from '../context/SerialContext';
import { createRxBuffer } from '../utils/serialExpect';
import { buildPySerialScript } from '../utils/scriptExport';
import {
  runScript, normalizeStep, buildJUnit, buildCsv, loadSuites, saveSuite, deleteSuite,
  exportSuiteJson, parseSuiteJson, moveStep, duplicateStep,
} from '../utils/scriptModel';

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

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-100 font-mono outline-none focus:border-cyan-500';
const selectCls = 'bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-slate-200 font-mono outline-none';

const download = (text, name, type) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const getStorage = () => { try { return window.localStorage; } catch { return null; } };

export default function ScriptRunner({
  isConnected,
  onSendString,
  latestRxText = '',
  onLogMessage
}) {
  const [suiteName, setSuiteName] = useState('Custom Test Suite');
  const [steps, setSteps] = useState(TEMPLATE_SUITES[0].steps.map(normalizeStep));
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  // { [stepId]: { status: 'running'|'pass'|'fail'|'aborted', timeMs, iterations, output, error } }
  const [results, setResults] = useState({});
  const [savedSuites, setSavedSuites] = useState(() => loadSuites(getStorage()));
  const [expandedId, setExpandedId] = useState(null);

  const isRunningRef = useRef(false);
  const rxBufferRef = useRef(null);
  if (!rxBufferRef.current) rxBufferRef.current = createRxBuffer();
  const importRef = useRef(null);
  const { subscribeRx, sendRawBytes, setSignals, reconfigureActivePort } = useSerial();

  // Accumulate every received chunk (unbatched) for assertions; the buffer is
  // cleared at the start of each step.
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const dec = new TextDecoder();
    return subscribeRx((bytes) => {
      rxBufferRef.current.append(dec.decode(bytes, { stream: true }));
    });
  }, [subscribeRx]);

  const runSuite = async (runSteps = steps) => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }
    if (runSteps.length === 0) return;

    setIsRunning(true);
    isRunningRef.current = true;
    setResults({});
    onLogMessage?.(`[TEST RUNNER] Starting test suite: "${suiteName}" (${runSteps.length} steps)...`, 'sys');

    const io = {
      // Exact bytes (escapes already resolved); fall back to the text path.
      send: async (bytes) => {
        if (sendRawBytes) await sendRawBytes(bytes);
        else await onSendString?.(new TextDecoder().decode(bytes), '');
      },
      setSignals: async (sig) => { await setSignals?.(sig); },
      setBaud: async (baud) => {
        if (!reconfigureActivePort) throw new Error('baud change not available');
        await reconfigureActivePort({ baudRate: baud });
      },
      buffer: rxBufferRef.current,
      isActive: () => isRunningRef.current,
      onUpdate: (id, r) => {
        setResults((prev) => ({ ...prev, [id]: r }));
        setCurrentStepIndex(steps.findIndex((s) => s.id === id));
        if (r.status === 'pass') onLogMessage?.(`[TEST PASS] Step ${steps.findIndex((s) => s.id === id) + 1} (+${r.timeMs}ms)`, 'sys');
        if (r.status === 'fail') onLogMessage?.(`[TEST FAIL] Step ${steps.findIndex((s) => s.id === id) + 1}: ${r.error || 'failed'}`, 'sys');
      },
    };

    let outcome;
    try {
      outcome = await runScript(runSteps, io);
    } finally {
      setIsRunning(false);
      isRunningRef.current = false;
      setCurrentStepIndex(-1);
    }

    if (outcome.aborted) {
      onLogMessage?.(`[TEST RUNNER] Test suite aborted.`, 'sys');
    } else if (outcome.passed) {
      alertSynth.playSuccessChime();
      onLogMessage?.(`[TEST RUNNER] SUITE PASSED! All ${runSteps.length} steps succeeded.`, 'sys');
    } else {
      alertSynth.playWarningChirp();
      onLogMessage?.(`[TEST RUNNER] SUITE COMPLETED WITH FAILURES.`, 'sys');
    }
  };

  const abortSuite = () => {
    // The engine sees isActive() flip and marks the in-flight step "aborted".
    isRunningRef.current = false;
    setIsRunning(false);
    setCurrentStepIndex(-1);
    onLogMessage?.(`[TEST RUNNER] Test suite aborted by user.`, 'sys');
  };

  const addStep = () => {
    const newId = String(Date.now());
    setSteps(prev => [...prev, normalizeStep({ id: newId, send: 'AT\\r\\n', expect: 'OK', timeoutMs: 1000 })]);
  };

  const removeStep = (id) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  const updateStep = (id, field, value) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const loadTemplate = (tmpl) => {
    setSuiteName(tmpl.name);
    setSteps(tmpl.steps.map(normalizeStep));
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
    download(JSON.stringify(report, null, 2), `test_report_${Date.now()}.json`, 'application/json');
  };

  const exportJUnit = () => download(buildJUnit(suiteName, steps, results), `test_report_${Date.now()}.xml`, 'application/xml');
  const exportPy = () => download(buildPySerialScript(suiteName, steps), `${suiteName.replace(/[^\w.-]+/g, '_') || 'suite'}.py`, 'text/x-python');
  const exportCsv = () => download(buildCsv(steps, results), `test_report_${Date.now()}.csv`, 'text/csv');

  const handleSaveSuite = () => setSavedSuites(saveSuite(getStorage(), suiteName, steps));
  const handleLoadSaved = (name) => {
    if (!name || !savedSuites[name]) return;
    setSuiteName(name);
    setSteps(savedSuites[name].map(normalizeStep));
    setResults({});
  };
  const handleDeleteSaved = (name) => { if (name) setSavedSuites(deleteSuite(getStorage(), name)); };
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseSuiteJson(await file.text());
      setSuiteName(parsed.name);
      setSteps(parsed.steps);
      setResults({});
    } catch (err) {
      alert(`Could not import suite: ${err.message}`);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const statusBadge = (res) => {
    if (!res) return null;
    if (res.status === 'running') return <span className="text-[10px] text-cyber-cyan animate-pulse font-bold">EXECUTING...</span>;
    if (res.status === 'pass') return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/40">
        <CheckCircle2 className="w-3 h-3" />
        <span>PASSED ({res.timeMs}ms{res.iterations?.length > 1 ? `, x${res.iterations.length}` : ''})</span>
      </span>
    );
    if (res.status === 'fail') return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-500/40">
        <XCircle className="w-3 h-3" />
        <span>FAILED ({res.timeMs}ms)</span>
      </span>
    );
    if (res.status === 'skipped') return <span className="text-[10px] text-slate-500">SKIPPED</span>;
    if (res.status === 'aborted') return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/40">
        <span>ABORTED</span>
      </span>
    );
    return null;
  };

  const btn = 'flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] disabled:opacity-40';
  const safeName = suiteName.replace(/[^\w.-]+/g, '_') || 'suite';
  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#030712] border border-slate-800 rounded-lg p-2">
        <button
          onClick={isRunning ? abortSuite : () => runSuite()}
          disabled={!isConnected && !isRunning}
          className={`flex items-center gap-1.5 px-3 py-1 rounded font-bold text-xs transition-all ${
            isRunning
              ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
              : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 hover:brightness-110'
          } disabled:opacity-40`}
        >
          {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isRunning ? 'ABORT SUITE' : 'RUN TEST SUITE'}</span>
        </button>
        <button onClick={addStep} disabled={isRunning} className={`${btn} text-cyber-cyan`} title="Add a step">
          <Plus className="w-3.5 h-3.5" /><span>Add Step</span>
        </button>
        <span className="text-[10px] text-slate-500 uppercase font-bold ml-1">Presets</span>
        {TEMPLATE_SUITES.map((t, idx) => (
          <button key={idx} onClick={() => loadTemplate(t)} disabled={isRunning} title={t.name} className={btn}>
            {t.name.split(' ')[0]}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={exportReport} className={btn} title="Download results as JSON"><Download className="w-3.5 h-3.5" /><span>JSON</span></button>
        <button onClick={exportJUnit} className={btn} title="Download results as JUnit XML">JUnit XML</button>
        <button onClick={exportCsv} className={btn} title="Download results as CSV">CSV</button>
        <button onClick={exportPy} className={btn} title="Export the suite as a pySerial script to run outside the browser (goto is not translated)">
          <FileCode className="w-3.5 h-3.5" /><span>.py</span>
        </button>
      </div>

      {/* Suite name + saved suites */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <input aria-label="Suite name" type="text" value={suiteName} onChange={(e) => setSuiteName(e.target.value)} disabled={isRunning} className={`${inputCls} w-40`} />
        <button onClick={handleSaveSuite} disabled={isRunning || !suiteName.trim()} className={btn} title="Save in this browser">
          <Save className="w-3 h-3" /><span>Save</span>
        </button>
        <select aria-label="Saved suites" value="" onChange={(e) => handleLoadSaved(e.target.value)} className={selectCls}>
          <option value="">Load saved...</option>
          {Object.keys(savedSuites).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={() => handleDeleteSaved(suiteName)} disabled={isRunning || !savedSuites[suiteName]} className={btn}>
          Delete saved
        </button>
        <button onClick={() => download(exportSuiteJson(suiteName, steps), `${safeName}.json`, 'application/json')} className={btn}>
          Export suite
        </button>
        <button onClick={() => importRef.current?.click()} disabled={isRunning} className={btn}>
          <Upload className="w-3 h-3" /><span>Import</span>
        </button>
        <input ref={importRef} type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
      </div>
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-300">Syntax help</summary>
        <p className="mt-1">
          Send (text) accepts <code>\r \n \t \0 \e \xNN \\</code> and <code>${'{var}'}</code>; Send (hex) takes bytes like <code>AA 55 0x10</code>. Regex Expect stores capture groups as <code>${'{1}'}</code>, <code>${'{2}'}</code>...; "any of" separates patterns with <code>||</code>.
        </p>
      </details>

      {/* Step Sequence Table */}
      <div className="flex flex-col gap-1.5">
        {steps.map((step, idx) => {
          const res = results[step.id];
          const isCurrent = currentStepIndex === idx;
          const type = step.type || 'send';

          return (
            <div
              key={step.id}
              className={`flex flex-col gap-1 p-2 rounded-lg border transition-all ${
                step.disabled ? 'opacity-50 ' : ''}${
                isCurrent
                  ? 'bg-cyan-950/30 border-cyan-500 shadow-cyan-glow'
                  : res?.status === 'pass'
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                  : res?.status === 'fail'
                  ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-slate-500 w-6">#{idx + 1}</span>
                  <input type="checkbox" checked={!step.disabled} onChange={(e) => updateStep(step.id, 'disabled', !e.target.checked)} disabled={isRunning} aria-label="Step enabled" title="Enabled (uncheck to skip this step)" />

                  <select value={type} onChange={(e) => updateStep(step.id, 'type', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Step type">
                    <option value="send">send/expect</option>
                    <option value="delay">delay</option>
                    <option value="dtr">set DTR</option>
                    <option value="rts">set RTS</option>
                    <option value="baud">set baud</option>
                  </select>

                  {type === 'send' && (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">Send:</span>
                        <input
                          type="text"
                          value={step.send}
                          onChange={(e) => updateStep(step.id, 'send', e.target.value)}
                          disabled={isRunning}
                          className={`${inputCls} w-32`}
                        />
                        <select value={step.sendFormat || 'text'} onChange={(e) => updateStep(step.id, 'sendFormat', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Send format">
                          <option value="text">text</option>
                          <option value="hex">hex</option>
                        </select>
                        <select value={step.lineEnding || 'none'} onChange={(e) => updateStep(step.id, 'lineEnding', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Line ending">
                          <option value="none">no EOL</option>
                          <option value="cr">CR</option>
                          <option value="lf">LF</option>
                          <option value="crlf">CRLF</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">Expect:</span>
                        <input
                          type="text"
                          value={step.expect}
                          onChange={(e) => updateStep(step.id, 'expect', e.target.value)}
                          disabled={isRunning}
                          className={`${inputCls} text-cyber-amber w-32 focus:border-amber-500`}
                        />
                        <select value={step.expectMode || 'plain'} onChange={(e) => updateStep(step.id, 'expectMode', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Expect mode">
                          <option value="plain">text</option>
                          <option value="regex">regex</option>
                          <option value="any">any of (||)</option>
                          <option value="not">must NOT appear</option>
                        </select>
                        <label className="flex items-center gap-1 text-[10px] text-slate-500">
                          <input type="checkbox" checked={step.caseSensitive !== false} onChange={(e) => updateStep(step.id, 'caseSensitive', e.target.checked)} disabled={isRunning} />
                          case
                        </label>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">Timeout:</span>
                        <input
                          type="number"
                          value={step.timeoutMs}
                          onChange={(e) => updateStep(step.id, 'timeoutMs', Number(e.target.value))}
                          disabled={isRunning}
                          className={`${inputCls} w-16 text-center`}
                        />
                        <span className="text-[10px] text-slate-500">ms</span>
                      </div>
                    </>
                  )}

                  {type !== 'send' && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 uppercase">
                        {type === 'delay' ? 'Delay (ms):' : type === 'baud' ? 'Baud:' : '1 = high, 0 = low:'}
                      </span>
                      <input
                        type="text"
                        value={step.value ?? ''}
                        onChange={(e) => updateStep(step.id, 'value', e.target.value)}
                        disabled={isRunning}
                        className={`${inputCls} w-24`}
                      />
                    </div>
                  )}
                </div>

                {/* Status Indicator + row actions */}
                <div className="flex items-center gap-1.5">
                  {statusBadge(res)}
                  <button onClick={() => runSuite([steps[idx]])} disabled={isRunning || !isConnected} aria-label="Run this step only" title="Run this step only" className="text-slate-500 hover:text-emerald-400 p-1 disabled:opacity-30"><SkipForward className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setSteps((p) => moveStep(p, idx, -1))} disabled={isRunning || idx === 0} aria-label="Move up" className="text-slate-500 hover:text-slate-200 p-1 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setSteps((p) => moveStep(p, idx, 1))} disabled={isRunning || idx === steps.length - 1} aria-label="Move down" className="text-slate-500 hover:text-slate-200 p-1 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setSteps((p) => duplicateStep(p, idx))} disabled={isRunning} aria-label="Duplicate step" className="text-slate-500 hover:text-slate-200 p-1"><Copy className="w-3.5 h-3.5" /></button>
                  {steps.length > 1 && (
                    <button
                      onClick={() => removeStep(step.id)}
                      disabled={isRunning}
                      aria-label="Remove step"
                      className="text-slate-600 hover:text-rose-400 p-1 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Flow control */}
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 pl-8">
                <label className="flex items-center gap-1">
                  repeat
                  <select value={step.loopMode || 'count'} onChange={(e) => updateStep(step.id, 'loopMode', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Loop mode">
                    <option value="count">N times</option>
                    <option value="until">until matched (max)</option>
                  </select>
                  <input type="number" min="1" value={step.loopCount ?? 1} onChange={(e) => updateStep(step.id, 'loopCount', Number(e.target.value))} disabled={isRunning} className={`${inputCls} w-12 text-center`} aria-label="Loop count" />
                </label>
                <label className="flex items-center gap-1">
                  retries
                  <input type="number" min="0" value={step.retries ?? 0} onChange={(e) => updateStep(step.id, 'retries', Number(e.target.value))} disabled={isRunning} className={`${inputCls} w-12 text-center`} aria-label="Retries" />
                </label>
                <label className="flex items-center gap-1">
                  on fail
                  <select value={step.onFail || 'stop'} onChange={(e) => updateStep(step.id, 'onFail', e.target.value)} disabled={isRunning} className={selectCls} aria-label="On fail">
                    <option value="stop">stop</option>
                    <option value="continue">continue</option>
                    <option value="goto">goto step</option>
                  </select>
                </label>
                {step.onFail === 'goto' && (
                  <select value={step.gotoId || ''} onChange={(e) => updateStep(step.id, 'gotoId', e.target.value)} disabled={isRunning} className={selectCls} aria-label="Goto target">
                    <option value="">(choose)</option>
                    {steps.map((s, j) => <option key={s.id} value={s.id}>#{j + 1}</option>)}
                  </select>
                )}
                {res && res.status !== 'running' && (res.output || res.error) && (
                  <button onClick={() => setExpandedId(expandedId === step.id ? null : step.id)} className="text-cyan-400 hover:text-cyan-300 underline">
                    {expandedId === step.id ? 'hide output' : 'show output'}
                  </button>
                )}
              </div>
              {expandedId === step.id && res && (
                <pre className="ml-8 p-2 bg-black/40 border border-slate-800 rounded text-[10px] text-slate-300 whitespace-pre-wrap max-h-32 overflow-auto">
                  {res.error ? `${res.error}\n` : ''}{res.output || '(no output captured)'}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
