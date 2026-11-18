import React, { useState } from 'react';
import { Globe, FileUp, ClipboardPaste, Search, RefreshCw, ShieldCheck, ShieldAlert, Download, Copy } from 'lucide-react';
import { parseCertificate, toDER, loadCertificateBundle, buildChain, matchHostname, spkiPin, fingerprintHex, pemFromDer, weaknessHints } from '../../utils/x509';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import { isBackendConfigured, tlsCert } from '../../utils/backendClient';
import { matchFingerprint, validityTimeline, certToText, certToJson, opensslCommands } from '../../utils/certReport';
import ProxyConfig from './common/ProxyConfig';

/**
 * X.509 certificate inspector. Three sources:
 *  - URL: pull the host's certificate(s) from Certificate Transparency logs
 *    (crt.sh, via the proxy — no CORS), pick one, and parse it.
 *  - File: load a PEM/DER certificate.
 *  - Paste: paste PEM text (chains supported — each cert listed).
 * Parsing and fingerprints are fully client-side. CT logs show the most recent
 * *issued* certificate, which may differ from the one a server currently serves.
 */

async function buildInfo(der) {
  const parsed = parseCertificate(der);
  const fps = {
    sha256: await fingerprintHex(der, 'SHA-256'),
    sha1: await fingerprintHex(der, 'SHA-1'),
    sha512: await fingerprintHex(der, 'SHA-512'),
    pin: await spkiPin(parsed),
    size: der.length,
  };
  return { parsed, fps, der };
}

const clip = (h, n = 160) => (h.length > n ? `${h.slice(0, n)}… (${h.length / 2} bytes)` : h);

function Row({ label, value, cls = '' }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return <tr><td className="p-1 border border-slate-700 bg-slate-800 text-slate-200 align-top whitespace-nowrap">{label}</td><td className={`p-1 border border-slate-700 break-all ${cls}`}>{Array.isArray(value) ? value.join(', ') : value}</td></tr>;
}

const copyText = (t) => navigator.clipboard?.writeText(t).catch(() => {});

function Timeline({ parsed }) {
  const t = validityTimeline(parsed);
  const color = t.state === 'valid' ? 'bg-green-500' : t.state === 'expiring' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="font-sans" title={`${t.totalDays}-day validity, ${t.pct}% elapsed`}>
      <div className="h-1.5 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-label="Validity elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.pct}><div className={`h-full ${color}`} style={{ width: `${t.pct}%` }} /></div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-0.5"><span>{parsed.notBefore.toISOString().slice(0, 10)}</span><span>{t.pct}% of {t.totalDays} d elapsed</span><span>{parsed.notAfter.toISOString().slice(0, 10)}</span></div>
    </div>
  );
}

function Tools({ parsed, fps, expectHost }) {
  const [fpIn, setFpIn] = useState('');
  const fpRes = matchFingerprint(fpIn, fps);
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
  const cmds = opensslCommands({ host: expectHost });
  return (
    <div className="space-y-1.5 font-sans">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => copyText(certToText(parsed, fps))} title="Copy a plain-text summary" className="px-2 py-0.5 text-[11px] bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><Copy size={11} /> Copy text</button>
        <button onClick={() => download('certificate.json', JSON.stringify(certToJson(parsed, fps), null, 2), 'application/json')} title="Download a JSON summary" className="px-2 py-0.5 text-[11px] bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><Download size={11} /> JSON</button>
        <input value={fpIn} onChange={(e) => setFpIn(e.target.value)} aria-label="Compare a fingerprint or pin" placeholder="compare fingerprint / pin-sha256 …" className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-[11px] font-mono" />
        {fpRes && <span className={`text-[11px] ${fpRes.match ? 'text-green-400' : 'text-red-400'}`}>{fpRes.match ? `Match (${fpRes.algorithm})` : `No match: ${fpRes.reason}`}</span>}
      </div>
      <details className="text-[11px]">
        <summary className="cursor-pointer text-slate-400">openssl equivalents (run these yourself on the saved PEM)</summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {cmds.map((c) => <li key={c.label}><span className="text-slate-500 font-sans">{c.label}: </span><code className="text-cyan-300 break-all">{c.cmd}</code> <button onClick={() => copyText(c.cmd)} title="Copy command" aria-label={`Copy command: ${c.label}`} className="text-slate-400 hover:text-slate-200 align-middle"><Copy size={10} /></button></li>)}
        </ul>
      </details>
    </div>
  );
}

