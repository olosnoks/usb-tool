import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSearch, Upload, Activity, Type, Binary, Scissors, FileArchive, Download } from 'lucide-react';
import {
  scanSignatures, entropyProfile, entropySummary, highEntropyRegions, classifyEntropy, autoBlockSize,
  extractStrings, hexRows, carveRangeForHit, carveBytes, decompressStream, buildReport, reportToMarkdown,
  formatOffset, HIGH_ENTROPY, DECOMPRESS_FORMATS
} from '../../utils/firmwareAnalyzer.js';

/**
 * Firmware Image Analyzer: binwalk-style signature scan, entropy profile, strings,
 * hex view, carving and gzip/zlib decompression. Everything runs on the file you pick,
 * in this browser; nothing is uploaded.
 */

const MAX_BYTES = 64 * 1024 * 1024;
const TABS = [
  ['signatures', 'Signatures', FileSearch],
  ['entropy', 'Entropy', Activity],
  ['strings', 'Strings', Type],
  ['hex', 'Hex view', Binary],
  ['decompress', 'Decompress', FileArchive],
  ['report', 'Report', Download]
];
const CATEGORY_TONE = {
  boot: 'text-cyan-300 border-cyan-900',
  filesystem: 'text-emerald-300 border-emerald-900',
  compression: 'text-amber-300 border-amber-900',
  container: 'text-indigo-300 border-indigo-900',
  executable: 'text-purple-300 border-purple-900',
  crypto: 'text-rose-300 border-rose-900',
  image: 'text-sky-300 border-sky-900',
  text: 'text-slate-300 border-slate-700'
};
const btn = 'px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-xs text-gray-200 hover:border-cyan-600 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-100';

