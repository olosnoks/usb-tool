import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Nfc, Download, Copy, Check, Trash2, Lock, TriangleAlert, Play, Square, History, Plus, ArrowUp, ArrowDown, X, FileDown, Eye, EyeOff } from 'lucide-react';
import {
  COMPOSER_KINDS, WSC_AUTH, WSC_ENC, buildNdefFromSpecs, buildWebNfcMessage, bytesToHex, decodeNdefRecords,
  describeRecord, fromWebNfcEvent, hexToBytes, readNdefInput, wrapType2Tlv,
} from '../../utils/webNfc.js';

/**
 * Web NFC reader/writer (NDEFReader, Chrome for Android only) plus an offline NDEF
 * parser/builder. Every reading shown here came from a tag the user scanned on their
 * phone, or from hex the user pasted. Nothing is simulated.
 */

const TABS = [['read', 'Read tag'], ['write', 'Write tag'], ['offline', 'Offline NDEF']];
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-gray-200 w-full';
const btnBase = 'px-3 py-1.5 rounded text-xs border inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed';
const btnEmerald = `${btnBase} border-emerald-800 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-900/50`;
const btnSlate = `${btnBase} border-slate-700 bg-slate-800 text-gray-200 hover:bg-slate-700`;
const btnRose = `${btnBase} border-rose-800 bg-rose-900/30 text-rose-200 hover:bg-rose-900/50`;

// One entry per input field: key (spec field), label, input type, default value, optional placeholder/options.
const FIELD_DEFS = {
  text: [
    { key: 'text', label: 'Text', type: 'textarea', def: 'Hello from Web NFC' },
    { key: 'lang', label: 'Language (BCP-47)', type: 'text', def: 'en', ph: 'en' },
  ],
  url: [{ key: 'uri', label: 'URL (absolute)', type: 'text', def: 'https://example.com', ph: 'https://example.com' }],
  wifi: [
    { key: 'ssid', label: 'SSID', type: 'text', def: '' },
    { key: 'key', label: 'Passphrase (8-63 printable ASCII; blank for open)', type: 'password', def: '' },
    { key: 'auth', label: 'Auth type', type: 'select', options: Object.keys(WSC_AUTH), def: 'wpa2' },
    { key: 'encryption', label: 'Encryption', type: 'select', options: Object.keys(WSC_ENC), def: 'aes' },
  ],
  vcard: [
    { key: 'name', label: 'Name', type: 'text', def: '' },
    { key: 'org', label: 'Organization', type: 'text', def: '' },
    { key: 'title', label: 'Title', type: 'text', def: '' },
    { key: 'phone', label: 'Phone', type: 'text', def: '' },
    { key: 'email', label: 'Email', type: 'text', def: '' },
    { key: 'vurl', label: 'Website', type: 'text', def: '' },
  ],
  json: [{ key: 'text', label: 'JSON text', type: 'textarea', def: '{"hello":"world"}' }],
  android: [{ key: 'pkg', label: 'Package name', type: 'text', def: 'com.example.app', ph: 'com.example.app' }],
  'raw-mime': [
    { key: 'mediaType', label: 'MIME type', type: 'text', def: 'application/x-test', ph: 'application/x-test' },
    { key: 'hex', label: 'Payload (hex)', type: 'textarea', def: '01 02 03' },
  ],
  'raw-external': [
    { key: 'type', label: 'External type (domain:name)', type: 'text', def: 'example.com:thing', ph: 'example.com:thing' },
    { key: 'hex', label: 'Payload (hex)', type: 'textarea', def: '01 02 03' },
  ],
};

function defaultFields(kind) {
  const f = {};
  for (const d of FIELD_DEFS[kind] || []) f[d.key] = d.def;
  return f;
}

/** Converts a composer entry into the spec shape used by webNfc.js. */
function toSpec(entry) {
  const f = entry.f;
  if (entry.kind === 'vcard') {
    return { kind: 'vcard', fields: { name: f.name, org: f.org, title: f.title, phone: f.phone, email: f.email, url: f.vurl } };
  }
  return { kind: entry.kind, ...f };
}

