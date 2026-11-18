import React, { useState, useRef, useMemo } from 'react';
import { Download, Search, Copy } from 'lucide-react';
import {
  dumpFlashViaStub,
  identifyEsp,
  readPartitionTable,
  isWebSerialSupported,
  fullFlashLength,
  formatBytes,
  ESP_BAUD_RATES
} from '../utils/espFlashDump';
import {
  parseOffset,
  parseSize,
  rangeWarnings,
  esptoolReadCommand,
  md5Hex,
  sha256Hex,
  hexRows,
  extractStrings
} from '../utils/espDumpTools';

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
    <div className="bg-[#030712] border border-slate-800 rounded-lg p-2">
      <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">{label}</span>
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
  const [dumpLength, setDumpLength] = useState('20480');
  const [lastDump, setLastDump] = useState(null);
  const [viewMode, setViewMode] = useState('hex');
  const [progress, setProgress] = useState({ percent: 0, bytesRead: 0, totalBytes: 0 });
  const [dumpStage, setDumpStage] = useState('');
  const webSerial = isWebSerialSupported();
  const flash = siliconInfo?.flash || null;
  const offsetNum = parseOffset(targetOffset);
  const lengthNum = parseSize(dumpLength);
  const warnings = rangeWarnings(offsetNum, lengthNum, flash?.sizeBytes);
  const cliCommand = Number.isFinite(offsetNum) && lengthNum > 0
    ? esptoolReadCommand({ offset: offsetNum, length: lengthNum, baud })
    : '';
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
      alert('Enter a valid offset (0x hex or decimal) and a size greater than zero (bytes, 0x hex, or 20K / 4M).');
      return;
    }
    try {
      setIsDumping(true);
      setDumpStage('');
      setProgress({ percent: 0, bytesRead: 0, totalBytes: 0 });
      const result = await dumpFlashViaStub({ startOffset: offsetNum, length, ...common() });
      if (result?.cancelled) onLogMessage?.('[DUMP] Cancelled: no port selected.', 'sys');
      else {
        remember(result);
        if (result?.data) {
          const sha = await sha256Hex(result.data);
          const md5 = md5Hex(result.data);
          setLastDump({ data: result.data, offset: offsetNum, md5, sha256: sha });
          onLogMessage?.(`[DUMP] MD5 ${md5}${sha ? ` SHA-256 ${sha}` : ''}`, 'sys');
        }
      }
    } catch (err) {
      const { msg, full } = failMessage(err);
      onLogMessage?.(`[DUMP ERROR] ${msg}`, 'sys');
      alert(`Dump Error: ${full}`);
    } finally {
      setIsDumping(false);
    }
  };

  const handleStartDump = () => runDump(offsetNum, lengthNum);

  const handleFullBackup = () => {
    try {
      const len = fullFlashLength(flash);
      setTargetOffset('0x00000000');
      setDumpLength(String(len));
      runDump(0, len);
    } catch (err) {
      alert(err.message);
    }
  };

  const dumpPartition = (p) => {
    setTargetOffset(`0x${p.offset.toString(16).toUpperCase().padStart(8, '0')}`);
    setDumpLength(String(p.size));
    runDump(p.offset, p.size);
  };

  const applyPreset = (preset) => {
    setTargetOffset(preset.offset);
    setDumpLength(String(preset.length));
  };

  const copyCli = () => {
    navigator.clipboard?.writeText(cliCommand);
    onLogMessage?.('[ESP RE] esptool command copied.', 'sys');
  };
  const saveAgain = () => {
    if (!lastDump) return;
    const url = URL.createObjectURL(new Blob([lastDump.data], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `esp_flash_dump_0x${lastDump.offset.toString(16).toUpperCase()}_${lastDump.data.length}B.bin`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const dumpView = useMemo(() => {
    if (!lastDump) return null;
    return {
      rows: hexRows(lastDump.data, lastDump.offset, 0, 512),
      strings: extractStrings(lastDump.data, lastDump.offset, 6, 300)
    };
  }, [lastDump]);

  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          onClick={handleInspectSilicon}
          disabled={!webSerial || busy}
          title="Connects through esptool-js (its own port prompt) and reads chip, MAC and flash identity"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 font-bold transition-all disabled:opacity-40"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{isInspecting ? 'IDENTIFYING...' : 'IDENTIFY CHIP'}</span>
        </button>
        <label htmlFor="esp-baud" className="text-[10px] text-slate-500 uppercase font-bold ml-auto">Baud</label>
        <select
          id="esp-baud"
          value={baud}
          onChange={(e) => setBaud(Number(e.target.value))}
          disabled={busy}
          title="Falls back to 115200 if the faster rate fails"
          className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200 outline-none focus:border-amber-500"
        >
          {ESP_BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Silicon Metadata Grid */}
      <div className="grid grid-cols-2 @lg:grid-cols-4 gap-2">
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

      {/* Flash Backup Presets */}
      <div className="space-y-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
          Quick Backup Targets:
        </span>
        <div className="grid grid-cols-2 @lg:grid-cols-4 gap-1.5">
          {DUMP_PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(p)}
              className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group"
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
            className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group disabled:opacity-40"
          >
            <div className="font-bold text-slate-200 group-hover:text-cyber-amber text-[11px] truncate">Full Flash Backup</div>
            <div className="text-[9px] text-slate-500">
              {flash?.sizeBytes ? `0x0 • ${formatBytes(flash.sizeBytes)} (detected)` : 'identify chip first'}
            </div>
          </button>
        </div>
      </div>

      {/* Partition table */}
      <div className="space-y-1">
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
      <div className="bg-[#030712] border border-slate-800 rounded-lg p-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <div>
            <label htmlFor="esp-offset" className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Start Offset (hex)</label>
            <input
              id="esp-offset"
              type="text"
              value={targetOffset}
              onChange={(e) => setTargetOffset(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-28 @md:w-32"
            />
          </div>

          <div>
            <label htmlFor="esp-size" className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Dump Size (bytes, 0x.., 20K, 4M)</label>
            <input
              id="esp-size"
              type="text"
              value={dumpLength}
              onChange={(e) => setDumpLength(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-28 @md:w-32"
            />
          </div>
        </div>

        <button
          onClick={handleStartDump}
          disabled={busy || !webSerial || !Number.isFinite(offsetNum) || !(lengthNum > 0)}
          title={webSerial ? 'Uploads esptool’s stub and reads flash, works on any modern ESP' : 'Web Serial isn’t available in this browser'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold hover:brightness-110 shadow-amber-glow transition-all disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          <span>{isDumping ? `READING FLASH (${progress.percent}%)...` : 'DUMP FLASH TO .BIN'}</span>
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="text-[10px] text-amber-400" role="status">{warnings.join(' ')}</div>
      )}

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

      {/* Equivalent esptool command */}
      {cliCommand && (
        <details className="bg-[#030712] border border-slate-800 rounded-lg p-2">
          <summary className="cursor-pointer text-[10px] text-slate-500 uppercase font-bold">esptool.py equivalent (for the CLI)</summary>
          <div className="mt-1.5 flex items-start gap-1.5">
            <code className="flex-1 break-all text-[10px] text-slate-300">{cliCommand}</code>
            <button onClick={copyCli} title="Copy command" aria-label="Copy esptool command" className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyber-amber">
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">Replace &lt;PORT&gt; with your serial port. This tool does not run esptool.py.</div>
        </details>
      )}

      {/* Last dump: digests, hex preview, strings */}
      {lastDump && dumpView && (
        <div className="bg-[#030712] border border-slate-800 rounded-lg p-2 space-y-1.5" data-testid="esp-last-dump">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Last dump: 0x{lastDump.offset.toString(16).toUpperCase()} &bull; {formatBytes(lastDump.data.length)}</span>
            <button onClick={saveAgain} title="Save the last dump again" className="ml-auto px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px]">Save .bin</button>
            <div className="flex gap-1" role="tablist" aria-label="Dump view">
              {['hex', 'strings'].map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={viewMode === m}
                  onClick={() => setViewMode(m)}
                  className={`px-2 py-0.5 rounded border text-[10px] ${viewMode === m ? 'border-cyber-amber text-cyber-amber' : 'border-slate-800 text-slate-400'}`}
                >
                  {m === 'hex' ? 'Hex' : `Strings (${dumpView.strings.length})`}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-slate-400 break-all">MD5 {lastDump.md5}</div>
          {lastDump.sha256 && <div className="text-[10px] text-slate-400 break-all">SHA-256 {lastDump.sha256}</div>}
          <div className="max-h-48 overflow-auto text-[10px] leading-4 text-slate-300 whitespace-pre">
            {viewMode === 'hex'
              ? dumpView.rows.map((r) => (
                <div key={r.offset}>{r.offset.toString(16).toUpperCase().padStart(8, '0')}  {r.hex.padEnd(47, ' ')}  {r.ascii}</div>
              ))
              : (dumpView.strings.length
                ? dumpView.strings.map((r) => <div key={r.offset}>{r.offset.toString(16).toUpperCase().padStart(8, '0')}  {r.text}</div>)
                : <div className="text-slate-500">No printable strings of 6+ characters.</div>)}
          </div>
          {viewMode === 'hex' && lastDump.data.length > 512 && <div className="text-[10px] text-slate-500">Showing the first 512 bytes; the saved file has all of it.</div>}
        </div>
      )}
    </div>
  );
}