function CertDetails({ parsed: i, fps, der }) {
  const statusCls = i.expired || i.notYetValid ? 'text-red-400' : 'text-green-400';
  const expCls = i.expired ? 'text-red-400' : i.daysUntilExpiry <= 30 ? 'text-amber-400' : 'text-green-400';
  const pk = i.publicKey || {};
  const pkStr = `${pk.algorithm}${pk.bits ? ` ${pk.bits}-bit` : ''}${pk.curve ? ` ${pk.curve}` : ''}${pk.exponent ? ` (e=${pk.exponent})` : ''}`;
  const downloadPem = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pemFromDer(der)], { type: 'application/x-pem-file' })); a.download = 'certificate.pem'; a.click(); URL.revokeObjectURL(a.href);
  };
  const hints = weaknessHints(i);
  const policies = (i.certificatePolicies || []).map((p) => `${p.name ? `${p.name} ` : ''}(${p.oid})${p.cps.length ? ` CPS: ${p.cps.join(', ')}` : ''}${p.notices.length ? ` notice: ${p.notices.join(' ')}` : ''}`);
  const nc = i.nameConstraints;
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody>
        <Row label="Subject" value={i.subject} />
        <Row label="Issuer" value={i.issuer} />
        {i.selfSigned && <Row label="Self-signed" value="yes (subject = issuer)" cls="text-amber-400" />}
        <Row label="Valid from" value={i.notBefore.toISOString()} />
        <Row label="Valid to" value={i.notAfter.toISOString()} cls={statusCls} />
        <Row label="Status" value={i.expired ? 'EXPIRED' : i.notYetValid ? 'NOT YET VALID' : `Valid · ${i.daysUntilExpiry} day(s) left`} cls={expCls} />
        <Row label="Validity period" value={`${i.validityDays} day(s)`} />
        <Row label="Version" value={`v${i.version}`} />
        <Row label="Serial" value={i.serial} />
        <Row label="Signature alg" value={i.signatureAlgorithm} />
        <Row label="Public key" value={pkStr} />
        <Row label="SAN" value={i.subjectAltNames} />
        <Row label="Key usage" value={i.keyUsage} />
        <Row label="Extended key usage" value={i.extKeyUsage} />
        {i.basicConstraints && <Row label="Basic constraints" value={`CA: ${i.basicConstraints.ca}${i.basicConstraints.pathLen != null ? `, pathlen: ${i.basicConstraints.pathLen}` : ''}`} cls={i.isCA ? 'text-amber-400' : ''} />}
        <Row label="Subject key id" value={i.subjectKeyIdentifier} />
        <Row label="Authority key id" value={i.authorityKeyIdentifier} />
        <Row label="CRL" value={i.crlDistributionPoints} />
        <Row label="OCSP" value={i.ocsp} />
        <Row label="CA Issuers" value={i.caIssuers} />
        <Row label="Critical exts" value={i.criticalExtensions} />
        <Row label="Policies" value={policies} />
        {nc && <Row label="Name constraints" value={[nc.permitted.length ? `permitted: ${nc.permitted.join(', ')}` : '', nc.excluded.length ? `excluded: ${nc.excluded.join(', ')}` : ''].filter(Boolean).join(' | ') || '(empty)'} />}
        {i.tlsFeatures && i.tlsFeatures.length > 0 && <Row label="TLS feature" value={`${i.tlsFeatures.join(', ')}${i.mustStaple ? ' (OCSP must-staple)' : ''}`} />}
        {i.scts && <Row label="Embedded SCTs" value={i.scts.length ? i.scts.map((t) => `log ${t.logId.slice(0, 16)}… @ ${t.timestamp}`) : '(none decoded)'} />}
        {(i.unknownExtensions || []).map((u) => <Row key={u.oid} label={`Ext ${u.name || u.oid}`} value={`${u.name ? `${u.oid} · ` : ''}${u.critical ? 'critical · ' : ''}${clip(u.hex)}`} />)}
        {hints.length > 0 && <Row label="Weakness hints" value={<ul className="list-disc ml-4 font-sans">{hints.map((h) => <li key={h.text} className={h.level === 'bad' ? 'text-red-400' : 'text-amber-400'}>{h.text}</li>)}</ul>} />}
        {[['SHA-256', fps.sha256], ['SHA-1', fps.sha1], ['SHA-512', fps.sha512], ['SPKI pin (SHA-256, base64)', fps.pin]].map(([l, v]) => <Row key={l} label={l} value={<span>{v} <button onClick={() => copyText(v)} title={`Copy ${l}`} aria-label={`Copy ${l}`} className="ml-1 text-slate-400 hover:text-slate-200 align-middle"><Copy size={10} /></button></span>} />)}
        <Row label="DER size" value={<span>{fps.size} bytes <button onClick={downloadPem} className="ml-2 inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-sans"><Download size={11} /> PEM</button></span>} />
      </tbody>
    </table>
  );
}

