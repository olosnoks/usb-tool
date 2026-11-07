import React, { useState, useEffect, useCallback } from 'react';
import { Hash, Copy, Check, FileUp } from 'lucide-react';
import { md5Hex } from '../../utils/md5.js';

/**
 * Hash & HMAC calculator — fully client-side. Digests text or a file with
 * MD5 (local implementation), SHA-1/256/384/512 (Web Crypto), and optional
 * HMAC using a key (SHA family via Web Crypto). Nothing is uploaded.
 */

const SHA = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-384': 'SHA-384', 'SHA-512': 'SHA-512' };

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function digestAll(bytes, hmacKeyBytes) {
  const out = {};
  out.MD5 = md5Hex(bytes);
  for (const name of Object.keys(SHA)) {
    if (hmacKeyBytes) {
      try {
        const key = await crypto.subtle.importKey('raw', hmacKeyBytes, { name: 'HMAC', hash: name }, false, ['sign']);
        out[`HMAC-${name}`] = toHex(await crypto.subtle.sign('HMAC', key, bytes));
      } catch { /* skip */ }
    } else {
      out[name] = toHex(await crypto.subtle.digest(name, bytes));
    }
  }
  return out;
}

function HashRow({ name, value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  return (
    <div className="py-1 border-b border-slate-900 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-cyan-400 font-semibold">{name}</span>
        <button onClick={copy} className="text-slate-600 hover:text-cyan-400">{copied ? <Check size={11} /> : <Copy size={11} />}</button>
      </div>
      <div className="font-mono text-[11px] text-gray-300 break-all">{value}</div>
    </div>
  );
}

export default function HashCalculatorWorkbench({ onLogMessage }) {
  const [text, setText] = useState('');
  const [hmacKey, setHmacKey] = useState('');
  const [useHmac, setUseHmac] = useState(false);
  const [fileInfo, setFileInfo] = useState(null);
  const [hashes, setHashes] = useState(null);
  const [busy, setBusy] = useState(false);

  const compute = useCallback(async (bytes, label) => {
    setBusy(true);
    const keyBytes = useHmac && hmacKey ? new TextEncoder().encode(hmacKey) : null;
    const res = await digestAll(bytes, keyBytes);
    setHashes(res);
    setBusy(false);
    onLogMessage?.(`Hashed ${label} (${bytes.length} bytes)${keyBytes ? ' with HMAC' : ''}`);
  }, [useHmac, hmacKey, onLogMessage]);

  // live-hash the text input
  useEffect(() => {
    if (fileInfo) return; // file mode takes over until cleared
    const bytes = new TextEncoder().encode(text);
    const keyBytes = useHmac && hmacKey ? new TextEncoder().encode(hmacKey) : null;
    let cancelled = false;
    digestAll(bytes, keyBytes).then((res) => { if (!cancelled) setHashes(res); });
    return () => { cancelled = true; };
  }, [text, useHmac, hmacKey, fileInfo]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFileInfo({ name: file.name, size: file.size });
    compute(bytes, file.name);
  };

  const clearFile = () => { setFileInfo(null); };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Input</span>
            <label className="inline-flex items-center gap-1 text-[11px] text-cyan-300 cursor-pointer hover:text-cyan-200">
              <FileUp size={12} /> Hash a file
              <input type="file" className="hidden" onChange={onFile} />
            </label>
          </div>
          {fileInfo ? (
            <div className="bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono flex items-center justify-between">
              <span className="text-gray-300 truncate">{fileInfo.name} · {(fileInfo.size / 1024).toFixed(1)} KB</span>
              <button onClick={clearFile} className="text-slate-500 hover:text-gray-200 text-[11px]">use text</button>
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder="type or paste text to hash live"
              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono resize-y"
            />
          )}
          <label className="flex items-center gap-2 mt-2 text-xs text-gray-300">
            <input type="checkbox" checked={useHmac} onChange={(e) => setUseHmac(e.target.checked)} />
            HMAC mode (keyed)
          </label>
          {useHmac && (
            <input
              value={hmacKey}
              onChange={(e) => setHmacKey(e.target.value)}
              placeholder="HMAC secret key"
              className="w-full mt-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
            />
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Digests {useHmac && <span className="text-amber-400">· HMAC (MD5 shown unkeyed)</span>} {busy && <span className="text-slate-500">· …</span>}
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2">
            {hashes
              ? Object.entries(hashes).map(([k, v]) => <HashRow key={k} name={k} value={v} />)
              : <div className="text-slate-600 text-xs">—</div>}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">MD5 and SHA-1 are broken for security use — fine for checksums/interop only. HMAC uses the SHA family via Web Crypto.</p>
        </div>
      </div>
    </div>
  );
}
