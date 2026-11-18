import React, { useMemo, useState } from 'react';
import { Copy, Check, FileDown } from 'lucide-react';
import { computeCidr, splitCidr, vlsm, aggregate, rangeToCidrs, cidrRelation, reverseName, binaryView } from '../../utils/ipcalc.js';
import { addressForms, excludeCidr, prefixTable, aclEntry } from '../../utils/ipcalcExtra.js';

/**
 * IPv4 / IPv6 subnet (CIDR) calculator — fully client-side, no network.
 * Calculate: network, broadcast, mask/wildcard, host range, address class and a
 * binary view. Tabs: Split, VLSM, Aggregate, Contains / overlap (+ range to
 * CIDRs and reverse DNS name).
 */

const EXAMPLES = ['192.168.1.10/24', '10.0.0.0/8', '172.16.5.4/20', '100.64.1.1/10', '2001:db8:abcd:12::1/64', '::1/128'];
const TABS = [['calc', 'Calculate'], ['split', 'Split'], ['vlsm', 'VLSM'], ['aggregate', 'Aggregate'], ['contains', 'Contains / overlap'], ['exclude', 'Exclude'], ['table', 'Prefix table']];

const copyText = (t) => navigator.clipboard?.writeText(String(t));
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono';

function Row({ k, v }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { copyText(v); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs">{k}</span>
      <span className="flex items-center gap-1.5 font-mono text-xs text-gray-200 break-all">
        {String(v)}
        <button onClick={copy} aria-label={`Copy ${k}`} className="text-slate-600 hover:text-cyan-400">{copied ? <Check size={11} /> : <Copy size={11} />}</button>
      </span>
    </div>
  );
}

function ResultList({ items, label = 'Copy all' }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2 mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500">{items.length} result(s)</span>
        <button onClick={() => copyText(items.join('\n'))} className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><Copy size={10} /> {label}</button>
      </div>
      <div className="max-h-64 overflow-auto font-mono text-xs text-gray-200">
        {items.map((it, i) => <div key={i} className="py-0.5 border-b border-slate-900 last:border-0 break-all">{it}</div>)}
      </div>
    </div>
  );
}

const Err = ({ children }) => <div className="p-2 mt-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{children}</div>;

function attempt(fn) {
  try { return { value: fn(), error: '' }; } catch (e) { return { value: null, error: e.message }; }
}

function BinaryView({ report }) {
  const bv = useMemo(() => { try { return binaryView(report.address, report.prefix); } catch { return null; } }, [report]);
  if (!bv) return null;
  return (
    <div className="mt-2 font-mono text-[11px] break-all" aria-label="Binary view">
      <div className="text-slate-500 text-[10px] mb-0.5">Binary (network bits highlighted)</div>
      <span className="text-cyan-300 bg-cyan-950/40">{bv.network}</span>
      {bv.network && bv.host && report.prefix % (report.version === 4 ? 8 : 16) === 0 && <span className="text-slate-600">{report.version === 4 ? '.' : ':'}</span>}
      <span className="text-slate-400">{bv.host}</span>
    </div>
  );
}