function getNfcSupport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ok: false, android: false, reason: 'No browser window is available.' };
  const secure = !!window.isSecureContext;
  const android = /Android/i.test(navigator.userAgent || '');
  if (!secure) return { ok: false, android, reason: 'Web NFC needs a secure (HTTPS) page. Open this tool over HTTPS.' };
  if ('NDEFReader' in window) return { ok: true, android, reason: '' };
  return {
    ok: false,
    android,
    reason: android
      ? 'This Android browser does not expose Web NFC. Use Chrome for Android (version 89 or newer) and turn NFC on in the Android settings.'
      : 'Web NFC is only available in Chrome for Android. This desktop browser has no NDEFReader, so phone-style NFC tags cannot be read or written here. For 13.56 MHz tags on a PC use the Proxmark3 / PM5 Suite or Flipper Zero Suite tabs.',
  };
}

function describeNfcError(e) {
  const name = e?.name || '';
  if (name === 'AbortError') return 'Stopped.';
  if (name === 'NotAllowedError') return 'Permission denied. NFC needs a user tap on this page and the NFC permission; allow it and try again.';
  if (name === 'NotSupportedError') return 'Not supported: this tag or operation is not supported by Web NFC (for example a read-only or incompatible tag).';
  if (name === 'NotReadableError') return 'The tag could not be read or written. Hold it still on the back of the phone, or turn NFC on in Android settings.';
  if (name === 'NetworkError') return 'The write did not complete. Keep the tag on the phone until the write finishes, then try again.';
  if (name === 'NotFoundError') return 'No compatible tag was found in range.';
  return e?.message || String(e);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(String(text));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <button type="button" onClick={copy} className="text-[10px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
      {copied ? <Check size={10} /> : <Copy size={10} />} {label}
    </button>
  );
}

function WscView({ wsc }) {
  const [reveal, setReveal] = useState(false);
  const rows = [
    ['SSID', wsc.ssid],
    ['Auth', wsc.authName],
    ['Encryption', wsc.encryptionName],
    ['Network index', wsc.networkIndex ?? ''],
  ];
  return (
    <div className="text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 py-0.5 border-b border-slate-900 last:border-0">
          <span className="w-28 shrink-0 text-slate-500">{k}</span>
          <span className="font-mono text-gray-200 break-all">{String(v)}</span>
        </div>
      ))}
      <div className="flex gap-2 py-0.5">
        <span className="w-28 shrink-0 text-slate-500">Network key</span>
        <span className="font-mono text-gray-200 break-all">{reveal ? wsc.networkKey || '(none)' : wsc.networkKey ? '********' : '(none)'}</span>
        {wsc.networkKey && (
          <button type="button" onClick={() => setReveal((r) => !r)} className="text-[10px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
            {reveal ? <EyeOff size={10} /> : <Eye size={10} />} {reveal ? 'hide' : 'reveal'}
          </button>
        )}
      </div>
    </div>
  );
}

