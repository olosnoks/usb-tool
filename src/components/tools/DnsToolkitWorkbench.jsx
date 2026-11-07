import React, { useState, useRef, useCallback } from 'react';
import { Globe, Mail, Search, RefreshCw, ShieldCheck, ShieldAlert, Server, FileDown, Play, Square } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';
import { parseSpf, parseDmarc, classifyTxt, DNSBL_ZONES, dnsblName, interpretDnsbl } from '../../utils/mailDns.js';

/**
 * DNS Toolkit — one domain lookup resolves every record type AND the email-auth
 * posture (SPF/DMARC/DKIM/DNSBL) in a single pass, shown together. A subdomain
 * brute-force section sits at the bottom with a verbose live log. Everything for
 * the domain exports to one Markdown file. All over DNS-over-HTTPS (dns.google);
 * a proxy can be set for networks that block it.
 */

const RRTYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };
const LOOKUP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SOA', 'CAA', 'TXT'];

async function doh(name, type) {
  const resp = await proxiedFetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  const data = await resp.json();
  return (data.Answer || []).map((a) => ({ ...a, typeName: RRTYPE[a.type] || a.type }));
}
const unquote = (s) => String(s).replace(/^"|"$/g, '').replace(/"\s+"/g, '');

function Section({ icon: Icon, title, children, accent = 'text-cyan-400' }) {
  return (
    <section className="mb-3">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5 ${accent}`}><Icon size={13} /> {title}</h3>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono">{children}</div>
    </section>
  );
}

export default function DnsToolkitWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [dkimSelector, setDkimSelector] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  // subdomain brute-force
  const [subList, setSubList] = useState(null);
  const [subBusy, setSubBusy] = useState(false);
  const [found, setFound] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [verbose, setVerbose] = useState(true);
  const [vlog, setVlog] = useState([]);
  const cancelRef = useRef(false);
  const vbufRef = useRef([]);

  const log = (m) => onLogMessage?.(m);
  const cleanDomain = () => domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*?\.+/, '');

  const lookup = async () => {
    const name = cleanDomain();
    if (!name) return;
    setBusy(true); setError(''); setInfo(null);
    log(`DNS lookup for ${name}${isProxyEnabled() ? ' (via proxy)' : ''}…`);
    try {
      const [a, aaaa, cname, mx, ns, soa, caa, txt] = await Promise.all(LOOKUP_TYPES.map((t) => doh(name, t)));
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
      setInfo({
        name, a, aaaa, cname, mx, ns, soa, caa, txtStrings,
        spf: parseSpf(spfTxt), dmarc: parseDmarc(dmarcTxt),
        dkim: dkimTxt ? { selector: dkimSelector.trim(), raw: dkimTxt } : null,
        mxIps, dnsbl,
      });
      log(`Lookup done: ${a.length} A, ${mx.length} MX, SPF ${spfTxt ? 'yes' : 'no'}, DMARC ${dmarcTxt ? 'yes' : 'no'}, DNSBL hits ${dnsbl.length}`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  const flushVerbose = () => setVlog(vbufRef.current.slice(-400));

  const brute = useCallback(async () => {
    const name = cleanDomain();
    if (!name || !subList || !subList.length) return;
    setSubBusy(true); setFound([]); setProgress({ done: 0, total: subList.length });
    vbufRef.current = []; setVlog([]);
    cancelRef.current = false;
    log(`Brute-forcing ${subList.length} subdomains of ${name} via DoH…`);
    let done = 0; const hits = []; const queue = [...subList];
    const worker = async () => {
      while (queue.length) {
        if (cancelRef.current) return;
        const sub = queue.shift();
        const fqdn = `${sub}.${name}`;
        let line;
        try {
          const ans = await doh(fqdn, 'A');
          if (ans.length) {
            const ips = ans.filter((a) => a.type === 1).map((a) => a.data);
            const data = (ips.length ? ips : ans.map((a) => a.data)).join(', ');
            hits.push({ fqdn, data });
            setFound([...hits].sort((a, b) => a.fqdn.localeCompare(b.fqdn)));
            line = `[+] ${fqdn} → ${data}`;
          } else {
            line = `[-] ${fqdn}`;
          }
        } catch { line = `[!] ${fqdn} (error)`; }
        done += 1;
        if (verbose) vbufRef.current.push(line);
        else if (line.startsWith('[+]')) vbufRef.current.push(line);
        if (done % 10 === 0 || !queue.length) { setProgress({ done, total: subList.length }); flushVerbose(); }
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    setProgress({ done, total: subList.length }); flushVerbose();
    log(cancelRef.current ? `Subdomain brute stopped (${hits.length} found)` : `Found ${hits.length} subdomain(s)`);
    setSubBusy(false);
  }, [domain, subList, verbose, log]);

  const buildMarkdown = () => {
    const now = new Date().toISOString();
    const L = [`# DNS report — ${info?.name || cleanDomain()}`, '', `_Generated ${now} by Skon's USB Tool — DNS Toolkit._`, ''];
    if (info) {
      const i = info;
      L.push('## Records', '');
      const rows = [];
      const push = (type, arr) => arr.forEach((r) => rows.push(`| ${type} | ${r.name || i.name} | ${String(r.data).replace(/\|/g, '\\|')} | ${r.TTL ?? ''} |`));
      L.push('| Type | Name | Data | TTL |', '|---|---|---|---|');
      push('A', i.a); push('AAAA', i.aaaa); push('CNAME', i.cname); push('MX', i.mx);
      push('NS', i.ns); push('SOA', i.soa); push('CAA', i.caa);
      i.txtStrings.forEach((t) => rows.push(`| TXT | ${i.name} | ${t.replace(/\|/g, '\\|')} | |`));
      L.push(rows.join('\n') || '| | | (none) | |', '');

      L.push('## Email authentication', '');
      L.push(`- **SPF:** ${i.spf ? `present — all = ${i.spf.all ? i.spf.all.qualifier + 'all (' + i.spf.all.meaning + ')' : 'none'}, ${i.spf.lookups} lookup(s)` : 'MISSING'}`);
      if (i.spf) L.push(`  - \`${i.spf.raw}\``);
      L.push(`- **DMARC:** ${i.dmarc ? `p=${i.dmarc.policy} (${i.dmarc.strength})${i.dmarc.pct !== 100 ? `, pct=${i.dmarc.pct}` : ''}` : 'MISSING'}`);
      if (i.dmarc) L.push(`  - \`${i.dmarc.raw}\`${i.dmarc.rua ? `\n  - reports → ${i.dmarc.rua}` : ''}`);
      L.push(`- **DKIM (${i.dkim?.selector || dkimSelector || '—'}):** ${i.dkim ? 'found' : 'not found for this selector'}`);
      if (i.dkim) L.push(`  - \`${i.dkim.raw}\``);
      L.push('');

      L.push('## Mail servers', '');
      if (i.mx.length) { [...i.mx].sort((a, b) => Number(a.data.split(/\s+/)[0]) - Number(b.data.split(/\s+/)[0])).forEach((r) => L.push(`- ${r.data}`)); i.mxIps.forEach((m) => L.push(`  - ${m.host} → ${m.ip}`)); }
      else L.push('- none');
      L.push('');

      L.push('## DNSBL reputation', '');
      if (i.mxIps.length === 0) L.push('- No mail-server IPs resolved.');
      else if (i.dnsbl.length === 0) L.push(`- Not listed on any checked DNSBL (${DNSBL_ZONES.join(', ')}).`);
      else i.dnsbl.forEach((d) => L.push(`- ⚠ ${d.ip} (${d.host}) listed on ${d.zone} → ${d.code}`));
      L.push('');
    } else {
      L.push('_No lookup has been run._', '');
    }

    L.push('## Subdomains (brute-force)', '');
    if (found.length) { L.push(`${found.length} discovered of ${progress.total} tried:`, ''); found.forEach((f) => L.push(`- ${f.fqdn} → ${f.data}`)); }
    else L.push(progress.total ? `None of ${progress.total} tried resolved.` : '_Not run._');
    L.push('');
    return L.join('\n');
  };

  const exportMd = () => {
    const name = info?.name || cleanDomain() || 'dns';
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `dns-${name}-${new Date().toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(a.href);
    log('Exported DNS report (.md)');
  };

  const i = info;
  const spf = i?.spf; const dmarc = i?.dmarc;
  const canExport = !!info || found.length > 0;

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && lookup()}
          placeholder="example.com"
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500">DKIM selector
          <input value={dkimSelector} onChange={(e) => setDkimSelector(e.target.value)} className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono ml-1" />
        </label>
        <button onClick={lookup} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Looking up…' : 'Look up'}
        </button>
        <button onClick={exportMd} disabled={!canExport} title={canExport ? 'Export everything for this domain to Markdown' : 'Run a lookup first'} className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-sm hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">
          <FileDown size={14} /> Export (.md)
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {i && (
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
              <span className={i.dkim ? 'text-emerald-300' : 'text-slate-400'}>DKIM ({dkimSelector || '—'}): {i.dkim ? 'found' : 'not found for this selector'}</span>
              {i.dkim && <div className="pl-3 break-all text-slate-500">{i.dkim.raw}</div>}
            </div>
          </Section>

          <Section icon={ShieldCheck} title={`DNSBL reputation (${i.mxIps.length} mail IP${i.mxIps.length === 1 ? '' : 's'})`} accent={i.dnsbl.length ? 'text-red-400' : 'text-emerald-400'}>
            {i.mxIps.length === 0 && <div className="text-slate-500">No mail-server IPs resolved.</div>}
            {i.mxIps.length > 0 && i.dnsbl.length === 0 && <div className="text-emerald-300 flex items-center gap-1"><ShieldCheck size={13} /> Not listed on any checked DNSBL ({DNSBL_ZONES.join(', ')}).</div>}
            {i.dnsbl.map((d, idx) => (<div key={idx} className="text-red-300 flex items-center gap-1"><ShieldAlert size={13} /> {d.ip} ({d.host}) listed on {d.zone} → {d.code}</div>))}
          </Section>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
            <Section icon={Server} title="Mail servers (MX)">
              {i.mx.length === 0 && <div className="text-slate-500">none</div>}
              {[...i.mx].sort((a, b) => Number(a.data.split(/\s+/)[0]) - Number(b.data.split(/\s+/)[0])).map((r, idx) => (<div key={idx} className="text-gray-300">{r.data}</div>))}
              {i.mxIps.map((m, idx) => <div key={`ip${idx}`} className="text-slate-500 pl-3">{m.host} → {m.ip}</div>)}
            </Section>
            <Section icon={Globe} title="Addresses & zone">
              {i.a.map((r, idx) => <div key={`a${idx}`} className="text-gray-300">A {r.data} <span className="text-slate-600">ttl {r.TTL}</span></div>)}
              {i.aaaa.map((r, idx) => <div key={`aa${idx}`} className="text-gray-300">AAAA {r.data}</div>)}
              {i.cname.map((r, idx) => <div key={`c${idx}`} className="text-slate-400">CNAME {r.data}</div>)}
              {i.ns.map((r, idx) => <div key={`ns${idx}`} className="text-slate-400">NS {r.data}</div>)}
              {i.caa.map((r, idx) => <div key={`caa${idx}`} className="text-slate-400">CAA {r.data}</div>)}
              {i.soa.map((r, idx) => <div key={`soa${idx}`} className="text-slate-500 break-all">SOA {r.data}</div>)}
            </Section>
          </div>

          <Section icon={Search} title={`TXT records (${i.txtStrings.length})`}>
            {i.txtStrings.length === 0 && <div className="text-slate-500">none</div>}
            {i.txtStrings.map((t, idx) => (<div key={idx} className="break-all mb-0.5"><span className="text-cyan-500 mr-1">[{classifyTxt(t)}]</span><span className="text-slate-400">{t}</span></div>))}
          </Section>
        </>
      )}

      {/* Subdomain brute-force */}
      <div className="mt-4 pt-3 border-t border-slate-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 text-indigo-300 flex items-center gap-1.5"><Search size={13} /> Subdomain brute-force</h3>
        <div className="text-[11px] text-slate-500 mb-1">Resolves <span className="font-mono">{'{word}'}.{cleanDomain() || 'domain'}</span> via DoH</div>
        <WordlistPicker category="subdomains" max={20000} label="Subdomain list" onLoad={(lines, meta) => { setSubList(lines); log(`Subdomain list: ${lines.length} (${meta.name})`); }} />
        <div className="flex gap-2 items-center flex-wrap mb-2">
          {!subBusy
            ? <button onClick={brute} disabled={!subList || !cleanDomain()} className="px-3 py-1 bg-indigo-900/50 border border-indigo-800 text-indigo-200 rounded text-xs hover:bg-indigo-900/70 disabled:opacity-40 inline-flex items-center gap-1"><Play size={12} /> Brute subdomains</button>
            : <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600 inline-flex items-center gap-1"><Square size={12} /> Stop ({progress.done}/{progress.total})</button>}
          <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} /> verbose</label>
          {!subList && <span className="text-xs text-gray-500">load a subdomain list first</span>}
          {progress.total > 0 && <span className="text-xs text-slate-500 ml-auto">{progress.done}/{progress.total} tried · {found.length} found</span>}
        </div>

        {vlog.length > 0 && (
          <div className="mb-2 bg-slate-950 border border-slate-800 rounded p-2 font-mono text-[11px] max-h-48 overflow-auto">
            {vlog.map((line, idx) => (
              <div key={idx} className={line.startsWith('[+]') ? 'text-green-400' : line.startsWith('[!]') ? 'text-red-400' : 'text-slate-600'}>{line}</div>
            ))}
            {subBusy && <div className="text-slate-500 animate-pulse">…</div>}
          </div>
        )}

        {found.length > 0 && (
          <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[40vh]">
            <table className="w-full text-xs text-gray-200 border-collapse font-mono">
              <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Subdomain</th><th className="px-2 py-1">A records</th></tr></thead>
              <tbody>
                {found.map((r, idx) => (<tr key={idx} className="border-b border-slate-900 last:border-0"><td className="px-2 py-1 break-all text-green-400">{r.fqdn}</td><td className="px-2 py-1 text-gray-300">{r.data}</td></tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!i && !error && <p className="text-[10px] text-slate-500 mt-3">One lookup resolves A/AAAA/CNAME/MX/NS/SOA/CAA/TXT and the email-auth posture (SPF/DMARC/DKIM/DNSBL) together. All over DNS-over-HTTPS; browsers can't do TCP AXFR zone transfers. Assess only domains you own or are authorized to test.</p>}
    </div>
  );
}
