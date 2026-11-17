import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, RefreshCw, Edit3 } from 'lucide-react';
import { parseSvd, decodeRegister, insertField, isWritable, isReadable } from '../../../utils/svd';
import { packStore } from '../../../utils/packStore';
import { confirmAction } from '../../../utils/sessionLog';

const h8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const input = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-cyan-300 outline-none';
const btn = 'flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold disabled:opacity-40';

const parseValue = (s) => {
  const t = String(s).trim();
  const v = /^0b/i.test(t) ? parseInt(t.slice(2), 2) : /^0x/i.test(t) ? parseInt(t.slice(2), 16) : /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  if (Number.isNaN(v) || v < 0 || v > 0xffffffff) throw new Error(`"${s}" is not a number (use decimal, 0x hex or 0b binary).`);
  return v >>> 0;
};

/**
 * Peripheral register viewer: load a .svd (a file of your own, or one from the
 * loaded CMSIS-Pack), read registers live, decode bit fields, write with a
 * confirmation. Registers whose read has side effects (clear-on-read FIFOs and
 * flags) are never read in bulk.
 */
export default function PeripheralsPanel({ client, guard, setError, pack }) {
  const [svd, setSvd] = useState(null);
  const [svdName, setSvdName] = useState('');
  const [saved, setSaved] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState({}); // address -> value
  const [open, setOpen] = useState('');     // expanded register name
  const [edits, setEdits] = useState({});
  const fileRef = useRef(null);

  useEffect(() => { packStore.list('svd').then(setSaved); }, []);

  const load = (text, name) => {
    const parsed = parseSvd(text);
    setSvd(parsed);
    setSvdName(name);
    setSelected(parsed.peripherals[0]?.name || '');
    setValues({});
    setOpen('');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      load(new TextDecoder().decode(bytes), file.name);
      await packStore.save('svd', file.name, bytes);
      setSaved(await packStore.list('svd'));
    } catch (err) {
      setError(`Could not load ${file.name}: ${err.message}`);
    }
  };

  const loadSaved = async (name) => {
    if (!name) return;
    try {
      const bytes = await packStore.load('svd', name);
      if (!bytes) throw new Error('not in the browser store any more');
      load(new TextDecoder().decode(bytes), name);
    } catch (err) {
      setError(`Could not load ${name}: ${err.message}`);
    }
  };

  const loadFromPack = async (path) => {
    if (!path) return;
    try {
      const bytes = await pack.load(path);
      const name = path.split('/').pop();
      load(new TextDecoder().decode(bytes), name);
      await packStore.save('svd', name, bytes);
      setSaved(await packStore.list('svd'));
    } catch (err) {
      setError(`Could not load ${path}: ${err.message}`);
    }
  };

  const periph = svd?.peripherals.find((p) => p.name === selected);
  const list = useMemo(() => (svd ? svd.peripherals.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())) : []), [svd, filter]);

  const readReg = (reg) => guard('periph', async () => {
    const [w] = await client.target.readWords(reg.address & ~3, 1);
    setValues((v) => ({ ...v, [reg.address]: w }));
  });

  const readAll = () => guard('periph', async () => {
    const next = {};
    for (const reg of periph.registers) {
      if (reg.sideEffects || !isReadable(reg.access)) continue;
      const [w] = await client.target.readWords(reg.address & ~3, 1);
      next[reg.address] = w;
    }
    setValues((v) => ({ ...v, ...next }));
  });

  // Registers narrower than 32 bits live inside a word: shift the value out, mask it back in.
  const rawFor = (reg, word) => {
    const bits = reg.size || 32;
    if (bits >= 32) return word >>> 0;
    return ((word >>> ((reg.address & 3) * 8)) & ((1 << bits) - 1)) >>> 0;
  };

  const writeReg = (reg, newValue, what) => guard('periph', async () => {
    if (!isWritable(reg.access)) throw new Error(`${reg.name} is read-only.`);
    if ((reg.size || 32) < 32) throw new Error(`${reg.name} is ${reg.size} bits wide: writing it through the 32-bit access port would touch its neighbours, so it is not offered.`);
    if (!confirmAction(`Write ${h8(newValue)} to ${periph.name}.${reg.name} (${h8(reg.address)})${what ? ` (${what})` : ''}?\n\nPeripheral writes act immediately on the running hardware.`)) return;
    await client.target.writeWord(reg.address, newValue);
    if (isReadable(reg.access) && !reg.sideEffects) {
      const [w] = await client.target.readWords(reg.address, 1);
      setValues((v) => ({ ...v, [reg.address]: w }));
    }
  });

  const writeField = (reg, field) => {
    const cur = values[reg.address];
    if (cur === undefined) { setError('Read the register first: a field write changes only its own bits of the value read.'); return; }
    if (reg.access === 'write-only') { setError(`${reg.name} is write-only: its current value cannot be read, so single fields cannot be changed. Write the whole register.`); return; }
    try {
      const fv = parseValue(edits[`${reg.name}.${field.name}`] ?? '');
      const next = insertField(rawFor(reg, cur), field, fv);
      writeReg(reg, next, `${field.name} = ${fv}`);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-400">
        Live peripheral registers decoded from a CMSIS-SVD file. Load the .svd for your chip (from the vendor pack, or a file of your own); it is kept in this browser for next time. Reads happen on demand through the debug port; registers whose read changes state are never read in bulk.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => fileRef.current?.click()} className={btn}><Upload className="w-3.5 h-3.5" /> OPEN .SVD</button>
        <input ref={fileRef} type="file" accept=".svd,.xml" className="hidden" onChange={onFile} />
        {saved.length > 0 && (
          <select value="" onChange={(e) => loadSaved(e.target.value)} className={input}>
            <option value="">saved SVDs ({saved.length})</option>
            {saved.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {pack?.svds?.length > 0 && (
          <select value="" onChange={(e) => loadFromPack(e.target.value)} className={input}>
            <option value="">SVD from pack ({pack.svds.length})</option>
            {pack.svds.map((n) => <option key={n} value={n}>{n.split('/').pop()}</option>)}
          </select>
        )}
        {svd && <span className="text-slate-300">{svdName}: {svd.name}, {svd.peripherals.length} peripherals</span>}
      </div>

      {svd && (
        <div className="grid grid-cols-1 @lg:grid-cols-12 gap-3">
          <div className="@lg:col-span-3 flex flex-col gap-1">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter peripherals" className={input} />
            <div className="max-h-72 overflow-y-auto border border-slate-800 rounded">
              {list.map((p) => (
                <button key={p.name} onClick={() => { setSelected(p.name); setOpen(''); }} className={`w-full text-left px-2 py-0.5 ${selected === p.name ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-300 hover:bg-slate-900'}`}>
                  {p.name} <span className="text-slate-500">{h8(p.baseAddress)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="@lg:col-span-9 flex flex-col gap-1">
            {periph ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-cyan-300">{periph.name}</span>
                  <span className="text-slate-500">{h8(periph.baseAddress)}{periph.description ? ` · ${periph.description}` : ''}</span>
                  <button onClick={readAll} className={`${btn} ml-auto`}><RefreshCw className="w-3.5 h-3.5" /> READ ALL</button>
                </div>
                <div className="max-h-96 overflow-y-auto border border-slate-800 rounded">
                  <table className="w-full text-left">
                    <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase sticky top-0">
                      <tr><th className="px-2 py-1">Register</th><th className="px-2 py-1">Address</th><th className="px-2 py-1">Access</th><th className="px-2 py-1">Value</th><th className="px-2 py-1">Reset</th><th /></tr>
                    </thead>
                    <tbody>
                      {periph.registers.map((reg) => {
                        const word = values[reg.address];
                        const raw = word === undefined ? undefined : rawFor(reg, word);
                        const isOpen = open === reg.name;
                        return (
                          <React.Fragment key={`${reg.name}@${reg.address}`}>
                            <tr className="border-t border-slate-900 hover:bg-slate-900/50 cursor-pointer" onClick={() => setOpen(isOpen ? '' : reg.name)} title={reg.description}>
                              <td className="px-2 py-0.5 text-slate-200">{reg.name}{reg.sideEffects && <span className="text-amber-400" title="Reading this register has side effects (clears flags or pops data)"> *</span>}</td>
                              <td className="px-2 py-0.5 text-slate-500">{h8(reg.address)}</td>
                              <td className="px-2 py-0.5 text-slate-500">{reg.access}</td>
                              <td className="px-2 py-0.5 font-bold text-cyan-300">{raw === undefined ? '--' : `0x${raw.toString(16).toUpperCase().padStart((reg.size || 32) / 4, '0')}`}</td>
                              <td className="px-2 py-0.5 text-slate-500">{reg.resetValue === undefined ? '' : `0x${reg.resetValue.toString(16).toUpperCase()}`}</td>
                              <td className="px-2 py-0.5 text-right">
                                <button disabled={!isReadable(reg.access)} onClick={(e) => { e.stopPropagation(); readReg(reg); }} className="text-cyan-400 disabled:opacity-30" title={reg.sideEffects ? 'Read (this has side effects)' : 'Read'}><RefreshCw className="w-3 h-3" /></button>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-slate-950/60">
                                <td colSpan={6} className="px-3 py-2">
                                  {reg.description && <div className="text-slate-500 mb-1">{reg.description}</div>}
                                  {reg.fields.length === 0 && <div className="text-slate-500">No bit fields defined.</div>}
                                  {raw !== undefined && decodeRegister(reg, raw).map((f) => {
                                    const field = reg.fields.find((x) => x.name === f.name && x.bitOffset === f.bitOffset);
                                    const key = `${reg.name}.${f.name}`;
                                    return (
                                      <div key={key} className="flex flex-wrap items-center gap-2 py-0.5">
                                        <span className="w-28 text-slate-300">{f.name}</span>
                                        <span className="text-slate-500 w-14">[{f.bitOffset + f.bitWidth - 1}:{f.bitOffset}]</span>
                                        <span className="text-cyan-300 font-bold w-16">{f.value} (0x{f.value.toString(16)})</span>
                                        <span className="text-emerald-300">{f.enumName || ''}</span>
                                        {isWritable(f.access) && isWritable(reg.access) && (
                                          <>
                                            <input value={edits[key] ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [key]: e.target.value }))} placeholder="new value" className={`${input} w-24`} />
                                            <button onClick={() => writeField(reg, field)} className={btn}><Edit3 className="w-3 h-3" /> WRITE</button>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {raw === undefined && reg.fields.length > 0 && <div className="text-slate-500">Read the register to decode its fields.</div>}
                                  {isWritable(reg.access) && (
                                    <div className="flex items-center gap-2 pt-1 mt-1 border-t border-slate-900">
                                      <span className="text-slate-500 font-bold">WRITE WHOLE REGISTER</span>
                                      <input value={edits[reg.name] ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [reg.name]: e.target.value }))} placeholder="0x..." className={`${input} w-28`} />
                                      <button onClick={() => { try { writeReg(reg, parseValue(edits[reg.name] ?? '')); } catch (err) { setError(err.message); } }} className={btn}>WRITE</button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-slate-500">* reading has side effects: skipped by READ ALL, read it deliberately.</div>
              </>
            ) : <div className="text-slate-500">Pick a peripheral.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
