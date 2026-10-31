import React, { useRef, useState } from 'react';
import {
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Sliders,
  Zap,
  Usb,
  Upload,
  RefreshCw,
  Eraser
} from 'lucide-react';
import { AvrIspClient, fuseHazards } from '../../utils/avrIspDriver';
import { parseIntelHex } from '../../utils/firmwareParser';
import { DemoBanner } from '../common/DemoNotice';

const hex2 = (n) => (n ?? 0).toString(16).padStart(2, '0').toUpperCase();
const bits = (n) => (n ?? 0).toString(2).padStart(8, '0');

const FUSE_FIELDS = [
  ['lfuse', 'LOW FUSE (LFUSE)', 'text-amber-300'],
  ['hfuse', 'HIGH FUSE (HFUSE)', 'text-cyan-300'],
  ['efuse', 'EXTENDED (EFUSE)', 'text-emerald-300'],
  ['lock', 'LOCK BITS', 'text-purple-300']
];

export default function AvrIspWorkbench() {
  const [client] = useState(() => new AvrIspClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [busy, setBusy] = useState('');
  const [chipInfo, setChipInfo] = useState(null);
  const [programmer, setProgrammer] = useState(null);
  const [fuses, setFuses] = useState(null);       // what the chip holds
  const [draft, setDraft] = useState({});          // what the user typed
  const [image, setImage] = useState(null);        // { name, data, startAddress }
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState('');
  const fileRef = useRef(null);

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
    setIsSimulated(false);
    await identify();
  });

  const handleConnectSimulation = () => run('connect', async () => {
    client.connectSimulation();
    setProgrammer(null);
    setIsConnected(true);
    setIsSimulated(true);
    await identify();
  });

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
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
      allowHazards = window.confirm(`These fuse values can lock you out of the chip:\n\n${hazards.join('\n\n')}\n\nWrite them anyway?`);
      if (!allowHazards) return;
    } else if (!isSimulated && !window.confirm(`Write L=0x${hex2(next.lfuse)} H=0x${hex2(next.hfuse)} E=0x${hex2(next.efuse)} to the ${chipInfo?.name || 'chip'}?`)) {
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

  const handleFlash = () => run('flash', async () => {
    if (!isSimulated && !window.confirm(`Erase the ${chipInfo?.name || 'chip'} and write ${image.name}?`)) return;
    setProgress(0);
    const r = await client.flashImage(image, { onProgress: setProgress });
    setResult(`SUCCESS: ${image.name} written and verified (${r.bytes} bytes).`);
  });

  const handleBurn = () => run('burn', async () => {
    if (!isSimulated && !image) throw new Error('Load the bootloader .hex first (for example optiboot_atmega328.hex from the Arduino IDE).');
    const f = client.chip?.defaultFuses;
    if (!isSimulated && !window.confirm(`Burn ${image.name} as the bootloader?\n\nThis erases the chip, sets fuses L=0x${hex2(f.lfuse)} H=0x${hex2(f.hfuse)} E=0x${hex2(f.efuse)} and lock 0x${hex2(f.lock)}.`)) return;
    setProgress(0);
    await client.burnBootloader(image || { data: new Uint8Array(512), startAddress: 0x7e00 }, setProgress);
    const back = await client.readFuses();
    setFuses(back);
    setResult(`SUCCESS: Bootloader written, verified and protected${isSimulated ? ' (simulated)' : ''}.`);
  });

  const handleErase = () => run('erase', async () => {
    if (!isSimulated && !window.confirm('Erase all flash and EEPROM on the target?')) return;
    await client.chipErase();
    setResult('SUCCESS: Chip erased.');
  });

  const ready = isConnected && !busy;

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && (
        <DemoBanner>Simulated programmer and ATmega328P. Nothing is sent to hardware.</DemoBanner>
      )}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>AVR ISP BOOTLOADER & FUSE PROGRAMMER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Uses an Arduino running the ArduinoISP sketch (or any STK500v1 programmer) at 19200 baud.
              Wire programmer pins 10/11/12/13 to the target&apos;s RESET/MOSI/MISO/SCK.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnectHardware}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs disabled:opacity-40"
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>{busy === 'connect' ? 'CONNECTING...' : 'CONNECT ARDUINOISP (SERIAL)'}</span>
                </button>
                <button
                  onClick={handleConnectSimulation}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-amber-300 border border-amber-500/40 text-xs font-bold disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>DEMO</span>
                </button>
              </>
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

        {isConnected && chipInfo && (
          <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
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
              value={isSimulated ? 'Simulated' : 'STK500v1'}
              sub={programmer ? `HW v${programmer.hw} · FW ${programmer.sw}` : 'Virtual target'}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>FUSES AND LOCK BITS</span>
            </span>
            <span className="text-[10px] text-slate-500">0 = programmed. Edit, then write.</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

          {['flash', 'burn'].includes(busy) && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-amber-300 font-bold">
                <span>{busy === 'burn' ? 'Burning bootloader...' : 'Writing flash...'}</span>
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
            disabled={!ready || (!isSimulated && !image)}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-extrabold text-xs disabled:opacity-40"
          >
            {busy === 'burn' ? 'PROGRAMMING BOOTLOADER...' : 'BURN AS BOOTLOADER (FUSES + LOCK)'}
          </button>
          <button
            onClick={handleErase}
            disabled={!ready}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30 font-bold text-[11px] disabled:opacity-40"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>CHIP ERASE</span>
          </button>
        </div>
      </div>
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
