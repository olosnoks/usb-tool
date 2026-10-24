import React, { useState } from 'react';
import { 
  Search, 
  Cpu, 
  Layers, 
  Sparkles, 
  Play, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  Edit3, 
  RefreshCw, 
  Sliders,
  Power
} from 'lucide-react';
import { 
  BusExplorerClient, 
  I2C_CHIP_DATABASE 
} from '../../utils/busExplorerDriver';
import StatusBadge from '../common/StatusBadge';

export default function BusExplorerWorkbench() {
  const [client] = useState(() => new BusExplorerClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [detectedDevices, setDetectedDevices] = useState([]);
  const [selectedAddr, setSelectedAddr] = useState(0x68);
  const [isScanning, setIsScanning] = useState(false);

  // Register inspector state
  const [inspectRegs, setInspectRegs] = useState(() => {
    const arr = [];
    for (let i = 0; i < 32; i++) {
      arr.push({ reg: i, val: 0 });
    }
    return arr;
  });

  const [writeReg, setWriteReg] = useState('0x6B');
  const [writeVal, setWriteVal] = useState('0x00');

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setDetectedDevices(client.detectedDevices);
    handleSelectAddress(0x68);
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setDetectedDevices([]);
  };

  const handleScanBus = async () => {
    if (!isConnected) return;
    setIsScanning(true);
    const found = await client.scanI2cBus();
    setDetectedDevices(found);
    setIsScanning(false);
    if (found.length > 0 && !found.includes(selectedAddr)) {
      handleSelectAddress(found[0]);
    }
  };

  const handleSelectAddress = (addr) => {
    setSelectedAddr(addr);
    client.initSimulatedRegisters(addr);
    refreshRegisters();
  };

  const refreshRegisters = () => {
    const updated = [];
    for (let r = 0; r < 32; r++) {
      updated.push({
        reg: r,
        val: client.readRegister(r)
      });
    }
    setInspectRegs(updated);
  };

  const handleWriteRegister = () => {
    const regNum = parseInt(writeReg, 16);
    const valNum = parseInt(writeVal, 16);
    if (isNaN(regNum) || isNaN(valNum)) {
      alert('Invalid Hex format (use 0x00 - 0xFF)');
      return;
    }
    client.writeRegister(regNum, valNum);
    refreshRegisters();
  };

  const selectedChipInfo = I2C_CHIP_DATABASE[selectedAddr];

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>I2C & SPI MULTI-PROTOCOL BUS EXPLORER & SENSOR IDENTIFIER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              1-click I2C bus scanner (0x08 - 0x77), automatic chip identification, and interactive live register read/write.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnectSimulation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 text-xs font-bold transition-all shadow-emerald-glow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>CONNECT BUS EXPLORER (DEMO)</span>
              </button>
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

        {/* 1-Click Scan Bar */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleScanBus}
              disabled={!isConnected || isScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-emerald-glow transition-all disabled:opacity-40"
            >
              <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SCANNING BUS (0x08 - 0x77)...' : 'SCAN I2C BUS (7-BIT SWEEP)'}</span>
            </button>
            <span className="text-[11px] text-slate-400">
              Found <strong className="text-emerald-400">{detectedDevices.length}</strong> responding device(s)
            </span>
          </div>

          {selectedChipInfo && (
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold">Selected Target:</span>
              <span className="font-extrabold text-amber-300">0x{(selectedAddr ?? 0).toString(16).toUpperCase()}</span>
              <span className="text-slate-400">• {selectedChipInfo.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Visual I2C Address Matrix & Chip Information */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: 16x8 I2C Hex Address Matrix */}
        <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>I2C BUS ADDRESS SCANNER MATRIX (0x00 - 0x7F)</span>
            </span>
            <span className="text-[10px] text-slate-500">Green = Responding ACK Target</span>
          </div>

          {/* Matrix table */}
          <div className="overflow-x-auto">
            <table className="w-full text-center border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-900">
                  <th className="p-1 font-bold text-slate-600 text-left">ROW</th>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((col) => (
                    <th key={col} className="p-1 font-mono">{col.toString(16).toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
                  <tr key={row} className="border-b border-slate-900/60">
                    <td className="p-1 text-[10px] text-slate-500 font-bold text-left">{row}0:</td>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((col) => {
                      const addr = (row << 4) | col;
                      const isReserved = addr < 0x08 || addr > 0x77;
                      const isDetected = detectedDevices.includes(addr);
                      const isSelected = selectedAddr === addr;

                      if (isReserved) {
                        return (
                          <td key={col} className="p-1 text-[10px] text-slate-700">
                            --
                          </td>
                        );
                      }

                      return (
                        <td key={col} className="p-0.5">
                          <button
                            onClick={() => handleSelectAddress(addr)}
                            disabled={!isDetected}
                            title={isDetected ? `0x${addr.toString(16).toUpperCase()}: ${I2C_CHIP_DATABASE[addr]?.name || 'Unknown'}` : `0x${addr.toString(16).toUpperCase()}: NACK`}
                            className={`w-full py-1 text-[10px] font-mono font-bold rounded transition-all ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 shadow-amber-glow font-black'
                                : isDetected
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/40 shadow-emerald-glow'
                                : 'text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            {addr.toString(16).padStart(2, '0').toUpperCase()}
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

        {/* Right: Detected Chip Card & Live Register Read/Write */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>CHIP INTELLIGENCE</span>
              </span>
              <span className="text-[10px] text-cyan-400 font-mono">0x{(selectedAddr ?? 0).toString(16).toUpperCase()}</span>
            </div>

            {selectedChipInfo ? (
              <div className="space-y-2 pt-2 text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Device Name</span>
                  <div className="text-amber-300 font-bold text-sm">{selectedChipInfo.name}</div>
                  <div className="text-slate-400">{selectedChipInfo.mfr}</div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Category</span>
                  <span className="text-cyan-300 font-semibold">{selectedChipInfo.type}</span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Description</span>
                  <p className="text-slate-400 leading-relaxed text-[10px]">{selectedChipInfo.desc}</p>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-center py-6 text-xs">
                Select a responding green address to view chip specifications.
              </div>
            )}
          </div>

          {/* Quick Register Write Bar */}
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">Quick Register Write (Hex)</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Reg (e.g. 0x6B)"
                value={writeReg}
                onChange={(e) => setWriteReg(e.target.value)}
                className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
              />
              <input
                type="text"
                placeholder="Val (e.g. 0x00)"
                value={writeVal}
                onChange={(e) => setWriteVal(e.target.value)}
                className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleWriteRegister}
                disabled={!isConnected}
                className="flex-1 px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded font-bold text-xs disabled:opacity-40"
              >
                WRITE
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Live 32-Byte Register View */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>LIVE REGISTER DUMP (REGISTERS 0x00 - 0x1F)</span>
          </span>
          <button
            onClick={refreshRegisters}
            disabled={!isConnected}
            className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 font-bold"
          >
            <RefreshCw className="w-3 h-3" />
            <span>REFRESH REGISTERS</span>
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {inspectRegs.map(({ reg, val }) => (
            <div key={reg} className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-center font-mono">
              <span className="text-[9px] text-slate-500 block">R_0x{reg.toString(16).padStart(2, '0').toUpperCase()}</span>
              <span className="text-xs font-bold text-amber-300 block mt-0.5">
                0x{val.toString(16).padStart(2, '0').toUpperCase()}
              </span>
              <span className="text-[9px] text-slate-600 block">{val} (dec)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
