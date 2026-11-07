import React, { useState } from 'react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

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

  const log = (msg) => onLogMessage?.(msg);

  const toggle = (t) => setTypes((s) => ({ ...s, [t]: !s[t] }));

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
      <h2 className="text-lg font-bold mb-2">DNS Enumerator</h2>
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
        <table className="w-full text-sm text-gray-200 border-collapse">
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
    </div>
  );
}
