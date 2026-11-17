import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, Check, Trash2, Copy } from 'lucide-react';

// Per-vendor API keys for the OSINT clients. Kept in localStorage and sent only
// to that vendor (through the configured proxy, if any).
const KEY_STORE = {
  shodan: 'skon.osint.shodanKey',
  urlscan: 'skon.osint.urlscanKey',
  hackertarget: 'skon.osint.htKey',
  hibp: 'skon.breach.hibpKey',
};

export const getKey = (s) => { try { return localStorage.getItem(KEY_STORE[s]) || ''; } catch { return ''; } };
export const setKey = (s, v) => { try { v ? localStorage.setItem(KEY_STORE[s], v) : localStorage.removeItem(KEY_STORE[s]); } catch { /* ignore */ } };

export function ApiKeyField({ service, label, required, hint }) {
  const [val, setVal] = useState(getKey(service));
  const [stored, setStored] = useState(getKey(service));
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const save = () => { setKey(service, val.trim()); setStored(val.trim()); setSaved(true); setTimeout(() => setSaved(false), 1400); };
  const clear = () => { setKey(service, ''); setVal(''); setStored(''); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(val.trim()); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
  };
  const dirty = val.trim() !== stored;
  return (
    <div className="mb-3 p-2 border border-slate-800 rounded bg-slate-900/50">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
          <KeyRound size={13} /> {label} API key {required ? <span className="text-red-400">*</span> : <span className="text-slate-500 font-normal">(optional)</span>}
        </label>
        <span className="text-[10px]">
          {stored
            ? <span className="text-emerald-400 inline-flex items-center gap-1"><Check size={11} /> key saved in this browser</span>
            : <span className="text-slate-500">no key saved</span>}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={`paste your ${label} API key here`}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-gray-200"
        />
        <button onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'} className="px-2 py-1.5 bg-slate-800 rounded hover:bg-slate-700 text-gray-300">
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button onClick={copy} disabled={!val.trim()} title="Copy key to clipboard" className="px-2 py-1.5 bg-slate-800 rounded hover:bg-slate-700 text-gray-300 disabled:opacity-40">
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        </button>
        <button onClick={save} disabled={!dirty} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-40">
          {saved ? 'Saved ✓' : 'Save'}
        </button>
        {stored && (
          <button onClick={clear} title="Remove saved key" className="px-2 py-1.5 bg-slate-800 rounded hover:bg-red-900/50 text-slate-400 hover:text-red-300">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
