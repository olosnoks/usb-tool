import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Radio, HardDrive, Crosshair, Download, Play, Square, Upload, Trash2, Send } from 'lucide-react';
import { parseFlm, readPack, flmSectors, loadFirmwareImage, itmText } from '../../../utils/cortexDebug';

import { confirmAction } from '../../../utils/sessionLog';
const parseHex = (s) => {
  const v = parseInt(String(s).trim().replace(/^0x/i, ''), 16);
  if (Number.isNaN(v)) throw new Error(`"${s}" is not a hex number.`);
  return v >>> 0;
};
const parseNum = (s) => {
  const t = String(s).trim();
  const v = /^0x/i.test(t) ? parseInt(t, 16) : Number(t.replace(/k$/i, '')) * (/k$/i.test(t) ? 1024 : 1);
  if (!Number.isFinite(v)) throw new Error(`"${s}" is not a number.`);
  return v;
};
const h8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const MAX_LOG = 200_000;

const input = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-cyan-300 outline-none';
const btn = 'flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold disabled:opacity-40';

const TABS = [
  { id: 'rtt', label: 'RTT CONSOLE', icon: Terminal },
  { id: 'swo', label: 'SWO / ITM', icon: Radio },
  { id: 'flash', label: 'FLASH', icon: HardDrive },
  { id: 'bp', label: 'BREAK / WATCH', icon: Crosshair },
  { id: 'dump', label: 'DUMP', icon: Download }
];

/**
 * RTT, SWO, flash programming, hardware breakpoints and memory dumps for the
 * CMSIS-DAP debugger. `busyRef` is shared with the parent so background
 * polling never interleaves with other probe commands.
 */
