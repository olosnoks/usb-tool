import React, { useState, useRef } from 'react';
import {
  Cpu,
  HardDrive,
  Upload,
  Download,
  Play,
  Trash2,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  FileCode,
  Sparkles,
  Zap,
  Sliders
} from 'lucide-react';
import {
  Ch341aClient,
  EEPROM_DATABASE,
  diffBuffers
} from '../../utils/ch341aDriver';
import HexViewer from '../common/HexViewer';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

import { confirmAction, useSessionError } from '../../utils/sessionLog';
const hex = (v, w = 6) => `0x${v.toString(16).toUpperCase().padStart(w, '0')}`;

export default function Ch341aProgrammer() {
  const [client] = useState(() => new Ch341aClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [chipInfo, setChipInfo] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [progress, setProgress] = useState({ percent: 0, current: 0, total: 0 });

  // Memory buffer for hex viewer
  const [loadedBuffer, setLoadedBuffer] = useState(null);
  const [hexByteStream, setHexByteStream] = useState([]);

  const fileInputRef = useRef(null);
  const compareInputRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [srInput, setSrInput] = useState('00');
  const [diff, setDiff] = useState(null); // { name, bytes, ranges, sizeDiffers }
  const [eepromType, setEepromType] = useState('24C02');
  const [eepromAddr, setEepromAddr] = useState('50');
  const [error, setError] = useSessionError('CH341A');

  const showBuffer = (data, type) => {
    setLoadedBuffer(data);
    const stream = [];
    for (let i = 0; i < Math.min(data.length, 2048); i++) stream.push({ offset: i, byte: data[i], type });
    setHexByteStream(stream);
  };

  // Run one programmer job with the busy banner; errors go to the error line.
  const job = async (label, fn) => {
    if (isBusy) return undefined;
    setIsBusy(true);
    setBusyAction(label);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Connect Physical CH341A via WebUSB
  const handleConnectHardware = async () => {
    try {
      setIsBusy(true);
      setBusyAction('Connecting to CH341A WebUSB...');
      await client.connect();
      setIsConnected(true);
      setIsSimulated(false);
      // Auto-detect chip
      const detected = await client.readJedecId();
      setChipInfo(detected);
      setStatus(await client.readStatus());
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Connect Virtual Simulation
  const handleConnectSimulation = async () => {
    const chip = await client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setChipInfo(chip);
    setStatus(await client.readStatus());
    const data = await client.readFlash(0, 65536);
    showBuffer(data, 'rx');
  };

  const handleDisconnect = () => {
    client.disconnect();
    setStatus(null);
    setDiff(null);
    setIsConnected(false);
    setIsSimulated(false);
    setChipInfo(null);
    setLoadedBuffer(null);
    setHexByteStream([]);
  };

  // Identify Chip
  const handleIdentify = async () => {
    if (!isConnected) return;
    try {
      setIsBusy(true);
      setBusyAction('Querying JEDEC 0x9F register...');
      const chip = await client.readJedecId();
      setChipInfo(chip);
    } catch (err) {
      alert(`Identification error: ${err.message}`);
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Read Flash Memory
  const handleReadFlash = async (length = 65536) => {
    if (!isConnected) return;
    try {
      setIsBusy(true);
      setBusyAction(`Reading ${length / 1024} KB from flash...`);
      setProgress({ percent: 0, current: 0, total: length });

      const data = await client.readFlash(0, length, (pct, cur, tot) => {
        setProgress({ percent: pct, current: cur, total: tot });
      });

      setLoadedBuffer(data);
      // Format into hex viewer stream
      const stream = [];
      const displayMax = Math.min(data.length, 2048);
      for (let i = 0; i < displayMax; i++) {
        stream.push({ offset: i, byte: data[i], type: 'rx' });
      }
      setHexByteStream(stream);
    } catch (err) {
      alert(`Read error: ${err.message}`);
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Write Flash Memory
  const handleWriteFlash = async () => {
    if (!isConnected || !loadedBuffer) {
      alert('Please load or dump a binary file first.');
      return;
    }
    if (chipInfo?.sizeBytes && loadedBuffer.length > chipInfo.sizeBytes) {
      alert(`The buffer (${loadedBuffer.length} bytes) is larger than the chip (${chipInfo.sizeBytes} bytes).`);
      return;
    }
    if (!isSimulated && !confirmAction(`Write ${loadedBuffer.length} bytes to the ${chipInfo?.model || 'SPI flash'} from address 0?\n\nSectors that differ are erased and reprogrammed, then verified. Keep a backup dump of the original contents.`)) return;
    try {
      setIsBusy(true);
      setBusyAction(`Programming ${loadedBuffer.length} bytes to SPI flash...`);
      setProgress({ percent: 0, current: 0, total: loadedBuffer.length });

      await client.writeFlash(0, loadedBuffer, (pct, cur, tot) => {
        setProgress({ percent: pct, current: cur, total: tot });
      });
      setStatus(await client.readStatus());
      alert('Flash programming and verification complete!');
    } catch (err) {
      alert(`Write error: ${err.message}`);
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Save to .BIN File
  const handleSaveBin = () => {
    if (!loadedBuffer) return;
    const blob = new Blob([loadedBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bios-dump-${chipInfo?.model || 'spi'}-${Date.now()}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load .BIN File from computer
  const handleFileLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      setLoadedBuffer(data);

      const stream = [];
      const displayMax = Math.min(data.length, 2048);
      for (let i = 0; i < displayMax; i++) {
        stream.push({ offset: i, byte: data[i], type: 'tx' });
      }
      setHexByteStream(stream);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Programmer Header Card */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>CH341A USB SPI / I2C BIOS & EEPROM PROGRAMMER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Read, write and verify 25-series SPI NOR flash (BIOS, routers, GPUs, IoT) and 24-series I2C EEPROMs with a CH341A over WebUSB: chip detection with SFDP fallback, write protection, smart erase-and-write, and dump comparison. On Windows the CH341A needs the WinUSB driver (Zadig).
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnectHardware}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all active:scale-95 disabled:opacity-50"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>CONNECT CH341A (WEBUSB)</span>
                </button>
                <button
                  onClick={handleConnectSimulation}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>DEMO SIMULATION</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Chip Identification & Info Banner */}
        {isConnected && chipInfo && (
          <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Detected Flash Chip</span>
              <div className="text-amber-300 font-bold text-sm mt-0.5">{chipInfo.model}</div>
              <div className="text-[10px] text-slate-400">{chipInfo.manufacturer}</div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Flash Capacity</span>
              <div className="text-cyan-300 font-bold text-sm mt-0.5">
                {chipInfo.sizeBytes ? `${chipInfo.sizeBytes >= 1048576 ? `${chipInfo.sizeBytes / 1048576} MB` : `${chipInfo.sizeBytes / 1024} KB`} (${chipInfo.sizeBytes} bytes)` : 'unknown'}
              </div>
              <div className="text-[10px] text-slate-400">Page: {chipInfo.pageSize}B • Sector: {chipInfo.sectorSize / 1024}KB</div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 font-bold uppercase">JEDEC ID (0x9F)</span>
              <div className="text-emerald-400 font-mono font-bold text-sm mt-0.5">
                0x{chipInfo.jedecId?.toString(16).toUpperCase() || 'EF4018'}
              </div>
              <div className="text-[10px] text-slate-400">{chipInfo.guessed ? `Not in the database; size from ${chipInfo.sizeFrom || 'nowhere'}` : 'SPI mode 0'}</div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Programmer Hardware</span>
              <div className="text-purple-300 font-bold text-sm mt-0.5">
                {isSimulated ? 'VIRTUAL CH341A' : 'CH341A USB'}
              </div>
              <div className="text-[10px] text-slate-400">{isSimulated ? 'Simulated Target Active' : 'VID 0x1A86 PID 0x5512'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      {isConnected && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 shadow-xl">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleIdentify}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-bold transition-all disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              <span>READ JEDEC ID</span>
            </button>

            <button
              onClick={() => handleReadFlash(65536)}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>DUMP 64 KB</span>
            </button>

            <button
              onClick={() => handleReadFlash(chipInfo?.sizeBytes || 1048576)}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-xs font-bold transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>DUMP FULL CHIP</span>
            </button>

            <button
              onClick={handleWriteFlash}
              disabled={isBusy || !loadedBuffer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-emerald-glow transition-all disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>WRITE BUFFER TO FLASH</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileLoad}
              accept=".bin,.rom,.hex"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>LOAD .BIN FILE</span>
            </button>

            {loadedBuffer && (
              <button
                onClick={handleSaveBin}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-800 text-xs font-bold transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>SAVE DUMP (.BIN)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {isSimulated && <DemoBanner>Virtual CH341A with a W25Q64 flash and a 24C02 EEPROM; it speaks the real CH341 packet protocol, but no hardware is involved.</DemoBanner>}
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {isConnected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
          {/* Status registers and protection */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl space-y-2">
            <div className="font-bold text-slate-200 flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5 text-cyan-400" /> STATUS & WRITE PROTECTION</div>
            {status ? (
              <>
                <div className="text-slate-400">SR1 {hex(status.sr1, 2)} · SR2 {hex(status.sr2, 2)} · SR3 {hex(status.sr3, 2)}</div>
                <div className="flex flex-wrap gap-1">
                  {[['BP', status.bp ? `${status.bp}` : '0', status.protected], ['TB', status.tb ? '1' : '0'], ['SEC', status.sec ? '1' : '0'], ['SRP0', status.srp0 ? '1' : '0', status.srp0], ['QE', status.qe ? '1' : '0'], ['WEL', status.wel ? '1' : '0']].map(([k, v, warn]) => (
                    <span key={k} className={`px-1.5 py-0.5 rounded border ${warn ? 'border-amber-500/50 text-amber-300' : 'border-slate-800 text-slate-300'}`}>{k}={v}</span>
                  ))}
                </div>
                <div className={status.protected ? 'text-amber-300' : 'text-emerald-300'}>
                  {status.protected ? 'Blocks are write-protected: writes and erases there are ignored.' : 'No block protection.'}
                </div>
              </>
            ) : <div className="text-slate-500">Not read yet.</div>}
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => job('Reading status registers...', async () => setStatus(await client.readStatus()))} disabled={isBusy} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40">READ</button>
              <button onClick={() => job('Clearing block protection...', async () => setStatus(await client.unprotect()))} disabled={isBusy} className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold disabled:opacity-40">UNPROTECT</button>
              <span className="text-slate-500">SR1</span>
              <input value={srInput} onChange={(e) => setSrInput(e.target.value)} className="w-10 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
              <button
                onClick={() => {
                  const v = parseInt(srInput, 16);
                  if (Number.isNaN(v) || v > 0xff) { setError('SR1 is one hex byte.'); return; }
                  if (!isSimulated && !confirmAction(`Write status register 1 = ${hex(v, 2)}? Setting SRP0 with WP# low can lock the register until power-off.`)) return;
                  job('Writing status register...', async () => setStatus(await client.writeStatus(v)));
                }}
                disabled={isBusy}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40"
              >
                WRITE
              </button>
            </div>
            <button
              onClick={() => {
                if (!isSimulated && !confirmAction(`Erase the WHOLE ${chipInfo?.model || 'chip'}? Every byte becomes FF. Save a dump first.`)) return;
                job('Chip erase (this can take a minute)...', async () => { await client.eraseChip(); setStatus(await client.readStatus()); });
              }}
              disabled={isBusy}
              className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> CHIP ERASE
            </button>
          </div>

          {/* Compare */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl space-y-2">
            <div className="font-bold text-slate-200 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-purple-400" /> COMPARE</div>
            <p className="text-slate-500">Compare a .bin file with the chip (reads the same length), or with the buffer below.</p>
            <input
              type="file"
              ref={compareInputRef}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const target = compareInputRef.current.dataset.target;
                job(`Comparing ${file.name}...`, async () => {
                  const data = new Uint8Array(await file.arrayBuffer());
                  const other = target === 'chip'
                    ? await client.readFlash(0, Math.min(data.length, chipInfo?.sizeBytes || data.length), (pct, cur, tot) => setProgress({ percent: pct, current: cur, total: tot }))
                    : loadedBuffer;
                  if (!other) throw new Error('Nothing in the buffer to compare with.');
                  setDiff({ name: `${file.name} vs ${target === 'chip' ? 'chip' : 'buffer'}`, ...diffBuffers(data, other) });
                });
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => { compareInputRef.current.dataset.target = 'chip'; compareInputRef.current.click(); }} disabled={isBusy} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40">FILE vs CHIP</button>
              <button onClick={() => { compareInputRef.current.dataset.target = 'buffer'; compareInputRef.current.click(); }} disabled={isBusy || !loadedBuffer} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40">FILE vs BUFFER</button>
            </div>
            {diff && (
              <div className="space-y-1">
                <div className={diff.bytes || diff.sizeDiffers ? 'text-amber-300' : 'text-emerald-300'}>
                  {diff.name}: {diff.bytes ? `${diff.bytes} bytes differ in ${diff.ranges.length} range(s)` : 'identical'}{diff.sizeDiffers ? ' (sizes differ)' : ''}
                </div>
                <div className="max-h-28 overflow-y-auto text-slate-400">
                  {diff.ranges.slice(0, 200).map((r) => <div key={r.start}>{hex(r.start)} – {hex(r.end - 1)} ({r.end - r.start} B)</div>)}
                </div>
              </div>
            )}
          </div>

          {/* I2C EEPROM */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl space-y-2">
            <div className="font-bold text-slate-200 flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5 text-emerald-400" /> I2C EEPROM (24Cxx)</div>
            <p className="text-slate-500">Put the 24Cxx in the 8-pin socket (the 25-series side is SPI). A missing chip reads as all FF.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={eepromType} onChange={(e) => setEepromType(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300">
                {Object.entries(EEPROM_DATABASE).map(([k, v]) => <option key={k} value={k}>{k} ({v.size >= 1024 ? `${v.size / 1024} KB` : `${v.size} B`})</option>)}
              </select>
              <span className="text-slate-500">addr 0x</span>
              <input value={eepromAddr} onChange={(e) => setEepromAddr(e.target.value)} className="w-8 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => job(`Reading ${eepromType}...`, async () => {
                  const ee = client.eeprom(eepromType, parseInt(eepromAddr, 16) || 0x50);
                  const data = await ee.read((f) => setProgress({ percent: Math.round(f * 100), current: 0, total: ee.size }));
                  showBuffer(data, 'rx');
                })}
                disabled={isBusy}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-emerald-500/40 text-emerald-300 font-bold disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> READ EEPROM
              </button>
              <button
                onClick={() => {
                  if (!loadedBuffer) { setError('Load or read a buffer first.'); return; }
                  if (!isSimulated && !confirmAction(`Write ${loadedBuffer.length} bytes to the ${eepromType}?`)) return;
                  job(`Writing ${eepromType}...`, async () => {
                    const ee = client.eeprom(eepromType, parseInt(eepromAddr, 16) || 0x50);
                    await ee.write(loadedBuffer.subarray(0, Math.min(loadedBuffer.length, ee.size)), (f) => setProgress({ percent: Math.round(f * 100), current: 0, total: ee.size }));
                  });
                }}
                disabled={isBusy || !loadedBuffer}
                className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" /> WRITE BUFFER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      {isBusy && (
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <span className="text-amber-400 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{busyAction}</span>
            </span>
            <span>{progress.percent}%</span>
          </div>
          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-100"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Built-in Interactive Hex Inspector for Dumped BIOS/Flash */}
      {loadedBuffer ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold text-slate-200">
              BUFFER PREVIEW: <strong className="text-amber-400">{(loadedBuffer.length / 1024).toFixed(1)} KB</strong> Loaded
            </span>
            <span>Showing first 2048 bytes</span>
          </div>
          <HexViewer
            byteStream={hexByteStream}
            onClear={() => {
              setLoadedBuffer(null);
              setHexByteStream([]);
            }}
            maxDisplayBytes={2048}
          />
        </div>
      ) : (
        <div className="bg-slate-950/60 border border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500 flex flex-col items-center gap-2">
          <HardDrive className="w-8 h-8 text-slate-600 stroke-[1.5]" />
          <span>Connect programmer and click "DUMP FLASH" or load a .bin firmware image to inspect</span>
        </div>
      )}
    </div>
  );
}
