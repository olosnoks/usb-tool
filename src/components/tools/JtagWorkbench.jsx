import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Cpu,
  Play,
  Upload,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  FileCode,
  Check,
  ShieldCheck,
  Search,
  Usb,
  Copy,
  Download,
  Camera
} from 'lucide-react';
import { JtagClient } from '../../utils/jtagDriver';
import { parseBsdl, opcodeValue, idcodeMatches, pinStates, extestVector } from '../../utils/bsdl';
import { analyzeSvf, formatSvfSummary, changedPorts, filterPins, pinsToCsv, openocdChainConfig } from '../../utils/jtagTools';

import { confirmAction, useSessionError } from '../../utils/sessionLog';
const SAMPLE_SVF_TEXT = `// Sample SVF: Initialize TAP & Read IDCODE
FREQUENCY 10000000 HZ;
TRST OFF;
ENDIR IDLE;
ENDDR IDLE;
STATE RESET IDLE;
SIR 6 TDI(09);
SDR 32 TDI(00000000) TDO(03628093) MASK(0FFFFFFF);
STATE IDLE;
RUNTEST 100 TCK;
`;

export default function JtagWorkbench() {
  const [client] = useState(() => new JtagClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [tapDevices, setTapDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);

  // SVF Player state
  const [svfContent, setSvfContent] = useState(SAMPLE_SVF_TEXT);
  const [isPlayingSvf, setIsPlayingSvf] = useState(false);
  const [playProgress, setPlayProgress] = useState({ percent: 0, current: 0, total: 0, lastCmd: '' });
  const [playResult, setPlayResult] = useState(null);

  const fileInputRef = useRef(null);

  const [error, setError] = useSessionError('JTAG');
  const [busy, setBusy] = useState('');
  const [probeInfo, setProbeInfo] = useState(null);
  const [probePins, setProbePins] = useState(null);
  const [bsTarget, setBsTarget] = useState(0);
  const [bsIrLens, setBsIrLens] = useState('');
  const [bsOpcode, setBsOpcode] = useState('0x01');
  const [bsLength, setBsLength] = useState('');
  const [bsCells, setBsCells] = useState(null);
  const [bsdl, setBsdl] = useState(null);
  const [bsLive, setBsLive] = useState(false);
  const [drive, setDrive] = useState({}); // port -> 0 | 1 while EXTEST is active
  const [extestOk, setExtestOk] = useState(false);
  const bsdlRef = useRef(null);
  const [baseline, setBaseline] = useState(null); // pinStates() rows saved by SNAPSHOT
  const [pinFilter, setPinFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const svfSummary = useMemo(() => analyzeSvf(svfContent), [svfContent]);
  const pinRows = useMemo(() => (bsdl && bsCells ? pinStates(bsdl, bsCells) : []), [bsdl, bsCells]);
  const changed = useMemo(() => (baseline ? changedPorts(baseline, pinRows) : new Set()), [baseline, pinRows]);
  const shownRows = filterPins(pinRows, pinFilter);
  const openocdText = useMemo(() => {
    const lens = bsIrLens.split(/[\s,]+/).filter(Boolean).map(Number);
    return openocdChainConfig(tapDevices, lens);
  }, [tapDevices, bsIrLens]);

  const copyOpenocd = async () => {
    try {
      await navigator.clipboard.writeText(openocdText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError('Clipboard unavailable: select the text and copy it by hand.');
    }
  };

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([pinsToCsv(pinRows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bsdl?.entity || 'boundary'}-pins.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const guard = async (label, fn) => {
    setBusy(label);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy('');
    }
  };

  const handleConnectHardware = (kind) => guard('connect', async () => {
    const i = await client.connectHardware({ kind });
    setProbeInfo(i);
    setIsConnected(true);
    setTapDevices([]);
    setPlayResult(null);
    setBsCells(null);
    setBaseline(null);
  });

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setTapDevices([]);
    setPlayResult(null);
    setProbeInfo(null);
    setProbePins(null);
    setBsCells(null);
  };

  const handleScanChain = () => guard('scan', async () => {
    if (!isConnected) return;
    setIsScanning(true);
    try {
      const devices = await client.scanChain();
      setTapDevices([...devices]);
      setBsIrLens(devices.map((d) => d.irlen ?? '?').join(', '));
    } finally {
      setIsScanning(false);
    }
  });

  const handleReadPins = () => guard('pins', async () => setProbePins(await client.readProbePins()));

  const chainIrLengths = () => {
    const irLengths = bsIrLens.split(/[\s,]+/).filter(Boolean).map(Number);
    if (irLengths.length !== tapDevices.length || irLengths.some((n) => !Number.isInteger(n) || n < 2)) {
      throw new Error(`Enter one IR length per device in the chain (${tapDevices.length}), from the device's BSDL file.`);
    }
    return irLengths;
  };

  const onBsdlFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const b = parseBsdl(await file.text());
      setBsdl(b);
      const sample = opcodeValue(b, 'SAMPLE') ?? opcodeValue(b, 'SAMPLE/PRELOAD');
      if (sample !== null) setBsOpcode(`0x${sample.toString(16).toUpperCase()}`);
      setBsLength(String(b.bsrLength));
      const lens = bsIrLens.split(/[\s,]+/).filter(Boolean);
      const list = tapDevices.map((d, i) => lens[i] || '');
      if (list.length) { list[Number(bsTarget)] = String(b.irLength); setBsIrLens(list.join(', ')); }
      setDrive({});
      setBaseline(null);
    } catch (err) {
      setError(`${file.name}: ${err.message}`);
    }
  };

  const handleExtest = (port, level) => {
    if (!extestOk && !confirmAction('EXTEST takes the pins away from the chip\'s own logic and drives them from here.\n\nDriving a pin that something else also drives can damage hardware. Only drive pins you know are free (LEDs, test points). RESET TAP returns the chip to normal.')) return;
    setExtestOk(true);
    const next = { ...drive };
    if (level === null) delete next[port]; else next[port] = level;
    guard('extest', async () => {
      const extestOp = opcodeValue(bsdl, 'EXTEST');
      if (extestOp === null) throw new Error('The BSDL file lists no EXTEST opcode.');
      const preloadOp = opcodeValue(bsdl, 'SAMPLE') ?? opcodeValue(bsdl, 'PRELOAD');
      setBsCells(await client.extest({ target: Number(bsTarget), irLengths: chainIrLengths(), preloadOp, extestOp, vector: extestVector(bsdl, next) }));
      setDrive(next);
    });
  };

  const handleResetTap = () => guard('reset', async () => {
    await client.resetTap();
    setDrive({});
  });

  useEffect(() => {
    if (!bsLive) return undefined;
    const t = setInterval(() => { if (!busy) handleSample(); }, 700);
    return () => clearInterval(t);
  }, [bsLive, busy, bsIrLens, bsOpcode, bsLength, bsTarget]);

  const handleSample = () => guard('sample', async () => {
    const irLengths = chainIrLengths();
    const opcode = parseInt(bsOpcode.replace(/^0x/i, ''), 16);
    const bsrLength = Number(bsLength);
    if (Number.isNaN(opcode)) throw new Error('SAMPLE opcode must be hex.');
    if (!Number.isInteger(bsrLength) || bsrLength < 1 || bsrLength > 4096) throw new Error('Boundary register length must be 1-4096 (BOUNDARY_LENGTH in the BSDL file).');
    setBsCells(await client.sampleBoundary({ target: Number(bsTarget), irLengths, opcode, bsrLength }));
  });

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setSvfContent(event.target.result);
      setPlayResult(null);
    };
    reader.readAsText(file);
  };

  const handleExecuteSvf = async () => {
    if (!isConnected || isPlayingSvf) return;
    try {
      setIsPlayingSvf(true);
      setPlayResult(null);
      const r = await client.playSvf(svfContent, (p) => setPlayProgress(p));
      setPlayResult(`SUCCESS: ${r.statements} statements played, ${r.checks} TDO check(s) matched.`);
    } catch (err) {
      setPlayResult(`ERROR: ${err.message}`);
    } finally {
      setIsPlayingSvf(false);
    }
  };


  const card = 'bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2';
  const smallBtn = 'flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-[10px] font-bold disabled:opacity-40';
  const field = 'w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200 focus:border-cyan-500 outline-none';

  return (
    <div className="space-y-2 font-mono text-xs">
      {error && (
        <div role="alert" className="flex items-start gap-2 p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Probe, scan and chain status */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-1.5">
          {!isConnected ? (
            <>
              <button
                onClick={() => handleConnectHardware('usb')}
                disabled={!!busy}
                title="Connect a CMSIS-DAP probe with JTAG over WebUSB"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-[11px] font-bold disabled:opacity-40"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>{busy === 'connect' ? 'CONNECTING...' : 'CONNECT PROBE (WEBUSB)'}</span>
              </button>
              <button
                onClick={() => handleConnectHardware('hid')}
                disabled={!!busy}
                title="Connect a CMSIS-DAP probe over WebHID"
                className="px-2.5 py-1 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold disabled:opacity-40"
              >
                HID PROBE
              </button>
            </>
          ) : (
            <button onClick={handleDisconnect} className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold">
              DISCONNECT
            </button>
          )}
          <button
            onClick={handleScanChain}
            disabled={!isConnected || isScanning || !!busy}
            title="Reset the TAPs and read every IDCODE in the chain"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-[11px] disabled:opacity-40"
          >
            <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'SCANNING...' : 'SCAN JTAG CHAIN (READ IDCODE)'}</span>
          </button>
          <span className="ml-auto text-[10px] text-slate-400">
            TAP: <strong className="text-emerald-400">{client.tapState}</strong> | <strong className="text-cyan-400">{tapDevices.length}</strong> device(s)
          </span>
        </div>
        {probeInfo && <p className="text-[11px] text-emerald-400">Probe: {probeInfo.product}{probeInfo.firmware ? ` (fw ${probeInfo.firmware})` : ''}</p>}
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-500">About this tool</summary>
          <p className="pt-1">
            Scan JTAG chains and identify IDCODEs, play .svf files with TDO checking, and sample boundary-scan cells, through a CMSIS-DAP probe with JTAG (DAPLink, Raspberry Pi Debug Probe, LPC-Link2).
          </p>
        </details>
      </div>

      {/* Detected JTAG TAP devices */}
      {tapDevices.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
            {tapDevices.map((dev) => (
              <div key={dev.index} className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-1 border-b border-slate-800">
                  <span className="font-bold text-amber-300 text-[11px]">
                    #{dev.index}{dev.index === 0 ? ' (TDO end)' : ''}: {dev.mfr} {dev.part}
                  </span>
                  <span className="text-[10px] text-cyan-400 font-bold">
                    {dev.idcode == null ? 'NO IDCODE' : <>0x{dev.idcode.toString(16).padStart(8, '0').toUpperCase()}</>}
                  </span>
                </div>
                <div className="grid grid-cols-2 @sm:grid-cols-4 gap-1.5 pt-1.5 text-[11px]">
                  <div><span className="text-[9px] text-slate-500 uppercase font-bold block">Family</span><span className="text-slate-300">{dev.family}</span></div>
                  <div><span className="text-[9px] text-slate-500 uppercase font-bold block">Package</span><span className="text-slate-300">{dev.package}</span></div>
                  <div><span className="text-[9px] text-slate-500 uppercase font-bold block">Pins</span><span className="text-emerald-400">{dev.pins ? `${dev.pins}` : '-'}</span></div>
                  <div><span className="text-[9px] text-slate-500 uppercase font-bold block">IR length</span><span className="text-purple-400">{dev.irlen ? `${dev.irlen} bits` : 'see BSDL'}</span></div>
                </div>
              </div>
            ))}
          </div>
          <details className="bg-slate-950 border border-slate-800 rounded-lg p-2">
            <summary className="cursor-pointer text-[11px] text-slate-400">OpenOCD chain snippet (export for the OpenOCD CLI)</summary>
            <pre className="mt-1.5 p-1.5 bg-black/40 rounded text-[10px] text-slate-300 overflow-x-auto whitespace-pre">{openocdText}</pre>
            <button onClick={copyOpenocd} className={`${smallBtn} mt-1.5`} title="Copy the snippet to the clipboard">
              <Copy className="w-3 h-3" /> {copied ? 'COPIED' : 'COPY'}
            </button>
            <p className="text-[10px] text-slate-500 pt-1">IR lengths come from the IR lengths field below or the built-in table; fill them in from the BSDL file where this shows "unknown".</p>
          </details>
        </div>
      )}

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2">
        {/* SVF player */}
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-200 text-[11px] flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-purple-400" />
              <span>SVF PLAYER</span>
            </span>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".svf" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className={smallBtn} title="Load a .svf file">
              <Upload className="w-3 h-3" />
              <span>LOAD .SVF FILE</span>
            </button>
          </div>

          <textarea
            value={svfContent}
            onChange={(e) => setSvfContent(e.target.value)}
            rows={7}
            aria-label="SVF script"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 text-xs font-mono outline-none focus:border-cyan-500 resize-y"
            placeholder="// Paste SVF commands here..."
          />

          <div className={`text-[10px] ${svfSummary.error ? 'text-rose-300' : 'text-slate-400'}`} data-testid="svf-summary">
            {formatSvfSummary(svfSummary)}
            {svfSummary.warnings?.length > 0 && (
              <ul className="text-amber-300 list-disc pl-4">
                {svfSummary.warnings.slice(0, 4).map((w) => <li key={w}>{w}</li>)}
                {svfSummary.warnings.length > 4 && <li>and {svfSummary.warnings.length - 4} more</li>}
              </ul>
            )}
          </div>

          {isPlayingSvf && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-cyan-400 font-bold">
                <span className="truncate">Playing... {playProgress.lastCmd}</span>
                <span>{playProgress.percent}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-100" style={{ width: `${playProgress.percent}%` }} />
              </div>
            </div>
          )}

          {playResult && (
            <div className={`p-2 rounded-lg border text-[11px] font-bold flex items-center gap-2 ${
              playResult.startsWith('SUCCESS')
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                : 'bg-rose-500/10 text-rose-300 border-rose-500/40'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{playResult}</span>
            </div>
          )}

          <button
            onClick={handleExecuteSvf}
            disabled={!isConnected || isPlayingSvf || !!svfSummary.error}
            title={svfSummary.error ? 'Fix the SVF syntax error first' : 'Play the script on the connected chain'}
            className="w-full py-1.5 rounded-lg bg-gradient-to-r from-purple-500 via-indigo-600 to-purple-500 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs disabled:opacity-40"
          >
            {isPlayingSvf ? 'EXECUTING SVF STREAM...' : 'EXECUTE SVF SEQUENCE'}
          </button>
        </div>

        {!isConnected ? (
          <div className={card}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 text-[11px] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>BOUNDARY SCAN PIN STATES (SAMPLE / EXTEST)</span>
              </span>
              <span className="text-[10px] text-slate-500">demo grid</span>
            </div>
            <p className="text-[11px] text-slate-400">Connect a probe to sample real pins. The grid below is an illustration only.</p>
            <div className="grid grid-cols-6 @sm:grid-cols-8 gap-1 max-h-44 overflow-y-auto">
              {client.pins.slice(0, 48).map((pin) => {
                let bg = 'bg-slate-900 text-slate-400 border-slate-800';
                if (pin.state === 'HIGH') bg = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                else if (pin.state === 'VCC_3V3') bg = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                else if (pin.state === 'GND') bg = 'bg-slate-800 text-slate-500 border-slate-700';
                return (
                  <div key={pin.pinNumber} className={`p-0.5 rounded text-center border text-[9px] font-mono ${bg}`}>
                    <span className="block font-bold">P{pin.pinNumber}</span>
                    <span className="block text-[8px] opacity-80">{pin.state === 'HIGH' ? '1' : pin.state === 'LOW' ? '0' : pin.state}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-500 flex items-center justify-between">
              <span>Showing first 48 pins of 144</span>
              <span className="text-emerald-400 font-bold">Green = Logic High</span>
            </div>
          </div>
        ) : (
          <div className={card}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-200 text-[11px] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>PROBE PINS & BOUNDARY SCAN (SAMPLE)</span>
              </span>
              <button onClick={handleReadPins} disabled={!!busy} className={smallBtn}>READ PROBE PINS</button>
            </div>
            {probePins && (
              <div className="grid grid-cols-6 gap-1">
                {Object.entries(probePins).map(([k, v]) => (
                  <div key={k} className={`p-0.5 rounded text-center border text-[10px] font-bold ${v ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
                    {k}<span className="block">{v ? '1' : '0'}</span>
                  </div>
                ))}
              </div>
            )}
            <details className="text-[11px] text-slate-400">
              <summary className="cursor-pointer text-slate-500">How sampling works</summary>
              <p className="pt-1">
                SAMPLE/PRELOAD captures every boundary cell of one device without disturbing it. The IR lengths, SAMPLE opcode and
                boundary length come from the device's BSDL file; cell-to-pin names are in that file too.
              </p>
            </details>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <label className="space-y-0.5">
                <span className="text-slate-500 block">Device</span>
                <select value={bsTarget} onChange={(e) => setBsTarget(e.target.value)} className={field}>
                  {tapDevices.map((d) => <option key={d.index} value={d.index}>#{d.index} {d.part}</option>)}
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="text-slate-500 block">IR lengths (TDO end first)</span>
                <input value={bsIrLens} onChange={(e) => setBsIrLens(e.target.value)} placeholder="6, 4" className={field} />
              </label>
              <label className="space-y-0.5">
                <span className="text-slate-500 block">SAMPLE opcode (hex)</span>
                <input value={bsOpcode} onChange={(e) => setBsOpcode(e.target.value)} className={field} />
              </label>
              <label className="space-y-0.5">
                <span className="text-slate-500 block">Boundary length (cells)</span>
                <input value={bsLength} onChange={(e) => setBsLength(e.target.value)} placeholder="e.g. 361" className={field} />
              </label>
            </div>
            <button onClick={handleSample} disabled={!!busy || !tapDevices.length} className="w-full py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-xs disabled:opacity-40">
              {busy === 'sample' ? 'SAMPLING...' : tapDevices.length ? 'SAMPLE BOUNDARY CELLS' : 'SCAN THE CHAIN FIRST'}
            </button>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <input ref={bsdlRef} type="file" accept=".bsd,.bsdl,.bsm,.txt" className="hidden" onChange={onBsdlFile} />
              <button onClick={() => bsdlRef.current?.click()} className={smallBtn}>{bsdl ? `BSDL: ${bsdl.entity}` : 'LOAD BSDL FILE'}</button>
              {bsdl && tapDevices[Number(bsTarget)]?.idcode != null && (() => {
                const ok = idcodeMatches(bsdl, tapDevices[Number(bsTarget)].idcode);
                return ok === null ? null : <span className={ok ? 'text-emerald-300' : 'text-rose-300 font-bold'}>{ok ? 'IDCODE matches the BSDL' : 'IDCODE does NOT match this BSDL'}</span>;
              })()}
              <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={bsLive} onChange={(e) => setBsLive(e.target.checked)} className="accent-emerald-500" /> live</label>
              <button onClick={handleResetTap} disabled={!!busy || !tapDevices.length} className="px-2 py-1 rounded bg-slate-900 border border-amber-500/40 text-amber-300 font-bold text-[10px] disabled:opacity-40">RESET TAP</button>
            </div>
            {Object.keys(drive).length > 0 && <p className="text-amber-300 font-bold text-[11px]">EXTEST active ({Object.keys(drive).length} pin(s) driven)</p>}
            {bsdl && bsCells && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input value={pinFilter} onChange={(e) => setPinFilter(e.target.value)} placeholder="Filter port or pin" aria-label="Filter pins" className={`${field} flex-1 min-w-[7rem]`} />
                  <button onClick={() => setBaseline(pinRows)} className={smallBtn} title="Save this sample, then highlight what changes in later samples"><Camera className="w-3 h-3" /> SNAPSHOT</button>
                  {baseline && <button onClick={() => setBaseline(null)} className={smallBtn} title="Stop comparing">CLEAR</button>}
                  <button onClick={downloadCsv} className={smallBtn} title="Download the pin table as CSV"><Download className="w-3 h-3" /> CSV</button>
                </div>
                {baseline && <p className="text-[10px] text-amber-300">{changed.size} port(s) changed since the snapshot (highlighted).</p>}
                <div className="max-h-64 overflow-y-auto border border-slate-800 rounded">
                  <table className="w-full text-[11px]">
                    <thead className="text-slate-500 text-left sticky top-0 bg-slate-950"><tr><th className="px-1">PORT</th><th>PIN</th><th>IN</th><th>OUT</th><th>DRIVE (EXTEST)</th></tr></thead>
                    <tbody>
                      {shownRows.map((pn) => (
                        <tr key={pn.port} className={`border-t border-slate-900 ${changed.has(pn.port) ? 'bg-amber-500/10' : ''}`}>
                          <td className="px-1 text-slate-200">{pn.port}</td>
                          <td className="text-slate-500">{pn.pins.join(', ')}</td>
                          <td className={pn.input === 1 ? 'text-emerald-300 font-bold' : 'text-slate-500'}>{pn.input ?? ''}</td>
                          <td className="text-slate-400">{pn.outputCell !== undefined ? `${pn.output}${pn.driving ? '' : ' (off)'}` : ''}</td>
                          <td>
                            {pn.outputCell !== undefined && (
                              <span className="flex gap-1">
                                {[0, 1].map((lv) => (
                                  <button key={lv} onClick={() => handleExtest(pn.port, lv)} disabled={!!busy} className={`px-1.5 rounded border ${drive[pn.port] === lv ? 'border-amber-500/60 text-amber-300' : 'border-slate-700 text-slate-400'}`}>{lv}</button>
                                ))}
                                {pn.port in drive && <button onClick={() => handleExtest(pn.port, null)} disabled={!!busy} className="px-1.5 rounded border border-slate-700 text-slate-400">off</button>}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {bsCells && !bsdl && (
              <div className="grid grid-cols-8 @sm:grid-cols-12 gap-1 max-h-48 overflow-y-auto">
                {bsCells.map((v, i) => (
                  <div key={i} className={`p-0.5 rounded text-center border text-[9px] font-mono ${v ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>
                    <span className="block font-bold">{i}</span>{v}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
