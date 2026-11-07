import React, { useState } from 'react';
import { Globe, FileUp, ClipboardPaste, Search, RefreshCw, ShieldCheck, ShieldAlert, Download } from 'lucide-react';
import { parseCertificate, toDER, splitPemChain } from '../../utils/x509';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import { isBackendConfigured, tlsCert } from '../../utils/backendClient';
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

async function fingerprint(der, alg) {
  const buf = await crypto.subtle.digest(alg, der);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

async function buildInfo(der) {
  const parsed = parseCertificate(der);
  const fps = { sha256: await fingerprint(der, 'SHA-256'), sha1: await fingerprint(der, 'SHA-1'), size: der.length };
  return { parsed, fps, der };
}

function Row({ label, value, cls = '' }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return <tr><td className="p-1 border border-slate-700 bg-slate-800 text-slate-200 align-top whitespace-nowrap">{label}</td><td className={`p-1 border border-slate-700 break-all ${cls}`}>{Array.isArray(value) ? value.join(', ') : value}</td></tr>;
}

function CertDetails({ parsed: i, fps, der }) {
  const statusCls = i.expired || i.notYetValid ? 'text-red-400' : 'text-green-400';
  const expCls = i.expired ? 'text-red-400' : i.daysUntilExpiry <= 30 ? 'text-amber-400' : 'text-green-400';
  const pk = i.publicKey || {};
  const pkStr = `${pk.algorithm}${pk.bits ? ` ${pk.bits}-bit` : ''}${pk.curve ? ` ${pk.curve}` : ''}${pk.exponent ? ` (e=${pk.exponent})` : ''}`;
  const downloadPem = () => {
    const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
    const pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' })); a.download = 'certificate.pem'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <table className="w-full border-collapse text-sm">
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
        <Row label="SHA-256" value={fps.sha256} />
        <Row label="SHA-1" value={fps.sha1} />
        <Row label="DER size" value={<span>{fps.size} bytes <button onClick={downloadPem} className="ml-2 inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-sans"><Download size={11} /> PEM</button></span>} />
      </tbody>
    </table>
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
  const [chain, setChain] = useState([]);

  const show = async (der, note) => {
    try { setResult(await buildInfo(der)); setError(''); if (note) log(note); }
    catch (e) { setError(e.message); setResult(null); log(`Cert parse error: ${e.message}`); }
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
    reader.onload = async (ev) => {
      const bytes = new Uint8Array(ev.target.result);
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
      const der = head.includes('-----BEGIN') ? toDER(new TextDecoder().decode(bytes)) : bytes;
      await show(der, `Parsed ${file.name}`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // --- Paste mode ---
  const parsePaste = async () => {
    const blocks = splitPemChain(pasteText);
    if (blocks.length === 0) { if (pasteText.trim()) { await show(toDER(pasteText), 'Parsed pasted certificate'); setChain([]); } return; }
    setChain(blocks);
    await show(toDER(blocks[0]), `Parsed pasted certificate (chain of ${blocks.length})`);
  };

  const TABS = [{ id: 'url', label: 'From URL', icon: Globe }, { id: 'file', label: 'From file', icon: FileUp }, { id: 'paste', label: 'Paste PEM', icon: ClipboardPaste }];

  return (
    <div className="p-4 text-gray-200">
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit mb-3">
        {TABS.map((t) => { const Icon = t.icon; return (
          <button key={t.id} onClick={() => { setMode(t.id); setError(''); }} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${mode === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
            <Icon size={13} /> {t.label}
          </button>
        ); })}
      </div>

      {mode === 'url' && (
        <div className="mb-3">
          <ProxyConfig onLogMessage={log} backend="tls-inspector" />
          <div className="flex flex-wrap gap-2">
            <input value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && lookup()} placeholder="example.com" className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
            <button onClick={lookup} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Fetch certs
            </button>
            {isBackendConfigured('tls-inspector') && (
              <button onClick={liveLookup} disabled={busy} title="Fetch the certificate the server serves right now, via the TLS backend" className="px-3 py-1.5 bg-emerald-900/40 border border-emerald-800 text-emerald-200 rounded text-sm hover:bg-emerald-900/60 disabled:opacity-50 inline-flex items-center gap-1">
                <ShieldCheck size={14} /> Live cert
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">Certificates come from Certificate Transparency logs (crt.sh) and are the most recent <em>issued</em> for the host — this may differ from what the server serves right now. Requires the proxy (crt.sh sends no CORS headers).</p>
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
        <div className="mb-3">
          <input type="file" accept=".pem,.crt,.cer,.der" onChange={handleFile} className="bg-slate-900 border border-slate-800 rounded p-1 text-gray-200 text-xs" />
        </div>
      )}

      {mode === 'paste' && (
        <div className="mb-3">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[11px] font-mono resize-y" />
          <button onClick={parsePaste} className="mt-1 px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 inline-flex items-center gap-1"><ClipboardPaste size={14} /> Parse</button>
          {chain.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {chain.map((b, idx) => <button key={idx} onClick={() => show(toDER(b), `Chain cert ${idx}`)} className="px-2 py-0.5 text-[10px] bg-slate-800 border border-slate-700 rounded hover:bg-slate-700">cert {idx}{idx === 0 ? ' (leaf)' : ''}</button>)}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs font-mono mb-2">Error: {error}</p>}

      {result && (
        <div className="font-mono text-xs">
          <div className="mb-2 flex items-center gap-2 font-sans">
            {result.parsed.expired || result.parsed.notYetValid
              ? <span className="inline-flex items-center gap-1 text-red-400"><ShieldAlert size={15} /> {result.parsed.expired ? 'Expired' : 'Not yet valid'}</span>
              : <span className="inline-flex items-center gap-1 text-green-400"><ShieldCheck size={15} /> Valid{result.parsed.daysUntilExpiry <= 30 ? ` — expires in ${result.parsed.daysUntilExpiry} day(s)` : ''}</span>}
          </div>
          <CertDetails {...result} />
        </div>
      )}
    </div>
  );
}
