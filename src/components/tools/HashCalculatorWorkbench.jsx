import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, FileUp } from 'lucide-react';
import {
  computeAll, decodeKey, detectAlgorithms, compareDigest, normalizeDigest, formatSums, sumsFileName,
} from '../../utils/hashSuite.js';

/**
 * Hash & HMAC calculator — fully client-side. Digests text or files with MD5,
 * MD4/NTLM, SHA-1/224/256/384/512, SHA-512/256, SHA-3, RIPEMD-160, CRC-32 and
 * Adler-32, and optional HMAC (key as text/hex/base64) for the hash families.
 * Nothing is uploaded.
 */

/** Read a File/Blob (or File-like with arrayBuffer) into a Uint8Array. */
async function readBytes(file) {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsArrayBuffer(file);
  });
}

const MATCH_STYLE = {
  match: 'text-emerald-400',
  mismatch: 'text-red-400',
};

function CopyBtn({ value, title }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  return <button onClick={copy} title={title} className="text-slate-600 hover:text-cyan-400">{copied ? <Check size={11} /> : <Copy size={11} />}</button>;
}

function HashRow({ row, status }) {
  return (
    <div className="py-1 border-b border-slate-900 last:border-0" data-testid={`row-${row.label}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-cyan-400 font-semibold">
          {row.label}
          {status === 'match' && <span className={`ml-2 ${MATCH_STYLE.match}`}>match</span>}
          {status === 'mismatch' && <span className={`ml-2 ${MATCH_STYLE.mismatch}`}>no match</span>}
        </span>
        {row.value && <CopyBtn value={row.value} title="Copy" />}
      </div>
      {row.error
        ? <div className="font-mono text-[11px] text-red-400">{row.error}</div>
        : <div className={`font-mono text-[11px] break-all ${status === 'match' ? 'text-emerald-300' : 'text-gray-300'}`}>{row.value}</div>}
    </div>
  );
}

export default function HashCalculatorWorkbench({ onLogMessage }) {
  const [text, setText] = useState('');
  const [hmacKey, setHmacKey] = useState('');
  const [keyEnc, setKeyEnc] = useState('text');
  const [useHmac, setUseHmac] = useState(false);
  const [files, setFiles] = useState([]); // File objects; recomputed whenever the key changes
  const [textRows, setTextRows] = useState(null);
  const [fileResults, setFileResults] = useState([]); // [{ name, size, rows, error }]
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [expected, setExpected] = useState('');
  const [sumsAlgo, setSumsAlgo] = useState('SHA-256');
  const fileInput = useRef(null);
  const logRef = useRef(onLogMessage);
  logRef.current = onLogMessage;

  // Recompute whenever the input, key, key encoding, HMAC toggle or files change.
  useEffect(() => {
    let cancelled = false;
    let keyBytes = null;
    if (useHmac) {
      try { keyBytes = decodeKey(hmacKey, keyEnc); setKeyError(''); }
      catch (e) { setKeyError(e.message); return undefined; }
    } else setKeyError('');

    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        if (files.length === 0) {
          const bytes = new TextEncoder().encode(text);
          const rows = await computeAll(bytes, { keyBytes, text });
          if (!cancelled) setTextRows(rows);
        } else {
          const out = [];
          for (const f of files) {
            if (cancelled) return;
            try {
              const bytes = await readBytes(f);
              out.push({ name: f.name, size: f.size ?? bytes.length, rows: await computeAll(bytes, { keyBytes }) });
            } catch (e) {
              out.push({ name: f.name, size: f.size ?? 0, rows: [], error: e.message || String(e) });
            }
          }
          if (!cancelled) {
            setFileResults(out);
            logRef.current?.(`Hashed ${out.length} file${out.length === 1 ? '' : 's'}${keyBytes ? ' with HMAC' : ''}`);
          }
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, files.length ? 50 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, useHmac, hmacKey, keyEnc, files]);

  const onFiles = (e) => {
    const list = Array.from(e.target.files || []);
    // Reset so choosing the same file again fires another change event.
    try { e.target.value = ''; } catch { /* some test environments forbid it */ }
    if (!list.length) return;
    setFileResults([]);
    setFiles(list);
  };

  const clearFiles = () => { setFiles([]); setFileResults([]); };

  const detected = detectAlgorithms(expected);
  const expectedNorm = normalizeDigest(expected);
  const expectedBad = expected.trim() !== '' && !expectedNorm;
  const statusOf = (row) => (expectedNorm && !row.error ? compareDigest(row.value, expected) : null);

  const rowsForSummary = files.length ? fileResults[0]?.rows : textRows;
  const anyMatch = !!rowsForSummary && !!expectedNorm && rowsForSummary.some((r) => statusOf(r) === 'match');
  const anyComparable = !!rowsForSummary && !!expectedNorm && rowsForSummary.some((r) => statusOf(r) !== null);

  const sumsEntries = fileResults
    .map((f) => ({ name: f.name, value: f.rows.find((r) => r.id === sumsAlgo)?.value }))
    .filter((e) => e.value);
  const sumsAlgoOptions = (fileResults[0]?.rows || []).filter((r) => !r.error && r.id !== 'NTLM').map((r) => r.id);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Input</span>
            <label className="inline-flex items-center gap-1 text-[11px] text-cyan-300 cursor-pointer hover:text-cyan-200">
              <FileUp size={12} /> Hash file(s)
              <input ref={fileInput} type="file" multiple className="hidden" onChange={onFiles} data-testid="hash-file-input" />
            </label>
          </div>
          {files.length ? (
            <div className="bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono flex items-center justify-between">
              <span className="text-gray-300 truncate">
                {files.length === 1 ? `${files[0].name} · ${((files[0].size ?? 0) / 1024).toFixed(1)} KB` : `${files.length} files`}
              </span>
              <button onClick={clearFiles} className="text-slate-500 hover:text-gray-200 text-[11px]">use text</button>
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
            <div className="mt-1 flex gap-1">
              <input
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder="HMAC secret key"
                aria-label="HMAC secret key"
                className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
              />
              <select value={keyEnc} onChange={(e) => setKeyEnc(e.target.value)} aria-label="Key encoding" className="bg-slate-900 border border-slate-800 rounded px-1 text-xs">
                <option value="text">text</option>
                <option value="hex">hex</option>
                <option value="base64">base64</option>
              </select>
            </div>
          )}
          {keyError && <div role="alert" className="mt-1 text-[11px] text-red-400">Key error: {keyError}</div>}

          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-3 mb-1">Expected digest (verify)</div>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="paste a known hash to compare (case and spaces ignored)"
            aria-label="Expected digest"
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono resize-y"
          />
          {expectedBad && <div className="text-[11px] text-amber-400">Not a hex string.</div>}
          {expectedNorm && (
            <div className="text-[11px] text-slate-400" data-testid="expected-summary">
              {detected.length ? `Length fits: ${detected.join(', ')}. ` : `${expectedNorm.length} hex digits does not fit any algorithm here. `}
              {anyComparable && (anyMatch
                ? <span className="text-emerald-400">Match.</span>
                : <span className="text-red-400">No match.</span>)}
              {files.length > 1 && ' Showing the first file; per-file results are in the table.'}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            Digests {useHmac && <span className="text-amber-400">· HMAC</span>} {busy && <span className="text-slate-500">· …</span>}
          </div>
          {files.length > 1 ? (
            <div className="bg-slate-950 border border-slate-800 rounded p-2">
              <div className="flex items-center gap-2 mb-2 text-[11px]">
                <select value={sumsAlgo} onChange={(e) => setSumsAlgo(e.target.value)} aria-label="Checksum algorithm" className="bg-slate-900 border border-slate-800 rounded px-1">
                  {(sumsAlgoOptions.length ? sumsAlgoOptions : [sumsAlgo]).map((id) => <option key={id} value={id}>{useHmac ? `HMAC-${id}` : id}</option>)}
                </select>
                <button
                  onClick={() => navigator.clipboard?.writeText(formatSums(sumsEntries))}
                  disabled={!sumsEntries.length}
                  className="px-2 py-0.5 bg-slate-800 rounded hover:bg-slate-700 text-cyan-300 disabled:opacity-40"
                >
                  Copy as {sumsFileName(sumsAlgo)}
                </button>
              </div>
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {fileResults.map((f, i) => {
                    const row = f.rows.find((r) => r.id === sumsAlgo);
                    const st = row ? statusOf(row) : null;
                    return (
                      <tr key={`${f.name}-${i}`} className="border-b border-slate-900 align-top">
                        <td className="pr-2 py-1 text-gray-300 break-all">{f.name}</td>
                        <td className={`py-1 break-all ${st === 'match' ? 'text-emerald-300' : st === 'mismatch' ? 'text-red-400' : 'text-gray-400'}`}>
                          {f.error ? <span className="text-red-400">{f.error}</span> : (row?.error || row?.value || '—')}
                          {st === 'match' && ' (match)'}{st === 'mismatch' && ' (no match)'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {fileResults.length < files.length && <div className="text-slate-500 text-[11px] mt-1">Hashing {files.length - fileResults.length} more…</div>}
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded p-2">
              {(() => {
                const single = files.length === 1 ? fileResults[0] : null;
                const rows = files.length === 1 ? single?.rows : textRows;
                if (single?.error) return <div className="text-red-400 text-xs">{single.error}</div>;
                return rows && rows.length
                  ? rows.map((r) => <HashRow key={r.label} row={r} status={statusOf(r)} />)
                  : <div className="text-slate-600 text-xs">—</div>;
              })()}
            </div>
          )}
          <p className="text-[10px] text-slate-500 mt-1">MD5, MD4, SHA-1, CRC-32 and Adler-32 are not for security use, only checksums and interop. NTLM is shown for text input only. HMAC is available for the hash families, not for CRC/Adler/MD4. Everything runs locally.</p>
        </div>
      </div>
    </div>
  );
}
