import React, { useState, useRef } from 'react';
import { Cpu, Download, Search } from 'lucide-react';
import {
  dumpFlashViaStub,
  identifyEsp,
  readPartitionTable,
  isWebSerialSupported,
  fullFlashLength,
  formatBytes,
  ESP_BAUD_RATES
} from '../utils/espFlashDump';

const DUMP_PRESETS = [
  {
    name: 'Bootloader Partition',
    offset: '0x00001000',
    length: 28672, // 28 KB
    description: 'First stage 2nd bootloader binary'
  },
  {
    name: 'Partition Table',
    offset: '0x00008000',
    length: 4096, // 4 KB
    description: 'Flash partition layout (app, ota, nvs)'
  },
  {
    name: 'NVS Storage (Credentials)',
    offset: '0x00009000',
    length: 20480, // 20 KB
    description: 'Non-Volatile Storage (WiFi creds, BLE keys)'
  }
];

function Cell({ label, children }) {
  return (
    <div className="bg-[#030712] border border-slate-800 rounded-lg p-3">
      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">{label}</span>
      <div className="text-xs font-bold text-slate-200 break-words">{children}</div>
    </div>
  );
}

export default function EspMemoryInspector({ onLogMessage }) {
  // Identify / dump / partition reads go through esptool-js, which opens and
  // owns its own port (the Terminal's read loop would deadlock a shared one).
  // The port chosen once is reused so the picker isn't shown for every action.
  const chosenPort = useRef(null);
  const [siliconInfo, setSiliconInfo] = useState(null);
  const [partitions, setPartitions] = useState(null);
  const [baud, setBaud] = useState(115200);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isReadingTable, setIsReadingTable] = useState(false);
  const [isDumping, setIsDumping] = useState(false);
  const [targetOffset, setTargetOffset] = useState('0x00009000');
  const [dumpLength, setDumpLength] = useState(20480);
  const [progress, setProgress] = useState({ percent: 0, bytesRead: 0, totalBytes: 0 });
  const [dumpStage, setDumpStage] = useState('');
  const webSerial = isWebSerialSupported();
  const flash = siliconInfo?.flash || null;
  const busy = isInspecting || isDumping || isReadingTable;

  const report = ({ stage, pct, bytesRead, totalBytes }) => {
    if (stage != null) setDumpStage(stage);
    if (pct != null) {
      setProgress({ percent: Math.round(pct), bytesRead: bytesRead || 0, totalBytes: totalBytes || 0 });
    }
  };
  const common = () => ({ port: chosenPort.current || undefined, baudrate: baud, report, onLog: onLogMessage });
  const remember = (res) => { if (res?.port) chosenPort.current = res.port; };
  const failMessage = (err) => {
    const msg = err && err.message ? err.message : String(err);
    const portBusy = /failed to open|already open|in use/i.test(msg);
    const retry = baud > 115200 ? ' You can retry at 115200 baud.' : '';
    const hint = portBusy ? ' The port is in use. Disconnect it in the Terminal (and close other serial tabs), then try again.' : '';
    return { msg, full: `${msg}${hint}${retry}` };
  };
  const noSerial = () => alert('Web Serial isn’t available in this browser. Use desktop Chrome, Edge or Brave.');

  const handleInspectSilicon = async () => {
    if (!webSerial) return noSerial();
    try {
      setIsInspecting(true);
      setDumpStage('');
      const res = await identifyEsp(common());
      if (res?.cancelled) { onLogMessage?.('[ESP RE] Cancelled: no port selected.', 'sys'); return; }
      remember(res);
      setSiliconInfo(res.info);
    } catch (err) {
      const { msg, full } = failMessage(err);
      onLogMessage?.(`[ESP RE] Identify failed: ${msg}`, 'sys');
      alert(`Identify Error: ${full}`);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleReadTable = async () => {
    if (!webSerial) return noSerial();
    try {
      setIsReadingTable(true);
      const res = await readPartitionTable(common());
      if (res?.cancelled) { onLogMessage?.('[ESP RE] Cancelled: no port selected.', 'sys'); return; }
      remember(res);
      setPartitions(res.table);
      const md5 = res.table.md5;
      onLogMessage?.(`[ESP RE] Partition table: ${res.table.partitions.length} entries${md5.present ? (md5.valid ? ', MD5 valid' : ', MD5 MISMATCH') : ''}.`, 'sys');
    } catch (err) {
      const { msg, full } = failMessage(err);
      setPartitions(null);
      onLogMessage?.(`[ESP RE] Partition table read failed: ${msg}`, 'sys');
      alert(`Partition Table Error: ${full}`);
    } finally {
      setIsReadingTable(false);
    }
  };

  const runDump = async (offsetNum, length) => {
    if (!webSerial) return noSerial();
    if (!Number.isFinite(offsetNum) || !(length > 0)) {
      alert('Enter a valid hex offset and a size greater than zero.');
      return;
    }
    try {
      setIsDumping(true);
      setDumpStage('');
      setProgress({ percent: 0, bytesRead: 0, totalBytes: 0 });
      const result = await dumpFlashViaStub({ startOffset: offsetNum, length, ...common() });
      if (result?.cancelled) onLogMessage?.('[DUMP] Cancelled: no port selected.', 'sys');
      else remember(result);
    } catch (err) {
      const { msg, full } = failMessage(err);
      onLogMessage?.(`[DUMP ERROR] ${msg}`, 'sys');
      alert(`Dump Error: ${full}`);
    } finally {
      setIsDumping(false);
    }
  };

  const handleStartDump = () => runDump(parseInt(targetOffset, 16), Number(dumpLength));

  const handleFullBackup = () => {
    try {
      const len = fullFlashLength(flash);
      setTargetOffset('0x00000000');
      setDumpLength(len);
      runDump(0, len);
    } catch (err) {
      alert(err.message);
    }
  };

  const dumpPartition = (p) => {
    setTargetOffset(`0x${p.offset.toString(16).toUpperCase().padStart(8, '0')}`);
    setDumpLength(p.size);
    runDump(p.offset, p.size);
  };

  const applyPreset = (preset) => {
    setTargetOffset(preset.offset);
    setDumpLength(preset.length);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">ESP32 SILICON INSPECTION & FLASH MEMORY DUMP</h2>
        </div>

        <button
          onClick={handleInspectSilicon}
          disabled={!webSerial || busy}
          title="Connects through esptool-js (its own port prompt) and reads chip, MAC and flash identity"
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 text-xs font-bold transition-all disabled:opacity-40"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{isInspecting ? 'IDENTIFYING...' : 'IDENTIFY CHIP'}</span>
        </button>
      </div>

      {/* Silicon Metadata Grid */}
      <div className="grid grid-cols-2 @sm:grid-cols-4 gap-2.5">
        <Cell label="Chip">{siliconInfo?.chip || '--'}</Cell>
        <Cell label="MAC Address">{siliconInfo ? (siliconInfo.mac || 'not readable') : 'Click "Identify Chip"'}</Cell>
        <Cell label="Features / Crystal">
          {siliconInfo
            ? `${siliconInfo.features ? siliconInfo.features.join(', ') : '--'}${siliconInfo.crystalMHz ? ` · ${siliconInfo.crystalMHz} MHz` : ''}`
            : '--'}
        </Cell>
        <Cell label="Flash">
          {siliconInfo
            ? (flash
              ? `${flash.manufacturerName} ${flash.device} · ${flash.sizeBytes ? formatBytes(flash.sizeBytes) : 'size unknown'}`
              : 'not detected')
            : '--'}
        </Cell>
      </div>

      {/* Baud */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] text-slate-500 uppercase font-bold">Baud:</span>
        <select
          value={baud}
          onChange={(e) => setBaud(Number(e.target.value))}
          disabled={busy}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none"
        >
          {ESP_BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-slate-500">Falls back to 115200 if the faster rate fails.</span>
      </div>

      {/* Flash Backup Presets */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
          Quick Backup Targets:
        </span>
        <div className="grid grid-cols-2 @sm:grid-cols-4 gap-2">
          {DUMP_PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(p)}
              className="text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group"
            >
              <div className="font-bold text-slate-200 group-hover:text-cyber-amber text-[11px] truncate">
                {p.name}
              </div>
              <div className="text-[9px] text-slate-500">{p.offset} &bull; {(p.length / 1024).toFixed(0)} KB</div>
            </button>
          ))}
          <button
            onClick={handleFullBackup}
            disabled={!flash?.sizeBytes || busy}
            title={flash?.sizeBytes ? 'Dump the whole detected flash' : 'Run "Identify chip" first so the flash size is known'}
            className="text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group disabled:opacity-40"
          >
            <div className="font-bold text-slate-200 group-hover:text-cyber-amber text-[11px] truncate">Full Flash Backup</div>
            <div className="text-[9px] text-slate-500">
              {flash?.sizeBytes ? `0x0 • ${formatBytes(flash.sizeBytes)} (detected)` : 'identify chip first'}
            </div>
          </button>
        </div>
      </div>

      {/* Partition table */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Partition table (0x8000)</span>
          <button
            onClick={handleReadTable}
            disabled={!webSerial || busy}
            className="px-3 py-1 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 text-[11px] font-bold disabled:opacity-40"
          >
            {isReadingTable ? 'READING...' : 'READ PARTITION TABLE'}
          </button>
        </div>
        {partitions && (
          <div className="bg-[#030712] border border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="text-slate-500 text-left">
                <tr><th className="p-1.5">Name</th><th>Type</th><th>Subtype</th><th>Offset</th><th>Size</th><th>Flags</th><th /></tr>
              </thead>
              <tbody>
                {partitions.partitions.map((p) => (
                  <tr key={`${p.name}-${p.offset}`} className="border-t border-slate-800 text-slate-300">
                    <td className="p-1.5 font-bold">{p.name || '(unnamed)'}</td>
                    <td>{p.typeName}</td>
                    <td>{p.subtypeName}</td>
                    <td>0x{p.offset.toString(16)}</td>
                    <td>{formatBytes(p.size)}</td>
                    <td>{[p.encrypted && 'encrypted', p.readonly && 'readonly'].filter(Boolean).join(', ') || '-'}</td>
                    <td>
                      <button
                        onClick={() => dumpPartition(p)}
                        disabled={busy}
                        className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 disabled:opacity-40"
                      >
                        Dump
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-1.5 text-[10px] text-slate-500">
              MD5 entry: {partitions.md5.present ? (partitions.md5.valid ? 'present, valid' : 'present, DOES NOT MATCH') : 'not present'}
              {partitions.warnings.map((w) => <div key={w} className="text-amber-400">{w}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Custom Range & Dump Execution */}
      <div className="bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Start Offset (Hex)</label>
            <input
              type="text"
              value={targetOffset}
              onChange={(e) => setTargetOffset(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-32"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Dump Size (Bytes)</label>
            <input
              type="number"
              value={dumpLength}
              onChange={(e) => setDumpLength(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-32"
            />
          </div>
        </div>

        <button
          onClick={handleStartDump}
          disabled={busy || !webSerial}
          title={webSerial ? 'Uploads esptool’s stub and reads flash, works on any modern ESP' : 'Web Serial isn’t available in this browser'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold hover:brightness-110 shadow-amber-glow transition-all disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          <span>{isDumping ? `READING FLASH (${progress.percent}%)...` : 'DUMP FLASH TO .BIN'}</span>
        </button>
      </div>

      {/* Progress Bar when Dumping */}
      {(isDumping || isInspecting || isReadingTable) && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{dumpStage || 'Working...'}</span>
            {isDumping && <span>{progress.bytesRead} / {progress.totalBytes} Bytes ({progress.percent}%)</span>}
          </div>
          {isDumping && (
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-cyber-amber transition-all duration-150"
                style={{ width: `${progress.percent}%` }}
              ></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
