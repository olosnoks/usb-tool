import React, { useMemo, useState } from 'react';
import { Calculator, Copy, Check } from 'lucide-react';
import { computeCidr } from '../../utils/ipcalc.js';

/**
 * IPv4 / IPv6 subnet (CIDR) calculator — fully client-side, no network.
 * Enter an address with an optional /prefix and see the network, broadcast,
 * mask/wildcard, host range and address counts.
 */

const EXAMPLES = ['192.168.1.10/24', '10.0.0.0/8', '172.16.5.4/20', '2001:db8:abcd:12::1/64', '::1/128'];

function Row({ k, v }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(String(v)); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs">{k}</span>
      <span className="flex items-center gap-1.5 font-mono text-xs text-gray-200">
        {String(v)}
        <button onClick={copy} className="text-slate-600 hover:text-cyan-400">{copied ? <Check size={11} /> : <Copy size={11} />}</button>
      </span>
    </div>
  );
}

export default function IpCalculatorWorkbench() {
  const [input, setInput] = useState('192.168.1.10/24');

  const { report, error } = useMemo(() => {
    if (!input.trim()) return { report: null, error: '' };
    try { return { report: computeCidr(input), error: '' }; }
    catch (e) { return { report: null, error: e.message }; }
  }, [input]);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <Calculator size={16} className="text-cyan-400 shrink-0" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          placeholder="e.g. 192.168.1.10/24 or 2001:db8::/48"
          className={`flex-1 bg-slate-900 border rounded px-2 py-1.5 text-sm font-mono ${error ? 'border-red-800' : 'border-slate-800'}`}
        />
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setInput(e)} className="px-2 py-0.5 text-[10px] bg-slate-800 text-gray-400 rounded hover:bg-slate-700 hover:text-gray-200 font-mono">{e}</button>
        ))}
      </div>

      {error && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {report && (
        <div className="bg-slate-950 border border-slate-800 rounded p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-900/50 text-cyan-200 border border-cyan-800">IPv{report.version}</span>
            <span className="font-mono text-sm text-cyan-300">{report.cidr}</span>
            {report.isPrivate !== undefined && (
              <span className={`px-2 py-0.5 rounded text-[10px] border ${report.isPrivate ? 'bg-amber-900/30 text-amber-300 border-amber-800' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                {report.isPrivate ? 'private / reserved' : 'public'}
              </span>
            )}
          </div>
          <Row k="Address" v={report.address} />
          <Row k="Network" v={report.network} />
          {report.broadcast && <Row k="Broadcast" v={report.broadcast} />}
          {report.netmask && <Row k="Netmask" v={report.netmask} />}
          {report.wildcard && <Row k="Wildcard" v={report.wildcard} />}
          <Row k="First host" v={report.firstHost} />
          <Row k="Last host" v={report.lastHost} />
          <Row k="Prefix" v={`/${report.prefix}`} />
          <Row k="Total addresses" v={typeof report.totalAddresses === 'bigint' ? report.totalAddresses.toLocaleString() : report.totalAddresses.toLocaleString()} />
          {report.usableHosts !== undefined && <Row k="Usable hosts" v={report.usableHosts.toLocaleString()} />}
        </div>
      )}
    </div>
  );
}