export default function DebugFeaturesPanel({ client, guard, busyRef, isSimulated, targetState, setTargetState, setError }) {
  const [tab, setTab] = useState('rtt');

  // RTT
  const [rttStart, setRttStart] = useState('0x20000000');
  const [rttSize, setRttSize] = useState('64k');
  const [rttAddr, setRttAddr] = useState('');
  const [rtt, setRtt] = useState(null); // { address, up, down }
  const [rttLogs, setRttLogs] = useState({});
  const [rttChannel, setRttChannel] = useState(0);
  const [rttInput, setRttInput] = useState('');
  const [rttEol, setRttEol] = useState('\n');
  const [scanProgress, setScanProgress] = useState(0);

  // SWO
  const [cpuHz, setCpuHz] = useState('72000000');
  const [swoBaud, setSwoBaud] = useState('2000000');
  const [stm32, setStm32] = useState(true);
  const [swo, setSwo] = useState(null);
  const [swoText, setSwoText] = useState({});
  const [swoStats, setSwoStats] = useState({ packets: 0, overflows: 0, other: 0 });

  // Flash
  const [pack, setPack] = useState(null); // readPack() result + file name
  const [packDevice, setPackDevice] = useState('');
  const [packAlgo, setPackAlgo] = useState('');
  const [flm, setFlm] = useState(null);
  const [ramBase, setRamBase] = useState('0x20000000');
  const [ramSize, setRamSize] = useState('0x4000');
  const [image, setImage] = useState(null); // { name, bytes }
  const [binBase, setBinBase] = useState('0x08000000');
  const [chipErase, setChipErase] = useState(false);
  const [verify, setVerify] = useState(true);
  const [runAfter, setRunAfter] = useState(true);
  const [flashProgress, setFlashProgress] = useState(null);
  const [flashResult, setFlashResult] = useState('');
  const algoInput = useRef(null);
  const imageInput = useRef(null);

  // Breakpoints
  const [units, setUnits] = useState(null);
  const [bpAddr, setBpAddr] = useState('0x08000100');
  const [wpAddr, setWpAddr] = useState('0x20000000');
  const [wpSize, setWpSize] = useState(4);
  const [wpAccess, setWpAccess] = useState('write');
  const [, setBpTick] = useState(0);

  // Dump
  const [dumpAddr, setDumpAddr] = useState('0x08000000');
  const [dumpLen, setDumpLen] = useState('64k');
  const [dumpProgress, setDumpProgress] = useState(null);

  const append = (setter, key, text) => setter((prev) => {
    const next = ((prev[key] || '') + text);
    return { ...prev, [key]: next.length > MAX_LOG ? next.slice(-MAX_LOG) : next };
  });

  // Poll RTT / SWO while running, skipping ticks when another probe action is in progress.
  useEffect(() => {
    if (!rtt && !swo) return undefined;
    const t = setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        if (rtt) {
          for (const { channel, bytes } of await client.rttPoll()) append(setRttLogs, channel, stripAnsi(new TextDecoder().decode(bytes)));
        }
        if (swo) {
          const packets = await client.readSwo();
          if (packets.length) {
            for (const [port, text] of Object.entries(itmText(packets))) append(setSwoText, port, text);
            setSwoStats((s) => ({
              packets: s.packets + packets.filter((p) => p.type === 'stimulus').length,
              overflows: s.overflows + packets.filter((p) => p.type === 'overflow').length,
              other: s.other + packets.filter((p) => p.type !== 'stimulus' && p.type !== 'overflow' && p.type !== 'sync').length
            }));
          }
        }
      } catch (e) {
        setError(`${swo ? 'SWO' : 'RTT'} stopped: ${e.message}`);
        setRtt(null);
        setSwo(null);
        client.stopSwo();
      } finally {
        busyRef.current = false;
      }
    }, 100);
    return () => clearInterval(t);
  }, [rtt, swo]);

  useEffect(() => () => { client.stopSwo(); }, []);

  const startRtt = () => guard('rtt', async () => {
    setScanProgress(0);
    const r = await client.findRtt({
      address: rttAddr.trim() ? parseHex(rttAddr) : undefined,
      start: parseHex(rttStart),
      size: parseNum(rttSize),
      onProgress: setScanProgress
    });
    setRtt(r);
    setRttChannel(r.up[0]?.index ?? 0);
    setRttAddr(h8(r.address));
  });

  const sendRtt = () => guard('rtt-write', async () => {
    const data = new TextEncoder().encode(rttInput + rttEol);
    const n = await client.rttWrite(rtt.down[0].index, data);
    if (n < data.length) setError(`Only ${n} of ${data.length} bytes fit in the RTT down buffer; the target is not reading it.`);
    setRttInput('');
  });

  const startSwo = () => guard('swo', async () => {
    const s = await client.startSwo({ cpuHz: parseNum(cpuHz), baud: parseNum(swoBaud), stm32 });
    setSwo(s);
    setSwoText({});
    setSwoStats({ packets: 0, overflows: 0, other: 0 });
  });

  const stopSwo = () => guard('swo', async () => {
    await client.stopSwo();
    setSwo(null);
  });

  const onAlgoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.(pack|zip)$/i.test(file.name)) {
        const p = await readPack(bytes);
        if (!p.algorithms.length) throw new Error('The pack contains no .FLM flash algorithms.');
        setPack({ ...p, fileName: file.name });
        setFlm(null);
        setPackDevice('');
        setPackAlgo(p.algorithms[0]);
        if (!p.devices.length) await choosePackAlgo(p, p.algorithms[0]);
      } else {
        setPack(null);
        const f = parseFlm(bytes);
        setFlm(f);
        setBinBase(h8(f.devAddr));
      }
    } catch (err) {
      setError(`Could not load ${file.name}: ${err.message}`);
    }
  };

  const choosePackAlgo = async (p, path, algoInfo) => {
    const f = parseFlm(await p.load(path));
    setFlm(f);
    setPackAlgo(path);
    setBinBase(h8(f.devAddr));
    if (algoInfo?.ramStart) setRamBase(h8(algoInfo.ramStart));
    if (algoInfo?.ramSize) setRamSize(`0x${algoInfo.ramSize.toString(16).toUpperCase()}`);
  };

  const onPackDevice = async (name) => {
    setPackDevice(name);
    const dev = pack.devices.find((d) => d.name === name);
    const algo = dev?.algorithms.find((a) => a.default) || dev?.algorithms[0];
    if (!algo) { setError(`${name} lists no flash algorithm.`); return; }
    try { await choosePackAlgo(pack, algo.path, algo); } catch (err) { setError(err.message); }
  };

  const onImageFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setImage({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  };

  const doFlash = () => guard('flash', async () => {
    if (!flm || !image) throw new Error('Load a flash algorithm and a firmware file first.');
    const segments = loadFirmwareImage(image.name, image.bytes, parseHex(binBase));
    const total = segments.reduce((n, s) => n + s.data.length, 0);
    const ranges = segments.map((s) => `${h8(s.addr)}-${h8(s.addr + s.data.length - 1)}`).join(', ');
    if (!confirmAction(`Program ${image.name} (${total} bytes at ${ranges}) into ${flm.name}?\n\n${chipErase ? 'The WHOLE chip is erased first.' : 'Only the sectors the image touches are erased.'}`)) return;
    setFlashResult('');
    setFlashProgress({ phase: 'load', frac: 0 });
    try {
      const r = await client.flash(flm, segments, {
        ramBase: parseHex(ramBase),
        ramSize: parseNum(ramSize),
        chipErase,
        verify,
        run: runAfter,
        onProgress: (phase, frac) => setFlashProgress({ phase, frac })
      });
      setTargetState(client.targetState);
      setFlashResult(`Done: erased ${chipErase ? 'chip' : `${r.sectors} sector(s)`}, wrote ${r.pages} page(s)${verify ? ', verified' : ''}${runAfter ? ', target running.' : '.'}`);
    } finally {
      setFlashProgress(null);
      setTargetState(client.targetState);
    }
  });

  const initUnits = () => guard('bp', async () => setUnits(await client.ensureDebugUnits()));
  const addBp = () => guard('bp', async () => { await client.setBreakpoint(parseHex(bpAddr)); setUnits(await client.ensureDebugUnits()); setBpTick((t) => t + 1); });
  const removeBp = (a) => guard('bp', async () => { await client.clearBreakpoint(a); setBpTick((t) => t + 1); });
  const addWp = () => guard('bp', async () => { await client.setWatchpoint(parseHex(wpAddr), { size: Number(wpSize), access: wpAccess }); setUnits(await client.ensureDebugUnits()); setBpTick((t) => t + 1); });
  const removeWp = (a) => guard('bp', async () => { await client.clearWatchpoint(a); setBpTick((t) => t + 1); });

  const doDump = () => guard('dump', async () => {
    const addr = parseHex(dumpAddr);
    const len = parseNum(dumpLen);
    if (len <= 0 || len > 16 * 1024 * 1024) throw new Error('Dump between 1 byte and 16 MB.');
    setDumpProgress(0);
    try {
      const data = await client.dump(addr, len, setDumpProgress);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dump-${h8(addr)}-${len}.bin`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDumpProgress(null);
    }
  });

  const caps = client.probe?.capabilities;
  const log = rttLogs[rttChannel] || '';

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1 px-2.5 py-1 rounded font-bold border ${tab === id ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {isSimulated && <div className="text-amber-300">These tools read and write real target memory, so they need a real probe. The demo target has none.</div>}

      {tab === 'rtt' && (
        <div className="flex flex-col gap-2">
          <p className="text-slate-400">SEGGER RTT: printf-style output and input through debugger memory reads, no UART or SWO pin needed. The firmware must include RTT (SEGGER_RTT.c, or defmt/rtt-target in Rust).</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">SEARCH RAM</span>
            <input value={rttStart} onChange={(e) => setRttStart(e.target.value)} className={`${input} w-28`} />
            <span className="text-slate-500">size</span>
            <input value={rttSize} onChange={(e) => setRttSize(e.target.value)} className={`${input} w-16`} />
            <span className="text-slate-500">or control block at</span>
            <input value={rttAddr} onChange={(e) => setRttAddr(e.target.value)} placeholder="auto" className={`${input} w-28`} />
            {!rtt ? (
              <button onClick={startRtt} disabled={isSimulated} className={btn}><Play className="w-3.5 h-3.5" /> START RTT</button>
            ) : (
              <button onClick={() => setRtt(null)} className={btn}><Square className="w-3.5 h-3.5" /> STOP</button>
            )}
            {scanProgress > 0 && scanProgress < 1 && !rtt && <span className="text-slate-500">scanning {Math.round(scanProgress * 100)}%</span>}
          </div>
          {rtt && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {rtt.up.map((c) => (
                  <button key={c.index} onClick={() => setRttChannel(c.index)} className={`px-2 py-0.5 rounded border ${rttChannel === c.index ? 'border-emerald-500/60 text-emerald-300' : 'border-slate-800 text-slate-400'}`}>
                    {c.index}: {c.name || 'unnamed'} ({c.size} B)
                  </button>
                ))}
                <button onClick={() => setRttLogs((p) => ({ ...p, [rttChannel]: '' }))} className={`${btn} ml-auto`}><Trash2 className="w-3 h-3" /> CLEAR</button>
              </div>
              <pre className="bg-black border border-slate-800 rounded p-2 h-64 overflow-y-auto whitespace-pre-wrap break-all text-emerald-200">{log || '(waiting for output)'}</pre>
              {rtt.down.length > 0 && (
                <div className="flex items-center gap-2">
                  <input value={rttInput} onChange={(e) => setRttInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendRtt()} placeholder={`send to down channel ${rtt.down[0].index}${rtt.down[0].name ? ` (${rtt.down[0].name})` : ''}`} className={`${input} flex-1`} />
                  <select value={rttEol} onChange={(e) => setRttEol(e.target.value)} className={input}>
                    <option value={'\n'}>LF</option><option value={'\r\n'}>CRLF</option><option value={'\r'}>CR</option><option value="">none</option>
                  </select>
                  <button onClick={sendRtt} className={btn}><Send className="w-3.5 h-3.5" /> SEND</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'swo' && (
        <div className="flex flex-col gap-2">
          <p className="text-slate-400">SWO trace: ITM stimulus port output (ITM_SendChar / printf retargeted to ITM) over the SWO pin. Needs a Cortex-M3/M4/M7/M33 (M0/M0+ have no SWO), the SWO pin wired to the probe, and a probe that captures SWO in UART mode.</p>
          {caps && !caps.swoUart && <div className="text-amber-300">{client.info?.probe || 'This probe'} does not report SWO UART support.</div>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">CORE CLOCK (Hz)</span>
            <input value={cpuHz} onChange={(e) => setCpuHz(e.target.value)} className={`${input} w-28`} />
            <span className="text-slate-500 font-bold">SWO BAUD</span>
            <input value={swoBaud} onChange={(e) => setSwoBaud(e.target.value)} className={`${input} w-24`} />
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={stm32} onChange={(e) => setStm32(e.target.checked)} className="accent-cyan-500" /> STM32: enable TRACESWO pin</label>
            {!swo ? (
              <button onClick={startSwo} disabled={isSimulated} className={btn}><Play className="w-3.5 h-3.5" /> START SWO</button>
            ) : (
              <button onClick={stopSwo} className={btn}><Square className="w-3.5 h-3.5" /> STOP</button>
            )}
          </div>
          {swo && <div className="text-slate-500">Probe at {swo.baud} baud, TPIU prescaler {swo.prescaler} · {swoStats.packets} stimulus writes · {swoStats.overflows} overflows · {swoStats.other} other packets</div>}
          {Object.keys(swoText).length === 0 && swo && <div className="text-slate-500">Waiting for ITM data. If nothing arrives, check the core clock: the baud rate is derived from it.</div>}
          {Object.entries(swoText).map(([port, text]) => (
            <div key={port}>
              <div className="text-slate-500 font-bold">STIMULUS PORT {port}</div>
              <pre className="bg-black border border-slate-800 rounded p-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-all text-emerald-200">{text}</pre>
            </div>
          ))}
        </div>
      )}

      {tab === 'flash' && (
        <div className="flex flex-col gap-2">
          <p className="text-slate-400">
            Program internal flash with the chip vendor's CMSIS-Pack flash algorithm. Open the device's .pack (from keil.arm.com/packs) or a single .FLM. The algorithm runs on the target from RAM; the core is reset and halted first.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => algoInput.current?.click()} className={btn}><Upload className="w-3.5 h-3.5" /> OPEN .PACK / .FLM</button>
            <input ref={algoInput} type="file" accept=".pack,.zip,.flm,.FLM" className="hidden" onChange={onAlgoFile} />
            {pack && pack.devices.length > 0 && (
              <select value={packDevice} onChange={(e) => onPackDevice(e.target.value)} className={input}>
                <option value="">choose device ({pack.devices.length})</option>
                {pack.devices.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            )}
            {pack && (
              <select value={packAlgo} onChange={(e) => choosePackAlgo(pack, e.target.value).catch((err) => setError(err.message))} className={input}>
                {pack.algorithms.map((a) => <option key={a} value={a}>{a.split('/').pop()}</option>)}
              </select>
            )}
          </div>
          {flm && (
            <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300">
              <div className="font-bold text-cyan-300">{flm.name}</div>
              <div>{h8(flm.devAddr)} – {h8(flm.devAddr + flm.devSize - 1)} ({flm.devSize / 1024} KB) · page {flm.pageSize} B · {flmSectors(flm).length} sectors · erased value 0x{flm.emptyValue.toString(16).toUpperCase()}</div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">RAM FOR ALGORITHM</span>
            <input value={ramBase} onChange={(e) => setRamBase(e.target.value)} className={`${input} w-28`} />
            <span className="text-slate-500">size</span>
            <input value={ramSize} onChange={(e) => setRamSize(e.target.value)} className={`${input} w-20`} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => imageInput.current?.click()} className={btn}><Upload className="w-3.5 h-3.5" /> FIRMWARE (.bin / .hex / .elf)</button>
            <input ref={imageInput} type="file" accept=".bin,.hex,.ihx,.elf,.axf,.out" className="hidden" onChange={onImageFile} />
            {image && <span className="text-slate-300">{image.name} ({image.bytes.length} B)</span>}
            {image && !/\.(hex|ihx|elf|axf|out)$/i.test(image.name) && (
              <>
                <span className="text-slate-500">load at</span>
                <input value={binBase} onChange={(e) => setBinBase(e.target.value)} className={`${input} w-28`} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-slate-400">
            <label className="flex items-center gap-1"><input type="checkbox" checked={chipErase} onChange={(e) => setChipErase(e.target.checked)} className="accent-rose-500" /> erase whole chip</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="accent-cyan-500" /> verify</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={runAfter} onChange={(e) => setRunAfter(e.target.checked)} className="accent-cyan-500" /> reset and run after</label>
            <button onClick={doFlash} disabled={isSimulated || !flm || !image || !!flashProgress} className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 font-bold disabled:opacity-40">
              <HardDrive className="w-3.5 h-3.5" /> PROGRAM FLASH
            </button>
          </div>
          {flashProgress && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-16 uppercase">{flashProgress.phase}</span>
              <div className="flex-1 h-2 bg-slate-900 rounded"><div className="h-2 bg-amber-400 rounded" style={{ width: `${Math.round(flashProgress.frac * 100)}%` }} /></div>
            </div>
          )}
          {flashResult && <div className="text-emerald-300 font-bold">{flashResult}</div>}
        </div>
      )}

      {tab === 'bp' && (
        <div className="flex flex-col gap-2">
          <p className="text-slate-400">Hardware breakpoints (FPB) stop the core when it fetches an address; watchpoints (DWT) when it reads or writes one. The debugger notices the halt within a second and shows the registers.</p>
          {!units ? (
            <button onClick={initUnits} disabled={isSimulated} className={`${btn} self-start`}>ENABLE BREAKPOINT UNITS</button>
          ) : (
            <>
              <div className="text-slate-500">{units.breakpoints} breakpoint and {units.watchpoints} watchpoint comparators</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-bold">BREAK AT</span>
                <input value={bpAddr} onChange={(e) => setBpAddr(e.target.value)} className={`${input} w-28`} />
                <button onClick={addBp} className={btn}>ADD</button>
                {client.breakpoints?.active.map((a) => (
                  <span key={a} className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/40 text-rose-300">
                    {h8(a)} <button onClick={() => removeBp(a)} title="Remove"><Trash2 className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-bold">WATCH</span>
                <input value={wpAddr} onChange={(e) => setWpAddr(e.target.value)} className={`${input} w-28`} />
                <select value={wpSize} onChange={(e) => setWpSize(e.target.value)} className={input}>
                  <option value={1}>1 byte</option><option value={2}>2 bytes</option><option value={4}>4 bytes</option>
                </select>
                <select value={wpAccess} onChange={(e) => setWpAccess(e.target.value)} className={input}>
                  <option value="write">on write</option><option value="read">on read</option><option value="readwrite">on read/write</option>
                </select>
                <button onClick={addWp} className={btn}>ADD</button>
                {client.watchpoints?.active.map((w) => (
                  <span key={w.addr} className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-300">
                    {h8(w.addr)} {w.size}B {w.access} <button onClick={() => removeWp(w.addr)} title="Remove"><Trash2 className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              {targetState === 'halted' && <div className="text-slate-500">RESUME steps over a breakpoint at the current PC before running.</div>}
            </>
          )}
        </div>
      )}

      {tab === 'dump' && (
        <div className="flex flex-col gap-2">
          <p className="text-slate-400">Save a range of target memory (flash, RAM or peripherals) to a .bin file. Read-protected chips return errors or zeros.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">FROM</span>
            <input value={dumpAddr} onChange={(e) => setDumpAddr(e.target.value)} className={`${input} w-28`} />
            <span className="text-slate-500 font-bold">LENGTH</span>
            <input value={dumpLen} onChange={(e) => setDumpLen(e.target.value)} className={`${input} w-24`} />
            <button onClick={doDump} disabled={isSimulated || dumpProgress !== null} className={btn}><Download className="w-3.5 h-3.5" /> DUMP TO FILE</button>
            {dumpProgress !== null && <span className="text-slate-400">{Math.round(dumpProgress * 100)}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}