/** "0x1F", "0X1f", or decimal. Returns null when it is not a valid offset. */
function parseOffset(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const v = /^0x/i.test(t) ? parseInt(t.slice(2), 16) : parseInt(t, 10);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(2)} MiB`);

function Stat({ label, value, tone = 'text-gray-100' }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-3 py-2 min-w-[7rem]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}

function EntropyCanvas({ profile, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !profile) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0f1015';
    ctx.fillRect(0, 0, W, H);
    const { values } = profile;
    const cols = Math.min(W, values.length);
    for (let x = 0; x < cols; x++) {
      const from = Math.floor((x * values.length) / cols);
      const to = Math.max(from + 1, Math.floor(((x + 1) * values.length) / cols));
      let v = 0;
      for (let i = from; i < to; i++) v = Math.max(v, values[i]);
      const h = Math.max(1, Math.round((v / 8) * (H - 4)));
      ctx.fillStyle = v >= HIGH_ENTROPY ? '#f43f5e' : v >= 6 ? '#f59e0b' : '#10b981';
      ctx.fillRect(Math.floor((x * W) / cols), H - h - 2, Math.max(1, Math.ceil(W / cols)), h);
    }
    ctx.strokeStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(0, H - 2 - ((HIGH_ENTROPY / 8) * (H - 4)));
    ctx.lineTo(W, H - 2 - ((HIGH_ENTROPY / 8) * (H - 4)));
    ctx.stroke();
  }, [profile]);

  const pick = (e) => {
    if (!profile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(0.999999, Math.max(0, (e.clientX - rect.left) / rect.width));
    onPick(Math.floor(frac * profile.values.length) * profile.blockSize);
  };
  return <canvas ref={ref} width={1000} height={160} onClick={pick} className="w-full h-40 cursor-crosshair rounded border border-slate-800" aria-label="Entropy profile" />;
}

export default function FirmwareAnalyzerWorkbench({ onLogMessage }) {
  const log = (text, level) => onLogMessage?.(text, level);
  const [file, setFile] = useState(null); // { name, size, bytes }
  const [busy, setBusy] = useState(null); // null | 'scan' | 'entropy' | 'strings' | 'decompress'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(null); // { hits, truncated }
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('signatures');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null); // hit offset chosen in the table
  const [carveNote, setCarveNote] = useState('');
  const [hexOffset, setHexOffset] = useState('0');
  const [hexLen, setHexLen] = useState(256);
  const [minLen, setMinLen] = useState(6);
  const [useAscii, setUseAscii] = useState(true);
  const [useUtf16, setUseUtf16] = useState(true);
  const [strings, setStrings] = useState(null); // { strings, truncated, minLength }
  const [stringFilter, setStringFilter] = useState('');
  const [dFormat, setDFormat] = useState('gzip');
  const [dOffset, setDOffset] = useState('0');
  const [dResult, setDResult] = useState(null);
  const abortRef = useRef(null);

  const hits = scan?.hits ?? [];
  const bytes = file?.bytes ?? null;

  const resetAll = () => {
    setScan(null);
    setProfile(null);
    setStrings(null);
    setDResult(null);
    setSelected(null);
    setCarveNote('');
    setError('');
  };

  const runAnalysis = async (f) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy('scan');
    setProgress(0);
    try {
      const result = await scanSignatures(f.bytes, { signal: ac.signal, onProgress: setProgress });
      setScan(result);
      setBusy('entropy');
      setProgress(0);
      const prof = await entropyProfile(f.bytes, { blockSize: autoBlockSize(f.size), onProgress: setProgress, signal: ac.signal });
      setProfile(prof);
      log(`Analyzed ${f.name}: ${result.hits.length} signature hit(s).`, 'info');
    } catch (e) {
      if (e?.name !== 'AbortError') setError(`Analysis failed: ${e?.message || e}`);
      else setError('Analysis cancelled.');
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const loadFile = async (picked) => {
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      setError(`That file is ${fmtBytes(picked.size)}. The limit is ${fmtBytes(MAX_BYTES)} so the browser can hold it in memory.`);
      return;
    }
    resetAll();
    const data = new Uint8Array(await picked.arrayBuffer());
    const f = { name: picked.name, size: data.length, bytes: data };
    setFile(f);
    setHexOffset('0');
    setDOffset('0');
    await runAnalysis(f);
  };

  const cancel = () => abortRef.current?.abort();

  const jumpHex = (offset) => {
    setHexOffset(formatOffset(offset));
    setTab('hex');
  };

  const onDrop = (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer?.files?.[0]);
  };

  const visibleHits = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return hits;
    return hits.filter((h) => `${h.name} ${h.id} ${h.categoryLabel} ${h.fields.map((f) => f.join(' ')).join(' ')}`.toLowerCase().includes(q));
  }, [hits, filter]);

  const onCarve = (hit) => {
    if (!bytes) return;
    const r = carveRangeForHit(hit, hits, bytes.length);
    const data = carveBytes(bytes, r.start, r.end);
    if (data.length === 0) return;
    const safe = hit.id.replace(/[^a-z0-9-]/gi, '');
    download(`${file.name}.${formatOffset(hit.offset).toLowerCase()}.${safe}.bin`, data);
    setCarveNote(`Carved ${fmtBytes(data.length)} from ${formatOffset(hit.offset)} to ${formatOffset(r.end)} (end set by ${r.basis}).`);
  };

  const onRunStrings = async () => {
    if (!bytes) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy('strings');
    setProgress(0);
    try {
      const r = await extractStrings(bytes, { minLen: Math.max(1, Number(minLen) || 6), ascii: useAscii, utf16: useUtf16, maxResults: 20000, onProgress: setProgress, signal: ac.signal });
      setStrings({ strings: r.strings, truncated: r.truncated, minLength: Math.max(1, Number(minLen) || 6) });
    } catch (e) {
      setError(e?.name === 'AbortError' ? 'String extraction cancelled.' : `String extraction failed: ${e?.message || e}`);
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const visibleStrings = useMemo(() => {
    if (!strings) return [];
    const q = stringFilter.trim().toLowerCase();
    const list = q ? strings.strings.filter((s) => s.text.toLowerCase().includes(q)) : strings.strings;
    return list;
  }, [strings, stringFilter]);

  const onDecompress = async () => {
    if (!bytes) return;
    const off = parseOffset(dOffset);
    if (off === null || off >= bytes.length) {
      setDResult({ error: 'Enter an offset inside the file.' });
      return;
    }
    setBusy('decompress');
    try {
      const r = await decompressStream(bytes.subarray(off), dFormat);
      setDResult({ offset: off, ...r });
    } catch (e) {
      setDResult({ error: e?.message || String(e) });
    } finally {
      setBusy(null);
    }
  };

  const report = useMemo(() => {
    if (!file || !scan) return null;
    return buildReport({
      fileName: file.name,
      size: file.size,
      hits,
      truncated: scan.truncated,
      entropy: profile,
      strings: strings ? { count: strings.strings.length, truncated: strings.truncated, minLength: strings.minLength } : null
    });
  }, [file, scan, hits, profile, strings]);

  const entropyInfo = useMemo(() => (profile ? entropySummary(profile) : null), [profile]);
  const hotRegions = useMemo(() => (profile ? highEntropyRegions(profile).slice(0, 50) : []), [profile]);
  const hexList = useMemo(() => {
    if (!bytes) return [];
    const off = parseOffset(hexOffset) ?? 0;
    return hexRows(bytes, off, hexLen);
  }, [bytes, hexOffset, hexLen]);
  const dumpRows = useMemo(() => (dResult?.data ? hexRows(dResult.data, 0, 256) : []), [dResult]);

  return (
    <div className="flex flex-col gap-3 p-3 text-gray-200 font-sans text-sm">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-300 font-semibold">
            <FileSearch size={16} /> Firmware Image Analyzer
          </div>
          <div className="text-xs text-slate-500">Signature scan, entropy, strings, hex, carving and decompression. Runs offline on the file you pick.</div>
        </div>
        <label className={`${btn} inline-flex items-center gap-1.5 cursor-pointer`}>
          <Upload size={12} /> {file ? 'Choose another file' : 'Choose firmware file'}
          <input type="file" className="hidden" onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>

      {!file && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="border border-dashed border-slate-700 rounded-lg p-8 text-center bg-slate-950"
        >
          <div className="text-slate-300">Drop a firmware image here, or choose a file.</div>
          <div className="text-xs text-slate-500 mt-1">Any binary: .bin, .img, .trx, .squashfs, .ubi, .elf, .hex and so on. Up to {fmtBytes(MAX_BYTES)}. Nothing is uploaded.</div>
        </div>
      )}

      {error && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {busy && (
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="font-mono">{busy === 'scan' ? 'Scanning signatures' : busy === 'entropy' ? 'Computing entropy' : busy === 'strings' ? 'Extracting strings' : 'Decompressing'}</span>
          {busy !== 'decompress' && (
            <>
              <div className="h-1.5 flex-1 bg-slate-800 rounded overflow-hidden"><div className="h-full bg-cyan-500" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <span className="font-mono w-10 text-right">{Math.round(progress * 100)}%</span>
              <button className={btn} onClick={cancel}>Cancel</button>
            </>
          )}
        </div>
      )}

      {file && (
        <>
          <div className="flex flex-wrap gap-2">
            <Stat label="File" value={file.name} />
            <Stat label="Size" value={`${fmtBytes(file.size)} (${file.size} B)`} />
            <Stat label="Signatures" value={scan ? hits.length : '...'} tone="text-cyan-300" />
            <Stat label="Mean entropy" value={entropyInfo ? `${entropyInfo.mean} bits/B` : '...'} />
            <Stat label="High-entropy blocks" value={entropyInfo ? `${entropyInfo.highBlocks} / ${entropyInfo.blocks}` : '...'} tone={entropyInfo?.highBlocks ? 'text-rose-300' : 'text-gray-100'} />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-1">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-2.5 py-1.5 rounded-t text-xs inline-flex items-center gap-1.5 ${tab === id ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-gray-200'}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {tab === 'signatures' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${input} w-64`} placeholder="Filter by type, field or value" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <span className="text-xs text-slate-500">{visibleHits.length} shown</span>
                {scan?.truncated?.length > 0 && (
                  <span className="text-xs text-amber-300">Capped: {scan.truncated.map((t) => `${t.name} (${t.limit})`).join(', ')}</span>
                )}
              </div>
              {carveNote && <div className="text-xs text-emerald-300">{carveNote}</div>}
              {scan && hits.length === 0 && <div className="text-xs text-slate-400 p-3 border border-slate-800 rounded bg-slate-950">No known signature matched. The entropy and strings tabs may still show structure.</div>}
              <div className="overflow-auto max-h-[420px] border border-slate-800 rounded">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-slate-900 text-slate-400">
                    <tr>
                      <th className="text-left p-2">Offset</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-right p-2">Size</th>
                      <th className="text-left p-2">Details</th>
                      <th className="text-left p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHits.map((h, i) => {
                      const tone = CATEGORY_TONE[h.category] || CATEGORY_TONE.text;
                      const isSel = selected === h.offset;
                      return (
                        <tr key={`${h.offset}-${h.id}-${i}`} onClick={() => setSelected(h.offset)} className={`border-t border-slate-900 align-top cursor-pointer ${isSel ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'}`}>
                          <td className="p-2 text-cyan-300 whitespace-nowrap">{formatOffset(h.offset)}<div className="text-slate-500">{h.offset}</div></td>
                          <td className="p-2">
                            <span className={`inline-block border rounded px-1.5 py-0.5 text-[10px] mr-1 ${tone}`}>{h.categoryLabel}</span>
                            <span className="text-gray-100">{h.name}</span>
                            {h.heuristic && <span className="ml-1 text-amber-400">heuristic</span>}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">{h.size ?? '-'}</td>
                          <td className="p-2 text-slate-300">
                            {h.fields.map(([k, v]) => <div key={k}><span className="text-slate-500">{k}:</span> {String(v)}</div>)}
                            {h.notes.map((n, j) => <div key={j} className="text-amber-300">{n}</div>)}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <button className={btn} onClick={(e) => { e.stopPropagation(); jumpHex(h.offset); }}>Hex</button>
                              <button className={btn} onClick={(e) => { e.stopPropagation(); onCarve(h); }}>
                                <Scissors size={10} className="inline mr-1" />Carve
                              </button>
                              {(h.id === 'gzip' || h.id === 'zlib') && (
                                <button className={btn} onClick={(e) => { e.stopPropagation(); setDOffset(formatOffset(h.offset)); setDFormat(h.id === 'gzip' ? 'gzip' : 'deflate'); setTab('decompress'); }}>Decompress</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-slate-500">
                Carve writes the bytes from a hit to its parsed size when the header states one, otherwise to the next hit, otherwise to the end of the file. Read-only: the image is never modified.
              </div>
            </div>
          )}

          {tab === 'entropy' && (
            <div className="flex flex-col gap-2">
              <EntropyCanvas profile={profile} onPick={jumpHex} />
              <div className="text-[11px] text-slate-500">
                Green: below 6 bits per byte (structured, code or text). Amber: 6 to 7.5 (mixed). Red: at or above {HIGH_ENTROPY} (likely compressed or encrypted). Click the plot to open that block in the hex view.
              </div>
              {entropyInfo && (
                <div className="text-xs font-mono text-slate-300">
                  Block size {entropyInfo.blockSize} B, {entropyInfo.blocks} blocks. Min {entropyInfo.min}, max {entropyInfo.max}, mean {entropyInfo.mean}.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Block size</span>
                <select className={input} value={profile?.blockSize || ''} onChange={async (e) => {
                  if (!bytes) return;
                  setBusy('entropy');
                  setProfile(await entropyProfile(bytes, { blockSize: Number(e.target.value), onProgress: setProgress }));
                  setBusy(null);
                }} disabled={!bytes || !!busy}>
                  {[256, 1024, 4096, 16384, 65536].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="text-xs text-slate-400">High-entropy regions ({hotRegions.length}{hotRegions.length === 50 ? '+' : ''} shown)</div>
              <div className="max-h-40 overflow-auto border border-slate-800 rounded font-mono text-xs">
                {hotRegions.length === 0 && <div className="p-2 text-slate-500">None at or above {HIGH_ENTROPY} bits per byte.</div>}
                {hotRegions.map((r) => (
                  <button key={r.start} onClick={() => jumpHex(r.start)} className="w-full text-left px-2 py-1 border-b border-slate-900 hover:bg-slate-900 text-rose-300">
                    {formatOffset(r.start)} to {formatOffset(r.end)} ({fmtBytes(r.end - r.start)}), mean {r.meanEntropy.toFixed(3)} <span className="text-slate-500">{classifyEntropy(r.meanEntropy)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'strings' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">Min length
                  <input type="number" min={1} max={256} className={`${input} w-16`} value={minLen} onChange={(e) => setMinLen(e.target.value)} />
                </label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={useAscii} onChange={(e) => setUseAscii(e.target.checked)} /> ASCII</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={useUtf16} onChange={(e) => setUseUtf16(e.target.checked)} /> UTF-16LE</label>
                <button className={btn} onClick={onRunStrings} disabled={!!busy || (!useAscii && !useUtf16)}>{strings ? 'Re-extract' : 'Extract strings'}</button>
                {strings && (
                  <button className={btn} onClick={() => download(`${file.name}.strings.txt`, strings.strings.map((s) => `${formatOffset(s.offset)}\t${s.encoding}\t${s.text}`).join('\n'), 'text/plain')}>Export all (TXT)</button>
                )}
              </div>
              {strings && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input className={`${input} w-64`} placeholder="Filter strings" value={stringFilter} onChange={(e) => setStringFilter(e.target.value)} />
                    <span className="text-slate-500">{strings.strings.length} found{strings.truncated ? ' (limit reached)' : ''}, {visibleStrings.length} match, first 1000 shown</span>
                  </div>
                  <div className="max-h-[360px] overflow-auto border border-slate-800 rounded font-mono text-xs bg-slate-950">
                    {visibleStrings.slice(0, 1000).map((s, i) => (
                      <div key={`${s.offset}-${i}`} className="px-2 py-0.5 border-b border-slate-900 flex gap-3">
                        <button className="text-cyan-400 hover:underline whitespace-nowrap" onClick={() => jumpHex(s.offset)}>{formatOffset(s.offset)}</button>
                        <span className="text-slate-500 w-14">{s.encoding}</span>
                        <span className="text-gray-200 break-all">{s.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!strings && <div className="text-xs text-slate-500">Strings are extracted on demand (ASCII runs and UTF-16LE runs of at least the minimum length).</div>}
            </div>
          )}

          {tab === 'hex' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Offset</span>
                <input className={`${input} w-32`} value={hexOffset} onChange={(e) => setHexOffset(e.target.value)} aria-label="Hex offset" />
                <button className={btn} onClick={() => setHexOffset(formatOffset(Math.max(0, (parseOffset(hexOffset) ?? 0) - hexLen)))}>Prev</button>
                <button className={btn} onClick={() => setHexOffset(formatOffset(Math.min(Math.max(0, file.size - 1), (parseOffset(hexOffset) ?? 0) + hexLen)))}>Next</button>
                <select className={input} value={hexLen} onChange={(e) => setHexLen(Number(e.target.value))}>
                  {[256, 512, 1024, 4096].map((n) => <option key={n} value={n}>{n} bytes</option>)}
                </select>
              </div>
              <div className="overflow-auto max-h-[420px] border border-slate-800 rounded bg-slate-950 p-2 font-mono text-[11px] leading-5">
                {hexList.map((r) => (
                  <div key={r.offset} className="whitespace-pre">
                    <span className="text-cyan-400">{r.offset.toString(16).toUpperCase().padStart(8, '0')}</span>  <span className="text-gray-200">{r.hex.padEnd(47, ' ')}</span>  <span className="text-slate-400">{r.ascii}</span>
                  </div>
                ))}
                {hexList.length === 0 && <div className="text-slate-500">Offset is past the end of the file.</div>}
              </div>
            </div>
          )}

          {tab === 'decompress' && (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-slate-400">
                Decompress a stream starting at an offset, using the browser's DecompressionStream. Output so far is kept if the stream is damaged or has trailing data.
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select className={input} value={dFormat} onChange={(e) => setDFormat(e.target.value)}>
                  {Object.entries(DECOMPRESS_FORMATS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <span className="text-slate-400">Start offset</span>
                <input className={`${input} w-32`} value={dOffset} onChange={(e) => setDOffset(e.target.value)} aria-label="Decompress offset" />
                <button className={btn} onClick={onDecompress} disabled={!!busy}>Decompress</button>
              </div>
              {dResult?.error && <div className="text-xs text-red-300">{dResult.error}</div>}
              {dResult && !dResult.error && (
                <>
                  <div className={`text-xs ${dResult.complete ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {dResult.complete ? 'Complete' : `Partial: ${dResult.error}`}. Output {fmtBytes(dResult.outputBytes)} from {formatOffset(dResult.offset)}.
                  </div>
                  <div className="flex gap-2">
                    <button className={btn} onClick={() => download(`${file.name}.${formatOffset(dResult.offset).toLowerCase()}.decompressed.bin`, dResult.data)} disabled={!dResult.outputBytes}>Download output</button>
                  </div>
                  <div className="max-h-64 overflow-auto border border-slate-800 rounded bg-slate-950 p-2 font-mono text-[11px] leading-5">
                    {dumpRows.map((r) => (
                      <div key={r.offset} className="whitespace-pre">
                        <span className="text-cyan-400">{r.offset.toString(16).toUpperCase().padStart(8, '0')}</span>  <span className="text-gray-200">{r.hex.padEnd(47, ' ')}</span>  <span className="text-slate-400">{r.ascii}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'report' && report && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <button className={btn} onClick={() => download(`${file.name}.report.json`, JSON.stringify(report, null, 2), 'application/json')}>Download JSON</button>
                <button className={btn} onClick={() => download(`${file.name}.report.md`, reportToMarkdown(report), 'text/markdown')}>Download Markdown</button>
              </div>
              <div className="text-[11px] text-slate-500">
                The report lists the signature hits, their parsed fields and notes, the entropy summary and high-entropy regions, and the string count if strings were extracted. It does not include the image bytes or the string text.
              </div>
              <pre className="max-h-[360px] overflow-auto border border-slate-800 rounded bg-slate-950 p-2 text-[11px] text-gray-300 whitespace-pre-wrap">{reportToMarkdown(report)}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
