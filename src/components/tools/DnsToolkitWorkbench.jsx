import React, { useState, useRef, useCallback } from 'react';
import { Globe, Mail, Network, Search, RefreshCw, ShieldCheck, ShieldAlert, Server } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';
import { parseSpf, parseDmarc, classifyTxt, DNSBL_ZONES, dnsblName, interpretDnsbl } from '../../utils/mailDns.js';

/**
 * DNS Toolkit — a single tool combining the former DNS Enumerator and DNS/Mail
 * Doctor. One domain field feeds three tabs:
 *   • Records     — resolve chosen record types over DoH
 *   • Email auth  — SPF / DMARC / DKIM parsing + DNSBL reputation of mail IPs
 *   • Subdomains  — wordlist brute-force via DoH
 * All over DNS-over-HTTPS (dns.google), which is CORS-enabled; a proxy can be
 * set for networks that block it. Browsers cannot do TCP AXFR zone transfers.
 */

const RRTYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };
const RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

async function doh(name, type) {
  const resp = await proxiedFetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  const data = await resp.json();
  return (data.Answer || []).map((a) => ({ ...a, typeName: RRTYPE[a.type] || a.type }));
}
function unquote(s) { return String(s).replace(/^"|"$/g, '').replace(/"\s+"/g, ''); }

