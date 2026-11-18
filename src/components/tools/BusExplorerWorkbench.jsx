import React, { useState } from 'react';
import {
  Search,
  Layers,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Usb,
  Copy,
  Download,
  Terminal
} from 'lucide-react';
import {
  BusExplorerClient,
  I2C_CHIP_DATABASE,
  I2C_SPEEDS,
  SPI_SPEEDS
} from '../../utils/busExplorerDriver';
import {
  SPI_MODES,
  parseHexBytes,
  parseI2cTransfer,
  formatBytes,
  formatHexDump,
  formatI2cdetect,
  diffDumps
} from '../../utils/busExplorerTools';
import SensorFlashPanels from './bus/SensorFlashPanels';

import { useSessionError } from '../../utils/sessionLog';

const card = 'bg-[#030712] border border-cyber-border rounded-lg p-2.5';
const head2 = 'flex flex-wrap items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-800';
const inp = 'bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500';
const iconBtn = 'flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold disabled:opacity-40';
const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BusExplorerWorkbench() {
  const [client] = useState(() => new BusExplorerClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [detectedDevices, setDetectedDevices] = useState([]);
  const [selectedAddr, setSelectedAddr] = useState(0x68);
  const [isScanning, setIsScanning] = useState(false);

  // Register dump: { start, addr, bytes }, plus the previous read of the same range for change highlighting
  const [dump, setDump] = useState(null);
  const [prevDump, setPrevDump] = useState(null);
  const [dumpLen, setDumpLen] = useState(32);

  const [writeReg, setWriteReg] = useState('0x6B');
  const [writeVal, setWriteVal] = useState('0x00');
  const [regStart, setRegStart] = useState('0x00');
  const [error, setError] = useSessionError('Bus Explorer');
  const [busy, setBusy] = useState('');
  const [scanAt, setScanAt] = useState(null);
  const [settings, setSettings] = useState(client.settings);
  const [spiOut, setSpiOut] = useState('9F 00 00 00');
  const [spiIn, setSpiIn] = useState('');
  const [xferText, setXferText] = useState('w1@0x68 0x75 r1');
  const [xferLog, setXferLog] = useState([]);
  const [copied, setCopied] = useState('');

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

  const copyText = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1200);
    } catch (e) {
      setError('Clipboard is not available in this browser context.');
    }
  };

  const handleConnectHardware = () => guard('connect', async () => {
    await client.connectHardware();
    setIsConnected(true);
    setDetectedDevices([]);
    setSettings({ ...client.settings });
  });

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setDetectedDevices([]);
  };

  const handleSelectAddress = (addr) => {
    setSelectedAddr(addr);
    client.activeAddress = addr;
    setDump(null);
    setPrevDump(null);
  };

  const handleScanBus = () => guard('scan', async () => {
    if (!isConnected) return;
    setIsScanning(true);
    try {
      const found = await client.scanI2cBus((addr) => setScanAt(addr));
      setDetectedDevices([...found]);
      if (found.length > 0 && !found.includes(selectedAddr)) handleSelectAddress(found[0]);
    } finally {
      setIsScanning(false);
      setScanAt(null);
    }
  });

  const refreshRegisters = (startText = regStart, len = dumpLen) => guard('read', async () => {
    const start = parseInt(String(startText).replace(/^0x/i, ''), 16);
    if (Number.isNaN(start) || start < 0 || start > 0xff) throw new Error('Start register must be a hex byte.');
    const count = Math.min(len, 256 - start);
    const vals = await client.readRegisters(start, count);
    const same = dump && dump.start === start && dump.addr === selectedAddr && dump.bytes.length === vals.length;
    setPrevDump(same ? dump.bytes : null);
    setDump({ start, addr: selectedAddr, bytes: vals });
  });

  const handleWriteRegister = () => guard('write', async () => {
    const regNum = parseInt(writeReg.replace(/^0x/i, ''), 16);
    const valNum = parseInt(writeVal.replace(/^0x/i, ''), 16);
    if (isNaN(regNum) || isNaN(valNum) || regNum > 0xff || valNum > 0xff) throw new Error('Register and value must be hex bytes (0x00 - 0xFF).');
    await client.writeRegister(regNum, valNum);
    await refreshRegisters();
  });

  const handleSetting = (changes) => guard('settings', async () => {
    const next = await client.configure(changes);
    setSettings({ ...next });
  });

  const handleSpi = () => guard('spi', async () => {
    const bytes = parseHexBytes(spiOut);
    if (!bytes.length) throw new Error('SPI bytes must be whole hex bytes, e.g. 9F 00 00 00.');
    const back = await client.spiTransfer(bytes);
    setSpiIn(formatBytes(back));
  });

  const handleXfer = () => guard('xfer', async () => {
    const { addr, ops } = parseI2cTransfer(xferText);
    const results = await client.i2cTransfer(addr, ops);
    const line = {
      id: `${Date.now()}-${Math.random()}`,
      cmd: xferText.trim(),
      out: results.map((r) => `${r.type === 'w' ? 'W' : 'R'} ${formatBytes(r.bytes)}`.trim()).join('  |  ')
    };
    setXferLog((log) => [line, ...log].slice(0, 50));
  });

  const selectedChipInfo = I2C_CHIP_DATABASE[selectedAddr];
  const changed = dump ? new Set(diffDumps(prevDump, dump.bytes)) : new Set();
  const dumpText = dump ? formatHexDump(dump.bytes, dump.start) : '';

  return (
    <div className="space-y-2 font-mono text-xs">
      {error && (
        <div className="flex items-start gap-2 p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          {!isConnected ? (
            <button
              onClick={handleConnectHardware}
              disabled={!!busy}
              title="Bus Pirate v3/v4, binary mode, 115200 baud"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 text-xs font-bold disabled:opacity-40"
            >
              <Usb className="w-3.5 h-3.5" />
              <span>{busy === 'connect' ? 'CONNECTING...' : 'CONNECT BUS PIRATE (SERIAL)'}</span>
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
            >
              DISCONNECT
            </button>
          )}
          <button
            onClick={handleScanBus}
            disabled={!isConnected || isScanning}
            title="Probe every 7-bit address 0x08 - 0x77"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs transition-all disabled:opacity-40"
          >
            <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'SCANNING...' : 'SCAN I2C BUS (7-BIT SWEEP)'}</span>
          </button>
          <span className="text-[11px] text-slate-400">
            {scanAt != null ? `Probing 0x${scanAt.toString(16).toUpperCase()}...` : <>Found <strong className="text-emerald-400">{detectedDevices.length}</strong></>}
          </span>
          {detectedDevices.length > 0 && (
            <button
              onClick={() => copyText('detect', formatI2cdetect(detectedDevices))}
              title="Copy the scan result in i2cdetect -y layout"
              className={`${iconBtn} border-slate-700 text-slate-300`}
            >
              <Copy className="w-3 h-3" /> {copied === 'detect' ? 'COPIED' : 'i2cdetect'}
            </button>
          )}
          {selectedChipInfo && (
            <span className="ml-auto text-[11px] text-slate-400">
              <span className="font-extrabold text-amber-300">0x{(selectedAddr ?? 0).toString(16).toUpperCase()}</span> {selectedChipInfo.name}
            </span>
          )}
        </div>
        {isConnected && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 mt-2 border-t border-slate-800 text-[11px] text-slate-300">
            <label className="flex items-center gap-1"><input type="checkbox" checked={settings.power} disabled={!!busy} onChange={(e) => handleSetting({ power: e.target.checked })} /> 3.3V/5V power</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={settings.pullups} disabled={!!busy} onChange={(e) => handleSetting({ pullups: e.target.checked })} /> pull-ups</label>
            <label className="flex items-center gap-1">I2C
              <select aria-label="I2C speed" value={settings.i2cSpeed} disabled={!!busy} onChange={(e) => handleSetting({ i2cSpeed: Number(e.target.value) })} className={inp}>
                {I2C_SPEEDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">SPI
              <select aria-label="SPI speed" value={settings.spiSpeed} disabled={!!busy} onChange={(e) => handleSetting({ spiSpeed: Number(e.target.value) })} className={inp}>
                {SPI_SPEEDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select aria-label="SPI mode" value={settings.spiMode} disabled={!!busy} onChange={(e) => handleSetting({ spiMode: Number(e.target.value) })} className={inp}>
                {SPI_MODES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Address matrix and chip info */}
      <div className="grid grid-cols-1 @lg:grid-cols-3 gap-2">
        <div className={`@lg:col-span-2 ${card}`}>
          <div className={head2}>
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>I2C ADDRESS MATRIX</span>
            </span>
            <span className="text-[10px] text-slate-500">Green = ACK</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-center border-collapse min-w-[20rem]">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-900">
                  <th className="p-0.5 font-bold text-slate-600 text-left">ROW</th>
                  {COLS.map((col) => (
                    <th key={col} className="p-0.5 font-mono">{col.toString(16).toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
                  <tr key={row} className="border-b border-slate-900/60">
                    <td className="p-0.5 text-[10px] text-slate-500 font-bold text-left">{row}0:</td>
                    {COLS.map((col) => {
                      const addr = (row << 4) | col;
                      const isReserved = addr < 0x08 || addr > 0x77;
                      const isDetected = detectedDevices.includes(addr);
                      const isSelected = selectedAddr === addr;

                      if (isReserved) {
                        return (
                          <td key={col} className="p-0.5 text-[10px] text-slate-700">
                            --
                          </td>
                        );
                      }

                      return (
                        <td key={col} className="p-px">
                          <button
                            onClick={() => handleSelectAddress(addr)}
                            disabled={!isDetected}
                            title={isDetected ? `0x${addr.toString(16).toUpperCase()}: ${I2C_CHIP_DATABASE[addr]?.name || 'Unknown'}` : `0x${addr.toString(16).toUpperCase()}: NACK`}
                            className={`w-full py-0.5 text-[10px] font-mono font-bold rounded transition-all ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 shadow-amber-glow font-black'
                                : isDetected
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/40 shadow-emerald-glow'
                                : 'text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            {hex2(addr)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${card} space-y-2`}>
          <div className={head2 + ' !mb-0'}>
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>CHIP INTELLIGENCE</span>
            </span>
            <span className="text-[10px] text-cyan-400 font-mono">0x{(selectedAddr ?? 0).toString(16).toUpperCase()}</span>
          </div>

          {selectedChipInfo ? (
            <div className="space-y-1.5 text-[11px]">
              <div>
                <div className="text-amber-300 font-bold text-sm">{selectedChipInfo.name}</div>
                <div className="text-slate-400">{selectedChipInfo.mfr} &middot; <span className="text-cyan-300">{selectedChipInfo.type}</span></div>
              </div>
              <p className="text-slate-400 leading-relaxed text-[10px]">{selectedChipInfo.desc}</p>
            </div>
          ) : (
            <div className="text-slate-500 text-center py-3 text-[11px]">
              Select a responding green address to view chip details.
            </div>
          )}

          <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">Quick Register Write (Hex)</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                aria-label="Register"
                placeholder="Reg 0x6B"
                value={writeReg}
                onChange={(e) => setWriteReg(e.target.value)}
                className={`${inp} w-20`}
              />
              <input
                type="text"
                aria-label="Value"
                placeholder="Val 0x00"
                value={writeVal}
                onChange={(e) => setWriteVal(e.target.value)}
                className={`${inp} w-20`}
              />
              <button
                onClick={handleWriteRegister}
                disabled={!isConnected || !!busy}
                className="flex-1 px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded font-bold text-xs disabled:opacity-40"
              >
                WRITE
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Register dump */}
      <div className={card}>
        <div className={head2}>
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
            <span>REGISTER DUMP</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={regStart}
              onChange={(e) => setRegStart(e.target.value)}
              aria-label="First register to read"
              className={`${inp} w-14`}
              title="First register to read"
            />
            <select aria-label="Number of registers" value={dumpLen} onChange={(e) => setDumpLen(Number(e.target.value))} className={inp} title="Registers to read">
              {[16, 32, 64, 128, 256].map((n) => <option key={n} value={n}>{n} regs</option>)}
            </select>
            <button
              onClick={() => refreshRegisters()}
              disabled={!isConnected || !!busy || !detectedDevices.includes(selectedAddr)}
              className={`${iconBtn} border-cyan-500/40 text-cyan-300`}
            >
              <RefreshCw className="w-3 h-3" />
              <span>{busy === 'read' ? 'READING...' : 'READ REGISTERS'}</span>
            </button>
            {dump && (
              <>
                <button onClick={() => copyText('dump', dumpText)} title="Copy as an i2cdump-style listing" className={`${iconBtn} border-slate-700 text-slate-300`}>
                  <Copy className="w-3 h-3" /> {copied === 'dump' ? 'COPIED' : 'COPY'}
                </button>
                <button onClick={() => download(`i2c-${hex2(dump.addr)}-dump.txt`, dumpText + '\n')} title="Save the listing as a text file" className={`${iconBtn} border-slate-700 text-slate-300`}>
                  <Download className="w-3 h-3" /> SAVE
                </button>
              </>
            )}
          </div>
        </div>

        {isConnected && dump ? (
          <>
            <div className="grid grid-cols-4 @sm:grid-cols-8 @xl:grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
              {dump.bytes.map((val, i) => (
                <div key={dump.start + i} className={`p-1 rounded border text-center font-mono ${changed.has(i) ? 'bg-amber-500/15 border-amber-500/60' : 'bg-slate-950 border-slate-800'}`}>
                  <span className="text-[9px] text-slate-500 block">R_{hex2(dump.start + i)}</span>
                  <span className="text-xs font-bold text-amber-300 block">{hex2(val)}</span>
                  <span className="text-[9px] text-slate-600 block">{val}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {prevDump ? `${changed.size} register(s) changed since the previous read (amber).` : 'Read again to highlight registers that changed.'}
            </p>
          </>
        ) : (
          <div className="text-[11px] text-slate-500 py-2 text-center">
            Connect, select a responding address and press <span className="text-slate-300 font-semibold">Read Registers</span>.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2">
        {/* Raw I2C transfer */}
        <div className={`${card} space-y-1.5`}>
          <div className={head2 + ' !mb-0'}>
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5 text-emerald-400" /> I2C TRANSFER</span>
            <span className="text-[10px] text-slate-500">i2ctransfer syntax</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={xferText}
              onChange={(e) => setXferText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && isConnected && !busy) handleXfer(); }}
              aria-label="I2C transfer script"
              placeholder="w1@0x68 0x75 r1"
              className={`${inp} flex-1 min-w-[10rem]`}
            />
            <button onClick={handleXfer} disabled={!isConnected || !!busy} className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded font-bold text-xs disabled:opacity-40">
              {busy === 'xfer' ? 'RUNNING...' : 'RUN'}
            </button>
          </div>
          <details className="text-[10px] text-slate-500">
            <summary className="cursor-pointer text-slate-400">Syntax</summary>
            <p className="mt-1 leading-relaxed">
              <code>w&lt;N&gt;@&lt;addr&gt; b0 b1..</code> writes, <code>r&lt;N&gt;[@&lt;addr&gt;]</code> reads N bytes (max 256). Messages are joined with repeated START and one STOP. Example: <code>w1@0x68 0x75 r1</code> reads WHO_AM_I. Bytes and address are hex.
            </p>
          </details>
          {xferLog.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-0.5 bg-slate-950 border border-slate-800 rounded p-1.5">
              {xferLog.map((l) => (
                <div key={l.id} className="text-[11px]"><span className="text-slate-500">&gt; {l.cmd}</span><br /><span className="text-emerald-300 break-all">{l.out}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* SPI transfer */}
        <div className={`${card} space-y-1.5`}>
          <div className={head2 + ' !mb-0'}>
            <span className="font-bold text-slate-200 text-xs">SPI TRANSFER</span>
            <span className="text-[10px] text-slate-500">CS low for the exchange &middot; mode {settings.spiMode}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={spiOut}
              onChange={(e) => setSpiOut(e.target.value)}
              aria-label="SPI bytes to send"
              className={`${inp} flex-1 min-w-[10rem]`}
            />
            <button
              onClick={handleSpi}
              disabled={!isConnected || !!busy}
              className="px-2.5 py-1 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded font-bold text-xs disabled:opacity-40"
            >
              {busy === 'spi' ? 'SENDING...' : 'TRANSFER'}
            </button>
          </div>
          <p className="text-[10px] text-slate-500">9F 00 00 00 reads a SPI flash JEDEC ID. Mode and speed are set in the toolbar after connecting.</p>
          {spiIn && <div className="text-xs text-emerald-300 break-all">MISO: {spiIn}</div>}
        </div>
      </div>

      <SensorFlashPanels client={client} isConnected={isConnected} selectedAddr={selectedAddr} guard={guard} busy={busy} />
    </div>
  );
}
