import React, { useState, useRef } from 'react';
import { 
  HardDrive, 
  Upload, 
  FileCheck, 
  Zap, 
  Play, 
  Square, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle, 
  Trash2, 
  Plus, 
  RotateCcw,
  Sparkles,
  Layers,
  Info
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { loadFirmwareFile } from '../../utils/firmwareParser';
import { EspBootloaderClient } from '../../utils/espLoader';
import { 
  PARTITION_PRESETS, 
  parseHexOffset, 
  formatHexOffset, 
  calculateTotalPayloadSize 
} from '../../utils/partitionPresets';
import CloudFirmwareCatalog from '../flasher/CloudFirmwareCatalog';

export default function FlasherTab() {
  const {
    isConnected,
    port,
    addLog,
    sendRawBytes
  } = useSerial();

  // Sub-view: 'catalog' (ESP Terminator 400+ presets) | 'slots' (Custom Multi-Slot Flasher)
  const [subView, setSubView] = useState('catalog');

  // Selected layout preset
  const [activePresetId, setActivePresetId] = useState('esp32-classic');

  // Multi-partition slots state (1 to 4 slots)
  const [slots, setSlots] = useState([
    {
      id: 'part-1',
      label: 'Bootloader',
      offset: '0x1000',
      enabled: true,
      file: null,
      fileInfo: null
    },
    {
      id: 'part-2',
      label: 'Partition Table',
      offset: '0x8000',
      enabled: true,
      file: null,
      fileInfo: null
    },
    {
      id: 'part-3',
      label: 'Application Firmware',
      offset: '0x10000',
      enabled: true,
      file: null,
      fileInfo: null
    }
  ]);

  // Flasher protocol engine options
  const [flasherMode, setFlasherMode] = useState('esp-rom'); // 'esp-rom' | 'raw-stream'
  const [blockSize, setBlockSize] = useState(1024);
  const [chunkDelay, setChunkDelay] = useState(10);
  const [isFlashing, setIsFlashing] = useState(false);

  // Timing controls for ESP bootloader entry during flash
  const [resetHoldMs, setResetHoldMs] = useState(150);
  const [bootPinHoldMs, setBootPinHoldMs] = useState(50);

  // Progress state
  const [progress, setProgress] = useState({
    activePartitionIndex: 0,
    totalPartitions: 0,
    currentPartitionLabel: '',
    partitionPercent: 0,
    aggregatePercent: 0,
    writtenBytes: 0,
    totalBytes: 0,
    speedKBps: 0,
    elapsedSeconds: 0,
    etaSeconds: 0
  });

  const isFlashingRef = useRef(false);
  const fileInputRefs = useRef({});

  // Apply layout preset
  const handleApplyPreset = (presetId) => {
    const preset = PARTITION_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    setSlots(preset.partitions.map((p, idx) => ({
      id: `part-${idx + 1}`,
      label: p.label,
      offset: p.offset,
      enabled: p.defaultEnabled !== false,
      file: null,
      fileInfo: null
    })));
    addLog(`[FLASHER] Applied "${preset.name}" memory partition preset.`, 'sys');
  };

  // Add a new custom partition slot (up to 4)
  const handleAddSlot = () => {
    if (slots.length >= 4) {
      alert('Maximum of 4 partition slots supported.');
      return;
    }
    const nextIdx = slots.length + 1;
    setSlots(prev => [
      ...prev,
      {
        id: `part-${Date.now()}`,
        label: `Partition ${nextIdx}`,
        offset: `0x${(0x10000 * nextIdx).toString(16).toUpperCase()}`,
        enabled: true,
        file: null,
        fileInfo: null
      }
    ]);
  };

  // Remove a partition slot
  const handleRemoveSlot = (slotId) => {
    if (slots.length <= 1) {
      alert('At least one partition slot must remain.');
      return;
    }
    setSlots(prev => prev.filter(s => s.id !== slotId));
  };

  // Update a partition slot property
  const updateSlot = (slotId, updates) => {
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, ...updates } : s));
  };

  // Handle file loading for a specific slot
  const handleSlotFile = async (slotId, file) => {
    if (!file) return;
    try {
      addLog(`[FLASHER] Parsing firmware file "${file.name}" (${file.size} bytes)...`, 'sys');
      const loaded = await loadFirmwareFile(file);
      updateSlot(slotId, {
        file,
        fileInfo: {
          name: file.name,
          size: loaded.size,
          type: loaded.type,
          data: loaded.data,
          startAddress: loaded.startAddress
        }
      });

      // If file contains explicit start address (e.g. Intel HEX or UF2), update slot offset
      if (loaded.startAddress > 0) {
        updateSlot(slotId, {
          offset: formatHexOffset(loaded.startAddress)
        });
      }

      addLog(`[FLASHER] Slot file loaded: "${file.name}" [${loaded.type}] - ${loaded.size} bytes.`, 'sys');
    } catch (err) {
      console.error(err);
      addLog(`[FLASHER ERROR] Failed to load "${file.name}": ${err.message}`, 'sys');
      alert(`Firmware File Error: ${err.message}`);
    }
  };

  // Calculate total payload size of enabled slots with files
  const totalPayloadSize = calculateTotalPayloadSize(slots);
  const enabledSlotsWithFiles = slots.filter(s => s.enabled && s.fileInfo?.data?.length > 0);

  // Load firmware directly from Cloud Catalog into slots
  const handleLoadFromCatalog = ({ firmware, files, flashConfig }) => {
    const newSlots = files.map((f, idx) => ({
      id: `part-${idx + 1}`,
      label: f.name.replace(/\.bin$/i, ''),
      offset: f.address || (idx === 0 ? '0x0' : '0x10000'),
      enabled: true,
      file: { name: f.name },
      fileInfo: {
        name: f.name,
        size: f.size,
        type: 'Raw Binary',
        data: f.data,
        startAddress: parseHexOffset(f.address || '0x0')
      }
    }));
    setSlots(newSlots);
    setSubView('slots');
    addLog(`[FLASHER] Loaded ${firmware.name} (${files.length} partitions) from Cloud Catalog. Ready to flash!`, 'success');
  };

  // Start Flashing Execution
  const startFlashing = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    if (enabledSlotsWithFiles.length === 0) {
      alert('Please select and enable at least one partition file to flash.');
      return;
    }

    // Validate all offsets
    const partitionsToFlash = [];
    for (const slot of enabledSlotsWithFiles) {
      const numOffset = parseHexOffset(slot.offset);
      if (numOffset === null) {
        alert(`Invalid hexadecimal offset "${slot.offset}" in slot "${slot.label}". Example: 0x1000 or 0x00010000`);
        return;
      }
      partitionsToFlash.push({
        data: slot.fileInfo.data,
        offset: numOffset,
        label: slot.label,
        size: slot.fileInfo.data.length
      });
    }

    setIsFlashing(true);
    isFlashingRef.current = true;
    const startTime = Date.now();

    // Mode 1: Native ESP ROM Bootloader
    if (flasherMode === 'esp-rom') {
      addLog(`[ESP FLASHER] Initializing ROM Bootloader client for ${partitionsToFlash.length} partition(s)...`, 'sys');
      const client = new EspBootloaderClient(port, addLog);

      try {
        // Assert hardware bootloader pulse with user-configured timing
        await client.hardwareResetToBootloader(resetHoldMs, bootPinHoldMs);
        await client.sync(6);

        // Flash multi-partitions sequentially
        await client.flashMultiplePartitions(
          partitionsToFlash,
          blockSize,
          ({ partitionIndex, totalPartitions, label, partitionPercent, aggregatePercent, writtenBytes, totalBytes }) => {
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? (writtenBytes / 1024) / elapsed : 0;
            const rem = totalBytes - writtenBytes;
            const eta = speed > 0 ? Math.ceil((rem / 1024) / speed) : 0;

            setProgress({
              activePartitionIndex: partitionIndex,
              totalPartitions,
              currentPartitionLabel: label,
              partitionPercent,
              aggregatePercent,
              writtenBytes,
              totalBytes,
              speedKBps: Number(speed.toFixed(1)),
              elapsedSeconds: Math.floor(elapsed),
              etaSeconds: eta
            });
          }
        );

        addLog(`[ESP FLASHER] SUCCESS! Programmed ${totalPayloadSize} bytes across ${partitionsToFlash.length} partition(s) in ${Math.floor((Date.now() - startTime) / 1000)}s! Target running.`, 'sys');
      } catch (err) {
        console.error('Flashing error:', err);
        addLog(`[ESP FLASHER ERROR] ${err.message}`, 'sys');
        alert(`Flashing error: ${err.message}`);
      } finally {
        client.release();
        setIsFlashing(false);
        isFlashingRef.current = false;
      }
      return;
    }

    // Mode 2: Raw UART Block Streamer
    try {
      addLog(`[RAW FLASHER] Streaming ${partitionsToFlash.length} partition(s) sequentially...`, 'sys');
      let aggregateWritten = 0;

      for (let pIdx = 0; pIdx < partitionsToFlash.length; pIdx++) {
        const part = partitionsToFlash[pIdx];
        const partBytes = part.data;
        const totalBlocks = Math.ceil(partBytes.length / blockSize);

        for (let b = 0; b < totalBlocks; b++) {
          if (!isFlashingRef.current) break;
          const start = b * blockSize;
          const end = Math.min(start + blockSize, partBytes.length);
          const chunk = partBytes.slice(start, end);

          await sendRawBytes(chunk);
          aggregateWritten += chunk.length;

          const partPct = Number(((end / partBytes.length) * 100).toFixed(1));
          const aggPct = Number(((aggregateWritten / totalPayloadSize) * 100).toFixed(1));
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (aggregateWritten / 1024) / elapsed : 0;

          setProgress({
            activePartitionIndex: pIdx,
            totalPartitions: partitionsToFlash.length,
            currentPartitionLabel: part.label,
            partitionPercent: partPct,
            aggregatePercent: aggPct,
            writtenBytes: aggregateWritten,
            totalBytes: totalPayloadSize,
            speedKBps: Number(speed.toFixed(1)),
            elapsedSeconds: Math.floor(elapsed),
            etaSeconds: speed > 0 ? Math.ceil(((totalPayloadSize - aggregateWritten) / 1024) / speed) : 0
          });

          if (chunkDelay > 0) {
            await new Promise(r => setTimeout(r, chunkDelay));
          }
        }
      }
      addLog(`[RAW FLASHER] Completed raw streaming ${aggregateWritten} bytes!`, 'sys');
    } catch (err) {
      console.error(err);
      addLog(`[RAW FLASHER ERROR] ${err.message}`, 'sys');
    } finally {
      setIsFlashing(false);
      isFlashingRef.current = false;
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Sub-Tab Navigation Header */}
      <div className="flex items-center gap-2 p-1 bg-[#101216] border border-[#232733] rounded-2xl w-fit">
        <button
          onClick={() => setSubView('catalog')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            subView === 'catalog'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Cloud Firmware Catalog (400+ Presets)</span>
        </button>
        <button
          onClick={() => setSubView('slots')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            subView === 'slots'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5 text-amber-400" />
          <span>Multi-Slot Partition Flasher</span>
          {enabledSlotsWithFiles.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/30 text-amber-200 rounded-full font-mono">
              {enabledSlotsWithFiles.length}
            </span>
          )}
        </button>
      </div>

      {subView === 'catalog' ? (
        <CloudFirmwareCatalog onSelectFirmwareForFlashing={handleLoadFromCatalog} />
      ) : (
        <>
          {/* Presets Header Card */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 sm:p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  <span>MULTI-OFFSET PARTITION FLASHING</span>
                </h2>
            <p className="text-[11px] text-slate-400">
              Configure 1 to 4 independent binary/HEX slots with absolute memory offsets for ESP32, ESP8266, or custom targets.
            </p>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-bold uppercase mr-1">Presets:</span>
            {PARTITION_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                  activePresetId === preset.id
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-amber-glow'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {preset.name}
              </button>
            ))}
            <button
              onClick={handleAddSlot}
              disabled={slots.length >= 4}
              title="Add an additional partition slot"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 hover:border-cyan-500/40 text-xs font-bold disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Slot</span>
            </button>
          </div>
        </div>

        {/* Partition Layout Visualization Bar */}
        <div className="pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1.5">
            <span className="flex items-center gap-1.5 font-bold">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Memory Layout Mapping Preview</span>
            </span>
            <span className="text-slate-400">
              Total Queue: <strong className="text-amber-400">{formatSize(totalPayloadSize)}</strong> across {enabledSlotsWithFiles.length} active file(s)
            </span>
          </div>

          <div className="h-6 bg-slate-950 rounded-lg border border-slate-800 flex overflow-hidden p-0.5 gap-1">
            {slots.map((slot, idx) => {
              const hasFile = slot.fileInfo?.size > 0;
              const isEnabled = slot.enabled;
              return (
                <div
                  key={slot.id}
                  title={`${slot.label} @ ${slot.offset}: ${hasFile ? formatSize(slot.fileInfo.size) : 'No file loaded'}`}
                  className={`h-full rounded flex items-center justify-center text-[10px] font-bold px-2 truncate transition-all ${
                    !isEnabled 
                      ? 'bg-slate-900/50 text-slate-600 border border-dashed border-slate-800' 
                      : hasFile 
                      ? 'bg-gradient-to-r from-amber-500/30 to-amber-600/30 text-amber-300 border border-amber-500/40' 
                      : 'bg-slate-900 text-slate-500 border border-slate-800'
                  }`}
                  style={{ flex: hasFile ? Math.max(1, slot.fileInfo.size / 1024) : 1 }}
                >
                  <span className="truncate">{slot.label} ({slot.offset})</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Multi-Binary Upload Slots (1 to 4) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {slots.map((slot, index) => {
          const numOffset = parseHexOffset(slot.offset);
          const isValidOffset = numOffset !== null;
          const hasFile = !!slot.fileInfo;

          return (
            <div
              key={slot.id}
              className={`bg-[#030712] border rounded-xl p-3 flex flex-col gap-2.5 transition-all shadow-lg ${
                slot.enabled ? 'border-slate-800 hover:border-slate-700' : 'border-slate-900 opacity-60'
              }`}
            >
              {/* Slot Header */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-850 pb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={slot.enabled}
                    onChange={(e) => updateSlot(slot.id, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={slot.label}
                    onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                    className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 font-bold text-xs text-slate-200 outline-none w-36 sm:w-44"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-500">
                    SLOT {index + 1}
                  </span>
                  {slots.length > 1 && (
                    <button
                      onClick={() => handleRemoveSlot(slot.id)}
                      title="Remove this partition slot"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Offset Input Field */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-500 w-16 shrink-0">OFFSET:</label>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={slot.offset}
                    onChange={(e) => updateSlot(slot.id, { offset: e.target.value })}
                    placeholder="0x00010000"
                    className={`w-full bg-slate-950 border rounded-lg px-2.5 py-1 text-xs font-mono font-bold outline-none uppercase ${
                      isValidOffset ? 'border-slate-800 text-cyan-300 focus:border-cyan-500' : 'border-rose-500/80 text-rose-300'
                    }`}
                  />
                  {!isValidOffset && (
                    <span className="absolute right-2 top-1 text-[10px] text-rose-400">Invalid Hex</span>
                  )}
                </div>
                {isValidOffset && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({(numOffset / 1024).toFixed(0)} KB)
                  </span>
                )}
              </div>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={(el) => (fileInputRefs.current[slot.id] = el)}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleSlotFile(slot.id, e.target.files[0]);
                }}
                accept=".bin,.hex,.uf2"
                className="hidden"
              />

              {/* Drop / Select Zone */}
              {!hasFile ? (
                <div
                  onClick={() => fileInputRefs.current[slot.id]?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handleSlotFile(slot.id, e.dataTransfer.files[0]);
                  }}
                  className="border border-dashed border-slate-800 hover:border-cyan-500/50 bg-slate-950/60 hover:bg-slate-900/40 rounded-lg p-3 text-center cursor-pointer transition-all flex flex-col items-center gap-1"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  <span className="text-[11px] text-slate-300 font-bold">Select or drop .bin / .hex / .uf2</span>
                  <span className="text-[10px] text-slate-600">Click to browse file</span>
                </div>
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <FileCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-bold text-slate-200 truncate">{slot.fileInfo.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {slot.fileInfo.type} • <strong className="text-amber-400">{formatSize(slot.fileInfo.size)}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => updateSlot(slot.id, { file: null, fileInfo: null })}
                    className="p-1 rounded bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 text-[10px]"
                    title="Clear file from this slot"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Flasher Engine Settings & Flash Action */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 flex flex-col gap-3 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-100 text-xs">BOOTLOADER ENGINE & TIMING CONTROLS</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            {/* Protocol mode */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-[11px] font-bold">PROTOCOL:</span>
              <select
                value={flasherMode}
                onChange={(e) => setFlasherMode(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-cyan-300 font-bold outline-none"
              >
                <option value="esp-rom">ESP ROM Bootloader (SLIP / Sync)</option>
                <option value="raw-stream">Raw UART Block Streamer</option>
              </select>
            </div>

            {/* Block Size */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-[11px] font-bold">BLOCK SIZE:</span>
              <select
                value={blockSize}
                onChange={(e) => setBlockSize(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 font-bold outline-none"
              >
                {[256, 512, 1024, 2048, 4096].map(b => (
                  <option key={b} value={b}>{b} Bytes</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Pulse Timing Sliders for Flasher */}
        {flasherMode === 'esp-rom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-2.5 rounded-lg border border-slate-850 text-xs">
            <div>
              <div className="flex items-center justify-between text-[11px] pb-1">
                <span className="text-slate-400 font-bold">Reset Pulse Duration:</span>
                <span className="text-amber-400 font-bold">{resetHoldMs} ms</span>
              </div>
              <input
                type="range"
                min="50"
                max="500"
                step="10"
                value={resetHoldMs}
                onChange={(e) => setResetHoldMs(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] pb-1">
                <span className="text-slate-400 font-bold">Boot Pin (IO0) Hold Duration:</span>
                <span className="text-cyan-400 font-bold">{bootPinHoldMs} ms</span>
              </div>
              <input
                type="range"
                min="20"
                max="250"
                step="5"
                value={bootPinHoldMs}
                onChange={(e) => setBootPinHoldMs(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Live Flashing Progress Displays */}
        {isFlashing && (
          <div className="space-y-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
            {/* Active Partition Progress */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-300 pb-1 font-bold">
                <span className="text-cyan-400">
                  Partition [{progress.activePartitionIndex + 1}/{progress.totalPartitions}]: {progress.currentPartitionLabel}
                </span>
                <span>{progress.partitionPercent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-150"
                  style={{ width: `${progress.partitionPercent}%` }}
                />
              </div>
            </div>

            {/* Aggregate Progress */}
            <div>
              <div className="flex justify-between text-[11px] text-slate-300 pb-1 font-bold">
                <span className="text-amber-400">Total Flashing Progress</span>
                <span>{progress.aggregatePercent}% ({formatSize(progress.writtenBytes)} / {formatSize(progress.totalBytes)})</span>
              </div>
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-150"
                  style={{ width: `${progress.aggregatePercent}%` }}
                />
              </div>
            </div>

            {/* Metrics */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono">
              <span>Speed: <strong className="text-emerald-400">{progress.speedKBps} KB/s</strong></span>
              <span>Elapsed: <strong className="text-slate-300">{progress.elapsedSeconds}s</strong></span>
              <span>ETA: <strong className="text-cyan-400">{progress.etaSeconds}s</strong></span>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={startFlashing}
            disabled={isFlashing || !isConnected || enabledSlotsWithFiles.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-sm shadow-amber-glow transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap className={`w-4 h-4 ${isFlashing ? 'animate-bounce' : ''}`} />
            <span>
              {isFlashing 
                ? 'PROGRAMMING PARTITIONS...' 
                : !isConnected 
                ? 'CONNECT SERIAL PORT TO FLASH' 
                : enabledSlotsWithFiles.length === 0 
                ? 'LOAD AT LEAST 1 PARTITION FILE' 
                : `FLASH ${enabledSlotsWithFiles.length} PARTITION(S) [${formatSize(totalPayloadSize)}]`}
            </span>
          </button>

          {isFlashing && (
            <button
              onClick={() => {
                isFlashingRef.current = false;
                setIsFlashing(false);
                addLog('[FLASHER] Aborted by user.', 'sys');
              }}
              className="px-4 py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition-all"
            >
              ABORT
            </button>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
