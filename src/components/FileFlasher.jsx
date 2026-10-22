import React, { useState, useRef } from 'react';
import { 
  HardDrive, 
  Upload, 
  FileCheck, 
  Zap, 
  Play, 
  Pause, 
  Square, 
  Cpu, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { loadFirmwareFile } from '../utils/firmwareParser';
import { EspBootloaderClient } from '../utils/espLoader';

const CURATED_FIRMWARES = [
  {
    name: 'Piglet Wardriver (ESP32)',
    category: 'Wardriving',
    offset: '0x00010000',
    description: 'High-speed WiFi packet logger and wardriving firmware for ESP32',
    demoBytes: 262144
  },
  {
    name: 'ESP32 Marauder',
    category: 'Security / Pentest',
    offset: '0x00010000',
    description: 'WiFi & Bluetooth offensive/defensive pentest suite for ESP32',
    demoBytes: 524288
  },
  {
    name: 'MicroPython v1.22 (ESP32)',
    category: 'Development',
    offset: '0x00001000',
    description: 'Official MicroPython interactive REPL firmware for standard ESP32',
    demoBytes: 1572864
  },
  {
    name: 'WLED Sound Reactive',
    category: 'IoT Lighting',
    offset: '0x00010000',
    description: 'Addressable LED controller with audio-reactive visualizer',
    demoBytes: 1048576
  }
];

export default function FileFlasher({
  isConnected,
  port,
  onWriteChunk,
  onLogMessage
}) {
  const [flasherMode, setFlasherMode] = useState('esp32');
  const [fileInfo, setFileInfo] = useState(null);
  const [targetOffset, setTargetOffset] = useState('0x00010000');
  const [blockSize, setBlockSize] = useState(1024);
  const [chunkDelay, setChunkDelay] = useState(10);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState({
    bytesSent: 0,
    totalBytes: 0,
    currentBlock: 0,
    totalBlocks: 0,
    percent: 0,
    speedKBps: 0,
    elapsedSeconds: 0,
    etaSeconds: 0
  });

  const isFlashingRef = useRef(false);
  const isPausedRef = useRef(false);
  const fileInputRef = useRef(null);

  const blockSizes = [64, 128, 256, 512, 1024, 2048, 4096];
  const delayOptions = [
    { label: '0 ms (Fast)', value: 0 },
    { label: '5 ms', value: 5 },
    { label: '10 ms', value: 10 },
    { label: '20 ms', value: 20 },
    { label: '50 ms', value: 50 }
  ];

  const handleFile = async (file) => {
    if (!file) return;
    try {
      onLogMessage?.(`[FLASHER] Loading firmware: ${file.name} (${file.size} bytes)...`, 'sys');
      const loaded = await loadFirmwareFile(file);
      setFileInfo({
        name: file.name,
        size: loaded.size,
        type: loaded.type,
        data: loaded.data,
        startAddress: loaded.startAddress
      });
      if (loaded.startAddress > 0) {
        setTargetOffset(`0x${loaded.startAddress.toString(16).padStart(8, '0').toUpperCase()}`);
      }
      onLogMessage?.(`[FLASHER] Parsed ${loaded.type} successfully. Payload: ${loaded.size} bytes.`, 'sys');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[FLASHER ERROR] Failed to parse: ${err.message}`, 'sys');
      alert(`Firmware Load Error: ${err.message}`);
    }
  };

  const loadPresetFirmware = (preset) => {
    // Generate synthetic image for selected preset if local file isn't uploaded
    const data = new Uint8Array(preset.demoBytes);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i ^ 0xAA) & 0xff;
    }
    setFileInfo({
      name: `${preset.name.toLowerCase().replace(/[\s\(\)]+/g, '_')}.bin`,
      size: data.length,
      type: 'Raw Binary (.bin)',
      data,
      startAddress: parseInt(preset.offset, 16)
    });
    setTargetOffset(preset.offset);
    onLogMessage?.(`[PRESET] Loaded curated ${preset.name} configuration (Target Offset: ${preset.offset}).`, 'sys');
  };

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const startFlashing = async () => {
    if (!fileInfo || !fileInfo.data || fileInfo.data.length === 0) return;
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    const data = fileInfo.data;
    const totalBytes = data.length;
    let offsetNum = parseInt(targetOffset, 16);
    if (isNaN(offsetNum)) offsetNum = 0x10000;

    setIsFlashing(true);
    setIsPaused(false);
    isFlashingRef.current = true;
    isPausedRef.current = false;

    const startTime = Date.now();

    // Mode 1: Native ESP32 Bootloader Protocol
    if (flasherMode === 'esp32' && port) {
      onLogMessage?.(`[ESP FLASHER] Starting native ROM bootloader protocol @ offset 0x${offsetNum.toString(16).toUpperCase()}...`, 'sys');
      const client = new EspBootloaderClient(port, onLogMessage);

      try {
        await client.hardwareResetToBootloader();
        await client.sync(6);

        await client.flashBinary(data, offsetNum, blockSize, (pct, written, total, curBlock, totalBlk) => {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (written / 1024) / elapsed : 0;
          const rem = total - written;
          const eta = speed > 0 ? Math.ceil((rem / 1024) / speed) : 0;

          setProgress({
            bytesSent: written,
            totalBytes: total,
            currentBlock: curBlock,
            totalBlocks: totalBlk,
            percent: pct,
            speedKBps: Number(speed.toFixed(1)),
            elapsedSeconds: Math.floor(elapsed),
            etaSeconds: eta
          });
        });

        onLogMessage?.(`[ESP FLASHER] SUCCESS! Programmed ${totalBytes} bytes in ${Math.floor((Date.now() - startTime) / 1000)}s! Target running.`, 'sys');
      } catch (err) {
        console.error('ESP Flash Error:', err);
        onLogMessage?.(`[ESP FLASHER ERROR] ${err.message}`, 'sys');
        alert(`Flashing error: ${err.message}`);
      } finally {
        client.release();
        setIsFlashing(false);
        isFlashingRef.current = false;
      }
      return;
    }

    // Mode 2: Raw Block Flasher
    const totalBlocks = Math.ceil(totalBytes / blockSize);
    onLogMessage?.(`[RAW FLASHER] Streaming ${totalBytes} bytes in ${totalBlocks} blocks...`, 'sys');
    let bytesSent = 0;

    for (let i = 0; i < totalBlocks; i++) {
      if (!isFlashingRef.current) break;
      while (isPausedRef.current) {
        await new Promise(r => setTimeout(r, 100));
        if (!isFlashingRef.current) break;
      }

      const start = i * blockSize;
      const end = Math.min(start + blockSize, totalBytes);
      const chunk = data.subarray(start, end);

      try {
        await onWriteChunk(chunk);
        bytesSent += chunk.length;

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (bytesSent / 1024) / elapsed : 0;
        const percent = Math.min(100, Number(((bytesSent / totalBytes) * 100).toFixed(1)));
        const rem = totalBytes - bytesSent;
        const eta = speed > 0 ? Math.ceil((rem / 1024) / speed) : 0;

        setProgress({
          bytesSent,
          totalBytes,
          currentBlock: i + 1,
          totalBlocks,
          percent,
          speedKBps: Number(speed.toFixed(1)),
          elapsedSeconds: Math.floor(elapsed),
          etaSeconds: eta
        });

        if (chunkDelay > 0 && i < totalBlocks - 1) {
          await new Promise(r => setTimeout(r, chunkDelay));
        }
      } catch (err) {
        onLogMessage?.(`[RAW FLASH ERROR] Block ${i + 1} failed: ${err.message}`, 'sys');
        break;
      }
    }

    setIsFlashing(false);
    isFlashingRef.current = false;
  };

  const abortFlashing = () => {
    isFlashingRef.current = false;
    setIsFlashing(false);
    setIsPaused(false);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-4 font-mono text-xs">
      {/* Title & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">HARDWARE FIRMWARE FLASHER</h2>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
          <button
            onClick={() => setFlasherMode('esp32')}
            disabled={isFlashing}
            className={`px-3 py-1 rounded font-bold transition-all ${
              flasherMode === 'esp32' ? 'bg-amber-500/20 text-cyber-amber border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ESP32 / ESP8266 ROM Protocol
          </button>
          <button
            onClick={() => setFlasherMode('raw')}
            disabled={isFlashing}
            className={`px-3 py-1 rounded font-bold transition-all ${
              flasherMode === 'raw' ? 'bg-cyan-500/20 text-cyber-cyan border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw UART Block Stream
          </button>
        </div>
      </div>

      {/* Curated Firmware Presets Drawer */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-cyber-amber" />
          1-Click Curated Firmware Presets
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CURATED_FIRMWARES.map((item, idx) => (
            <button
              key={idx}
              onClick={() => loadPresetFirmware(item)}
              className="text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group"
            >
              <div className="font-bold text-slate-200 group-hover:text-cyber-amber text-[11px] truncate">
                {item.name}
              </div>
              <div className="text-[9px] text-slate-500">{item.category} • Offset {item.offset}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Drag & Drop File Upload */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
          fileInfo ? 'border-emerald-500/50 bg-emerald-950/10' : 'border-slate-800 hover:border-cyber-amber/50 hover:bg-slate-900/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".bin,.hex,.uf2"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />

        {fileInfo ? (
          <div className="flex items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/20 text-cyber-emerald border border-emerald-500/40">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-slate-100 text-sm tracking-wide">{fileInfo.name}</p>
                <p className="text-[11px] text-slate-400">
                  Type: <span className="text-cyber-amber font-semibold">{fileInfo.type}</span> | 
                  Size: <span className="text-cyber-cyan font-semibold">{(fileInfo.size / 1024).toFixed(2)} KB</span> ({fileInfo.size} B)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700"
            >
              Change File
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 text-slate-500">
            <Upload className="w-5 h-5 text-cyber-amber" />
            <p className="text-xs text-slate-300 font-semibold">Drop custom firmware file here, or click to browse</p>
            <p className="text-[10px] text-slate-500">Supports Raw Binary (.bin), Intel Hex (.hex), or Microsoft UF2 (.uf2)</p>
          </div>
        )}
      </div>

      {/* Target Addressing & Chunk Config */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Target Flash Offset
          </label>
          <input
            type="text"
            value={targetOffset}
            onChange={(e) => setTargetOffset(e.target.value)}
            disabled={isFlashing}
            placeholder="0x00010000"
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-cyber-amber font-bold outline-none focus:border-cyber-amber"
          />
          <span className="text-[9px] text-slate-500 mt-0.5 block">ESP32 App default: 0x10000 | Bootloader: 0x1000</span>
        </div>

        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Block / Chunk Size
          </label>
          <select
            value={blockSize}
            onChange={(e) => setBlockSize(Number(e.target.value))}
            disabled={isFlashing}
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 outline-none cursor-pointer"
          >
            {blockSizes.map(size => (
              <option key={size} value={size}>
                {size} Bytes {size === 1024 ? '(Optimal ESP)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Inter-Block Throttling
          </label>
          <select
            value={chunkDelay}
            onChange={(e) => setChunkDelay(Number(e.target.value))}
            disabled={isFlashing || flasherMode === 'esp32'}
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 outline-none cursor-pointer disabled:opacity-50"
          >
            {delayOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Progress View */}
      {isFlashing && (
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-bold text-slate-200">
                {flasherMode === 'esp32' ? 'PROGRAMMING SPI FLASH...' : 'TRANSMITTING RAW CHUNKS...'}
              </span>
            </div>
            <span className="text-cyber-cyan font-bold text-sm">{progress.percent}%</span>
          </div>

          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 via-emerald-400 to-cyan-400 rounded-full transition-all duration-150 shadow-emerald-glow"
              style={{ width: `${progress.percent}%` }}
            ></div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px] text-slate-400 pt-1">
            <div>Blocks: <span className="text-slate-200 font-semibold">{progress.currentBlock}/{progress.totalBlocks}</span></div>
            <div>Bytes: <span className="text-slate-200 font-semibold">{(progress.bytesSent / 1024).toFixed(1)} / {(progress.totalBytes / 1024).toFixed(1)} KB</span></div>
            <div>Speed: <span className="text-cyber-cyan font-semibold">{progress.speedKBps} KB/s</span></div>
            <div>ETA: <span className="text-cyber-amber font-semibold">{progress.etaSeconds}s</span></div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-1">
        {!isFlashing ? (
          <button
            onClick={startFlashing}
            disabled={!fileInfo || !isConnected}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 py-2.5 rounded-lg font-bold text-xs tracking-wider uppercase transition-all shadow-amber-glow disabled:opacity-40"
          >
            <Zap className="w-4 h-4 fill-current" />
            <span>{flasherMode === 'esp32' ? 'FLASH TO ESP32 TARGET (AUTO-STRAP & SYNC)' : 'STREAM RAW CHUNKS TO TARGET'}</span>
          </button>
        ) : (
          <button
            onClick={abortFlashing}
            className="flex-1 flex items-center justify-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 py-2 rounded-lg font-bold text-xs"
          >
            <Square className="w-4 h-4 text-rose-400 fill-current" />
            <span>ABORT FLASHING</span>
          </button>
        )}
      </div>
    </div>
  );
}
