import React, { useState } from 'react';

/**
 * Simple DNS enumerator that uses Google's DNS-over-HTTPS API.
 * This is a stub implementation – real zone‑transfer attempts would need a server‑side proxy.
 */
export default function DnsEnumeratorWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [records, setRecords] = useState([]);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const resolve = async () => {
    if (!domain) return;
    log(`Resolving ${domain} …`);
    try {
      const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
      const data = await resp.json();
      const ips = (data.Answer || []).map((a) => a.data);
      setRecords(ips);
      log(`Found ${ips.length} A record(s): ${ips.join(', ')}`);
    } catch (e) {
      log(`Error: ${e.message}`);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">DNS Enumerator</h2>
      <p className="text-sm text-gray-400 mb-4">Query A records via DNS‑over‑HTTPS (stub for zone‑transfer).</p>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"
        />
        <button
          onClick={resolve}
          className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500"
        >
          Resolve
        </button>
      </div>
      {records.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-1">A records:</h3>
          <ul className="list-disc list-inside text-sm text-gray-300">
            {records.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{ maxHeight: '30vh' }} />
    </div>
  );
}

