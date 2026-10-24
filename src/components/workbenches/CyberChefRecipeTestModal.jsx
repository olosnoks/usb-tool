/**
 * CyberChefRecipeTestModal.jsx
 * Recipe Test Suites & Regression Validation Modal.
 * Define test inputs and expected outputs, execute Chef recipes, and inspect diff views.
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Play, Plus, Trash2, X, AlertCircle } from 'lucide-react';
import { Chef } from '../../utils/cyberchef/index.js';

export default function CyberChefRecipeTestModal({
  isOpen,
  onClose,
  recipe = []
}) {
  const [testCases, setTestCases] = useState([
    {
      id: 'tc-1',
      name: 'Default Test Case',
      input: 'CyberChef Input',
      expected: '',
      matchType: 'exact', // 'exact' | 'contains'
      status: 'idle', // 'idle' | 'running' | 'pass' | 'fail'
      actual: '',
      durationMs: null
    }
  ]);
  const [isRunningAll, setIsRunningAll] = useState(false);

  // Load saved tests from localStorage if available
  useEffect(() => {
    if (isOpen && recipe.length > 0) {
      try {
        const recipeSig = recipe.map(r => r.op).join('|');
        const saved = localStorage.getItem(`cc_test_suite_${recipeSig}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTestCases(parsed.map(tc => ({ ...tc, status: 'idle', actual: '', durationMs: null })));
          }
        }
      } catch {}
    }
  }, [isOpen, recipe]);

  const saveTests = (tests) => {
    try {
      const recipeSig = recipe.map(r => r.op).join('|');
      localStorage.setItem(`cc_test_suite_${recipeSig}`, JSON.stringify(tests));
    } catch {}
  };

  const addTestCase = () => {
    const newCase = {
      id: `tc-${Date.now()}`,
      name: `Test Case #${testCases.length + 1}`,
      input: '',
      expected: '',
      matchType: 'exact',
      status: 'idle',
      actual: '',
      durationMs: null
    };
    const updated = [...testCases, newCase];
    setTestCases(updated);
    saveTests(updated);
  };

  const removeTestCase = (id) => {
    if (testCases.length === 1) return;
    const updated = testCases.filter(t => t.id !== id);
    setTestCases(updated);
    saveTests(updated);
  };

  const updateTestCase = (id, field, value) => {
    const updated = testCases.map(tc => {
      if (tc.id !== id) return tc;
      return { ...tc, [field]: value, status: 'idle', actual: '' };
    });
    setTestCases(updated);
    saveTests(updated);
  };

  const runAllTests = async () => {
    setIsRunningAll(true);
    const chef = new Chef();
    const recipeConfig = recipe.map(r => ({ op: r.op, args: r.args || {} }));

    const updated = [...testCases];

    for (let i = 0; i < updated.length; i++) {
      const tc = updated[i];
      tc.status = 'running';
      setTestCases([...updated]);

      const start = performance.now();
      try {
        const dish = await chef.bake(tc.input, recipeConfig);
        const actualStr = dish.toString();
        const duration = Math.round((performance.now() - start) * 10) / 10;

        let passed = false;
        if (tc.matchType === 'contains') {
          passed = actualStr.includes(tc.expected);
        } else {
          passed = actualStr.trim() === tc.expected.trim();
        }

        tc.status = passed ? 'pass' : 'fail';
        tc.actual = actualStr;
        tc.durationMs = duration;
      } catch (err) {
        tc.status = 'fail';
        tc.actual = `Execution Error: ${err.message}`;
        tc.durationMs = Math.round((performance.now() - start) * 10) / 10;
      }
    }

    setTestCases([...updated]);
    setIsRunningAll(false);
  };

  if (!isOpen) return null;

  const passedCount = testCases.filter(t => t.status === 'pass').length;
  const failedCount = testCases.filter(t => t.status === 'fail').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#14161f] border border-[#2b303c] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#232733] bg-[#11131a]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Recipe Test Suite & Regression Runner</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                  {recipe.length} Operations
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Validate input transformations against assertions to ensure safe refactoring.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-[#171922] border-b border-[#232733] text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={runAllTests}
              disabled={isRunningAll}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold rounded-xl transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isRunningAll ? 'animate-spin' : ''}`} />
              <span>{isRunningAll ? 'Running...' : 'Run All Tests'}</span>
            </button>
            <button
              onClick={addTestCase}
              className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl transition flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Add Test Case</span>
            </button>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            {passedCount > 0 && (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {passedCount} Passed
              </span>
            )}
            {failedCount > 0 && (
              <span className="text-rose-400 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                {failedCount} Failed
              </span>
            )}
            <span className="text-slate-500">{testCases.length} Total</span>
          </div>
        </div>

        {/* Test Cases List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {testCases.map((tc, idx) => (
            <div
              key={tc.id}
              className={`p-4 rounded-xl border transition flex flex-col gap-3 ${
                tc.status === 'pass'
                  ? 'bg-emerald-950/15 border-emerald-500/40'
                  : tc.status === 'fail'
                  ? 'bg-rose-950/15 border-rose-500/40'
                  : 'bg-[#181a24] border-[#2b303c]'
              }`}
            >
              {/* Test Case Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tc.name}
                    onChange={e => updateTestCase(tc.id, 'name', e.target.value)}
                    className="bg-transparent font-bold text-xs text-slate-200 border-b border-transparent hover:border-slate-600 focus:border-cyan-400 focus:outline-none px-1"
                  />
                  {tc.status === 'pass' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> PASSED {tc.durationMs ? `(${tc.durationMs}ms)` : ''}
                    </span>
                  )}
                  {tc.status === 'fail' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                      <XCircle className="w-2.5 h-2.5" /> FAILED {tc.durationMs ? `(${tc.durationMs}ms)` : ''}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={tc.matchType}
                    onChange={e => updateTestCase(tc.id, 'matchType', e.target.value)}
                    className="bg-[#11131a] text-slate-400 border border-[#2b303c] rounded px-2 py-0.5 text-[11px] focus:outline-none"
                  >
                    <option value="exact">Strict Equal</option>
                    <option value="contains">Contains Substring</option>
                  </select>

                  {testCases.length > 1 && (
                    <button
                      onClick={() => removeTestCase(tc.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded transition"
                      title="Remove test case"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Input and Expected Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase text-slate-400">Input Payload</label>
                  <textarea
                    rows={2}
                    value={tc.input}
                    onChange={e => updateTestCase(tc.id, 'input', e.target.value)}
                    placeholder="Enter input string..."
                    className="w-full bg-[#11131a] border border-[#2b303c] rounded-lg p-2 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 resize-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase text-slate-400">Expected Output</label>
                  <textarea
                    rows={2}
                    value={tc.expected}
                    onChange={e => updateTestCase(tc.id, 'expected', e.target.value)}
                    placeholder="Enter expected result string..."
                    className="w-full bg-[#11131a] border border-[#2b303c] rounded-lg p-2 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 resize-none"
                  />
                </div>
              </div>

              {/* Failure Diff View */}
              {tc.status === 'fail' && (
                <div className="mt-1 p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/40 text-xs font-mono space-y-1">
                  <div className="flex items-center gap-1.5 text-rose-400 text-[11px] font-bold">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Assertion Mismatch</span>
                  </div>
                  <div className="text-[11px] text-emerald-400 bg-emerald-950/30 p-1.5 rounded border border-emerald-800/30 overflow-x-auto">
                    + Expected: {tc.expected}
                  </div>
                  <div className="text-[11px] text-rose-400 bg-rose-950/40 p-1.5 rounded border border-rose-800/40 overflow-x-auto">
                    - Received: {tc.actual}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#232733] bg-[#11131a] flex items-center justify-between text-xs">
          <span className="text-slate-500 text-[11px]">
            Tests automatically persist to localStorage per recipe signature.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
