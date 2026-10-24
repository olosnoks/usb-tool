import React, { useState, useEffect } from 'react';
import {
  COMMAND_TREE,
  validateActionParameters,
  validateHexBytes
} from './commandSchema';
import { Play, ShieldAlert, AlertTriangle, CheckCircle, Info, Lock } from 'lucide-react';

export default function CommandTreeForm({
  device,
  onExecute,
  isExecuting = false
}) {
  const [selectedDomainId, setSelectedDomainId] = useState('hf');
  const [selectedSubsystemId, setSelectedSubsystemId] = useState('14a');
  const [selectedActionId, setSelectedActionId] = useState('reader');
  const [parameterValues, setParameterValues] = useState({});
  const [validationErrors, setValidationErrors] = useState({});

  // Resolve current active nodes
  const currentDomain = COMMAND_TREE.find((d) => d.id === selectedDomainId) || COMMAND_TREE[0];
  const currentSubsystem =
    currentDomain.subsystems.find((s) => s.id === selectedSubsystemId) ||
    currentDomain.subsystems[0];
  const currentAction =
    currentSubsystem.actions.find((a) => a.id === selectedActionId) ||
    currentSubsystem.actions[0];

  // Initialize default parameter values when action changes
  useEffect(() => {
    if (currentAction && currentAction.parameters) {
      const defaults = {};
      currentAction.parameters.forEach((param) => {
        defaults[param.id] = param.defaultValue !== undefined ? param.defaultValue : '';
      });
      setParameterValues(defaults);
      setValidationErrors({});
    } else {
      setParameterValues({});
      setValidationErrors({});
    }
  }, [selectedActionId, selectedSubsystemId, selectedDomainId]);

  const handleDomainChange = (e) => {
    const domainId = e.target.value;
    setSelectedDomainId(domainId);
    const domain = COMMAND_TREE.find((d) => d.id === domainId);
    if (domain && domain.subsystems.length > 0) {
      setSelectedSubsystemId(domain.subsystems[0].id);
      if (domain.subsystems[0].actions.length > 0) {
        setSelectedActionId(domain.subsystems[0].actions[0].id);
      }
    }
  };

  const handleSubsystemChange = (e) => {
    const subId = e.target.value;
    setSelectedSubsystemId(subId);
    const sub = currentDomain.subsystems.find((s) => s.id === subId);
    if (sub && sub.actions.length > 0) {
      setSelectedActionId(sub.actions[0].id);
    }
  };

  const handleActionChange = (e) => {
    setSelectedActionId(e.target.value);
  };

  const handleParamChange = (paramId, value) => {
    const updated = { ...parameterValues, [paramId]: value };
    setParameterValues(updated);

    // Validate on change
    if (currentAction) {
      const { errors } = validateActionParameters(currentAction, updated);
      setValidationErrors(errors);
    }
  };

  // Determine if device can execute the current action
  const canRun = (device && currentAction) ? device.canExecute(currentAction.risk) : false;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!currentAction) return;

    const { valid, errors } = validateActionParameters(currentAction, parameterValues);
    setValidationErrors(errors);

    if (!valid) return;

    const payloadOptions = currentAction.formatPayload
      ? currentAction.formatPayload(parameterValues)
      : {};

    onExecute({
      cmd: currentAction.cmd,
      ...payloadOptions,
      actionId: currentAction.id,
      actionName: currentAction.name,
      risk: currentAction.risk
    });
  };

  const getRiskBadgeColor = (risk) => {
    switch (risk) {
      case 'diagnostic':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'read':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'write':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'magic':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'raw':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-700/50 text-slate-300 border-slate-600';
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <span>Cascading Command Engine</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-800/40">
              NG Protocol
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict Little-Endian binary dispatch with tri-state execution lockouts
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Cascading Selectors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Level 1: Domain */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              1. Domain
            </label>
            <select
              value={selectedDomainId}
              onChange={handleDomainChange}
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition"
            >
              {COMMAND_TREE.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Level 2: Subsystem */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              2. Subsystem
            </label>
            <select
              value={selectedSubsystemId}
              onChange={handleSubsystemChange}
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition"
            >
              {currentDomain.subsystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Level 3: Action */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              3. Action & Risk
            </label>
            <select
              value={selectedActionId}
              onChange={handleActionChange}
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition"
            >
              {currentSubsystem.actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} [{a.risk.toUpperCase()}]
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Details & Risk Indicator */}
        {currentAction && (
          <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">{currentAction.name}</span>
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full border uppercase ${getRiskBadgeColor(
                    currentAction.risk
                  )}`}
                >
                  Risk: {currentAction.risk}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Opcode: 0x{(currentAction.cmd != null ? currentAction.cmd.toString(16) : '0000').padStart(4, '0')}
                </span>
              </div>
              <p className="text-xs text-slate-400">{currentAction.description}</p>
            </div>

            {!canRun && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/40 px-2.5 py-1 rounded">
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Execution Locked</span>
              </div>
            )}
          </div>
        )}

        {/* Level 4: Dependent Parameters */}
        {currentAction.parameters && currentAction.parameters.length > 0 && (
          <div className="p-4 bg-slate-950/50 border border-slate-800/60 rounded-lg space-y-3">
            <h4 className="text-xs font-medium text-slate-300 uppercase tracking-wider mb-2">
              Command Parameters
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentAction.parameters.map((param) => (
                <div key={param.id}>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {param.name} {param.required && <span className="text-rose-400">*</span>}
                  </label>

                  {param.type === 'hex_bytes' && (
                    <div>
                      <input
                        type="text"
                        value={parameterValues[param.id] ?? ''}
                        onChange={(e) => handleParamChange(param.id, e.target.value)}
                        placeholder="e.g. 52 or 9320"
                        className="w-full font-mono text-sm bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded px-3 py-1.5 text-slate-100 outline-none"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">{param.description}</p>
                    </div>
                  )}

                  {param.type === 'number' && (
                    <div>
                      <input
                        type="number"
                        min={param.min}
                        max={param.max}
                        value={parameterValues[param.id] ?? ''}
                        onChange={(e) => handleParamChange(param.id, e.target.value)}
                        className="w-full font-mono text-sm bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded px-3 py-1.5 text-slate-100 outline-none"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">
                        Min: {param.min ?? 'any'}, Max: {param.max ?? 'any'}
                      </p>
                    </div>
                  )}

                  {param.type === 'boolean' && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`param-${param.id}`}
                        checked={!!parameterValues[param.id]}
                        onChange={(e) => handleParamChange(param.id, e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 w-4 h-4"
                      />
                      <label htmlFor={`param-${param.id}`} className="text-xs text-slate-300">
                        {param.description || 'Enable option'}
                      </label>
                    </div>
                  )}

                  {validationErrors[param.id] && (
                    <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      <span>{validationErrors[param.id]}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Execution Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={!canRun || isExecuting}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-lg ${
              !canRun
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                : isExecuting
                ? 'bg-cyan-600/50 text-cyan-200 cursor-wait'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
            }`}
          >
            {canRun ? <Play className="w-4 h-4 fill-current" /> : <Lock className="w-4 h-4" />}
            <span>{isExecuting ? 'Transmitting...' : `Execute ${currentAction.name}`}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
