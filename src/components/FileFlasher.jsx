import React, { useState, useRef, useEffect } from 'react';
import { 
  Cpu, 
  Upload, 
  FileCode, 
  CheckCircle, 
  AlertCircle, 
  Play, 
  Pause, 
  Square, 
  Sliders, 
  Zap, 
  FileCheck,
  HardDrive
} from 'lucide-react';
import { loadFirmwareFile } from '../utils/firmwareParser';

export default function FileFlasher({
  isConnected,
  onWriteChunk, // function(Uint8Array): Promise<void>
  onLogMessage
}) {
  const [fileInfo, setFileInfo] = useState(null); // { name, size, type, data, startAddress }
  const [targetOffset, setTargetOffset] = useState('0x00000000');
  const [blockSize, setBlockSize] = useState(256); // 64, 128, 256, 512, 1024
  const [chunkDelay, setChunkDelay] = useState(10); // ms delay between blocks
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

  const blockSizes = [32, 64, 128, 256, 512, 1024, 4096];
  const delayOptions = [
    { label: '0 ms (Max)', value: 0 },
    { label: '5 ms', value: 5 },
    { label: '10 ms', value: 10 },
    { label: '20 ms', value: 20 },
    { label: '50 ms', value: 50 },
    { label: '100 ms', value: 100 }
  ];

  const handleFile = async (file) => {
    if (!file) return;
    try {
      onLogMessage?.(`Loading firmware file: ${file.name} (${file.size} bytes)...`, 'sys');
      const loaded = await loadFirmwareFile(file);
      setFileInfo({
        name: file.name,
        size: loaded.size,
        type: loaded.type,
        data: loaded.data,
        startAddress: loaded.startAddress
      });
      // If address found in hex or uf2, set offset
      if (loaded.startAddress > 0) {
        setTargetOffset(`0x${loaded.startAddress.toString(16).padStart(8, '0').toUpperCase()}`);
      }
      onLogMessage?.(`Parsed ${loaded.type} successfully. Payload: ${loaded.size} bytes.`, 'sys');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`Failed to parse firmware: ${err.message}`, 'sys');
      alert(`Firmware Load Error: ${err.message}`);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const startFlashing = async () => {
    if (!fileInfo || !fileInfo.data || fileInfo.data.length === 0) return;
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    const data = fileInfo.data;
    const totalBytes = data.length;
    const totalBlocks = Math.ceil(totalBytes / blockSize);

    setIsFlashing(true);
    setIsPaused(false);
    isFlashingRef.current = true;
    isPausedRef.current = false;

    onLogMessage?.(`[FLASHER] Initiating flashing at offset ${targetOffset}. Total: ${totalBytes} bytes (${totalBlocks} blocks @ ${blockSize}B, delay ${chunkDelay}ms)`, 'sys');

    const startTime = Date.now();
    let bytesSent = 0;

    for (let i = 0; i < totalBlocks; i++) {
      // Check if user aborted
      if (!isFlashingRef.current) {
        onLogMessage?.('[FLASHER] Flashing aborted by user.', 'sys');
        break;
      }

      // Check if paused
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
        const remainingBytes = totalBytes - bytesSent;
        const eta = speed > 0 ? Math.ceil((remainingBytes / 1024) / speed) : 0;

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

        // Throttle delay between chunks
        if (chunkDelay > 0 && i < totalBlocks - 1) {
          await new Promise(r => setTimeout(r, chunkDelay));
        }
      } catch (err) {
        console.error('Flash error:', err);
        onLogMessage?.(`[FLASHER ERROR] Block ${i + 1} transmission failed: ${err.message}`, 'sys');
        break;
      }
    }

    if (isFlashingRef.current && bytesSent === totalBytes) {
      onLogMessage?.(`[FLASHER SUCCESS] Successfully transmitted ${totalBytes} bytes in ${Math.floor((Date.now() - startTime) / 1000)}s!`, 'sys');
    }

    setIsFlashing(false);
    setIsPaused(false);
    isFlashingRef.current = false;
    isPausedRef.current = false;
  };

  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    isPausedRef.current = next;
    onLogMessage?.(next ? '[FLASHER] Flashing paused.' : '[FLASHER] Flashing resumed.', 'sys');
  };

  const abortFlashing = () => {
    isFlashingRef.current = false;
    setIsFlashing(false);
    setIsPaused(false);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-4 font-mono text-xs">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">FIRMWARE BINARY FLASHER</h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
          .BIN | .HEX | .UF2
        </span>
      </div>

      {/* Drag & Drop Upload Target */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          fileInfo 
            ? 'border-emerald-500/50 bg-emerald-950/10' 
            : 'border-slate-800 hover:border-cyber-amber/50 hover:bg-slate-900/40'
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
                  Format: <span className="text-cyber-amber font-semibold">{fileInfo.type}</span> | 
                  Size: <span className="text-cyber-cyan font-semibold">{(fileInfo.size / 1024).toFixed(2)} KB</span> ({fileInfo.size} bytes)
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
          <div className="flex flex-col items-center justify-center gap-2 text-slate-500">
            <Upload className="w-6 h-6 text-cyber-amber/80" />
            <p className="text-xs text-slate-300 font-semibold">
              Drop firmware file here, or click to browse
            </p>
            <p className="text-[10px] text-slate-500">
              Auto-parses Raw Binary (.bin), Intel Hex (.hex), or Microsoft UF2 (.uf2)
            </p>
          </div>
        )}
      </div>

      {/* Target Addressing & Chunk Configuration */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Target Memory Offset */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Target Flash Offset
          </label>
          <input
            type="text"
            value={targetOffset}
            onChange={(e) => setTargetOffset(e.target.value)}
            disabled={isFlashing}
            placeholder="0x00000000"
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-cyber-amber font-bold outline-none focus:border-cyber-amber"
          />
        </div>

        {/* Block / Chunk Size */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Block Write Size
          </label>
          <select
            value={blockSize}
            onChange={(e) => setBlockSize(Number(e.target.value))}
            disabled={isFlashing}
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-cyber-amber cursor-pointer"
          >
            {blockSizes.map(size => (
              <option key={size} value={size}>
                {size} Bytes {size === 256 ? '(Recommended)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Inter-chunk Throttling Delay */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
            Inter-Block Delay
          </label>
          <select
            value={chunkDelay}
            onChange={(e) => setChunkDelay(Number(e.target.value))}
            disabled={isFlashing}
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 outline-none focus:border-cyber-amber cursor-pointer"
          >
            {delayOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Flashing Progress & Telemetry */}
      {isFlashing && (
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`}></span>
              <span className="font-bold text-slate-200">
                {isPaused ? 'FLASHING PAUSED' : 'TRANSMITTING CHUNKS TO UART...'}
              </span>
            </div>
            <span className="text-cyber-cyan font-bold text-sm">
              {progress.percent}%
            </span>
          </div>

          {/* Cyber Progress Bar */}
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 via-emerald-400 to-cyan-400 rounded-full transition-all duration-150 shadow-emerald-glow"
              style={{ width: `${progress.percent}%` }}
            ></div>
          </div>

          {/* Telemetry Row */}
          <div className="grid grid-cols-4 gap-2 text-[10px] text-slate-400 pt-1">
            <div>
              Blocks: <span className="text-slate-200 font-semibold">{progress.currentBlock}/{progress.totalBlocks}</span>
            </div>
            <div>
              Bytes: <span className="text-slate-200 font-semibold">{(progress.bytesSent / 1024).toFixed(1)} / {(progress.totalBytes / 1024).toFixed(1)} KB</span>
            </div>
            <div>
              Speed: <span className="text-cyber-cyan font-semibold">{progress.speedKBps} KB/s</span>
            </div>
            <div>
              ETA: <span className="text-cyber-amber font-semibold">{progress.etaSeconds}s</span>
            </div>
          </div>
        </div>
      )}

      {/* Flash Actions */}
      <div className="flex items-center gap-2 pt-1">
        {!isFlashing ? (
          <button
            onClick={startFlashing}
            disabled={!fileInfo || !isConnected}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 py-2.5 rounded-lg font-bold text-xs tracking-wider uppercase transition-all shadow-amber-glow disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="w-4 h-4 fill-current" />
            <span>FLASH FIRMWARE TO TARGET</span>
          </button>
        ) : (
          <>
            <button
              onClick={togglePause}
              className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 rounded-lg font-bold text-xs border border-slate-700 transition-colors"
            >
              {isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-amber-400" />}
              <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
            </button>
            <button
              onClick={abortFlashing}
              className="flex items-center justify-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-5 py-2 rounded-lg font-bold text-xs transition-colors"
            >
              <Square className="w-4 h-4 text-rose-400 fill-current" />
              <span>ABORT</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
