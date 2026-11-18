import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Globe, Mail, Search, RefreshCw, ShieldCheck, ShieldAlert, Server, FileDown, Play, Square, Copy, Terminal } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';
import {
  parseSpf, parseDmarc, classifyTxt, DNSBL_ZONES, dnsblName, interpretDnsbl, expandSpf,
  parseMtaStsTxt, parseMtaStsPolicy, parseTlsRpt, parseBimi, COMMON_DKIM_SELECTORS, compareResolvers, dnssecVerdict,
} from '../../utils/mailDns.js';
import { doh, dohProblem, unquote, RESOLVERS } from '../../utils/dnsDoh.js';
import { ipToArpa, digCommand, parseDkim, healthFindings } from '../../utils/dnsHealth.js';

/**
 * DNS Toolkit — one domain lookup resolves every record type AND the email-auth
 * posture (SPF/DMARC/DKIM/DNSBL) in a single pass, shown together. A subdomain
 * brute-force section sits at the bottom with a verbose live log. Everything for
 * the domain exports to one Markdown file. All over DNS-over-HTTPS (dns.google);
 * a proxy can be set for networks that block it.
 */

const QUERY_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SOA', 'TXT', 'CAA', 'PTR', 'SRV', 'DS', 'DNSKEY', 'NAPTR', 'TLSA'];
const LOOKUP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SOA', 'CAA', 'TXT'];
const TYPE_CODE = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

// All queries go through the proxy-aware fetch; a resolver can be named per call.
const dq = (name, type, resolver = 'google') => doh(name, type, { resolver, fetchImpl: proxiedFetch });

/** TXT strings for a name; throws on a resolver error (SERVFAIL/REFUSED), [] on NXDOMAIN/no data. */
async function txtQuery(name, resolver) {
  const r = await dq(name, 'TXT', resolver);
  const problem = dohProblem(r);
  if (problem) throw new Error(problem);
  return r.answers.filter((a) => a.type === 16).map((a) => unquote(a.data));
}
/** Like txtQuery but never throws: { strings, error }. */
const txtSafe = (name) => txtQuery(name).then((strings) => ({ strings, error: null }), (e) => ({ strings: [], error: describeNetworkError(e) }));
const first = (strings, re) => strings.find((t) => re.test(t));

const LEVEL_STYLE = { error: ['text-red-300', '✗'], warn: ['text-amber-300', '⚠'], info: ['text-slate-400', 'i'], ok: ['text-emerald-300', '✓'] };

function HealthSection({ findings }) {
  const errs = findings.filter((f) => f.level === 'error').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return (
    <Section icon={ShieldCheck} title={`Health summary (${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'})`} accent={errs ? 'text-red-400' : warns ? 'text-amber-400' : 'text-emerald-400'}>
      {findings.map((f, idx) => (
        <div key={idx} className={`flex gap-1.5 ${LEVEL_STYLE[f.level][0]}`}><span className="w-3 shrink-0 text-center">{LEVEL_STYLE[f.level][1]}</span><span>{f.text}</span></div>
      ))}
    </Section>
  );
}

function Section({ icon: Icon, title, children, accent = 'text-cyan-400', id }) {
  return (
    <section id={id} className="mb-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-0.5 flex items-center gap-1.5 ${accent}`}><Icon size={13} /> {title}</h3>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-[11px] font-mono">{children}</div>
    </section>
  );
}

// initialTab -> section to scroll to: records (lookup results) | email | brute (subdomains).
export const DNS_TOOLKIT_TABS = { records: 'dns-records', email: 'dns-email', brute: 'dns-brute' };

