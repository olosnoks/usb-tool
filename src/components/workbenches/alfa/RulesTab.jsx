// "rules" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { RULE_ACTION_TYPES, RULE_EVENT_TYPES, createRule, executeRuleAction } from '../../../utils/ruleEngine';
import { Bell, Sliders, Trash2 } from 'lucide-react';

export default function RulesTab({
  newRuleActionPayload,
  newRuleActionType,
  newRuleEventType,
  newRuleName,
  newRuleTargetMac,
  rules,
  setNewRuleActionPayload,
  setNewRuleActionType,
  setNewRuleEventType,
  setNewRuleName,
  setNewRuleTargetMac,
  setRules,
  setStatusLevel,
  setStatusMessage
}) {
  return (
    <div className="p-4 space-y-5">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
          <div className="text-[11px] text-amber-300 uppercase font-semibold">Total Rules</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{rules.length}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Persisted in local storage</div>
        </div>

        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-3">
          <div className="text-[11px] text-emerald-300 uppercase font-semibold">Active Rules</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {rules.filter(r => r.enabled !== false).length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Actively evaluating events</div>
        </div>

        <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl p-3">
          <div className="text-[11px] text-purple-300 uppercase font-semibold">Webhooks Configured</div>
          <div className="text-2xl font-bold text-purple-400 mt-1">
            {rules.filter(r => r.actionType === RULE_ACTION_TYPES.WEBHOOK).length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">HTTP POST integrations</div>
        </div>

        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3">
          <div className="text-[11px] text-cyan-300 uppercase font-semibold">Notifications & Audio</div>
          <div className="text-2xl font-bold text-cyan-400 mt-1">
            {rules.filter(r => r.actionType === RULE_ACTION_TYPES.NATIVE_NOTIFICATION || r.actionType === RULE_ACTION_TYPES.AUDIO_BEEP).length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Real-time alert actions</div>
        </div>
      </div>

      {/* Rule Creation Form Card */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <span className="font-bold text-xs uppercase text-slate-200">Create Automation Rule</span>
          </div>
          <span className="text-[11px] text-slate-500">Configure triggers, targets, and reactive actions</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Rule Name */}
          <div>
            <label className="text-[10px] text-slate-400 font-semibold block mb-1">
              Rule Name:
            </label>
            <input
              type="text"
              placeholder="e.g. Alert on VIP Laptop or Rogue AP"
              value={newRuleName}
              onChange={(e) => setNewRuleName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-medium"
            />
          </div>

          {/* Trigger Event Type */}
          <div>
            <label className="text-[10px] text-slate-400 font-semibold block mb-1">
              Trigger Event Type:
            </label>
            <select
              value={newRuleEventType}
              onChange={(e) => setNewRuleEventType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400 font-medium"
            >
              <option value={RULE_EVENT_TYPES.DEVICE_CONNECTED}>DEVICE_CONNECTED (Discovered / Associated)</option>
              <option value={RULE_EVENT_TYPES.DEVICE_DISCONNECTED}>DEVICE_DISCONNECTED (Inactive / Missing &gt;60s)</option>
              <option value={RULE_EVENT_TYPES.ANOMALY_DETECTED}>ANOMALY_DETECTED (Deauth Flood / Rogue AP)</option>
            </select>
          </div>

          {/* Target MAC */}
          <div>
            <label className="text-[10px] text-slate-400 font-semibold block mb-1">
              Target MAC Address (* for Any):
            </label>
            <input
              type="text"
              placeholder="e.g. 00:11:22:33:44:55 or *"
              value={newRuleTargetMac}
              onChange={(e) => setNewRuleTargetMac(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {/* Action Type */}
          <div>
            <label className="text-[10px] text-slate-400 font-semibold block mb-1">
              Action Type:
            </label>
            <select
              value={newRuleActionType}
              onChange={(e) => setNewRuleActionType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400 font-medium"
            >
              <option value={RULE_ACTION_TYPES.NATIVE_NOTIFICATION}>NATIVE_NOTIFICATION (Desktop Push Alert)</option>
              <option value={RULE_ACTION_TYPES.AUDIO_BEEP}>AUDIO_BEEP (Web Audio Chime / Beep)</option>
              <option value={RULE_ACTION_TYPES.WEBHOOK}>WEBHOOK (HTTP POST JSON Payload)</option>
            </select>
          </div>

          {/* Action Payload */}
          <div className="md:col-span-2">
            <label className="text-[10px] text-slate-400 font-semibold block mb-1">
              Action Payload / Parameters:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={
                  newRuleActionType === RULE_ACTION_TYPES.WEBHOOK
                    ? 'https://example.com/api/webhook (Full URL for JSON POST)'
                    : newRuleActionType === RULE_ACTION_TYPES.AUDIO_BEEP
                    ? 'Beep frequency in Hz (default 880)'
                    : 'Custom notification message body (optional)'
                }
                value={newRuleActionPayload}
                onChange={(e) => setNewRuleActionPayload(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-medium"
              />
              <button
                onClick={() => {
                  if (!newRuleName.trim()) {
                    setStatusMessage('Please enter a descriptive rule name.');
                    setStatusLevel('warning');
                    return;
                  }
                  const rule = createRule({
                    name: newRuleName,
                    eventType: newRuleEventType,
                    targetMac: newRuleTargetMac,
                    actionType: newRuleActionType,
                    actionPayload: newRuleActionPayload
                  });
                  setRules(prev => [rule, ...prev]);
                  setNewRuleName('');
                  setNewRuleTargetMac('');
                  setNewRuleActionPayload('');
                  setStatusMessage(`Created automation rule "${rule.name}"`);
                  setStatusLevel('success');
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shrink-0 shadow-sm"
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Rules List Table or Empty State */}
      {rules.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2">
          <Bell className="w-10 h-10 text-amber-400/60 mx-auto" />
          <div className="text-sm font-bold text-slate-300">No Automation Rules Configured</div>
          <div className="text-xs text-slate-500 max-w-md mx-auto">
            Define custom rules above to dispatch HTTP webhooks, trigger desktop notifications, or sound audible chimes when devices connect, disconnect, or exhibit security anomalies.
          </div>
        </div>
      ) : (
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 shadow-lg">
          <table className="w-full text-left text-xs text-slate-300 border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Rule Name</th>
                <th className="py-2.5 px-3">Event Trigger</th>
                <th className="py-2.5 px-3">Target MAC</th>
                <th className="py-2.5 px-3">Action Type</th>
                <th className="py-2.5 px-3">Action Payload</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2 px-3 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        rule.enabled !== false
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-500 border-slate-700'
                      }`}
                    >
                      {rule.enabled !== false ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </td>
                  <td className="py-2 px-3 font-semibold text-slate-100 whitespace-nowrap">
                    {rule.name}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      rule.eventType === RULE_EVENT_TYPES.DEVICE_CONNECTED
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                        : rule.eventType === RULE_EVENT_TYPES.DEVICE_DISCONNECTED
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}>
                      {rule.eventType}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">
                      {rule.targetMac || '*'}
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      rule.actionType === RULE_ACTION_TYPES.WEBHOOK
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                        : rule.actionType === RULE_ACTION_TYPES.AUDIO_BEEP
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    }`}>
                      {rule.actionType}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-400 text-[11px] max-w-xs truncate" title={rule.actionPayload || 'Default'}>
                    {rule.actionPayload || '—'}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            const testDevice = {
                              bssid: rule.targetMac !== '*' ? rule.targetMac : '00:C0:CA:98:76:54',
                              clientMac: rule.targetMac !== '*' ? rule.targetMac : '00:C0:CA:98:76:54',
                              ssid: 'Test-Network',
                              vendor: 'Alfa Test Device',
                              rssi: -55
                            };
                            await executeRuleAction(rule, testDevice, rule.eventType);
                            setStatusMessage(`Triggered test execution for rule "${rule.name}"`);
                            setStatusLevel('success');
                          } catch (testErr) {
                            setStatusMessage(`Test rule failed: ${testErr.message || testErr}`);
                            setStatusLevel('error');
                          }
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold transition"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => {
                          setRules(prev => prev.filter(r => r.id !== rule.id));
                          setStatusMessage(`Deleted rule "${rule.name}"`);
                          setStatusLevel('info');
                        }}
                        className="p-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] border border-rose-500/30 transition"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
