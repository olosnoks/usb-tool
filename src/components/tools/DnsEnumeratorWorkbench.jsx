import React, { useState, useRef } from 'react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';

/**
 * DNS lookup over DNS-over-HTTPS (Google public resolver).
 * Queries the selected record types and shows the answers. DoH is CORS-enabled,
 * so this works direct from the browser; a proxy can still be used if desired.
 * True AXFR zone transfers require a TCP connection to the authoritative server
 * and cannot be performed from a browser.
 */
const RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

export default function DnsEnumeratorWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [types, setTypes] = useState({ A: true, AAAA: true, MX: true, TXT: true, NS: true, CNAME: false, SOA: false, CAA: false });
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [subList, setSubList] = useState(null);
  const [found, setFound] = useState([]);
  const [subBusy, setSubBusy] = useState(false);
  const [subProgress, setSubProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  const toggle = (t) => setTypes((s) => ({ ...s, [t]: !s[t] }));

  const bruteSubdomains = async () => {
    const name = domain.trim().replace(/^\*?\./, '');
    if (!name || !subList || !subList.length) return;
    setSubBusy(true);
    setFound([]);
    setSubProgress({ done: 0, total: subList.length });
    cancelRef.current = false;
    log(`Brute-forcing ${subList.length} subdomains of ${name} via DoH…`);
    let done = 0;
    const hits = [];
    const queue = [...subList];
    const worker = async () => {
      while (queue.length) {
        if (cancelRef.current) return;
        const sub = queue.shift();
        const fqdn = `${sub}.${name}`;
        try {
          const resp = await proxiedFetch(`https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=A`, { headers: { accept: 'application/dns-json' } });
          const data = await resp.json();
          if (data.Answer && data.Answer.length) {
            const ips = data.Answer.filter((a) => a.type === 1).map((a) => a.data);
            hits.push({ fqdn, data: (ips.length ? ips : data.Answer.map((a) => a.data)).join(', ') });
            setFound([...hits].sort((a, b) => a.fqdn.localeCompare(b.fqdn)));
          }
        } catch { /* ignore individual failures */ }
        done += 1;
        if (done % 10 === 0 || !queue.length) setSubProgress({ done, total: subList.length });
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    setSubProgress({ done, total: subList.length });
    log(cancelRef.current ? 'Subdomain brute cancelled' : `Found ${hits.length} subdomain(s)`);
    setSubBusy(false);
  };

  const resolve = async () => {
    const name = domain.trim();
    if (!name) return;
    setBusy(true);
    setRecords([]);
    const out = [];
    const selected = RECORD_TYPES.filter((t) => types[t]);
    log(`Resolving ${name} (${selected.join(', ')})…`);
    for (const type of selected) {
      try {
        const resp = await proxiedFetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
          headers: { accept: 'application/dns-json' },
        });
        const data = await resp.json();
        const answers = data.Answer || [];
        if (answers.length === 0) {
          out.push({ type, name: '—', data: '(no records)' });
        } else {
          for (const a of answers) out.push({ type, name: a.name, data: a.data, ttl: a.TTL });
        }
        log(`${type}: ${answers.length} record(s)`);
      } catch (e) {
        out.push({ type, name: '—', data: `Error: ${describeNetworkError(e)}` });
        log(`${type}: ${describeNetworkError(e)}`);
      }
      setRecords([...out]);
    }
    setBusy(false);
  };

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">Resolve records via DNS-over-HTTPS. (Browser cannot perform TCP zone transfers.)</p>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && resolve()}
          className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"
        />
        <button onClick={resolve} disabled={busy} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-40">
          {busy ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
      <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-300">
        {RECORD_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={types[t]} onChange={() => toggle(t)} /> {t}
          </label>
        ))}
      </div>
      {records.length > 0 && (
        <table className="w-full text-sm text-gray-200 border-collapse mb-4">
          <thead><tr className="border-b border-gray-600 text-left"><th className="pr-2">Type</th><th className="pr-2">Name</th><th className="pr-2">Data</th><th>TTL</th></tr></thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="pr-2 font-mono">{r.type}</td>
                <td className="pr-2 break-all">{r.name}</td>
                <td className="pr-2 break-all">{r.data}</td>
                <td className="text-gray-500">{r.ttl ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2 pt-3 border-t border-slate-800">
        <div className="text-sm text-gray-300 mb-1">Subdomain brute-force (resolves <span className="font-mono">{'{word}'}.{domain || 'domain'}</span> via DoH)</div>
        <WordlistPicker category="subdomains" max={20000} label="Subdomain list" onLoad={(lines, meta) => { setSubList(lines); log(`Subdomain list: ${lines.length} (${meta.name})`); }} />
        <div className="flex gap-2 items-center mb-2">
          <button onClick={bruteSubdomains} disabled={subBusy || !subList || !domain.trim()} className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-40">
            {subBusy ? `Brute-forcing ${subProgress.done}/${subProgress.total}` : 'Brute subdomains'}
          </button>
          {subBusy && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
          {!subList && <span className="text-xs text-gray-500">load a subdomain list first</span>}
        </div>
        {found.length > 0 && (
          <table className="w-full text-sm text-gray-200 border-collapse">
            <thead><tr className="border-b border-gray-600 text-left"><th className="pr-2">Subdomain</th><th>A records</th></tr></thead>
            <tbody>
              {found.map((r, i) => (
                <tr key={i} className="border-b border-gray-800"><td className="pr-2 break-all text-green-400">{r.fqdn}</td><td className="font-mono text-gray-300">{r.data}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
