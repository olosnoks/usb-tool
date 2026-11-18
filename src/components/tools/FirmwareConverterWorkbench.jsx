import React, { useEffect, useMemo, useState } from 'react';
import { FileCode, Upload, Download, Copy, Check, Layers, Scissors, GitMerge, AlertTriangle, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import {
  FirmwareError, FORMAT_INFO, OUTPUT_FORMATS, UF2_FAMILIES, parseFirmware, parseNumber, describeImage,
  convertImage, verifyOutput, relocateImage, splitImageAt, splitImageBySegment, mergeImages,
} from '../../utils/firmwareConvert.js';

/**
 * Firmware File Converter & Inspector. Fully offline: files are read in the browser and
 * never uploaded. Inspect a .bin / .hex / .srec / .uf2 / .elf file (segment map, gaps,
 * CRC-32 and SHA-256, start address, UF2 block headers, warnings), relocate it, split or
 * merge, and write it back out as .bin, Intel HEX, S-record or UF2. Each output is re-read
 * and compared with the source before it can be downloaded.
 */

const IN_OPTIONS = [['auto', 'Auto-detect'], ['bin', 'Raw binary (.bin)'], ['hex', 'Intel HEX'], ['srec', 'Motorola S-record'], ['uf2', 'UF2'], ['elf', 'ELF']];
const PAYLOAD_OPTIONS = ['32', '64', '128', '256', '476'];
const ROW_LIMIT = 200;

const attempt = (fn) => {
  try { return { value: fn(), error: '' }; } catch (e) { return { value: null, error: e.message || String(e) }; }
};
const hx = (n, width) => `0x${n.toString(16).toUpperCase().padStart(width ?? (n > 0xffffffff ? 16 : 8), '0')}`;
const hx32 = (n) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const cardCls = 'bg-slate-950 border border-slate-800 rounded p-3';

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] text-slate-500">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-600 normal-case">{hint}</span>}
    </label>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 min-w-0">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="font-mono text-xs text-cyan-200 truncate" title={String(value)}>{value}</div>
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(String(text));
    setDone(true);
    setTimeout(() => setDone(false), 1000);
  };
  return (
    <button onClick={copy} aria-label="Copy" className="text-slate-600 hover:text-cyan-400">
      {done ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function download(output) {
  const blob = new Blob([output.bytes], { type: output.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function VerifyBadge({ verify }) {
  if (!verify) return null;
  const c = verify.checks;
  const mark = (v) => (v === true ? 'ok' : v === false ? 'FAIL' : 'n/a');
  const detail = `data ${mark(c.data)} · base ${mark(c.base)} · start ${mark(c.start)} · family ${mark(c.family)}`;
  if (verify.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300" title={detail}>
        <ShieldCheck size={11} /> re-read and matches the source
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-300" title={detail}>
      <ShieldAlert size={11} /> verification failed ({detail})
    </span>
  );
}

export default function FirmwareConverterWorkbench({ onLogMessage }) {
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState('file');
  const [dragging, setDragging] = useState(false);
  const [inFormat, setInFormat] = useState('auto');
  const [baseAddr, setBaseAddr] = useState('0x00000000');
  const [offset, setOffset] = useState('0');
  const [outFormat, setOutFormat] = useState('hex');
  const [fillText, setFillText] = useState('FF');
  const [fillGaps, setFillGaps] = useState(false);
  const [recordSize, setRecordSize] = useState('16');
  const [srecHeader, setSrecHeader] = useState('');
  const [uf2Payload, setUf2Payload] = useState('256');
  const [uf2Family, setUf2Family] = useState('auto');
  const [uf2Custom, setUf2Custom] = useState('0xe48bff56');
  const [splitMode, setSplitMode] = useState('none');
  const [splitAddr, setSplitAddr] = useState('0x08000000');
  const [outputs, setOutputs] = useState(null);
  const [outError, setOutError] = useState('');

  const log = (text, level = 'info') => onLogMessage?.(text, level);

  // Numeric settings, each with its own error message.
  const baseRes = useMemo(() => attempt(() => parseNumber(baseAddr)), [baseAddr]);
  const offsetRes = useMemo(() => attempt(() => parseNumber(offset)), [offset]);
  const fillRes = useMemo(() => attempt(() => {
    const n = parseNumber(fillText);
    if (n < 0 || n > 255) throw new FirmwareError('Fill byte must be 0x00 to 0xFF');
    return n;
  }), [fillText]);
  const splitRes = useMemo(() => attempt(() => parseNumber(splitAddr)), [splitAddr]);

  // Parse every loaded file with the chosen input format.
  const parsed = useMemo(() => files.map((f) => {
    try {
      const image = parseFirmware(f.bytes, { format: inFormat, filename: f.name, baseAddress: baseRes.value ?? 0 });
      return { ...f, image, error: '' };
    } catch (e) {
      return { ...f, image: null, error: e.message || String(e) };
    }
  }), [files, inFormat, baseRes]);

  const active = parsed.find((p) => p.id === activeId) ?? parsed[0] ?? null;
  const mergedRes = useMemo(() => {
    const imgs = parsed.filter((p) => p.image).map((p) => p.image);
    return imgs.length > 1 ? attempt(() => mergeImages(imgs)) : { value: null, error: '' };
  }, [parsed]);

  const sourceImage = view === 'merged' && mergedRes.value ? mergedRes.value : active?.image ?? null;
  const workRes = useMemo(() => {
    if (!sourceImage) return { value: null, error: '' };
    if (offsetRes.error) return { value: null, error: `Offset: ${offsetRes.error}` };
    return attempt(() => relocateImage(sourceImage, offsetRes.value));
  }, [sourceImage, offsetRes]);
  const working = workRes.value;
  const info = useMemo(() => (working ? describeImage(working) : null), [working]);

  // Outputs belong to the settings they were built with; drop them when anything changes.
  useEffect(() => {
    setOutputs(null);
    setOutError('');
  }, [working, outFormat, fillText, fillGaps, recordSize, srecHeader, uf2Payload, uf2Family, uf2Custom, splitMode, splitAddr]);

  const addFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    const added = [];
    for (const f of list) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      added.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`, name: f.name, size: f.size, bytes });
    }
    setFiles((prev) => [...prev, ...added]);
    setActiveId((cur) => cur ?? added[0].id);
    setView('file');
    log(`Loaded ${added.length} file(s) for firmware inspection`, 'info');
  };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  };

  const familyOption = () => {
    if (uf2Family === 'auto' || uf2Family === 'none') return uf2Family;
    if (uf2Family === 'custom') return parseNumber(uf2Custom);
    return parseNumber(uf2Family);
  };

  const build = () => {
    setOutputs(null);
    setOutError('');
    try {
      if (!working) throw new FirmwareError('Load a file first');
      if (fillRes.error) throw new FirmwareError(`Fill: ${fillRes.error}`);
      const fill = fillRes.value;
      const family = familyOption();
      let parts;
      if (splitMode === 'address') {
        if (splitRes.error) throw new FirmwareError(`Split address: ${splitRes.error}`);
        parts = splitImageAt(working, splitRes.value);
      } else if (splitMode === 'segment') {
        parts = splitImageBySegment(working);
      } else {
        parts = [working];
      }
      const base = (active?.name || 'merged').replace(/\.[^.]+$/, '');
      const result = [];
      parts.forEach((img, i) => {
        if (!img.segments.length) return;
        const opts = {
          fill,
          fillGaps,
          recordSize: Number(recordSize),
          header: srecHeader,
          payloadSize: Number(uf2Payload),
          family,
        };
        const out = convertImage(img, outFormat, opts);
        const verify = verifyOutput(img, outFormat, out.bytes, { fill, fillGaps, family });
        const suffix = parts.length > 1 ? `.part${i + 1}` : '';
        result.push({ name: `${base}${suffix}.${out.ext}`, bytes: out.bytes, mime: out.mime, verify, blocks: out.blocks ?? null });
      });
      if (!result.length) throw new FirmwareError('Nothing to write (the split left no data)');
      setOutputs(result);
      const failed = result.filter((r) => !r.verify.ok);
      log(failed.length ? `Output verification failed for ${failed.length} file(s)` : `Built ${result.length} output file(s)`, failed.length ? 'warn' : 'info');
    } catch (e) {
      setOutError(e.message || String(e));
    }
  };

  // Segment map rows, with the gap that follows each segment.
  const segRows = useMemo(() => {
    if (!working) return [];
    return working.segments.map((s, i) => {
      const end = s.address + s.data.length;
      const next = working.segments[i + 1];
      return { i, start: s.address, end, size: s.data.length, gapAfter: next ? next.address - end : 0 };
    });
  }, [working]);

  const uf2Blocks = working?.meta?.uf2Blocks ?? null;
  const warnings = working?.warnings ?? [];
  const parseErrors = view === 'merged' ? [] : parsed.filter((p) => p.error).map((p) => `${p.name}: ${p.error}`);
  const fileFormat = info?.format ? (FORMAT_INFO[info.format]?.label ?? info.format) : '-';

  return (
    <div className="p-3 space-y-3 text-gray-200 text-xs bg-slate-950 min-h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <FileCode size={18} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-100">Firmware File Converter &amp; Inspector</h2>
        <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-900/40 text-cyan-200 border border-cyan-800">OFFLINE</span>
        <span className="text-[10px] text-slate-500">Files stay in this browser. Nothing is uploaded.</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Input */}
        <section className={`${cardCls} space-y-3`}>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">1. Input</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded p-4 text-center ${dragging ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800'}`}
          >
            <Upload size={18} className="mx-auto text-slate-500 mb-1" />
            <div className="text-slate-400 mb-2">Drop firmware files here, or choose them</div>
            <label className="inline-block px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer text-gray-200">
              Choose file(s)
              <input
                type="file"
                multiple
                accept=".bin,.hex,.ihx,.srec,.s19,.s28,.s37,.mot,.uf2,.elf,.axf,.out"
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <div className="text-[10px] text-slate-600 mt-2">Several files can be loaded to merge them. Nothing runs until you choose an action.</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Input format">
              <select value={inFormat} onChange={(e) => setInFormat(e.target.value)} className={inputCls} aria-label="Input format">
                {IN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Raw .bin base address" hint={baseRes.error ? `Invalid: ${baseRes.error}` : 'Used only for raw binary input'}>
              <input value={baseAddr} onChange={(e) => setBaseAddr(e.target.value)} className={`${inputCls} ${baseRes.error ? 'border-red-800' : ''}`} spellCheck={false} aria-label="Base address" />
            </Field>
          </div>

          {files.length > 0 && (
            <div className="space-y-1">
              {parsed.map((p) => (
                <div key={p.id} className={`flex items-center gap-2 px-2 py-1 rounded border ${p.id === active?.id && view === 'file' ? 'border-cyan-700 bg-cyan-950/30' : 'border-slate-800 bg-slate-900'}`}>
                  <button onClick={() => { setActiveId(p.id); setView('file'); }} className="flex-1 text-left font-mono truncate text-gray-200" title={p.name}>
                    {p.name} <span className="text-slate-500">({fmtBytes(p.size)})</span>
                  </button>
                  {p.error ? <span className="text-[10px] text-red-300 truncate max-w-[50%]">{p.error}</span> : <span className="text-[10px] text-emerald-400">{FORMAT_INFO[p.image.meta.format]?.label ?? p.image.meta.format}</span>}
                  <button onClick={() => removeFile(p.id)} aria-label={`Remove ${p.name}`} className="text-slate-600 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              ))}
              {mergedRes.error && <div className="text-[10px] text-red-300">Merge: {mergedRes.error}</div>}
              {parsed.filter((p) => p.image).length > 1 && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setView('file')} className={`px-2 py-1 rounded text-[11px] ${view === 'file' ? 'bg-cyan-800 text-white' : 'bg-slate-800 text-gray-300'}`}>Single file</button>
                  <button onClick={() => setView('merged')} className={`px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 ${view === 'merged' ? 'bg-cyan-800 text-white' : 'bg-slate-800 text-gray-300'}`}><GitMerge size={11} /> Merge all {parsed.filter((p) => p.image).length} files</button>
                </div>
              )}
            </div>
          )}

          <Field label="Relocate by offset" hint={offsetRes.error ? `Invalid: ${offsetRes.error}` : 'Added to every address (decimal, 0x hex or negative). Applies to the view and to outputs.'}>
            <input value={offset} onChange={(e) => setOffset(e.target.value)} className={`${inputCls} ${offsetRes.error ? 'border-red-800' : ''}`} spellCheck={false} aria-label="Offset" />
          </Field>
          {parseErrors.length > 0 && (
            <div className="p-2 border border-red-900 rounded bg-red-950/30 text-red-300 space-y-0.5">
              {parseErrors.map((e) => <div key={e} className="font-mono break-all">{e}</div>)}
            </div>
          )}
          {workRes.error && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono break-all">{workRes.error}</div>}
        </section>

        {/* Inspector */}
        <section className={`${cardCls} space-y-3`}>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">2. Inspector</div>
          {!info && <div className="text-slate-500 py-6 text-center">Load a file to see its segment map, digests, start address and warnings.</div>}
          {info && (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                <Kpi label="Format" value={fileFormat} />
                <Kpi label="Data bytes" value={`${info.dataBytes.toLocaleString()} (${fmtBytes(info.dataBytes)})`} />
                <Kpi label="Address range" value={info.span ? `${hx(info.start, 8)}..${hx(info.end, 8)}` : '-'} />
                <Kpi label="Segments / gaps" value={`${info.segmentCount} / ${info.gaps.length}`} />
                <Kpi label="Gap bytes" value={info.gapBytes.toLocaleString()} />
                <Kpi label="Start address" value={info.startAddress === null ? 'none' : `${hx(info.startAddress, 8)}${info.startKind ? ` (${info.startKind})` : ''}`} />
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex items-center gap-2"><span className="text-slate-500 w-16">CRC-32</span><span className="text-cyan-200">{info.crc32}</span><CopyButton text={info.crc32} /></div>
                <div className="flex items-center gap-2 min-w-0"><span className="text-slate-500 w-16">SHA-256</span><span className="text-cyan-200 break-all">{info.sha256 || '-'}</span>{info.sha256 && <CopyButton text={info.sha256} />}</div>
                <div className="text-[10px] text-slate-600 font-sans">Digests cover the {info.digestBasis}.</div>
              </div>
              {info.familyIds.length > 0 && (
                <div className="text-[11px]">
                  <span className="text-slate-500">UF2 family: </span>
                  <span className="font-mono text-cyan-200">{info.familyIds.map((f) => {
                    const name = UF2_FAMILIES.find((x) => x.id === f)?.name;
                    return `${hx32(f)}${name ? ` (${name})` : ''}`;
                  }).join(', ')}</span>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="p-2 border border-amber-900 rounded bg-amber-950/30 space-y-0.5">
                  <div className="text-amber-300 inline-flex items-center gap-1 mb-1"><AlertTriangle size={12} /> Warnings</div>
                  {warnings.map((w, i) => <div key={i} className="text-amber-200/90">{w}</div>)}
                </div>
              )}
              {!warnings.length && <div className="text-[11px] text-emerald-400">No warnings.</div>}

              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Segment map</div>
                <div className="max-h-56 overflow-auto border border-slate-800 rounded">
                  <table className="w-full font-mono text-[11px]">
                    <thead className="sticky top-0 bg-slate-900 text-slate-500 text-left">
                      <tr><th className="px-2 py-1">#</th><th className="px-2">Start</th><th className="px-2">End (excl.)</th><th className="px-2">Size</th><th className="px-2">Gap after</th></tr>
                    </thead>
                    <tbody>
                      {segRows.slice(0, ROW_LIMIT).map((r) => (
                        <tr key={r.i} className="border-t border-slate-900">
                          <td className="px-2 py-0.5 text-slate-500">{r.i}</td>
                          <td className="px-2 text-cyan-200">{hx(r.start, 8)}</td>
                          <td className="px-2">{hx(r.end, 8)}</td>
                          <td className="px-2">{r.size.toLocaleString()}</td>
                          <td className={`px-2 ${r.gapAfter > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{r.gapAfter > 0 ? r.gapAfter.toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {segRows.length > ROW_LIMIT && <div className="text-[10px] text-slate-500 p-1">Showing the first {ROW_LIMIT} of {segRows.length} segments.</div>}
                </div>
              </div>

              {uf2Blocks && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">UF2 blocks ({uf2Blocks.length})</div>
                  <div className="max-h-56 overflow-auto border border-slate-800 rounded">
                    <table className="w-full font-mono text-[11px]">
                      <thead className="sticky top-0 bg-slate-900 text-slate-500 text-left">
                        <tr><th className="px-2 py-1">#</th><th className="px-2">Target</th><th className="px-2">Payload</th><th className="px-2">Flags</th><th className="px-2">Family</th><th className="px-2">Block</th></tr>
                      </thead>
                      <tbody>
                        {uf2Blocks.slice(0, ROW_LIMIT).map((b) => (
                          <tr key={b.index} className="border-t border-slate-900">
                            <td className="px-2 py-0.5 text-slate-500">{b.index}</td>
                            <td className="px-2 text-cyan-200">{hx32(b.targetAddress)}</td>
                            <td className="px-2">{b.payloadSize}</td>
                            <td className="px-2">{hx32(b.flags)}</td>
                            <td className="px-2">{b.familyId === null ? '-' : hx32(b.familyId)}</td>
                            <td className="px-2">{b.blockNo}/{b.numBlocks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {uf2Blocks.length > ROW_LIMIT && <div className="text-[10px] text-slate-500 p-1">Showing the first {ROW_LIMIT} of {uf2Blocks.length} blocks.</div>}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Convert */}
      <section className={`${cardCls} space-y-3`}>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">3. Convert, split and download</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Output format">
            <select value={outFormat} onChange={(e) => setOutFormat(e.target.value)} className={inputCls} aria-label="Output format">
              {OUTPUT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_INFO[f].label}</option>)}
            </select>
          </Field>
          <Field label="Split" hint={splitMode === 'address' && splitRes.error ? `Invalid: ${splitRes.error}` : undefined}>
            <select value={splitMode} onChange={(e) => setSplitMode(e.target.value)} className={inputCls} aria-label="Split mode">
              <option value="none">No split</option>
              <option value="address">At an address (two files)</option>
              <option value="segment">One file per segment</option>
            </select>
          </Field>
          {splitMode === 'address' && (
            <Field label="Split address">
              <input value={splitAddr} onChange={(e) => setSplitAddr(e.target.value)} className={`${inputCls} ${splitRes.error ? 'border-red-800' : ''}`} spellCheck={false} aria-label="Split address" />
            </Field>
          )}
          {(outFormat === 'bin' || outFormat === 'hex' || outFormat === 'srec') && (
            <Field label="Fill byte for gaps" hint={fillRes.error ? `Invalid: ${fillRes.error}` : 'Raw .bin always fills gaps'}>
              <input value={fillText} onChange={(e) => setFillText(e.target.value)} className={`${inputCls} ${fillRes.error ? 'border-red-800' : ''}`} spellCheck={false} aria-label="Fill byte" />
            </Field>
          )}
          {outFormat !== 'bin' && (
            <label className="flex items-center gap-2 text-[11px] text-gray-300">
              <input type="checkbox" checked={fillGaps} onChange={(e) => setFillGaps(e.target.checked)} />
              Fill gaps (write a contiguous image)
            </label>
          )}
          {(outFormat === 'hex' || outFormat === 'srec') && (
            <Field label="Bytes per record">
              <select value={recordSize} onChange={(e) => setRecordSize(e.target.value)} className={inputCls} aria-label="Bytes per record">
                {['8', '16', '32', '64'].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          )}
          {outFormat === 'srec' && (
            <Field label="S0 header text (optional)">
              <input value={srecHeader} onChange={(e) => setSrecHeader(e.target.value)} maxLength={60} className={inputCls} aria-label="S0 header" />
            </Field>
          )}
          {outFormat === 'uf2' && (
            <>
              <Field label="Payload per block (bytes)">
                <select value={uf2Payload} onChange={(e) => setUf2Payload(e.target.value)} className={inputCls} aria-label="UF2 payload">
                  {PAYLOAD_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="UF2 family ID">
                <select value={uf2Family} onChange={(e) => setUf2Family(e.target.value)} className={inputCls} aria-label="UF2 family">
                  <option value="auto">Keep source family (if exactly one)</option>
                  <option value="none">No family ID</option>
                  {UF2_FAMILIES.map((f) => <option key={f.id} value={`0x${f.id.toString(16).padStart(8, '0')}`}>{f.name} {hx32(f.id)}</option>)}
                  <option value="custom">Custom hex</option>
                </select>
              </Field>
              {uf2Family === 'custom' && (
                <Field label="Custom family (hex)">
                  <input value={uf2Custom} onChange={(e) => setUf2Custom(e.target.value)} className={inputCls} aria-label="Custom family" spellCheck={false} />
                </Field>
              )}
            </>
          )}
        </div>
        {outFormat === 'uf2' && <div className="text-[10px] text-slate-500">UF2 has no start-address field, so it is not written. Blocks cover only the data present; gaps are omitted unless filled.</div>}
        {outFormat === 'bin' && <div className="text-[10px] text-slate-500">Raw .bin starts at the lowest address ({info ? hx(info.start, 8) : 'none loaded'}); the base address is not stored in the file.</div>}
        {outFormat === 'hex' && <div className="text-[10px] text-slate-500">Intel HEX output uses type 04 for upper addresses and type 05 for the start address.</div>}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={build}
            disabled={!working}
            className="px-3 py-1.5 rounded bg-cyan-800 hover:bg-cyan-700 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs inline-flex items-center gap-1"
          >
            <Layers size={12} /> Build output{splitMode !== 'none' ? 's' : ''}
          </button>
          {!working && <span className="text-[10px] text-slate-500">Load a file first.</span>}
        </div>

        {outError && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono break-all">{outError}</div>}

        {outputs && (
          <div className="space-y-1">
            {outputs.map((o) => (
              <div key={o.name} className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded border border-slate-800 bg-slate-900">
                <span className="font-mono text-gray-200">{o.name}</span>
                <span className="text-slate-500">{fmtBytes(o.bytes.length)}</span>
                {o.blocks !== null && <span className="text-slate-500">{o.blocks} block(s)</span>}
                <VerifyBadge verify={o.verify} />
                <button
                  onClick={() => download(o)}
                  disabled={!o.verify.ok}
                  className="ml-auto px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:text-slate-600 text-cyan-300 inline-flex items-center gap-1"
                  title={o.verify.ok ? 'Download' : 'Not downloadable: the re-read did not match the source'}
                >
                  <Download size={12} /> Download
                </button>
              </div>
            ))}
            {outputs.some((o) => o.verify.checks.data === null) && (
              <div className="text-[10px] text-slate-500">Some checks could not run because the address span is too large to expand; the segment comparison still applies.</div>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 text-[10px] text-slate-600"><Scissors size={10} /> Split and merge run on the file as it is shown (after any relocation). Outputs are re-read and compared before download.</div>
      </section>
    </div>
  );
}