function RecordView({ rec, index = 0, depth = 0 }) {
  const badge = (t) => <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">{t}</span>;
  const download = () => {
    const bytes = hexToBytes(rec.hex || '');
    downloadBlob(`nfc-record-${index + 1}.bin`, new Blob([bytes], { type: rec.mediaType || 'application/octet-stream' }));
  };
  let body = null;
  switch (rec.kind) {
    case 'text':
      body = <pre className="whitespace-pre-wrap break-words text-xs text-gray-200 font-sans">{rec.text || '(empty text)'}</pre>;
      break;
    case 'uri':
      body = (
        <div className="flex items-start gap-2">
          <span className="font-mono text-xs text-cyan-200 break-all flex-1">{rec.uri}</span>
          <CopyButton text={rec.uri} />
        </div>
      );
      break;
    case 'json':
      body = <pre className="whitespace-pre-wrap break-all text-xs text-gray-200 font-mono max-h-64 overflow-auto">{rec.text}</pre>;
      break;
    case 'wsc':
      body = <WscView wsc={rec.wsc} />;
      break;
    case 'android-app':
      body = <div className="font-mono text-xs text-gray-200">Android app package: <span className="text-emerald-200">{rec.pkg}</span></div>;
      break;
    case 'external':
      body = <div className="font-mono text-xs text-gray-300">External type <span className="text-amber-200">{rec.externalType}</span></div>;
      break;
    case 'smart-poster':
      body = (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-400">Smart poster with {rec.records.length} nested record(s)</div>
          {rec.records.map((r, i) => <RecordView key={i} rec={r} index={i} depth={depth + 1} />)}
        </div>
      );
      break;
    case 'empty':
      body = <div className="text-xs text-slate-500">Empty record (TNF 0)</div>;
      break;
    default:
      body = (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
          <span>{rec.note || (rec.kind === 'text' ? '' : 'Raw payload shown as hex.')}</span>
          {rec.size > 0 && (
            <button type="button" onClick={download} className="text-[10px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
              <Download size={10} /> Download payload
            </button>
          )}
        </div>
      );
  }
  if (rec.kind === 'text' && rec.note) body = <>{body}<div className="text-[10px] text-amber-300 mt-1">{rec.note}</div></>;
  return (
    <div className={`border border-slate-800 rounded p-2 bg-slate-950/60 ${depth ? 'ml-4' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <span className="text-emerald-300 font-mono text-[11px] break-all">{rec.recordType}</span>
        {rec.mediaType && badge(rec.mediaType)}
        {rec.lang && badge(`lang ${rec.lang}`)}
        {rec.encoding && rec.kind === 'text' && badge(rec.encoding)}
        {rec.id && badge(`id ${rec.id}`)}
        {badge(`${rec.size} B`)}
        <span className="ml-auto text-[10px] text-slate-500">{rec.kind}</span>
      </div>
      {body}
      {rec.kind !== 'smart-poster' && rec.size > 0 && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-slate-500 cursor-pointer">payload hex ({rec.size} bytes)</summary>
          <div className="font-mono text-[10px] break-all text-slate-400 max-h-40 overflow-auto mt-1">{rec.hex}</div>
        </details>
      )}
    </div>
  );
}

function ReadTab({ support, scanning, scanError, onStart, onStop, last, history, selectedId, setSelectedId, onExport, onClear }) {
  const shown = history.find((h) => h.id === selectedId) || last;
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_280px]">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {!scanning ? (
            <button type="button" onClick={onStart} disabled={!support.ok} className={btnEmerald}><Play size={12} /> Start scanning</button>
          ) : (
            <button type="button" onClick={onStop} className={btnRose}><Square size={12} /> Stop scanning</button>
          )}
          <span className={`text-xs ${scanning ? 'text-emerald-300' : 'text-slate-500'}`}>
            {scanning ? 'Listening. Hold an NFC tag against the back of the phone.' : 'Idle. Scanning starts only from this button (Web NFC needs a user gesture).'}
          </span>
        </div>
        {scanError && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{scanError}</div>}
        {!shown && <div className="p-4 border border-dashed border-slate-800 rounded text-xs text-slate-500">No tag read yet in this session.</div>}
        {shown && (
          <div className="bg-slate-900/60 border border-slate-800 rounded p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Serial (UID)</span>
              <span className="font-mono text-cyan-300">{shown.serialNumber || '(not provided by the browser)'}</span>
              <span className="text-slate-600 ml-auto font-mono">{new Date(shown.at).toLocaleString()}</span>
            </div>
            {shown.records.length === 0 && <div className="text-xs text-slate-500">The tag holds no NDEF records.</div>}
            {shown.records.map((r, i) => <RecordView key={i} rec={r} index={i} />)}
          </div>
        )}
      </div>
      <aside className="bg-slate-900/60 border border-slate-800 rounded p-3 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-300 inline-flex items-center gap-1.5"><History size={12} /> Scan history ({history.length})</span>
          <div className="flex gap-2">
            <button type="button" onClick={onExport} disabled={!history.length} className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-40 inline-flex items-center gap-1"><FileDown size={10} /> JSON</button>
            <button type="button" onClick={onClear} disabled={!history.length} className="text-[10px] text-slate-400 hover:text-rose-300 disabled:opacity-40 inline-flex items-center gap-1"><Trash2 size={10} /> Clear</button>
          </div>
        </div>
        {!history.length && <div className="text-[11px] text-slate-600">Each successful read is added here with its time.</div>}
        <ul className="space-y-1 max-h-[420px] overflow-auto">
          {history.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setSelectedId(h.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] border ${shown && shown.id === h.id ? 'border-emerald-700 bg-emerald-900/20' : 'border-slate-800 hover:bg-slate-800'}`}
              >
                <div className="flex justify-between gap-2 font-mono text-slate-300">
                  <span className="truncate">{h.serialNumber || 'no uid'}</span>
                  <span className="text-slate-500 shrink-0">{new Date(h.at).toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-500 truncate">{h.records.map((r) => r.recordType).join(', ') || 'no records'}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function ComposerRow({ entry, index, count, onChange, onRemove, onMove }) {
  const defs = FIELD_DEFS[entry.kind] || [];
  const setField = (key, value) => onChange({ ...entry, f: { ...entry.f, [key]: value } });
  return (
    <div className="border border-slate-800 rounded p-2 bg-slate-950/60 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-500 font-mono w-5">{index + 1}.</span>
        <select
          value={entry.kind}
          aria-label={`Record ${index + 1} type`}
          onChange={(e) => onChange({ id: entry.id, kind: e.target.value, f: defaultFields(e.target.value) })}
          className={`${inputCls} w-auto`}
        >
          {COMPOSER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move record up" className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"><ArrowUp size={12} /></button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move record down" className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"><ArrowDown size={12} /></button>
          <button type="button" onClick={onRemove} aria-label="Remove record" className="p-1 text-slate-400 hover:text-rose-300"><X size={12} /></button>
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {defs.map((d) => (
          <label key={d.key} className={`text-[10px] text-slate-500 ${d.type === 'textarea' ? 'md:col-span-2' : ''}`}>
            {d.label}
            {d.type === 'textarea' && (
              <textarea rows={2} value={entry.f[d.key] ?? ''} onChange={(e) => setField(d.key, e.target.value)} className={`${inputCls} mt-0.5`} spellCheck={false} />
            )}
            {d.type === 'select' && (
              <select value={entry.f[d.key] ?? ''} onChange={(e) => setField(d.key, e.target.value)} className={`${inputCls} mt-0.5`}>
                {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {(d.type === 'text' || d.type === 'password') && (
              <input type={d.type} value={entry.f[d.key] ?? ''} placeholder={d.ph || ''} onChange={(e) => setField(d.key, e.target.value)} className={`${inputCls} mt-0.5`} spellCheck={false} autoComplete="off" />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function WriteTab({ support, entries, setEntries, overwrite, setOverwrite, preview, writing, writeStatus, writeError, onWrite, onAbort, lockState, setLockState, onLock }) {
  const addEntry = () => setEntries((list) => [...list, { id: `r${Date.now()}${list.length}`, kind: 'text', f: defaultFields('text') }]);
  const updateEntry = (i, next) => setEntries((list) => list.map((e, j) => (j === i ? next : e)));
  const removeEntry = (i) => setEntries((list) => list.filter((_, j) => j !== i));
  const moveEntry = (i, d) => setEntries((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const sizeNote = preview.size > 888 ? 'Larger than NTAG216 (888 bytes); no common NTAG fits this.'
    : preview.size > 504 ? 'Needs an NTAG216 (888 bytes); NTAG213/215 are too small.'
      : preview.size > 144 ? 'Needs an NTAG215 (504 bytes) or NTAG216; NTAG213 holds 144 bytes.'
        : preview.size > 0 ? 'Fits NTAG213 (144 bytes) and larger tags.' : '';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="text-xs text-slate-400">Compose the NDEF message. Records are written in this order.</div>
        {entries.length === 0 && <div className="text-xs text-slate-600">No records. Add one below.</div>}
        {entries.map((e, i) => (
          <ComposerRow
            key={e.id}
            entry={e}
            index={i}
            count={entries.length}
            onChange={(next) => updateEntry(i, next)}
            onRemove={() => removeEntry(i)}
            onMove={(d) => moveEntry(i, d)}
          />
        ))}
        <button type="button" onClick={addEntry} className={btnSlate}><Plus size={12} /> Add record</button>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded p-3 space-y-2">
        <div className="text-xs text-slate-300">Message preview (built offline)</div>
        {preview.error && <div className="text-xs text-amber-300">{preview.error}</div>}
        {!preview.error && preview.size === 0 && <div className="text-xs text-slate-600">Add a record to see the bytes.</div>}
        {!preview.error && preview.size > 0 && (
          <>
            <div className="text-[11px] text-slate-400">{preview.size} bytes. {sizeNote}</div>
            <div className="font-mono text-[10px] break-all text-slate-400 max-h-24 overflow-auto">{preview.hex}</div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite existing NDEF data (off: the write is refused if the tag already holds NDEF)
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!writing ? (
          <button type="button" onClick={onWrite} disabled={!support.ok || !!preview.error || preview.size === 0} className={btnEmerald}><Nfc size={12} /> Write to tag</button>
        ) : (
          <button type="button" onClick={onAbort} className={btnRose}><Square size={12} /> Abort write</button>
        )}
        <span className="text-xs text-slate-500">{writing ? 'Keep the tag held against the phone...' : writeStatus}</span>
      </div>
      {writeError && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{writeError}</div>}

      <div className="border border-rose-900 rounded p-3 bg-rose-950/20 space-y-2">
        <div className="text-xs text-rose-200 inline-flex items-center gap-1.5"><TriangleAlert size={12} /> Make tag read-only (permanent)</div>
        {lockState.step === 0 && (
          <>
            <div className="text-[11px] text-rose-300/80">Locking a tag is irreversible. Its contents can never be changed or erased again, and most NTAG tags cannot be unlocked.</div>
            <button type="button" onClick={() => setLockState({ step: 1, typed: '', ack: false })} disabled={!support.ok || writing} className={btnRose}><Lock size={12} /> Make read-only...</button>
          </>
        )}
        {lockState.step >= 1 && (
          <div className="space-y-2">
            <div className="text-[11px] text-rose-200">
              Warning: this permanently locks the tag the phone is next to. The tag will keep whatever data it holds now, and it can never be written again.
              Do this only on a tag you intend to keep as it is.
            </div>
            <label className="flex items-center gap-2 text-[11px] text-rose-200">
              <input type="checkbox" checked={lockState.ack} onChange={(e) => setLockState((s) => ({ ...s, ack: e.target.checked }))} />
              I understand the lock cannot be undone.
            </label>
            <label className="block text-[11px] text-rose-200">
              Type LOCK to continue
              <input value={lockState.typed} onChange={(e) => setLockState((s) => ({ ...s, typed: e.target.value }))} className={`${inputCls} mt-0.5 max-w-xs`} spellCheck={false} autoComplete="off" aria-label="Type LOCK to confirm" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onLock} disabled={!lockState.ack || lockState.typed !== 'LOCK' || writing || !support.ok} className={btnRose}><Lock size={12} /> Lock tag permanently</button>
              <button type="button" onClick={() => setLockState({ step: 0, typed: '', ack: false })} className={btnSlate}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OfflineTab({ entries, buildSpecs, parseInput, setParseInput }) {
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState('');
  const [built, setBuilt] = useState(null);
  const [buildError, setBuildError] = useState('');

  const runParse = () => {
    try {
      const { source, ndef } = readNdefInput(parseInput);
      const res = decodeNdefRecords(ndef);
      setParsed({ source, ndefBytes: ndef.length, records: res.records.map(describeRecord), trailing: res.trailing, warnings: res.warnings });
      setParseError('');
    } catch (e) {
      setParsed(null);
      setParseError(e.message);
    }
  };

  const runBuild = () => {
    try {
      const specs = buildSpecs();
      const ndef = buildNdefFromSpecs(specs);
      const tlv = wrapType2Tlv(ndef);
      const reparsed = decodeNdefRecords(ndef).records;
      setBuilt({
        ndefHex: bytesToHex(ndef),
        tlvHex: bytesToHex(tlv),
        ndefBytes: ndef.length,
        tlvBytes: tlv.length,
        reparsed: reparsed.map((r) => r.recordType),
      });
      setBuildError('');
    } catch (e) {
      setBuilt(null);
      setBuildError(e.message);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2 min-w-0">
        <div className="text-xs text-slate-300">Parse raw NDEF</div>
        <div className="text-[11px] text-slate-500">
          Paste an NDEF message (starts with a record header such as d1, 0xD1 flags with MB set), or a Type 2 tag memory dump
          that contains a 03 TLV (for example from a Proxmark3 or Flipper dump). Spaces, colons and 0x prefixes are ignored.
        </div>
        <textarea
          rows={6}
          value={parseInput}
          onChange={(e) => setParseInput(e.target.value)}
          aria-label="Raw NDEF or Type 2 TLV hex"
          placeholder="d1 01 08 54 02 65 6e 48 65 6c 6c 6f"
          className={inputCls}
          spellCheck={false}
        />
        <div className="flex gap-2">
          <button type="button" onClick={runParse} className={btnEmerald}>Parse</button>
          <button type="button" onClick={() => { setParseInput(''); setParsed(null); setParseError(''); }} className={btnSlate}>Clear</button>
        </div>
        {parseError && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{parseError}</div>}
        {parsed && (
          <div className="space-y-2">
            <div className="text-[11px] text-slate-400">
              Input: {parsed.source === 'raw' ? 'raw NDEF message' : 'Type 2 TLV (03 NDEF TLV unwrapped)'}, NDEF {parsed.ndefBytes} bytes, {parsed.records.length} record(s)
              {parsed.trailing > 0 && `, ${parsed.trailing} trailing byte(s) ignored`}
            </div>
            {parsed.warnings.map((w, i) => <div key={i} className="text-[11px] text-amber-300">{w}</div>)}
            {parsed.records.map((r, i) => <RecordView key={i} rec={r} index={i} />)}
          </div>
        )}
      </section>

      <section className="space-y-2 min-w-0">
        <div className="text-xs text-slate-300">Build raw bytes from the Write composer</div>
        <div className="text-[11px] text-slate-500">
          Uses the {entries.length} record(s) currently in the Write tab. The output is the NDEF message, plus the same message wrapped as a
          Type 2 03 TLV (with 0xFE terminator) ready to place at page 4 of a NTAG.
        </div>
        <button type="button" onClick={runBuild} className={btnEmerald} disabled={!entries.length}>Build bytes</button>
        {buildError && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{buildError}</div>}
        {built && (
          <div className="space-y-2 text-xs">
            <div className="text-slate-400">NDEF message: {built.ndefBytes} bytes. Parsed back as: {built.reparsed.join(', ')}</div>
            <div>
              <div className="flex justify-between text-slate-500 text-[10px]">
                <span>NDEF message (hex)</span>
                <CopyButton text={built.ndefHex} />
              </div>
              <div className="font-mono text-[10px] break-all text-gray-300 bg-slate-950 border border-slate-800 rounded p-2 max-h-32 overflow-auto">{built.ndefHex}</div>
            </div>
            <div>
              <div className="flex justify-between text-slate-500 text-[10px]">
                <span>Type 2 TLV wrapped ({built.tlvBytes} bytes)</span>
                <span className="flex gap-2">
                  <CopyButton text={built.tlvHex} />
                  <button type="button" onClick={() => setParseInput(built.tlvHex)} className="text-[10px] text-slate-400 hover:text-slate-200">Load into parser</button>
                </span>
              </div>
              <div className="font-mono text-[10px] break-all text-gray-300 bg-slate-950 border border-slate-800 rounded p-2 max-h-32 overflow-auto">{built.tlvHex}</div>
            </div>
            <button
              type="button"
              onClick={() => downloadBlob('ndef-message.bin', new Blob([hexToBytes(built.ndefHex)], { type: 'application/octet-stream' }))}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
            >
              <Download size={10} /> Download NDEF message (.bin)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function WebNfcWorkbench({ onLogMessage }) {
  const [support, setSupport] = useState({ ok: false, android: false, reason: '' });
  const [tab, setTab] = useState('read');

  // Read state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const scanAbortRef = useRef(null);

  // Write state
  const [entries, setEntries] = useState(() => [{ id: 'r0', kind: 'text', f: defaultFields('text') }]);
  const [overwrite, setOverwrite] = useState(true);
  const [writing, setWriting] = useState(false);
  const [writeStatus, setWriteStatus] = useState('');
  const [writeError, setWriteError] = useState('');
  const [lockState, setLockState] = useState({ step: 0, typed: '', ack: false });
  const opAbortRef = useRef(null);

  // Offline state
  const [parseInput, setParseInput] = useState('');

  useEffect(() => {
    setSupport(getNfcSupport());
    return () => {
      scanAbortRef.current?.abort();
      opAbortRef.current?.abort();
    };
  }, []);

  const log = (text, level = 'info') => { if (typeof onLogMessage === 'function') onLogMessage(text, level); };

  // Spec list with ids stripped; re-derived on each render (cheap).
  const buildSpecs = () => {
    const specs = entries.map(toSpec);
    if (!specs.length) throw new Error('Add at least one record');
    return specs;
  };

  const preview = useMemo(() => {
    if (!entries.length) return { size: 0, hex: '', error: '' };
    try {
      const bytes = buildNdefFromSpecs(entries.map(toSpec));
      return { size: bytes.length, hex: bytesToHex(bytes), error: '' };
    } catch (e) {
      return { size: 0, hex: '', error: e.message };
    }
  }, [entries]);

  // ----- Read -----
  const startScan = async () => {
    if (!support.ok || scanning) return;
    setScanError('');
    const ac = new AbortController();
    scanAbortRef.current = ac;
    try {
      const reader = new window.NDEFReader();
      reader.onreading = (ev) => {
        const ndef = fromWebNfcEvent(ev);
        const entry = {
          id: `s${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
          serialNumber: ndef.serialNumber,
          records: ndef.records.map(describeRecord),
        };
        setHistory((h) => [entry, ...h].slice(0, 200));
        setSelectedId(entry.id);
        setScanError('');
        log(`NFC: read ${entry.records.length} record(s) from ${entry.serialNumber || 'tag'}`, 'success');
      };
      reader.onreadingerror = () => setScanError('Could not read this tag. Hold it still against the back of the phone and try again.');
      ac.signal.addEventListener('abort', () => {
        if (scanAbortRef.current === ac) scanAbortRef.current = null;
        setScanning(false);
      });
      await reader.scan({ signal: ac.signal });
      if (!ac.signal.aborted) setScanning(true);
    } catch (e) {
      if (scanAbortRef.current === ac) scanAbortRef.current = null;
      setScanning(false);
      if (e?.name !== 'AbortError') {
        const msg = describeNfcError(e);
        setScanError(msg);
        log(`NFC scan: ${msg}`, 'error');
      }
    }
  };

  const stopScan = () => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    setScanning(false);
  };

  const exportHistory = () => {
    const doc = { format: 'skons-usb-tool/web-nfc-scans', exportedAt: new Date().toISOString(), scans: history };
    downloadBlob(`web-nfc-scans-${Date.now()}.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  };

  // ----- Write -----
  const writeTag = async () => {
    setWriteError('');
    setWriteStatus('');
    let message;
    try {
      buildNdefFromSpecs(entries.map(toSpec)); // validate the whole composition first
      message = buildWebNfcMessage(entries.map(toSpec));
    } catch (e) {
      setWriteError(e.message);
      return;
    }
    const ac = new AbortController();
    opAbortRef.current = ac;
    setWriting(true);
    try {
      const reader = new window.NDEFReader();
      await reader.write(message, { overwrite, signal: ac.signal });
      setWriteStatus('Written. Scan the tag on the Read tab to verify.');
      log(`NFC: wrote ${message.records.length} record(s)`, 'success');
    } catch (e) {
      const msg = describeNfcError(e);
      if (e?.name !== 'AbortError') setWriteError(msg);
      else setWriteStatus(msg);
      log(`NFC write: ${msg}`, 'error');
    } finally {
      if (opAbortRef.current === ac) opAbortRef.current = null;
      setWriting(false);
    }
  };

  const abortOp = () => opAbortRef.current?.abort();

  const lockTag = async () => {
    if (lockState.typed !== 'LOCK' || !lockState.ack) return;
    const first = window.confirm('Final confirmation: lock the NFC tag against the phone permanently? This cannot be undone.');
    if (!first) return;
    setWriteError('');
    setWriteStatus('');
    const ac = new AbortController();
    opAbortRef.current = ac;
    setWriting(true);
    try {
      const reader = new window.NDEFReader();
      await reader.makeReadOnly({ signal: ac.signal });
      setWriteStatus('Tag is now permanently read-only.');
      log('NFC: tag made read-only (permanent)', 'warn');
      setLockState({ step: 0, typed: '', ack: false });
    } catch (e) {
      const msg = describeNfcError(e);
      if (e?.name !== 'AbortError') setWriteError(msg);
      else setWriteStatus(msg);
      log(`NFC lock: ${msg}`, 'error');
    } finally {
      if (opAbortRef.current === ac) opAbortRef.current = null;
      setWriting(false);
    }
  };

  return (
    <div className="p-4 space-y-4 text-gray-200">
      <header className="flex flex-wrap items-center gap-3">
        <div className="p-2 rounded bg-emerald-900/30 border border-emerald-800"><Nfc size={18} className="text-emerald-300" /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-100">Web NFC Reader / Writer</div>
          <div className="text-[11px] text-slate-500">NDEF tags via the browser's NDEFReader. Also an offline NDEF parser and builder.</div>
        </div>
        <span className={`ml-auto text-[10px] px-2 py-1 rounded border ${support.ok ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800' : 'bg-amber-900/30 text-amber-300 border-amber-800'}`}>
          {support.ok ? 'Web NFC ready' : 'Web NFC unavailable here'}
        </span>
      </header>

      {!support.ok && (
        <div className="p-3 border border-amber-900 rounded bg-amber-950/20 text-xs text-amber-200 space-y-1">
          <div className="inline-flex items-center gap-1.5 font-semibold"><TriangleAlert size={12} /> Phone NFC needs Chrome for Android</div>
          <div>{support.reason}</div>
          <div className="text-amber-300/80">The Offline NDEF tab works on any browser.</div>
        </div>
      )}

      <nav className="flex gap-1 border-b border-slate-800" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${tab === id ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'read' && (
        <ReadTab
          support={support}
          scanning={scanning}
          scanError={scanError}
          onStart={startScan}
          onStop={stopScan}
          last={history[0] || null}
          history={history}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onExport={exportHistory}
          onClear={() => { setHistory([]); setSelectedId(null); }}
        />
      )}
      {tab === 'write' && (
        <WriteTab
          support={support}
          entries={entries}
          setEntries={setEntries}
          overwrite={overwrite}
          setOverwrite={setOverwrite}
          preview={preview}
          writing={writing}
          writeStatus={writeStatus}
          writeError={writeError}
          onWrite={writeTag}
          onAbort={abortOp}
          lockState={lockState}
          setLockState={setLockState}
          onLock={lockTag}
        />
      )}
      {tab === 'offline' && (
        <OfflineTab entries={entries} buildSpecs={buildSpecs} parseInput={parseInput} setParseInput={setParseInput} />
      )}
    </div>
  );
}