export default function DnsToolkitWorkbench({ onLogMessage, initialTab }) {
  const scrolledRef = useRef(false);
  const [domain, setDomain] = useState('');
  const [dkimSelector, setDkimSelector] = useState('default');
  const [probeDkim, setProbeDkim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  // single-record query (dig-style)
  const [qType, setQType] = useState('A');
  const [qResolver, setQResolver] = useState('google');
  const [qBusy, setQBusy] = useState(false);
  const [qRes, setQRes] = useState(null);

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

  const copyText = (t, what) => { navigator.clipboard?.writeText(t).then(() => log(`Copied ${what}`), () => {}); };

  // One record type from one resolver, shown like `dig`. An IP address becomes a PTR query.
  const runQuery = async () => {
    const raw = cleanDomain();
    if (!raw) return;
    const arpa = ipToArpa(raw);
    const name = arpa || raw;
    const type = arpa ? 'PTR' : qType;
    setQBusy(true); setQRes(null);
    try {
      const t0 = performance.now();
      const r = await dq(name, type, qResolver);
      setQRes({ name, type, resolver: qResolver, status: r.statusName, ad: r.ad, answers: r.answers, ms: Math.round(performance.now() - t0), problem: dohProblem(r) });
      log(`${type} ${name} @${RESOLVERS[qResolver].label}: ${r.statusName}, ${r.answers.length} answer(s)`);
    } catch (e) { setQRes({ name, type, resolver: qResolver, error: describeNetworkError(e) }); }
    setQBusy(false);
  };

  const lookup = async () => {
    const name = cleanDomain();
    if (!name) return;
    setBusy(true); setError(''); setInfo(null);
    log(`DNS lookup for ${name}${isProxyEnabled() ? ' (via proxy)' : ''}…`);
    try {
      // One failing record type shows an error chip; the others still render.
      const settled = await Promise.allSettled(LOOKUP_TYPES.map((t) => dq(name, t)));
      const recs = {}; const recErrors = {}; let ad = false;
      LOOKUP_TYPES.forEach((t, idx) => {
        const s = settled[idx];
        if (s.status === 'rejected') { recErrors[t] = describeNetworkError(s.reason); recs[t] = []; return; }
        const problem = dohProblem(s.value);
        if (problem) recErrors[t] = problem;
        if (s.value.ad && (t === 'A' || t === 'SOA')) ad = true;
        recs[t] = s.value.answers.filter((a) => a.type === TYPE_CODE[t]);
      });
      if (Object.keys(recErrors).length === LOOKUP_TYPES.length) {
        setError(`Every record lookup failed: ${Object.values(recErrors)[0]}`);
        setBusy(false);
        return;
      }
      const { A: a, AAAA: aaaa, CNAME: cname, MX: mx, NS: ns, SOA: soa, CAA: caa, TXT: txt } = recs;
      const txtStrings = txt.map((r) => unquote(r.data));

      // SPF with the include:/redirect= chain expanded for a real lookup count.
      const spfTxt = first(txtStrings, /^v=spf1/i);
      const spfExp = recErrors.TXT ? null : await expandSpf(name, (d) => (d === name ? Promise.resolve(txtStrings) : txtQuery(d)));
      const spf = parseSpf(spfTxt);
      if (spf && spfExp) { spf.lookups = spfExp.lookups; spf.expansion = spfExp; }

      const selectors = [...new Set([dkimSelector.trim(), ...(probeDkim ? COMMON_DKIM_SELECTORS : [])].filter(Boolean))];
      const [dmarcR, mtaR, tlsR, bimiR, dsR, dnskeyR, ...dkimR] = await Promise.all([
        txtSafe(`_dmarc.${name}`), txtSafe(`_mta-sts.${name}`), txtSafe(`_smtp._tls.${name}`), txtSafe(`default._bimi.${name}`),
        dq(name, 'DS').catch((e) => ({ error: describeNetworkError(e) })), dq(name, 'DNSKEY').catch((e) => ({ error: describeNetworkError(e) })),
        ...selectors.map((s) => txtSafe(`${s}._domainkey.${name}`).then((r) => ({ selector: s, ...r }))),
      ]);
      const dmarc = parseDmarc(first(dmarcR.strings, /^v=DMARC1/i));
      const dkim = dkimR.filter((r) => r.strings.length).map((r) => ({ selector: r.selector, raw: r.strings.join('') }));
      const dkimErrors = dkimR.filter((r) => r.error).map((r) => ({ selector: r.selector, error: r.error }));

      const mtaTxt = parseMtaStsTxt(first(mtaR.strings, /^v=STSv1/i));
      let mtaPolicy = null; let mtaPolicyNote = null;
      if (mtaTxt) {
        if (!isProxyEnabled()) mtaPolicyNote = 'needs proxy: the policy file at mta-sts.<domain> sends no CORS headers';
        else {
          try {
            const pr = await proxiedFetch(`https://mta-sts.${name}/.well-known/mta-sts.txt`);
            if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
            mtaPolicy = parseMtaStsPolicy(await pr.text());
            if (!mtaPolicy) mtaPolicyNote = 'policy file is not valid MTA-STS';
          } catch (e) { mtaPolicyNote = `policy file not fetched: ${describeNetworkError(e)}`; }
        }
      }

      const dsRes = dsR.error ? null : dsR; const dkRes = dnskeyR.error ? null : dnskeyR;
      const dnssec = dsRes || dkRes
        ? { ...dnssecVerdict({ ad: ad || !!dsRes?.ad, hasDs: !!dsRes?.answers.some((x) => x.type === 43), hasDnskey: !!dkRes?.answers.some((x) => x.type === 48) }), ad: ad || !!dsRes?.ad }
        : { state: 'error', text: `DNSSEC lookup failed: ${dsR.error || dnskeyR.error}`, ad: false };

      // Same question to every resolver: disagreement can mean split-horizon, geo-DNS, or tampering.
      const rnames = Object.keys(RESOLVERS);
      const resolverChecks = {};
      for (const t of ['A', 'NS']) {
        const rs = await Promise.allSettled(rnames.map((r) => dq(name, t, r)));
        resolverChecks[t] = compareResolvers(rs.map((s, idx) => {
          const label = RESOLVERS[rnames[idx]].label;
          if (s.status === 'rejected') return { resolver: label, ok: false, error: describeNetworkError(s.reason) };
          const problem = dohProblem(s.value);
          if (problem) return { resolver: label, ok: false, error: problem };
          return { resolver: label, ok: true, values: s.value.answers.filter((x) => x.type === TYPE_CODE[t]).map((x) => x.data) };
        }));
      }

      const mxHosts = mx.map((r) => r.data.split(/\s+/)[1]?.replace(/\.$/, '')).filter(Boolean);
      const mxIps = [];
      const mxRes = await Promise.allSettled(mxHosts.slice(0, 5).map((h) => dq(h, 'A')));
      mxRes.forEach((s, idx) => {
        if (s.status === 'fulfilled') s.value.answers.filter((i) => i.type === 1).forEach((i) => mxIps.push({ host: mxHosts[idx], ip: i.data }));
      });
      const dnsbl = []; const dnsblInconclusive = []; let dnsblChecked = 0;
      const jobs = [];
      for (const { host, ip } of mxIps) for (const zone of DNSBL_ZONES) { const q = dnsblName(ip, zone); if (q) jobs.push({ host, ip, zone, q }); }
      const dres = await Promise.allSettled(jobs.map((j) => dq(j.q, 'A')));
      dres.forEach((s, idx) => {
        const j = jobs[idx];
        if (s.status === 'rejected') { dnsblInconclusive.push({ ...j, reason: describeNetworkError(s.reason) }); return; }
        const problem = dohProblem(s.value);
        if (problem) { dnsblInconclusive.push({ ...j, reason: problem }); return; }
        dnsblChecked += 1;
        for (const ans of s.value.answers.filter((x) => x.type === 1)) {
          const v = interpretDnsbl(ans.data);
          if (!v) continue;
          if (v.inconclusive) dnsblInconclusive.push({ ...j, code: v.code, reason: v.reason });
          else dnsbl.push({ ...j, code: v.code });
        }
      });

      setInfo({
        name, a, aaaa, cname, mx, ns, soa, caa, txtStrings, recErrors,
        spf, dmarc, dmarcError: dmarcR.error, txtError: recErrors.TXT || null,
        dkim, dkimErrors, dkimSelectors: selectors,
        mtaSts: mtaTxt ? { ...mtaTxt, policy: mtaPolicy, policyNote: mtaPolicyNote } : null, mtaStsError: mtaR.error,
        tlsRpt: parseTlsRpt(first(tlsR.strings, /^v=TLSRPTv1/i)), bimi: parseBimi(first(bimiR.strings, /^v=BIMI1/i)),
        dnssec, resolverChecks,
        mxIps, dnsbl, dnsblInconclusive, dnsblChecked,
      });
      log(`Lookup done: ${a.length} A, ${mx.length} MX, SPF ${spfTxt ? `yes (${spf?.lookups ?? '?'} lookups)` : 'no'}, DMARC ${dmarc ? 'yes' : 'no'}, DNSSEC ${dnssec.state}, DNSBL hits ${dnsbl.length}${dnsblInconclusive.length ? `, ${dnsblInconclusive.length} inconclusive` : ''}`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  useEffect(() => {
    if (scrolledRef.current) return;
    const id = DNS_TOOLKIT_TABS[initialTab];
    const el = id && document.getElementById(id);
    if (el) { scrolledRef.current = true; el.scrollIntoView?.({ block: 'start' }); }
  }, [initialTab, info]);

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
          const res = await dq(fqdn, 'A');
          const ans = res.answers;
          if (dohProblem(res)) {
            line = `[!] ${fqdn} (${res.statusName})`;
          } else if (ans.length) {
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
      L.push('## Health summary', '');
      healthFindings(i).forEach((f) => L.push(`- **${f.level}:** ${f.text}`));
      L.push('', '## Records', '');
      const rows = [];
      const push = (type, arr) => arr.forEach((r) => rows.push(`| ${type} | ${r.name || i.name} | ${String(r.data).replace(/\|/g, '\\|')} | ${r.TTL ?? ''} |`));
      L.push('| Type | Name | Data | TTL |', '|---|---|---|---|');
      push('A', i.a); push('AAAA', i.aaaa); push('CNAME', i.cname); push('MX', i.mx);
      push('NS', i.ns); push('SOA', i.soa); push('CAA', i.caa);
      i.txtStrings.forEach((t) => rows.push(`| TXT | ${i.name} | ${t.replace(/\|/g, '\\|')} | |`));
      L.push(rows.join('\n') || '| | | (none) | |', '');

      const errTypes = Object.entries(i.recErrors || {});
      if (errTypes.length) { L.push('**Record lookup errors:** ' + errTypes.map(([t, m]) => `${t} (${m})`).join(', '), ''); }

      L.push('## Email authentication', '');
      L.push(`- **SPF:** ${i.spf ? `present — all = ${i.spf.all ? i.spf.all.qualifier + 'all (' + i.spf.all.meaning + ')' : 'none'}, ${i.spf.lookups} DNS lookup(s) after expanding include/redirect${i.spf.expansion?.overLimit ? ' — OVER the 10-lookup limit' : ''}` : (i.txtError ? `unknown (TXT lookup failed: ${i.txtError})` : 'MISSING')}`);
      if (i.spf) L.push(`  - \`${i.spf.raw}\``);
      (i.spf?.expansion?.errors || []).forEach((e) => L.push(`  - ERROR: ${e}`));
      (i.spf?.expansion?.warnings || []).forEach((e) => L.push(`  - warning: ${e}`));
      if (i.spf?.expansion?.voidLookups) L.push(`  - void lookups: ${i.spf.expansion.voidLookups}`);
      L.push(`- **DMARC:** ${i.dmarc ? `p=${i.dmarc.policy} (${i.dmarc.strength})${i.dmarc.sp ? `, sp=${i.dmarc.sp}` : ''}, adkim=${i.dmarc.adkim}, aspf=${i.dmarc.aspf}${i.dmarc.pct !== 100 ? `, pct=${i.dmarc.pct}` : ''}` : (i.dmarcError ? `unknown (${i.dmarcError})` : 'MISSING')}`);
      if (i.dmarc) { L.push(`  - \`${i.dmarc.raw}\``); if (i.dmarc.rua) L.push(`  - aggregate reports (rua) → ${i.dmarc.rua}`); if (i.dmarc.ruf) L.push(`  - forensic reports (ruf) → ${i.dmarc.ruf}`); }
      L.push(`- **DKIM (${i.dkimSelectors.join(', ') || '—'}):** ${i.dkim.length ? i.dkim.map((d) => d.selector).join(', ') + ' found' : 'not found for the selector(s) tried'}`);
      i.dkim.forEach((d) => L.push(`  - ${d.selector}: \`${d.raw}\``));
      L.push(`- **MTA-STS:** ${i.mtaSts ? `TXT present (id=${i.mtaSts.id || '?'})${i.mtaSts.policy ? `, mode=${i.mtaSts.policy.mode}, max_age=${i.mtaSts.policy.maxAge}, mx=${i.mtaSts.policy.mx.join(' ')}` : `; ${i.mtaSts.policyNote}`}` : (i.mtaStsError ? `unknown (${i.mtaStsError})` : 'not published')}`);
      L.push(`- **TLS-RPT:** ${i.tlsRpt ? `present — ${i.tlsRpt.rua || 'no rua'}` : 'not published'}`);
      L.push(`- **BIMI:** ${i.bimi ? `present — logo ${i.bimi.logo || 'none'}${i.bimi.authority ? `, VMC ${i.bimi.authority}` : ''}` : 'not published'}`);
      L.push('');

      L.push('## DNSSEC and resolver agreement', '');
      L.push(`- **DNSSEC:** ${i.dnssec.state} — ${i.dnssec.text}`);
      for (const [t, c] of Object.entries(i.resolverChecks)) {
        L.push(`- **${t} across resolvers:** ${c.comparable ? (c.agree ? 'all agree' : 'DISAGREE (may be geo-DNS/load-balancing, or tampering)') : 'not enough resolvers answered to compare'}`);
        c.groups.forEach((g) => L.push(`  - ${g.resolvers.join(', ')}: ${g.values.join(', ') || '(empty)'}`));
        c.failed.forEach((f) => L.push(`  - ${f.resolver}: error — ${f.error}`));
      }
      L.push('');

      L.push('## Mail servers', '');
      if (i.mx.length) { [...i.mx].sort((a, b) => Number(a.data.split(/\s+/)[0]) - Number(b.data.split(/\s+/)[0])).forEach((r) => L.push(`- ${r.data}`)); i.mxIps.forEach((m) => L.push(`  - ${m.host} → ${m.ip}`)); }
      else L.push('- none');
      L.push('');

      L.push('## DNSBL reputation', '');
      if (i.mxIps.length === 0) L.push('- No mail-server IPs resolved.');
      else {
        if (i.dnsbl.length === 0) L.push(`- No listings found (${i.dnsblChecked} check(s) answered; zones: ${DNSBL_ZONES.join(', ')}).`);
        i.dnsbl.forEach((d) => L.push(`- ⚠ ${d.ip} (${d.host}) listed on ${d.zone} → ${d.code}`));
        i.dnsblInconclusive.forEach((d) => L.push(`- inconclusive (${d.reason}): ${d.ip} (${d.host}) on ${d.zone}${d.code ? ` → ${d.code}` : ''}`));
      }
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

  const exportJson = () => {
    const name = info?.name || cleanDomain() || 'dns';
    const strip = (rs) => (rs || []).map((r) => ({ name: r.name, type: r.typeName, ttl: r.TTL, data: r.data }));
    const doc = {
      generatedAt: new Date().toISOString(), tool: "Skon's USB Tool — DNS Toolkit", domain: name,
      records: info ? {
        A: strip(info.a), AAAA: strip(info.aaaa), CNAME: strip(info.cname), MX: strip(info.mx), NS: strip(info.ns), SOA: strip(info.soa), CAA: strip(info.caa), TXT: info.txtStrings, errors: info.recErrors,
      } : null,
      email: info ? {
        spf: info.spf ? { raw: info.spf.raw, all: info.spf.all, lookups: info.spf.lookups, voidLookups: info.spf.expansion?.voidLookups ?? null, overLimit: !!info.spf.expansion?.overLimit, errors: info.spf.expansion?.errors || [], warnings: info.spf.expansion?.warnings || [] } : null,
        dmarc: info.dmarc, dkim: info.dkim, dkimSelectorsTried: info.dkimSelectors,
        mtaSts: info.mtaSts, tlsRpt: info.tlsRpt, bimi: info.bimi,
      } : null,
      dnssec: info?.dnssec || null,
      resolverAgreement: info?.resolverChecks || null,
      mailServers: info ? { hosts: info.mxIps, dnsbl: { listed: info.dnsbl, inconclusive: info.dnsblInconclusive, answeredChecks: info.dnsblChecked } } : null,
      subdomains: { tried: progress.total, found },
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `dns-${name}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    log('Exported DNS report (.json)');
  };

  const i = info;
  const spf = i?.spf; const dmarc = i?.dmarc;
  const canExport = !!info || found.length > 0;

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 text-xs">
      <ProxyConfig onLogMessage={log} backend="dns" />
      <div className="flex flex-wrap gap-1.5 mb-2 items-center">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && lookup()}
          placeholder="example.com or an IP"
          aria-label="Domain or IP address"
          className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
        />
        <button onClick={lookup} disabled={busy} className="px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} {busy ? 'Looking up…' : 'Look up'}
        </button>
        <button onClick={exportMd} disabled={!canExport} aria-label="Export Markdown" title={canExport ? 'Export everything for this domain to Markdown' : 'Run a lookup first'} className="px-2 py-1 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">
          <FileDown size={12} /> .md
        </button>
        <button onClick={exportJson} disabled={!canExport} aria-label="Export JSON" title={canExport ? 'Export everything for this domain to JSON' : 'Run a lookup first'} className="px-2 py-1 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">
          <FileDown size={12} /> .json
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 items-center text-[11px] text-slate-500">
        <label className="flex items-center gap-1">DKIM selector
          <input value={dkimSelector} onChange={(e) => setDkimSelector(e.target.value)} className="w-24 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 font-mono" />
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={probeDkim} onChange={(e) => setProbeDkim(e.target.checked)} /> also try common selectors</label>
      </div>

      <details className="mb-2 bg-slate-950 border border-slate-800 rounded">
        <summary className="px-2 py-1 cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5 select-none"><Terminal size={12} /> Single record query (dig)</summary>
        <div className="p-2 pt-1 space-y-1.5">
          <div className="flex flex-wrap gap-1.5 items-center">
            <select value={qType} onChange={(e) => setQType(e.target.value)} aria-label="Record type" className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 font-mono text-[11px]">
              {QUERY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={qResolver} onChange={(e) => setQResolver(e.target.value)} aria-label="Resolver" className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 font-mono text-[11px]">
              {Object.entries(RESOLVERS).map(([k, r]) => <option key={k} value={k}>@{r.label}</option>)}
            </select>
            <button onClick={runQuery} disabled={qBusy || !cleanDomain()} className="px-2 py-1 bg-violet-900/40 border border-violet-800 text-violet-200 rounded text-[11px] hover:bg-violet-900/60 disabled:opacity-40 inline-flex items-center gap-1">
              {qBusy ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />} Query
            </button>
            <span className="text-[10px] text-slate-500">An IP address is looked up as PTR automatically.</span>
          </div>
          {qRes && (
            <div className="font-mono text-[11px]">
              {qRes.error ? <div className="text-red-300">{qRes.error}</div> : (
                <>
                  <div className={qRes.problem ? 'text-red-300' : 'text-slate-400'}>
                    ;; {qRes.status} · {qRes.answers.length} answer(s) · {qRes.ms} ms{qRes.ad ? ' · AD (DNSSEC validated)' : ''} · @{RESOLVERS[qRes.resolver].label}
                  </div>
                  {qRes.answers.map((a, idx) => <div key={idx} className="text-gray-300 break-all">{a.name} <span className="text-slate-600">{a.TTL}</span> {a.typeName} {a.data}</div>)}
                  {!qRes.answers.length && !qRes.problem && <div className="text-slate-500">(no records)</div>}
                  <button onClick={() => copyText(digCommand(qRes.name, qRes.type, qRes.resolver), 'dig command')} title="Copy the equivalent dig command to run it yourself (this tool used DNS-over-HTTPS)" className="mt-1 text-[10px] text-slate-400 hover:text-gray-200 inline-flex items-center gap-1"><Copy size={10} /> {digCommand(qRes.name, qRes.type, qRes.resolver)}</button>
                </>
              )}
            </div>
          )}
        </div>
      </details>

      {error && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {i && (
        <>
          {Object.keys(i.recErrors).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 items-center text-[11px]">
              <span className="text-slate-500">Lookup errors:</span>
              {Object.entries(i.recErrors).map(([t, m]) => <span key={t} className="px-1.5 py-0.5 rounded bg-red-950/40 border border-red-900 text-red-300" title={m}>{t}: {m}</span>)}
            </div>
          )}
          <HealthSection findings={healthFindings(i)} />
          <Section id="dns-email" icon={Mail} title="Email authentication" accent="text-emerald-400">
            <div className="mb-2">
              <span className={spf ? 'text-emerald-300' : 'text-red-300'}>SPF: {spf ? 'present' : (i.txtError ? 'unknown (TXT lookup failed)' : 'MISSING')}</span>
              {spf && (
                <div className="pl-3 text-slate-400">
                  <div>all: <span className="text-gray-200">{spf.all ? `${spf.all.qualifier}all → ${spf.all.meaning}` : 'none'}</span>{spf.all?.qualifier === '+' && <span className="text-amber-400"> ⚠ +all permits any sender</span>}</div>
                  <div>DNS lookups (includes expanded): <span className={spf.lookups > 10 ? 'text-red-400' : 'text-gray-200'}>{spf.lookups}/10</span>{spf.expansion?.voidLookups > 0 && <span className="text-amber-400"> · {spf.expansion.voidLookups} void</span>}</div>
                  {(spf.expansion?.errors || []).map((e, idx) => <div key={`se${idx}`} className="text-red-400 break-all">✗ {e}</div>)}
                  {(spf.expansion?.warnings || []).map((e, idx) => <div key={`sw${idx}`} className="text-amber-400 break-all">⚠ {e}</div>)}
                  <div className="break-all text-slate-500">{spf.raw}</div>
                </div>
              )}
            </div>
            <div className="mb-2">
              <span className={dmarc ? (dmarc.strength === 'weak' ? 'text-amber-300' : 'text-emerald-300') : 'text-red-300'}>DMARC: {dmarc ? `p=${dmarc.policy} (${dmarc.strength})` : (i.dmarcError ? `unknown (${i.dmarcError})` : 'MISSING')}</span>
              {dmarc && (
                <div className="pl-3 text-slate-400">
                  <div>sp: <span className="text-gray-200">{dmarc.sp || '(inherits p)'}</span> · adkim: <span className="text-gray-200">{dmarc.adkim}</span> · aspf: <span className="text-gray-200">{dmarc.aspf}</span></div>
                  {dmarc.pct !== 100 && <div>pct: {dmarc.pct}%</div>}
                  {dmarc.rua && <div>aggregate reports (rua) → <span className="text-gray-200 break-all">{dmarc.rua}</span></div>}
                  {dmarc.ruf && <div>forensic reports (ruf) → <span className="text-gray-200 break-all">{dmarc.ruf}</span></div>}
                  <div className="break-all text-slate-500">{dmarc.raw}</div>
                </div>
              )}
            </div>
            <div className="mb-2">
              <span className={i.dkim.length ? 'text-emerald-300' : 'text-slate-400'}>DKIM ({i.dkimSelectors.join(', ') || '—'}): {i.dkim.length ? `found for ${i.dkim.map((d) => d.selector).join(', ')}` : 'not found for the selector(s) tried'}</span>
              {i.dkim.map((d) => {
                const k = parseDkim(d.raw);
                return (
                  <div key={d.selector} className="pl-3">
                    <div className="text-slate-400">{d.selector}: {k.keyType.toUpperCase()}{k.bits ? ` ${k.bits}-bit` : ''}{k.revoked ? ' · revoked' : ''}{k.testing ? ' · testing (t=y)' : ''}</div>
                    {k.notes.map((n, idx) => <div key={idx} className={n.level === 'error' ? 'text-red-400' : 'text-amber-400'}>{n.level === 'error' ? '✗' : '⚠'} {n.text}</div>)}
                    <div className="break-all text-slate-500">{d.raw}</div>
                  </div>
                );
              })}
            </div>
            <div className="mb-2">
              <span className={i.mtaSts ? 'text-emerald-300' : 'text-slate-400'}>MTA-STS: {i.mtaSts ? `published (id ${i.mtaSts.id || '?'})` : (i.mtaStsError ? `unknown (${i.mtaStsError})` : 'not published')}</span>
              {i.mtaSts?.policy && <div className="pl-3 text-slate-400">mode <span className={i.mtaSts.policy.mode === 'enforce' ? 'text-emerald-300' : 'text-amber-300'}>{i.mtaSts.policy.mode}</span> · max_age {i.mtaSts.policy.maxAge} · mx {i.mtaSts.policy.mx.join(', ')}</div>}
              {i.mtaSts && !i.mtaSts.policy && <div className="pl-3 text-slate-500">{i.mtaSts.policyNote}</div>}
            </div>
            <div className="mb-2">
              <span className={i.tlsRpt ? 'text-emerald-300' : 'text-slate-400'}>TLS-RPT: {i.tlsRpt ? 'published' : 'not published'}</span>
              {i.tlsRpt?.rua && <div className="pl-3 text-slate-400 break-all">reports → {i.tlsRpt.rua}</div>}
            </div>
            <div>
              <span className={i.bimi ? 'text-emerald-300' : 'text-slate-400'}>BIMI: {i.bimi ? 'published' : 'not published'}</span>
              {i.bimi && <div className="pl-3 text-slate-400 break-all">logo {i.bimi.logo || 'none'}{i.bimi.authority ? ` · VMC ${i.bimi.authority}` : ''}</div>}
            </div>
          </Section>

          <Section icon={ShieldCheck} title="DNSSEC and resolver agreement" accent="text-sky-400">
            <div className="mb-1">
              <span className={{ validated: 'text-emerald-300', unverified: 'text-amber-300', incomplete: 'text-amber-300', unsigned: 'text-slate-400', error: 'text-red-300' }[i.dnssec.state]}>DNSSEC: {i.dnssec.state}</span>
              <span className="text-slate-500"> — {i.dnssec.text}</span>
            </div>
            {Object.entries(i.resolverChecks).map(([t, c]) => (
              <div key={t} className="mb-1">
                <span className={!c.comparable ? 'text-slate-400' : c.agree ? 'text-emerald-300' : 'text-amber-300'}>{t} across resolvers: {!c.comparable ? 'not enough answers to compare' : c.agree ? 'all agree' : 'differ (geo-DNS or load balancing is common; tampering is possible)'}</span>
                {c.groups.map((g, idx) => <div key={idx} className="pl-3 text-slate-400 break-all">{g.resolvers.join(', ')}: {g.values.join(', ') || '(empty)'}</div>)}
                {c.failed.map((f) => <div key={f.resolver} className="pl-3 text-red-400">{f.resolver}: {f.error}</div>)}
              </div>
            ))}
          </Section>

          <Section icon={ShieldCheck} title={`DNSBL reputation (${i.mxIps.length} mail IP${i.mxIps.length === 1 ? '' : 's'})`} accent={i.dnsbl.length ? 'text-red-400' : 'text-emerald-400'}>
            {i.mxIps.length === 0 && <div className="text-slate-500">No mail-server IPs resolved.</div>}
            {i.mxIps.length > 0 && i.dnsbl.length === 0 && i.dnsblChecked > 0 && <div className="text-emerald-300 flex items-center gap-1"><ShieldCheck size={13} /> No listings among {i.dnsblChecked} answered check(s) ({DNSBL_ZONES.join(', ')}).</div>}
            {i.dnsbl.map((d, idx) => (<div key={idx} className="text-red-300 flex items-center gap-1"><ShieldAlert size={13} /> {d.ip} ({d.host}) listed on {d.zone} → {d.code}</div>))}
            {i.dnsblInconclusive.map((d, idx) => (<div key={`inc${idx}`} className="text-amber-300 flex items-center gap-1"><ShieldAlert size={13} /> inconclusive ({d.reason}): {d.ip} ({d.host}) on {d.zone}{d.code ? ` → ${d.code}` : ''}</div>))}
          </Section>

          <div id="dns-records" className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
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
      <div id="dns-brute" className="mt-2 pt-2 border-t border-slate-800">
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

      {!i && !error && <p className="text-[10px] text-slate-500 mt-2">One lookup resolves A/AAAA/CNAME/MX/NS/SOA/CAA/TXT and the email-auth posture (SPF/DMARC/DKIM/DNSBL) together. All over DNS-over-HTTPS; browsers can't do TCP AXFR zone transfers. Assess only domains you own or are authorized to test.</p>}
    </div>
  );
}
