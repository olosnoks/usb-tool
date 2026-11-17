import React, { useRef, useState } from 'react';
import {
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Zap,
  Usb,
  Upload,
  RefreshCw,
  Eraser,
  Download
} from 'lucide-react';
import { AvrIspClient, fuseHazards, toIntelHex, uploadViaBootloader, ARDUINO_BOARDS } from '../../utils/avrIspDriver';
import { SerialLink } from '../../utils/serialLink';
import { parseIntelHex } from '../../utils/firmwareParser';

import { confirmAction } from '../../utils/sessionLog';
const hex2 = (n) => (n ?? 0).toString(16).padStart(2, '0').toUpperCase();
const bits = (n) => (n ?? 0).toString(2).padStart(8, '0');

const FUSE_FIELDS = [
  ['lfuse', 'LOW FUSE (LFUSE)', 'text-amber-300'],
  ['hfuse', 'HIGH FUSE (HFUSE)', 'text-cyan-300'],
  ['efuse', 'EXTENDED (EFUSE)', 'text-emerald-300'],
  ['lock', 'LOCK BITS', 'text-purple-300']
];

function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Intel HEX text or a raw binary, chosen by file name.
async function readImageFile(file) {
  if (/\.bin$/i.test(file.name)) return { name: file.name, data: new Uint8Array(await file.arrayBuffer()), startAddress: 0 };
  const parsed = parseIntelHex(await file.text());
  if (!parsed.data.length) throw new Error('No data records in the file.');
  return { name: file.name, data: parsed.data, startAddress: parsed.startAddress };
}