function AddressForms({ address }) {
  const forms = useMemo(() => { try { return addressForms(address); } catch { return []; } }, [address]);
  if (!forms.length) return null;
  return (
    <details className="mt-2">
      <summary className="text-[11px] text-slate-500 cursor-pointer">Other forms of {address}</summary>
      <div className="mt-1">{forms.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div>
    </details>
  );
}

function reportToMarkdown(r) {
  const rows = [['Address', r.address], ['Network', r.network], r.broadcast && ['Broadcast', r.broadcast], r.netmask && ['Netmask', r.netmask], r.wildcard && ['Wildcard', r.wildcard],
    ['First host', r.firstHost], ['Last host', r.lastHost], ['Prefix', `/${r.prefix}`], ['Total addresses', r.totalAddresses.toLocaleString()],
    r.usableHosts !== undefined && ['Usable hosts', r.usableHosts.toLocaleString()], r.classification && ['Class', r.classification.label], ['Reverse name', safeReverse(r.address)]].filter(Boolean);
  return [`# ${r.cidr}`, '', '| Field | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | \`${v}\` |`), ''].join('\n');
}
const safeReverse = (ip) => { try { return reverseName(ip); } catch { return ''; } };

function CalcTab() {
  const [input, setInput] = useState('192.168.1.10/24');
  const { value: report, error } = useMemo(() => (input.trim() ? attempt(() => computeCidr(input)) : { value: null, error: '' }), [input]);
  const exportMd = () => {
    const blob = new Blob([reportToMarkdown(report)], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ipcalc-${report.network.replace(/[:.]/g, '_')}-${report.prefix}.md`; a.click(); URL.revokeObjectURL(a.href);
  };
  const copyAll = () => copyText(reportToMarkdown(report));
  return (
    <>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
        aria-label="Address with prefix"
        placeholder="e.g. 192.168.1.10/24, 10.0.0.1/255.255.255.0 or 2001:db8::/48"
        className={`w-full ${inputCls} ${error ? 'border-red-800' : ''}`}
      />
      <div className="flex flex-wrap gap-1 my-1.5">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setInput(e)} className="px-2 py-0.5 text-[10px] bg-slate-800 text-gray-400 rounded hover:bg-slate-700 hover:text-gray-200 font-mono">{e}</button>
        ))}
      </div>
      {error && <Err>{error}</Err>}
      {report && (
        <div className="bg-slate-950 border border-slate-800 rounded p-2">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-900/50 text-cyan-200 border border-cyan-800">IPv{report.version}</span>
            <span className="font-mono text-sm text-cyan-300">{report.cidr}</span>
            {report.classification && (
              <span className={`px-2 py-0.5 rounded text-[10px] border ${report.isPrivate ? 'bg-amber-900/30 text-amber-300 border-amber-800' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                {report.classification.label}
              </span>
            )}
            <span className="ml-auto flex gap-2">
              <button onClick={copyAll} className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><Copy size={10} /> Copy all</button>
              <button onClick={exportMd} className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><FileDown size={10} /> Export (.md)</button>
            </span>
          </div>
          <Row k="Address" v={report.address} />
          <Row k="Network" v={report.network} />
          {report.broadcast && <Row k="Broadcast" v={report.broadcast} />}
          {report.netmask && <Row k="Netmask" v={report.netmask} />}
          {report.wildcard && <Row k="Wildcard" v={report.wildcard} />}
          <Row k="First host" v={report.firstHost} />
          <Row k="Last host" v={report.lastHost} />
          <Row k="Prefix" v={`/${report.prefix}`} />
          <Row k="Total addresses" v={report.totalAddresses.toLocaleString()} />
          {report.usableHosts !== undefined && <Row k="Usable hosts" v={report.usableHosts.toLocaleString()} />}
          <Row k="Reverse name" v={safeReverse(report.address)} />
          {report.wildcard && <Row k="ACL (net wildcard)" v={aclEntry(report.cidr)} />}
          <BinaryView report={report} />
          <AddressForms address={report.address} />
        </div>
      )}
    </>
  );
}

function SplitTab() {
  const [cidr, setCidr] = useState('10.0.0.0/24');
  const [prefix, setPrefix] = useState('26');
  const [limit, setLimit] = useState('1024');
  const res = useMemo(() => attempt(() => splitCidr(cidr, /^\d+$/.test(prefix) ? Number(prefix) : NaN, Number(limit) || 1024)), [cidr, prefix, limit]);
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Network to split" value={cidr} onChange={(e) => setCidr(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
        <label className="text-xs text-slate-500">into /<input aria-label="New prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} className={`w-16 ml-1 ${inputCls}`} /></label>
        <label className="text-xs text-slate-500">max <input aria-label="Output limit" value={limit} onChange={(e) => setLimit(e.target.value)} className={`w-20 ml-1 ${inputCls}`} /></label>
      </div>
      {res.error ? <Err>{res.error}</Err> : <ResultList items={res.value} />}
    </>
  );
}

function VlsmTab() {
  const [parent, setParent] = useState('10.0.0.0/24');
  const [hosts, setHosts] = useState('100, 50, 10');
  const res = useMemo(() => attempt(() => {
    const counts = hosts.split(/[\s,]+/).filter(Boolean).map((h) => { if (!/^\d+$/.test(h)) throw new Error(`Invalid host count "${h}"`); return Number(h); });
    if (!counts.length) throw new Error('Enter at least one host count');
    return vlsm(parent, counts);
  }), [parent, hosts]);
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Parent network" value={parent} onChange={(e) => setParent(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
        <input aria-label="Host counts" value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="hosts per subnet, comma separated" className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
      </div>
      {res.error ? <Err>{res.error}</Err> : (
        <ResultList items={res.value.map((r) => `${r.cidr}  (${r.requested} requested, ${r.usable} usable: ${r.first} - ${r.last})`)} />
      )}
    </>
  );
}

