import React, { useState, useRef } from 'react';
import { Send, X, Upload, Cpu, Square } from 'lucide-react';
import { bytesToHex } from '../../../utils/bleDriver';
import { WRITE_FORMATS, encodeValue, DFU_UUIDS, NordicSecureDfu, readDfuPackage, enterBootloader } from '../../../utils/nordicDfu';

import { confirmAction } from '../../../utils/sessionLog';
const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none';
const btn = 'flex items-center gap-1 px-2.5 py-1 rounded border font-bold disabled:opacity-40';

/** Compose a value in a chosen format and write it to one characteristic. */
export function WriteComposer({ ch, onClose, onWritten, addLog }) {
  const [format, setFormat] = useState('hex');
  const [text, setText] = useState('');
  const [mode, setMode] = useState(ch.properties.write ? 'response' : 'noresponse');
  const [history, setHistory] = useState([]);
  let preview = null;
  let problem = '';
  try { preview = text ? encodeValue(text, format) : null; } catch (e) { problem = e.message; }

  const send = async (bytes = preview) => {
    if (!bytes) return;
    try {
      if (mode === 'noresponse') await ch._ref.writeValueWithoutResponse(bytes);
      else await ch._ref.writeValueWithResponse(bytes);
      addLog(`Wrote ${bytesToHex(bytes)} to ${ch.name}${mode === 'noresponse' ? ' (no response)' : ''}.`, 'ok');
      setHistory((h) => [{ format, text, hex: bytesToHex(bytes), bytes }, ...h.filter((x) => x.hex !== bytesToHex(bytes))].slice(0, 10));
      onWritten?.();
    } catch (err) {
      addLog(`Write ${ch.name} failed: ${err.message}`, 'err');
    }
  };

  return (
    <div className="bg-[#030712] border border-cyan-500/40 rounded-xl p-3 shadow-xl space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-bold text-cyan-300 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> WRITE TO {ch.name}</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className={inp}>
          {Object.entries(WRITE_FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !problem && send()} placeholder={format === 'hex' ? '01 ff a0' : format === 'utf8' ? 'text' : '1, 2, 3'} className={`${inp} flex-1 min-w-[10rem]`} autoFocus />
        {ch.properties.write && ch.properties.writeWithoutResponse && (
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={inp}>
            <option value="response">with response</option>
            <option value="noresponse">without response</option>
          </select>
        )}
        <button onClick={() => send()} disabled={!preview || !!problem} className={`${btn} border-cyan-500/40 text-cyan-300`}><Send className="w-3 h-3" /> WRITE</button>
      </div>
      <div className={problem ? 'text-rose-300' : 'text-slate-500'}>{problem || (preview ? `${preview.length} byte(s): ${bytesToHex(preview)}` : 'Type a value.')}</div>
      {history.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {history.map((h) => (
            <button key={h.hex} onClick={() => send(h.bytes)} title={`${WRITE_FORMATS[h.format]}: ${h.text}`} className="px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-cyan-300">{h.hex}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Firmware update for devices with the Nordic Secure DFU service (0xFE59). */
export function DfuPanel({ tree, addLog }) {
  const service = tree.find((s) => s.uuid === DFU_UUIDS.SERVICE);
  const [parts, setParts] = useState(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState(null); // { phase, fraction, part }
  const [running, setRunning] = useState(false);
  const fileRef = useRef(null);
  if (!service) return null;
  const find = (uuid) => service.characteristics.find((c) => c.uuid === uuid);
  const control = find(DFU_UUIDS.CONTROL);
  const packet = find(DFU_UUIDS.PACKET);
  const buttonless = find(DFU_UUIDS.BUTTONLESS) || find(DFU_UUIDS.BUTTONLESS_BONDED);
  const inBootloader = !!(control && packet);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setParts(await readDfuPackage(new Uint8Array(await file.arrayBuffer())));
      setFileName(file.name);
    } catch (err) {
      addLog(`${file.name}: ${err.message}`, 'err');
    }
  };

  const toBootloader = async () => {
    try {
      await enterBootloader(buttonless._ref);
      addLog('The device is restarting into its bootloader. Reconnect and pick the device named "DfuTarg" (its address is usually one higher).', 'ok');
    } catch (err) {
      addLog(`Enter bootloader: ${err.message}`, 'err');
    }
  };

  const flash = async () => {
    const part = parts[0];
    const rest = parts.length - 1;
    if (!confirmAction(`Update the device with ${fileName} (${part.type}, ${part.firmware.length} bytes)?\n\nKeep the device close and powered. If the link drops, reconnect to DfuTarg and start again: it resumes.`)) return;
    setRunning(true);
    const dfu = new NordicSecureDfu(control._ref, packet._ref, { chunkSize: 20, log: (m) => addLog(m, 'info') });
    try {
      await dfu.start();
      const t0 = performance.now();
      await dfu.update(part, (phase, fraction) => setProgress({ phase, fraction, part: part.type }));
      addLog(`${part.type} sent in ${((performance.now() - t0) / 1000).toFixed(1)} s and validated; the device is rebooting.${rest ? ` This package has ${rest} more part(s): reconnect to DfuTarg and flash again for the next one.` : ''}`, 'ok');
      if (rest) setParts(parts.slice(1));
    } catch (err) {
      addLog(`DFU: ${err.message}`, 'err');
    } finally {
      dfu.stop();
      setRunning(false);
    }
  };

  return (
    <div className="bg-[#030712] border border-amber-500/40 rounded-xl p-4 shadow-xl space-y-2 text-xs">
      <div className="font-bold text-amber-300 flex items-center gap-1.5"><Cpu className="w-4 h-4" /> NORDIC SECURE DFU (FIRMWARE UPDATE)</div>
      {inBootloader ? (
        <>
          <p className="text-slate-400">The device is in its DFU bootloader. Pick a DFU package (.zip from nrfutil / the vendor). It must be signed with the key the bootloader trusts.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={onFile} />
            <button onClick={() => fileRef.current?.click()} disabled={running} className={`${btn} border-slate-700 text-slate-200`}><Upload className="w-3 h-3" /> {fileName || 'OPEN DFU .ZIP'}</button>
            {parts && <span className="text-slate-400">{parts.map((p) => `${p.type} (${p.firmware.length} B)`).join(' → ')}</span>}
            <button onClick={flash} disabled={!parts || running} className={`${btn} border-amber-500/50 text-amber-300`}>{running ? <><Square className="w-3 h-3" /> UPDATING</> : 'START UPDATE'}</button>
          </div>
          {progress && (
            <div className="space-y-1">
              <div className="text-slate-400">{progress.part}: {progress.phase === 'init' ? 'init packet' : 'firmware'} {Math.round(progress.fraction * 100)}%</div>
              <div className="h-1.5 bg-slate-900 rounded"><div className="h-1.5 bg-amber-400 rounded" style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
            </div>
          )}
        </>
      ) : buttonless ? (
        <>
          <p className="text-slate-400">This application supports buttonless DFU. Restart it into the bootloader, then reconnect to the device advertising as DfuTarg to flash.</p>
          <button onClick={toBootloader} className={`${btn} border-amber-500/50 text-amber-300`}>ENTER BOOTLOADER</button>
        </>
      ) : (
        <p className="text-slate-500">The DFU service is present but neither the bootloader nor the buttonless characteristic is exposed.</p>
      )}
    </div>
  );
}