function ChainPanel({ bundle, selected, onSelect }) {
  const { infos, chainInfo } = bundle;
  const { chain, unused, problems, valid } = chainInfo;
  const sigBadge = (e) => (e.sig == null ? '' : e.sig.ok === true ? 'signature OK' : e.sig.ok === false ? 'signature FAILED' : 'signature unchecked');
  return (
    <div className="mb-2 border border-slate-800 rounded bg-slate-950 p-2 text-xs">
      <div className="mb-1 flex items-center gap-2 font-sans">
        {valid
          ? <span className="inline-flex items-center gap-1 text-green-400"><ShieldCheck size={14} /> Chain complete and every signature verifies ({chain.length} cert{chain.length === 1 ? '' : 's'}, leaf to root)</span>
          : <span className="inline-flex items-center gap-1 text-red-400"><ShieldAlert size={14} /> Chain has problems</span>}
      </div>
      <p className="text-[10px] text-slate-500 mb-1">Signatures are checked with Web Crypto between the supplied certificates only; no trust store is consulted, so a self-signed root is reported but not trusted.</p>
      <ol className="space-y-1">
        {chain.map((e, n) => {
          const info = infos[e.index];
          return (
            <li key={e.index}>
              <button onClick={() => onSelect(info)} className={`w-full text-left px-2 py-1 rounded border font-mono ${selected === info.der ? 'border-cyan-700 bg-cyan-950/30' : 'border-slate-800 hover:bg-slate-800/60'}`}>
                <span className="text-slate-500">{n === 0 ? 'leaf' : e.selfSigned ? 'root' : 'intermediate'} · cert {e.index}</span> <span className="text-slate-200 break-all">{e.parsed.subject}</span>
                {sigBadge(e) && <span className={`ml-2 ${e.sig.ok === true ? 'text-green-400' : e.sig.ok === false ? 'text-red-400' : 'text-amber-400'}`}>{sigBadge(e)}</span>}
                {e.notes.filter((x) => x.level !== 'info').map((x) => <span key={x.text} className={`ml-2 ${x.level === 'bad' ? 'text-red-400' : 'text-amber-400'}`}>[{x.text}]</span>)}
                {e.selfSigned && <span className="ml-2 text-amber-400">[self-signed]</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {unused.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 items-center font-sans"><span className="text-slate-500">Not in the leaf's chain:</span>
          {unused.map((i) => <button key={i} onClick={() => onSelect(infos[i])} className="px-2 py-0.5 text-[10px] bg-slate-800 border border-slate-700 rounded hover:bg-slate-700">cert {i}</button>)}
        </div>
      )}
      {problems.length > 0 && <ul className="mt-1 list-disc ml-4 text-red-300 font-sans">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>
  );
}

export default function CertInspectWorkbench({ onLogMessage }) {
  const [mode, setMode] = useState('url');
  const [result, setResult] = useState(null); // { parsed, fps, der }
  const [error, setError] = useState('');
  const log = (m) => onLogMessage?.(m);

  // URL / crt.sh
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [certList, setCertList] = useState(null);

  // paste
  const [pasteText, setPasteText] = useState('');

  // bundle (file / paste): every cert, plus the verified chain
  const [bundle, setBundle] = useState(null); // { infos: [info], chainInfo, selected }
  const [expectHost, setExpectHost] = useState('');

  const clearStale = () => { setCertList(null); setBundle(null); };

  const show = async (der, note, { keepBundle = false } = {}) => {
    try { setResult(await buildInfo(der)); setError(''); if (note) log(note); }
    catch (e) { setError(e.message); setResult(null); clearStale(); log(`Cert parse error: ${e.message}`); }
    if (!keepBundle) setBundle(null);
  };

  // Load every certificate of a PEM bundle / PKCS#7 / single DER, order and verify the chain.
  const showBundle = async (ders, note) => {
    try {
      if (!ders.length) throw new Error('No certificates found in the input.');
      const infos = [];
      for (const d of ders) infos.push(await buildInfo(d));
      const chainInfo = await buildChain(ders);
      const first = chainInfo.chain[0]?.index ?? 0;
      setBundle({ infos, chainInfo });
      setResult(infos[first]); setError(''); setCertList(null);
      log(`${note} (${infos.length} certificate${infos.length === 1 ? '' : 's'}; chain ${chainInfo.valid ? 'valid' : 'has problems'})`);
    } catch (e) { setError(e.message); setResult(null); clearStale(); log(`Cert parse error: ${e.message}`); }
  };

  // --- URL mode ---
  const lookup = async () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
    if (!h) return;
    setBusy(true); setError(''); setCertList(null); setResult(null);
    log(`crt.sh certificates for ${h}${isProxyEnabled() ? ' (via proxy)' : ''}…`);
    try {
      const resp = await proxiedFetch(`https://crt.sh/?q=${encodeURIComponent(h)}&output=json`, { headers: { accept: 'application/json' } });
      const text = await resp.text();
      let rows;
      try { rows = JSON.parse(text); } catch { throw new Error('crt.sh did not return JSON (rate-limited or proxy issue). Retry shortly.'); }
      const seen = new Set();
      const list = rows
        .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
        .sort((a, b) => new Date(b.not_before) - new Date(a.not_before))
        .slice(0, 25);
      setCertList(list);
      log(`crt.sh: ${list.length} recent certificate(s)`);
      if (list[0]) loadById(list[0].id);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  // Live certificate via the TLS backend — what the server serves right now.
  const liveLookup = async () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
    if (!h) return;
    setBusy(true); setError(''); setCertList(null); setResult(null);
    log(`Live TLS certificate for ${h} (TLS backend)…`);
    try {
      const data = await tlsCert({ host: h, port: 443 });
      if (!data.pem) throw new Error('Backend returned no PEM (update the tls-inspector image).');
      await show(toDER(data.pem), `Live certificate for ${h} (${data.protocol || 'TLS'})`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const loadById = async (id) => {
    setBusy(true);
    try {
      const resp = await proxiedFetch(`https://crt.sh/?d=${id}`, { headers: { accept: 'application/x-pem-file' } });
      const pem = await resp.text();
      await show(toDER(pem), `Loaded crt.sh certificate #${id}`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  // --- File mode ---
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => { setError('Could not read the file.'); setResult(null); clearStale(); };
    reader.onload = async (ev) => {
      let ders;
      try { ders = loadCertificateBundle(new Uint8Array(ev.target.result)); }
      catch (err) { setError(err.message); setResult(null); clearStale(); log(`Cert parse error: ${err.message}`); return; }
      await showBundle(ders, `Parsed ${file.name}`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // --- Paste mode ---
  const parsePaste = async () => {
    if (!pasteText.trim()) return;
    let ders;
    try { ders = loadCertificateBundle(pasteText); }
    catch (err) { setError(err.message); setResult(null); clearStale(); log(`Cert parse error: ${err.message}`); return; }
    await showBundle(ders, 'Parsed pasted certificate(s)');
  };

  const hostCheck = result && expectHost.trim() ? matchHostname(result.parsed, expectHost) : null;

  const TABS = [{ id: 'url', label: 'From URL', icon: Globe }, { id: 'file', label: 'From file', icon: FileUp }, { id: 'paste', label: 'Paste PEM', icon: ClipboardPaste }];

  return (
    <div className="text-gray-200 text-xs">
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit mb-2">
        {TABS.map((t) => { const Icon = t.icon; return (
          <button key={t.id} onClick={() => { setMode(t.id); setError(''); }} className={`px-2.5 py-1 inline-flex items-center gap-1.5 ${mode === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
            <Icon size={13} /> {t.label}
          </button>
        ); })}
      </div>

      {mode === 'url' && (
        <div className="mb-2">
          <ProxyConfig onLogMessage={log} backend="tls-inspector" />
          <div className="flex flex-wrap gap-2">
            <input value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && lookup()} placeholder="example.com" className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono" />
            <button onClick={lookup} disabled={busy} className="px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Fetch certs
            </button>
            {isBackendConfigured('tls-inspector') && (
              <button onClick={liveLookup} disabled={busy} title="Fetch the certificate the server serves right now, via the TLS backend" className="px-2.5 py-1 bg-emerald-900/40 border border-emerald-800 text-emerald-200 rounded text-xs hover:bg-emerald-900/60 disabled:opacity-50 inline-flex items-center gap-1">
                <ShieldCheck size={14} /> Live cert
              </button>
            )}
          </div>
          <details className="mt-1 text-[10px] text-slate-500"><summary className="cursor-pointer">About these results</summary><p className="mt-0.5">Certificates come from Certificate Transparency logs (crt.sh) and are the most recent <em>issued</em> for the host — this may differ from what the server serves right now. Requires the proxy (crt.sh sends no CORS headers).</p></details>
          {certList && certList.length > 0 && (
            <div className="mt-2 border border-slate-800 rounded bg-slate-950 max-h-40 overflow-auto text-[11px] font-mono">
              {certList.map((c) => (
                <button key={c.id} onClick={() => loadById(c.id)} className="w-full text-left px-2 py-1 border-b border-slate-900 last:border-0 hover:bg-slate-800/60">
                  <span className="text-cyan-400">#{c.id}</span> <span className="text-slate-400">{(c.name_value || '').split('\n')[0]}</span> <span className="text-slate-600">· {String(c.not_before).slice(0, 10)} → {String(c.not_after).slice(0, 10)}</span>
                </button>
              ))}
            </div>
          )}
          {certList && certList.length === 0 && <div className="text-xs text-slate-500 mt-2">No certificates found for that host in CT logs.</div>}
        </div>
      )}

      {mode === 'file' && (
        <div className="mb-2">
          <p className="text-[10px] text-slate-500 mb-1">Every certificate in a PEM bundle or PKCS#7 (.p7b) file is loaded and the chain is verified.</p>
          <input type="file" accept=".pem,.crt,.cer,.der,.p7b,.p7c,.pb7" onChange={handleFile} className="bg-slate-900 border border-slate-800 rounded p-1 text-gray-200 text-xs" />
        </div>
      )}

      {mode === 'paste' && (
        <div className="mb-2">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[11px] font-mono resize-y" />
          <button onClick={parsePaste} className="mt-1 px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 inline-flex items-center gap-1"><ClipboardPaste size={14} /> Parse</button>
        </div>
      )}

      {bundle && <ChainPanel bundle={bundle} selected={result?.der} onSelect={(info) => { setResult(info); setError(''); }} />}

      {error && <p className="text-red-400 text-xs font-mono mb-2">Error: {error}</p>}

      {result && (
        <div className="font-mono text-xs">
          <div className="mb-2 flex items-center gap-2 font-sans">
            {result.parsed.expired || result.parsed.notYetValid
              ? <span className="inline-flex items-center gap-1 text-red-400"><ShieldAlert size={15} /> {result.parsed.expired ? 'Expired' : 'Not yet valid'}</span>
              : <span className="inline-flex items-center gap-1 text-green-400"><ShieldCheck size={15} /> Valid{result.parsed.daysUntilExpiry <= 30 ? ` — expires in ${result.parsed.daysUntilExpiry} day(s)` : ''}</span>}
          </div>
          <div className="mb-2 font-sans flex flex-wrap items-center gap-2">
            <input value={expectHost} onChange={(e) => setExpectHost(e.target.value)} placeholder="check hostname or IP against this certificate" className="flex-1 min-w-[14rem] max-w-md bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono" />
            {hostCheck && (
              <span className={`text-xs ${hostCheck.match ? 'text-green-400' : 'text-red-400'}`}>
                {hostCheck.match ? `Match: ${hostCheck.matchedName} (${hostCheck.via})` : `No match: ${hostCheck.reason}`}
              </span>
            )}
          </div>
          <div className="mb-2 space-y-2"><Timeline parsed={result.parsed} /><Tools parsed={result.parsed} fps={result.fps} expectHost={expectHost} /></div>
          <CertDetails {...result} />
        </div>
      )}
    </div>
  );
}