function AggregateTab() {
  const [text, setText] = useState('10.0.0.0/25\n10.0.0.128/25');
  const [a, setA] = useState('10.0.0.1');
  const [b, setB] = useState('10.0.0.6');
  const res = useMemo(() => attempt(() => aggregate(text.split(/[\s,]+/).filter(Boolean))), [text]);
  const range = useMemo(() => attempt(() => rangeToCidrs(a, b)), [a, b]);
  return (
    <>
      <textarea aria-label="CIDRs to aggregate" value={text} onChange={(e) => setText(e.target.value)} rows={4} className={`w-full ${inputCls}`} spellCheck={false} placeholder="One CIDR per line" />
      {res.error ? <Err>{res.error}</Err> : <ResultList items={res.value} />}
      <div className="mt-3 text-xs text-slate-500">Range to CIDRs</div>
      <div className="flex flex-wrap gap-2 items-center mt-1">
        <input aria-label="Range start" value={a} onChange={(e) => setA(e.target.value)} className={`flex-1 min-w-[8rem] ${inputCls}`} spellCheck={false} />
        <span className="text-slate-600">to</span>
        <input aria-label="Range end" value={b} onChange={(e) => setB(e.target.value)} className={`flex-1 min-w-[8rem] ${inputCls}`} spellCheck={false} />
      </div>
      {range.error ? <Err>{range.error}</Err> : <ResultList items={range.value} />}
    </>
  );
}

const RELATION_TEXT = {
  equal: 'The two are identical.', 'a-contains-b': 'A contains B.', 'b-contains-a': 'B contains A.',
  overlap: 'They partially overlap.', disjoint: 'They share no addresses.',
};

function ContainsTab() {
  const [a, setA] = useState('10.0.0.0/16');
  const [b, setB] = useState('10.0.5.7');
  const rel = useMemo(() => attempt(() => cidrRelation(a, b)), [a, b]);
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Network A" value={a} onChange={(e) => setA(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
        <input aria-label="Network or address B" value={b} onChange={(e) => setB(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
      </div>
      {rel.error ? <Err>{rel.error}</Err> : (
        <div className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded text-xs text-gray-200" role="status">
          {RELATION_TEXT[rel.value]} <span className="text-slate-500">({rel.value})</span>
        </div>
      )}
    </>
  );
}

function ExcludeTab() {
  const [parent, setParent] = useState('10.0.0.0/24');
  const [ex, setEx] = useState('10.0.0.64/26');
  const res = useMemo(() => attempt(() => excludeCidr(parent, ex)), [parent, ex]);
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Parent network" value={parent} onChange={(e) => setParent(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
        <span className="text-slate-600 text-xs">minus</span>
        <input aria-label="Network to exclude" value={ex} onChange={(e) => setEx(e.target.value)} className={`flex-1 min-w-[10rem] ${inputCls}`} spellCheck={false} />
      </div>
      {res.error ? <Err>{res.error}</Err> : <ResultList items={res.value} />}
    </>
  );
}

function PrefixTableTab() {
  const [v, setV] = useState(4);
  const rows = useMemo(() => prefixTable(v), [v]);
  return (
    <>
      <div className="flex gap-1 mb-1.5">
        {[4, 6].map((x) => <button key={x} onClick={() => setV(x)} aria-pressed={v === x} className={`px-2 py-0.5 text-[11px] rounded border ${v === x ? 'bg-cyan-900/50 border-cyan-800 text-cyan-200' : 'bg-slate-900 border-slate-800 text-gray-400'}`}>IPv{x}</button>)}
      </div>
      <div className="max-h-80 overflow-auto bg-slate-950 border border-slate-800 rounded">
        <table className="w-full text-[11px] font-mono text-gray-200">
          <thead className="text-slate-500 text-left"><tr><th className="px-2 py-1">Prefix</th>{v === 4 && <><th>Netmask</th><th>Wildcard</th></>}<th>Addresses</th>{v === 4 && <th>Usable</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.prefix} className="border-t border-slate-900">
                <td className="px-2 py-0.5">/{r.prefix}</td>
                {v === 4 && <><td>{r.netmask}</td><td>{r.wildcard}</td></>}
                <td className="break-all">{r.addresses.toLocaleString('en-US')}</td>
                {v === 4 && <td>{r.usable.toLocaleString('en-US')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function IpCalculatorWorkbench({ initialTab = 'calc' }) {
  const [tab, setTab] = useState(TABS.some(([id]) => id === initialTab) ? initialTab : 'calc');
  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="mb-2">
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-2 py-0.5 text-[11px] rounded border ${tab === id ? 'bg-cyan-900/50 border-cyan-800 text-cyan-200' : 'bg-slate-900 border-slate-800 text-gray-400 hover:text-gray-200'}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'calc' && <CalcTab />}
      {tab === 'split' && <SplitTab />}
      {tab === 'vlsm' && <VlsmTab />}
      {tab === 'aggregate' && <AggregateTab />}
      {tab === 'contains' && <ContainsTab />}
      {tab === 'exclude' && <ExcludeTab />}
      {tab === 'table' && <PrefixTableTab />}
    </div>
  );
}
