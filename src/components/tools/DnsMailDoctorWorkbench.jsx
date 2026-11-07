import React, { useState } from 'react';
import { Search, Mail, Globe, ShieldCheck, ShieldAlert, Server } from 'lucide-react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { parseSpf, parseDmarc, classifyTxt, DNSBL_ZONES, dnsblName, interpretDnsbl, reverseIpv4 } from '../../utils/mailDns.js';

/**
 * DNS / Mail Doctor (MXToolbox-style), client-side over DNS-over-HTTPS.
 * Resolves the common record types, parses SPF / DMARC / DKIM, and checks the
 * domain's mail-server IPs against public DNSBLs. DoH (dns.google) is
 * CORS-enabled, so this works directly from the browser; a proxy can still be
 * configured for networks that block it.
 */

const RRTYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };

async function doh(name, type) {
  const resp = await proxiedFetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  const data = await resp.json();
  return (data.Answer || []).map((a) => ({ ...a, typeName: RRTYPE[a.type] || a.type }));
}

function unquote(s) { return String(s).replace(/^"|"$/g, '').replace(/"\s+"/g, ''); }

function Section({ icon: Icon, title, children, accent = 'text-cyan-400' }) {
  return (
    <section className="mb-3">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5 ${accent}`}><Icon size={13} /> {title}</h3>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono">{children}</div>
    </section>
  );
}

export default function DnsMailDoctorWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [dkimSelector, setDkimSelector] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState(null);

  const log = (m) => onLogMessage?.(m);

  const run = async () => {
    const name = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!name) return;
    setBusy(true); setError(''); setRes(null);
    log(`DNS/Mail check for ${name}…`);
    try {
      const [a, aaaa, mx, ns, soa, caa, txt] = await Promise.all([
        doh(name, 'A'), doh(name, 'AAAA'), doh(name, 'MX'), doh(name, 'NS'),
        doh(name, 'SOA'), doh(name, 'CAA'), doh(name, 'TXT'),
      ]);
      const txtStrings = txt.map((r) => unquote(r.data));
      const spfTxt = txtStrings.find((t) => /^v=spf1/i.test(t));
      const dmarcAns = await doh(`_dmarc.${name}`, 'TXT');
      const dmarcTxt = dmarcAns.map((r) => unquote(r.data)).find((t) => /^v=DMARC1/i.test(t));
      const dkimAns = dkimSelector.trim() ? await doh(`${dkimSelector.trim()}._domainkey.${name}`, 'TXT') : [];
      const dkimTxt = dkimAns.map((r) => unquote(r.data)).join('');

      // DNSBL check on mail-server IPs (resolve each MX host's A record).
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

      setRes({
        name, a, aaaa, mx, ns, soa, caa, txtStrings,
        spf: parseSpf(spfTxt), dmarc: parseDmarc(dmarcTxt),
        dkim: dkimTxt ? { selector: dkimSelector.trim(), raw: dkimTxt } : null,
        mxIps, dnsbl,
      });
      log(`Done: ${mx.length} MX, SPF ${spfTxt ? 'yes' : 'no'}, DMARC ${dmarcTxt ? 'yes' : 'no'}, DNSBL hits ${dnsbl.length}`);
    } catch (e) {
      setError(describeNetworkError(e));
    }
    setBusy(false);
  };

  const spf = res?.spf;
  const dmarc = res?.dmarc;

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="example.com"
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono"
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500">DKIM selector:</span>
          <input value={dkimSelector} onChange={(e) => setDkimSelector(e.target.value)} className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono" />
        </div>
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          <Search size={14} /> {busy ? 'Checking…' : 'Check'}
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {res && (
        <>
          <Section icon={Mail} title="Email authentication" accent="text-emerald-400">
            {/* SPF */}
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
            {/* DMARC */}
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
            {/* DKIM */}
            <div>
              <span className={res.dkim ? 'text-emerald-300' : 'text-slate-400'}>DKIM ({dkimSelector || '—'}): {res.dkim ? 'found' : 'not found for this selector'}</span>
              {res.dkim && <div className="pl-3 break-all text-slate-500">{res.dkim.raw}</div>}
            </div>
          </Section>

          <Section icon={ShieldCheck} title={`DNSBL reputation (${res.mxIps.length} mail IP${res.mxIps.length === 1 ? '' : 's'})`} accent={res.dnsbl.length ? 'text-red-400' : 'text-emerald-400'}>
            {res.mxIps.length === 0 && <div className="text-slate-500">No mail-server IPs resolved.</div>}
            {res.mxIps.length > 0 && res.dnsbl.length === 0 && <div className="text-emerald-300 flex items-center gap-1"><ShieldCheck size={13} /> Not listed on any checked DNSBL ({DNSBL_ZONES.join(', ')}).</div>}
            {res.dnsbl.map((d, i) => (
              <div key={i} className="text-red-300 flex items-center gap-1"><ShieldAlert size={13} /> {d.ip} ({d.host}) listed on {d.zone} → {d.code}</div>
            ))}
          </Section>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
            <Section icon={Server} title="Mail servers (MX)">
              {res.mx.length === 0 && <div className="text-slate-500">none</div>}
              {res.mx.sort((a, b) => Number(a.data.split(/\s+/)[0]) - Number(b.data.split(/\s+/)[0])).map((r, i) => (
                <div key={i} className="text-gray-300">{r.data}</div>
              ))}
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
            {res.txtStrings.map((t, i) => (
              <div key={i} className="break-all mb-0.5"><span className="text-cyan-500 mr-1">[{classifyTxt(t)}]</span><span className="text-slate-400">{t}</span></div>
            ))}
          </Section>
        </>
      )}

      {!res && !error && (
        <p className="text-xs text-slate-500">
          Enter a domain to resolve its DNS records, parse SPF / DMARC / DKIM, and check its mail-server IPs against public
          DNSBLs — all over DNS-over-HTTPS, from your browser. True AXFR zone transfers need a TCP socket and aren't possible
          in a browser.
        </p>
      )}
    </div>
  );
}