// ---------- Records tab ----------
function RecordsTab({ domain, log }) {
  const [types, setTypes] = useState({ A: true, AAAA: true, MX: true, TXT: true, NS: true, CNAME: false, SOA: false, CAA: false });
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const toggle = (t) => setTypes((s) => ({ ...s, [t]: !s[t] }));

  const resolve = async () => {
    const name = domain.trim();
    if (!name) return;
    setBusy(true); setRecords([]);
    const out = [];
    const selected = RECORD_TYPES.filter((t) => types[t]);
    log(`Resolving ${name} (${selected.join(', ')})…`);
    for (const type of selected) {
      try {
        const answers = await doh(name, type);
        if (answers.length === 0) out.push({ type, name: '—', data: '(no records)' });
        else for (const a of answers) out.push({ type, name: a.name, data: a.data, ttl: a.TTL });
      } catch (e) {
        out.push({ type, name: '—', data: `Error: ${describeNetworkError(e)}` });
      }
      setRecords([...out]);
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-gray-300">
        {RECORD_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={types[t]} onChange={() => toggle(t)} /> {t}</label>
        ))}
        <button onClick={resolve} disabled={busy} className="ml-auto px-3 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} {busy ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
      {records.length > 0 && (
        <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[55vh]">
          <table className="w-full text-xs text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Type</th><th className="px-2 py-1">Name</th><th className="px-2 py-1">Data</th><th className="px-2 py-1">TTL</th></tr></thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i} className="border-b border-slate-900 last:border-0">
                  <td className="px-2 py-1 text-cyan-400">{r.type}</td>
                  <td className="px-2 py-1 break-all text-slate-400">{r.name}</td>
                  <td className="px-2 py-1 break-all text-gray-200">{r.data}</td>
                  <td className="px-2 py-1 text-slate-600">{r.ttl ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Email auth tab ----------
function Section({ icon: Icon, title, children, accent = 'text-cyan-400' }) {
  return (
    <section className="mb-3">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5 ${accent}`}><Icon size={13} /> {title}</h3>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono">{children}</div>
    </section>
  );
}

function EmailTab({ domain, log }) {
  const [dkimSelector, setDkimSelector] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState(null);

  const run = async () => {
    const name = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!name) return;
    setBusy(true); setError(''); setRes(null);
    log(`DNS/Mail check for ${name}…`);
    try {
      const [a, aaaa, mx, ns, soa, caa, txt] = await Promise.all([
        doh(name, 'A'), doh(name, 'AAAA'), doh(name, 'MX'), doh(name, 'NS'), doh(name, 'SOA'), doh(name, 'CAA'), doh(name, 'TXT'),
      ]);
      const txtStrings = txt.map((r) => unquote(r.data));
      const spfTxt = txtStrings.find((t) => /^v=spf1/i.test(t));
      const dmarcAns = await doh(`_dmarc.${name}`, 'TXT');
      const dmarcTxt = dmarcAns.map((r) => unquote(r.data)).find((t) => /^v=DMARC1/i.test(t));
      const dkimAns = dkimSelector.trim() ? await doh(`${dkimSelector.trim()}._domainkey.${name}`, 'TXT') : [];
      const dkimTxt = dkimAns.map((r) => unquote(r.data)).join('');

      const mxHosts = mx.map((r) => r.data.split(/\s+/)[1]?.replace(/\.$/, '')).filter(Boolean);
      const mxIps = [];
      for (const host of mxHosts.slice(0, 5)) {
        const ips = await doh(host, 'A');
        ips.filter((i) => i.type === 1).forEach((i) => mxIps.push({ host, ip: i.data }));
      }
      const dnsbl = [];
      for (const { host, ip } of mxIps) {
        for (const zone of DNSBL_ZONES) {
          const q = dnsblName(ip, zone);
          if (!q) continue;
          try {
            const ans = await doh(q, 'A');
            const hit = ans.find((x) => x.type === 1 && interpretDnsbl(x.data));
            if (hit) dnsbl.push({ host, ip, zone, code: hit.data });
          } catch { /* NXDOMAIN = not listed */ }
        }
      }
      setRes({ name, a, aaaa, mx, ns, soa, caa, txtStrings, spf: parseSpf(spfTxt), dmarc: parseDmarc(dmarcTxt), dkim: dkimTxt ? { selector: dkimSelector.trim(), raw: dkimTxt } : null, mxIps, dnsbl });
      log(`Done: ${mx.length} MX, SPF ${spfTxt ? 'yes' : 'no'}, DMARC ${dmarcTxt ? 'yes' : 'no'}, DNSBL hits ${dnsbl.length}`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  const spf = res?.spf; const dmarc = res?.dmarc;
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500">DKIM selector:</span>
          <input value={dkimSelector} onChange={(e) => setDkimSelector(e.target.value)} className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono" />
        </div>
        <button onClick={run} disabled={busy} className="ml-auto px-3 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} />} {busy ? 'Checking…' : 'Check email auth'}
        </button>
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}
      {res && (
        <>
          <Section icon={Mail} title="Email authentication" accent="text-emerald-400">
            <div className="mb-2">
              <span className={spf ? 'text-emerald-300' : 'text-red-300'}>SPF: {spf ? 'present' : 'MISSING'}</span>
              {spf && (
                <div className="pl-3 text-slate-400">
                  <div>all: <span className="text-gray-200">{spf.all ? `${spf.all.qualifier}all → ${spf.all.meaning}` : 'none'}</span>{spf.all?.qualifier === '+' && <span className="text-amber-400"> ⚠ +all permits any sender</span>}</div>
                  <div>DNS lookups: <span className={spf.lookups > 10 ? 'text-amber-400' : 'text-gray-200'}>{spf.lookups}{spf.lookups > 10 ? ' ⚠ exceeds the 10-lookup limit' : ''}</span></div>
                  <div className="break-all text-slate-500">{spf.raw}</div>
                </div>
              )}
            </div>
            <div className="mb-2">
              <span className={dmarc ? (dmarc.strength === 'weak' ? 'text-amber-300' : 'text-emerald-300') : 'text-red-300'}>DMARC: {dmarc ? `p=${dmarc.policy} (${dmarc.strength})` : 'MISSING'}</span>
              {dmarc && (
                <div className="pl-3 text-slate-400">
                  {dmarc.pct !== 100 && <div>pct: {dmarc.pct}%</div>}
                  {dmarc.rua && <div>aggregate reports → <span className="text-gray-200 break-all">{dmarc.rua}</span></div>}
                  <div className="break-all text-slate-500">{dmarc.raw}</div>
                </div>
              )}
            </div>
            <div>
              <span className={res.dkim ? 'text-emerald-300' : 'text-slate-400'}>DKIM ({dkimSelector || '—'}): {res.dkim ? 'found' : 'not found for this selector'}</span>
              {res.dkim && <div className="pl-3 break-all text-slate-500">{res.dkim.raw}</div>}
            </div>
          </Section>
          <Section icon={ShieldCheck} title={`DNSBL reputation (${res.mxIps.length} mail IP${res.mxIps.length === 1 ? '' : 's'})`} accent={res.dnsbl.length ? 'text-red-400' : 'text-emerald-400'}>
            {res.mxIps.length === 0 && <div className="text-slate-500">No mail-server IPs resolved.</div>}
            {res.mxIps.length > 0 && res.dnsbl.length === 0 && <div className="text-emerald-300 flex items-center gap-1"><ShieldCheck size={13} /> Not listed on any checked DNSBL ({DNSBL_ZONES.join(', ')}).</div>}
            {res.dnsbl.map((d, i) => (<div key={i} className="text-red-300 flex items-center gap-1"><ShieldAlert size={13} /> {d.ip} ({d.host}) listed on {d.zone} → {d.code}</div>))}
          </Section>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
            <Section icon={Server} title="Mail servers (MX)">
              {res.mx.length === 0 && <div className="text-slate-500">none</div>}
              {[...res.mx].sort((a, b) => Number(a.data.split(/\s+/)[0]) - Number(b.data.split(/\s+/)[0])).map((r, i) => (<div key={i} className="text-gray-300">{r.data}</div>))}
              {res.mxIps.map((m, i) => <div key={`ip${i}`} className="text-slate-500 pl-3">{m.host} → {m.ip}</div>)}
            </Section>
            <Section icon={Globe} title="Addresses & zone">
              {res.a.map((r, i) => <div key={`a${i}`} className="text-gray-300">A {r.data}</div>)}
              {res.aaaa.map((r, i) => <div key={`aa${i}`} className="text-gray-300">AAAA {r.data}</div>)}
              {res.ns.map((r, i) => <div key={`ns${i}`} className="text-slate-400">NS {r.data}</div>)}
              {res.caa.map((r, i) => <div key={`caa${i}`} className="text-slate-400">CAA {r.data}</div>)}
              {res.soa.map((r, i) => <div key={`soa${i}`} className="text-slate-500 break-all">SOA {r.data}</div>)}
            </Section>
          </div>
          <Section icon={Search} title={`TXT records (${res.txtStrings.length})`}>
            {res.txtStrings.length === 0 && <div className="text-slate-500">none</div>}
            {res.txtStrings.map((t, i) => (<div key={i} className="break-all mb-0.5"><span className="text-cyan-500 mr-1">[{classifyTxt(t)}]</span><span className="text-slate-400">{t}</span></div>))}
          </Section>
        </>
      )}
    </div>
  );
}

// ---------- Subdomains tab ----------
function SubdomainsTab({ domain, log }) {
  const [subList, setSubList] = useState(null);
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  const brute = useCallback(async () => {
    const name = domain.trim().replace(/^\*?\./, '');
    if (!name || !subList || !subList.length) return;
    setBusy(true); setFound([]); setProgress({ done: 0, total: subList.length });
    cancelRef.current = false;
    log(`Brute-forcing ${subList.length} subdomains of ${name} via DoH…`);
    let done = 0; const hits = []; const queue = [...subList];
    const worker = async () => {
      while (queue.length) {
        if (cancelRef.current) return;
        const sub = queue.shift();
        const fqdn = `${sub}.${name}`;
        try {
          const ans = await doh(fqdn, 'A');
          if (ans.length) {
            const ips = ans.filter((a) => a.type === 1).map((a) => a.data);
            hits.push({ fqdn, data: (ips.length ? ips : ans.map((a) => a.data)).join(', ') });
            setFound([...hits].sort((a, b) => a.fqdn.localeCompare(b.fqdn)));
          }
        } catch { /* ignore */ }
        done += 1;
        if (done % 10 === 0 || !queue.length) setProgress({ done, total: subList.length });
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    setProgress({ done, total: subList.length });
    log(cancelRef.current ? 'Subdomain brute cancelled' : `Found ${hits.length} subdomain(s)`);
    setBusy(false);
  }, [domain, subList, log]);

  return (
    <div>
      <div className="text-sm text-gray-300 mb-1">Resolves <span className="font-mono">{'{word}'}.{domain || 'domain'}</span> via DoH</div>
      <WordlistPicker category="subdomains" max={20000} label="Subdomain list" onLoad={(lines, meta) => { setSubList(lines); log(`Subdomain list: ${lines.length} (${meta.name})`); }} />
      <div className="flex gap-2 items-center mb-2">
        <button onClick={brute} disabled={busy || !subList || !domain.trim()} className="px-3 py-1 bg-indigo-900/50 border border-indigo-800 text-indigo-200 rounded text-xs hover:bg-indigo-900/70 disabled:opacity-40">
          {busy ? `Brute-forcing ${progress.done}/${progress.total}` : 'Brute subdomains'}
        </button>
        {busy && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Stop</button>}
        {!subList && <span className="text-xs text-gray-500">load a subdomain list first</span>}
      </div>
      {found.length > 0 && (
        <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[50vh]">
          <table className="w-full text-xs text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Subdomain</th><th className="px-2 py-1">A records</th></tr></thead>
            <tbody>
              {found.map((r, i) => (<tr key={i} className="border-b border-slate-900 last:border-0"><td className="px-2 py-1 break-all text-green-400">{r.fqdn}</td><td className="px-2 py-1 text-gray-300">{r.data}</td></tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'records', label: 'Records', icon: Network, comp: RecordsTab },
  { id: 'email', label: 'Email auth', icon: Mail, comp: EmailTab },
  { id: 'subdomains', label: 'Subdomains', icon: Search, comp: SubdomainsTab },
];

export default function DnsToolkitWorkbench({ onLogMessage, initialTab = 'records' }) {
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : 'records');
  const [domain, setDomain] = useState('');
  const log = (m) => onLogMessage?.(m);
  const Active = TABS.find((t) => t.id === tab).comp;

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="example.com"
        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono mb-3"
      />
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs mb-3 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>
      <Active domain={domain} log={log} />
      <p className="text-[10px] text-slate-500 mt-3">All lookups use DNS-over-HTTPS (dns.google). Browsers can't perform TCP AXFR zone transfers. Assess only domains you own or are authorized to test.</p>
    </div>
  );
}