export default function AvrIspWorkbench() {
  const [client] = useState(() => new AvrIspClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const [chipInfo, setChipInfo] = useState(null);
  const [programmer, setProgrammer] = useState(null);
  const [fuses, setFuses] = useState(null);       // what the chip holds
  const [draft, setDraft] = useState({});          // what the user typed
  const [image, setImage] = useState(null);        // { name, data, startAddress }
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState('');
  const [mode, setMode] = useState('isp'); // 'isp' | 'bootloader'
  const [board, setBoard] = useState('uno');
  const [baud, setBaud] = useState(ARDUINO_BOARDS.uno.baud);
  const [preserveEeprom, setPreserveEeprom] = useState(false);
  const [hexOut, setHexOut] = useState(true);
  const fileRef = useRef(null);
  const verifyRef = useRef(null);
  const eepromRef = useRef(null);

  const run = async (label, fn) => {
    setBusy(label);
    setResult('');
    try {
      await fn();
    } catch (err) {
      setResult(`ERROR: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const identify = async () => {
    const chip = await client.readSignature();
    setChipInfo(chip);
    const f = await client.readFuses();
    setFuses(f);
    setDraft({ lfuse: `0x${hex2(f.lfuse)}`, hfuse: `0x${hex2(f.hfuse)}`, efuse: `0x${hex2(f.efuse)}`, lock: `0x${hex2(f.lock)}` });
  };

  const handleConnectHardware = () => run('connect', async () => {
    const info = await client.connectHardware();
    setProgrammer(info);
    setIsConnected(true);
    await identify();
  });

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setChipInfo(null);
    setFuses(null);
    setResult('');
  };

  const parsedDraft = () => {
    const out = {};
    for (const [k] of FUSE_FIELDS) {
      const v = parseInt(String(draft[k] ?? '').replace(/^0x/i, ''), 16);
      if (Number.isNaN(v) || v < 0 || v > 0xff) throw new Error(`${k.toUpperCase()} must be a hex byte (00-FF).`);
      out[k] = v;
    }
    return out;
  };

  const handleWriteFuses = () => run('fuses', async () => {
    const next = parsedDraft();
    const hazards = fuseHazards(client.chip, next);
    let allowHazards = false;
    if (hazards.length) {
      allowHazards = confirmAction(`These fuse values can lock you out of the chip:\n\n${hazards.join('\n\n')}\n\nWrite them anyway?`);
      if (!allowHazards) return;
    } else if (!confirmAction(`Write L=0x${hex2(next.lfuse)} H=0x${hex2(next.hfuse)} E=0x${hex2(next.efuse)} to the ${chipInfo?.name || 'chip'}?`)) {
      return;
    }
    const back = await client.writeFuses(next, { allowHazards });
    setFuses(back);
    setResult(`SUCCESS: Fuses written and read back: L=0x${hex2(back.lfuse)} H=0x${hex2(back.hfuse)} E=0x${hex2(back.efuse)}.`);
  });

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseIntelHex(String(ev.target.result));
        if (!parsed.data.length) throw new Error('No data records in the file.');
        setImage({ name: file.name, data: parsed.data, startAddress: parsed.startAddress });
        setResult('');
      } catch (err) {
        setResult(`ERROR: ${file.name} is not a valid Intel HEX file (${err.message}).`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Explain what the chip erase in the next step does to the EEPROM, from the high fuse.
  const eraseWarning = async () => {
    const impact = await client.eraseImpact();
    setFuses(await client.readFuses());
    return impact;
  };

  const eepromNote = (impact) => (impact.status === 'preserved'
    ? impact.text
    : `WARNING: ${impact.text}${preserveEeprom ? '\n\n"Keep EEPROM" is on: it is read first and written back afterwards.' : '\n\nTick "keep EEPROM" to dump it first and restore it after the erase.'}`);

  const handleFlash = () => run('flash', async () => {
    const impact = await eraseWarning();
    if (!confirmAction(`Erase the ${chipInfo?.name || 'chip'} and write ${image.name}?\n\n${eepromNote(impact)}`)) return;
    setProgress(0);
    const r = await client.flashImage(image, { onProgress: setProgress, preserveEeprom });
    setResult(`SUCCESS: ${image.name} written and verified (${r.bytes} bytes).`);
  });

  const handleReadFlash = () => run('read', async () => {
    setProgress(0);
    const data = await client.readFlash({ onProgress: (f) => setProgress(Math.round(f * 100)) });
    const base = `${(chipInfo?.name || 'avr').toLowerCase()}-flash`;
    if (hexOut) download(`${base}.hex`, toIntelHex(data, 0), 'text/plain');
    else download(`${base}.bin`, data);
    setResult(`SUCCESS: Read ${data.length} bytes of flash and saved ${hexOut ? 'an Intel HEX' : 'a binary'} file.`);
  });

  const handleVerifyFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run('verify', async () => {
      const img = await readImageFile(file);
      setProgress(0);
      const r = await client.verifyFlash(img, { onProgress: (f) => setProgress(Math.round(f * 100)) });
      if (!r.ok) throw new Error(`Flash differs from ${file.name}: first difference at 0x${r.firstMismatch.toString(16)} (file 0x${hex2(r.expected)}, chip 0x${hex2(r.actual)}).`);
      setResult(`SUCCESS: Flash matches ${file.name} (${r.checked} bytes compared).`);
    });
  };

  const handleReadEeprom = () => run('eeprom-read', async () => {
    setProgress(0);
    const data = await client.readEeprom({ onProgress: (f) => setProgress(Math.round(f * 100)) });
    const base = `${(chipInfo?.name || 'avr').toLowerCase()}-eeprom`;
    if (hexOut) download(`${base}.eep`, toIntelHex(data, 0, { skipBlank: false }), 'text/plain');
    else download(`${base}.bin`, data);
    setResult(`SUCCESS: Read ${data.length} bytes of EEPROM.`);
  });

  const handleWriteEeprom = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run('eeprom-write', async () => {
      const img = await readImageFile(file);
      if (!confirmAction(`Write ${img.data.length} bytes from ${file.name} into the EEPROM of the ${chipInfo?.name || 'chip'} at 0x${img.startAddress.toString(16)}? Only bytes that differ are written, then everything is read back.`)) return;
      setProgress(0);
      const r = await client.writeEeprom(img.data, { start: img.startAddress, onProgress: (f) => setProgress(Math.round(f * 100)) });
      setResult(`SUCCESS: EEPROM written and verified (${r.bytes} bytes, ${r.written} changed).`);
    });
  };

  const handleBootloaderUpload = () => run('bootloader', async () => {
    const b = ARDUINO_BOARDS[board];
    if (!image) throw new Error('Load the sketch .hex first (Arduino IDE: Sketch > Export Compiled Binary).');
    if (!confirmAction(`Upload ${image.name} to ${b.name} at ${baud} baud through its bootloader?\n\nThe board is reset with DTR. No fuses are touched and no chip erase is issued.`)) return;
    setProgress(0);
    const link = await SerialLink.request({ name: 'Arduino bootloader upload', release: () => {} }, { baudRate: Number(baud) });
    try {
      const r = await uploadViaBootloader(link, image, { board: b, onProgress: setProgress, log: (m) => console.log(`[AVR bootloader] ${m}`) });
      setResult(`SUCCESS: ${image.name} uploaded and verified (${r.bytes} bytes). The sketch is starting.`);
    } finally {
      await link.close();
    }
  });

  const handleBurn = () => run('burn', async () => {
    if (!image) throw new Error('Load the bootloader .hex first (for example optiboot_atmega328.hex from the Arduino IDE).');
    const f = client.chip?.defaultFuses;
    if (!f) throw new Error(`The Arduino fuse defaults for the ${client.chip?.name || 'chip'} are not known, so burning a bootloader is disabled for it.`);
    if (!confirmAction(`Burn ${image.name} as the bootloader?\n\nThis erases the chip, sets fuses L=0x${hex2(f.lfuse)} H=0x${hex2(f.hfuse)} E=0x${hex2(f.efuse)} and lock 0x${hex2(f.lock)}.`)) return;
    setProgress(0);
    await client.burnBootloader(image, setProgress);
    const back = await client.readFuses();
    setFuses(back);
    setResult('SUCCESS: Bootloader written, verified and protected.');
  });

  const handleErase = () => run('erase', async () => {
    const impact = await eraseWarning();
    if (!confirmAction(`Erase all flash on the ${chipInfo?.name || 'target'} and clear its lock bits?\n\n${eepromNote(impact)}`)) return;
    setProgress(0);
    await client.chipErase({ preserveEeprom, onProgress: setProgress });
    setResult(`SUCCESS: Chip erased${preserveEeprom ? ', EEPROM restored' : ''}.`);
  });

  const ready = isConnected && !busy;

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <div className="flex gap-1 mb-2">
              {[['isp', 'ISP PROGRAMMER (ARDUINOISP)'], ['bootloader', 'ARDUINO BOOTLOADER UPLOAD']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  disabled={!!busy}
                  className={`px-2.5 py-1 rounded border text-[11px] font-bold disabled:opacity-40 ${mode === id ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              {mode === 'isp'
                ? 'Uses an Arduino running the ArduinoISP sketch (or any STK500v1 programmer) at 19200 baud. Wire programmer pins 10/11/12/13 to the target’s RESET/MOSI/MISO/SCK.'
                : 'Uploads a sketch to an Arduino that already has a bootloader, like avrdude -c arduino. No programmer, fuses or chip erase involved.'}
            </p>
          </div>

          <div className={`flex items-center gap-2 ${mode === 'isp' ? '' : 'hidden'}`}>
            {!isConnected ? (
              <button
                onClick={handleConnectHardware}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs disabled:opacity-40"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>{busy === 'connect' ? 'CONNECTING...' : 'CONNECT ARDUINOISP (SERIAL)'}</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => run('identify', identify)}
                  disabled={!ready}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-slate-700 text-xs font-bold disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy === 'identify' ? 'animate-spin' : ''}`} />
                  <span>RE-READ CHIP</span>
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
                >
                  <span>DISCONNECT</span>
                </button>
              </>
            )}
          </div>
        </div>

        {mode === 'isp' && isConnected && chipInfo && (
          <div className="pt-3 grid grid-cols-2 @sm:grid-cols-4 gap-3 text-[11px]">
            <Card label="Target Microcontroller" value={chipInfo.name} sub={chipInfo.family} color="text-amber-300" />
            <Card label="Signature" value={`0x${(chipInfo.signature ?? 0).toString(16).toUpperCase().padStart(6, '0')}`} sub="Read over ISP" color="text-cyan-300" />
            <Card
              label="Flash Memory"
              value={chipInfo.flashSize ? `${(chipInfo.flashSize / 1024).toFixed(0)} KB` : 'unknown'}
              sub={chipInfo.pageSize ? `${chipInfo.pageSize}-byte pages · EEPROM ${chipInfo.eepromSize} B` : 'Not in the chip list'}
              color="text-emerald-300"
            />
            <Card
              label="Programmer"
              value="STK500v1"
              sub={programmer ? `HW v${programmer.hw} · FW ${programmer.sw}` : ''}
              color="text-purple-300"
            />
          </div>
        )}
      </div>

      {result && (
        <div className={`p-2.5 rounded-lg border text-xs font-bold flex items-start gap-2 ${
          result.startsWith('SUCCESS') ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40' : 'bg-rose-500/10 text-rose-300 border-rose-500/40'
        }`}>
          {result.startsWith('SUCCESS') ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{result}</span>
        </div>
      )}

      <div className={`grid grid-cols-1 @lg:grid-cols-3 gap-4 ${mode === 'isp' ? '' : 'hidden'}`}>
        <div className="@lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>FUSES AND LOCK BITS</span>
            </span>
            <span className="text-[10px] text-slate-500">0 = programmed. Edit, then write.</span>
          </div>

          <div className="grid grid-cols-2 @sm:grid-cols-4 gap-3">
            {FUSE_FIELDS.map(([k, label, color]) => (
              <div key={k} className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">{label}</span>
                <div className={`text-xl font-extrabold ${color}`}>{fuses ? `0x${hex2(fuses[k])}` : '--'}</div>
                <div className="text-[10px] text-slate-500 tracking-widest">{fuses ? bits(fuses[k]) : '--------'}</div>
                <input
                  type="text"
                  value={draft[k] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  disabled={!isConnected || k === 'lock' || (k === 'efuse' && client.chip?.noEfuse)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs disabled:opacity-40"
                />
              </div>
            ))}
          </div>
          {chipInfo?.defaultFuses && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span>Arduino defaults for {chipInfo.name}: L=0x{hex2(chipInfo.defaultFuses.lfuse)} H=0x{hex2(chipInfo.defaultFuses.hfuse)} E=0x{hex2(chipInfo.defaultFuses.efuse)}</span>
              <button
                onClick={() => setDraft((d) => ({ ...d, lfuse: `0x${hex2(chipInfo.defaultFuses.lfuse)}`, hfuse: `0x${hex2(chipInfo.defaultFuses.hfuse)}`, efuse: `0x${hex2(chipInfo.defaultFuses.efuse)}` }))}
                className="px-2 py-0.5 rounded border border-slate-700 text-cyan-300"
              >
                use these
              </button>
            </div>
          )}
          <button
            onClick={handleWriteFuses}
            disabled={!ready || !fuses}
            className="w-full py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold text-xs disabled:opacity-40"
          >
            {busy === 'fuses' ? 'WRITING FUSES...' : 'WRITE FUSES'}
          </button>
          <p className="text-[10px] text-slate-500">
            Writes that would disable ISP (SPIEN, RSTDISBL, DWEN) need a second confirmation. The values are read back after writing.
          </p>
        </div>

        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>FLASH & BOOTLOADER</span>
            </span>
          </div>

          <input type="file" ref={fileRef} accept=".hex,.ihx" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{image ? `${image.name} (${image.data.length} B @ 0x${image.startAddress.toString(16)})` : 'LOAD .HEX FILE'}</span>
          </button>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            For a bootloader, load the matching file from the Arduino IDE, for example
            hardware/arduino/avr/bootloaders/optiboot/optiboot_atmega328.hex.
          </p>

          {['flash', 'burn', 'read', 'verify', 'eeprom-read', 'eeprom-write', 'erase', 'bootloader'].includes(busy) && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-amber-300 font-bold">
                <span>{{ burn: 'Burning bootloader...', read: 'Reading flash...', verify: 'Verifying flash...', 'eeprom-read': 'Reading EEPROM...', 'eeprom-write': 'Writing EEPROM...', erase: 'Erasing...', bootloader: 'Uploading through the bootloader...' }[busy] || 'Writing flash...'}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-400" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <button
            onClick={handleFlash}
            disabled={!ready || !image}
            className="w-full py-2 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-xs disabled:opacity-40"
          >
            ERASE, WRITE & VERIFY HEX
          </button>
          <button
            onClick={handleBurn}
            disabled={!ready || !image || !chipInfo?.defaultFuses}
            title={chipInfo && !chipInfo.defaultFuses ? 'The Arduino fuse defaults for this chip are not known.' : ''}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-extrabold text-xs disabled:opacity-40"
          >
            {busy === 'burn' ? 'PROGRAMMING BOOTLOADER...' : 'BURN AS BOOTLOADER (FUSES + LOCK)'}
          </button>
          <label className="flex items-start gap-1.5 text-[10px] text-slate-400 leading-relaxed">
            <input type="checkbox" checked={preserveEeprom} onChange={(e) => setPreserveEeprom(e.target.checked)} className="accent-amber-500 mt-0.5" />
            <span>Keep EEPROM: read it before an erase and write it back afterwards. Without this, ERASE wipes the EEPROM unless the EESAVE fuse is programmed (checked from the high fuse before each erase).</span>
          </label>
          <button
            onClick={handleErase}
            disabled={!ready}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30 font-bold text-[11px] disabled:opacity-40"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>CHIP ERASE</span>
          </button>

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Read, verify, EEPROM</span>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <input type="checkbox" checked={hexOut} onChange={(e) => setHexOut(e.target.checked)} className="accent-cyan-500" />
              <span>Save as Intel HEX (otherwise raw .bin)</span>
            </label>
            <input type="file" ref={verifyRef} accept=".hex,.ihx,.bin" className="hidden" onChange={handleVerifyFile} />
            <input type="file" ref={eepromRef} accept=".hex,.eep,.bin" className="hidden" onChange={handleWriteEeprom} />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleReadFlash} disabled={!ready || !chipInfo?.flashSize} className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 font-bold text-[11px] disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /><span>READ FLASH</span>
              </button>
              <button onClick={() => verifyRef.current?.click()} disabled={!ready || !chipInfo?.flashSize} className="py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-emerald-300 font-bold text-[11px] disabled:opacity-40">
                VERIFY AGAINST FILE
              </button>
              <button onClick={handleReadEeprom} disabled={!ready || !chipInfo?.eepromSize} className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 font-bold text-[11px] disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /><span>READ EEPROM</span>
              </button>
              <button onClick={() => eepromRef.current?.click()} disabled={!ready || !chipInfo?.eepromSize} className="py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 font-bold text-[11px] disabled:opacity-40">
                WRITE EEPROM FILE
              </button>
            </div>
            <p className="text-[10px] text-slate-500">EEPROM goes through ISP byte commands, so a 4 KB EEPROM takes a while at 19200 baud. Writes only touch bytes that differ and are read back.</p>
          </div>
        </div>
      </div>

      {mode === 'bootloader' && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3 max-w-xl">
          <div className="flex items-center gap-1.5 pb-2 border-b border-slate-800 font-bold text-slate-200 text-xs">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>UPLOAD THROUGH THE ARDUINO BOOTLOADER (STK500v1)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Board</span>
              <select
                value={board}
                onChange={(e) => { setBoard(e.target.value); setBaud(ARDUINO_BOARDS[e.target.value].baud); }}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
              >
                {Object.entries(ARDUINO_BOARDS).map(([id, b]) => <option key={id} value={id}>{b.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Baud rate</span>
              <select
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
              >
                {[115200, 57600, 38400, 19200].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{image ? `${image.name} (${image.data.length} B @ 0x${image.startAddress.toString(16)})` : 'LOAD SKETCH .HEX FILE'}</span>
          </button>
          {busy === 'bootloader' && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-amber-300 font-bold"><span>Uploading...</span><span>{progress}%</span></div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-400" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <button
            onClick={handleBootloaderUpload}
            disabled={!!busy || !image}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-extrabold text-xs disabled:opacity-40"
          >
            {busy === 'bootloader' ? 'UPLOADING...' : 'UPLOAD SKETCH'}
          </button>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            The board is reset with the serial DTR line, then talks STK500v1 (optiboot or ATmegaBOOT). Pages are written and read back; fuses and the chip erase command are never sent.
            The image must be the sketch (starting at 0), not a bootloader, and must stay below the bootloader. Boards with other bootloaders (Mega 2560 uses STK500v2, Leonardo/Micro use AVR109) are not supported here.
            The Nano&apos;s old bootloader runs at 57600; a Pro Mini is normally 57600 too, and an Uno or new-bootloader Nano is 115200.
          </p>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, color }) {
  return (
    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
      <span className="text-[10px] text-slate-500 uppercase font-bold block">{label}</span>
      <span className={`font-extrabold text-sm ${color}`}>{value}</span>
      <span className="text-[10px] text-slate-400 block">{sub}</span>
    </div>
  );
}
