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
  SPI_FLASH_DATABASE 
} from '../../utils/ch341aDriver';
import HexViewer from '../common/HexViewer';
import StatusBadge from '../common/StatusBadge';

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
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setIsBusy(false);
      setBusyAction('');
    }
  };

  // Connect Virtual Simulation
  const handleConnectSimulation = () => {
    const chip = client.connectSimulation(0xEF4018); // Winbond W25Q128 16MB
    setIsConnected(true);
    setIsSimulated(true);
    setChipInfo(chip);
    handleReadFlash(65536); // Read initial 64KB
  };

  const handleDisconnect = () => {
    client.disconnect();
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
    try {
      setIsBusy(true);
      setBusyAction(`Programming ${loadedBuffer.length} bytes to SPI flash...`);
      setProgress({ percent: 0, current: 0, total: loadedBuffer.length });

      await client.writeFlash(0, loadedBuffer, (pct, cur, tot) => {
        setProgress({ percent: pct, current: cur, total: tot });
      });
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
              Unbrick PC motherboards, routers, GPUs, and IoT devices by reading and programming 24/25 series SPI NOR Flash chips directly over WebUSB.
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
                {(chipInfo.sizeBytes / 1024 / 1024).toFixed(0)} MB ({chipInfo.sizeBytes} Bytes)
              </div>
              <div className="text-[10px] text-slate-400">Page: {chipInfo.pageSize}B • Sector: {chipInfo.sectorSize / 1024}KB</div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 font-bold uppercase">JEDEC ID (0x9F)</span>
              <div className="text-emerald-400 font-mono font-bold text-sm mt-0.5">
                0x{chipInfo.jedecId?.toString(16).toUpperCase() || 'EF4018'}
              </div>
              <div className="text-[10px] text-slate-400">SPI Mode 0 / Mode 3</div>
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
