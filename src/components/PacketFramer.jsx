import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Binary, 
  Layers, 
  Trash2, 
  Download, 
  Search, 
  Sliders, 
  Filter, 
  CheckCircle2, 
  AlertTriangle,
  Play,
  Pause
} from 'lucide-react';
import { calculateModbusCRC16 } from '../utils/checksums';

export default function PacketFramer({
  activeHexByteStream = [],
  isConnected
}) {
  const [frameMode, setFrameMode] = useState('startEnd'); // 'startEnd' | 'fixedLen' | 'slip'
  const [startByte, setStartByte] = useState('0xAA');
  const [endByte, setEndByte] = useState('0x55');
  const [fixedLength, setFixedLength] = useState(16);
  const [isPaused, setIsPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [packets, setPackets] = useState([]);
  const [selectedPacket, setSelectedPacket] = useState(null);

  const lastProcessedOffsetRef = useRef(0);
  const bufferRef = useRef([]);

  // Process incoming bytes into framed packets
  useEffect(() => {
    if (isPaused || activeHexByteStream.length === 0) return;

    // Filter bytes received since last offset
    const newItems = activeHexByteStream.filter(item => item.offset >= lastProcessedOffsetRef.current);
    if (newItems.length === 0) return;

    lastProcessedOffsetRef.current = activeHexByteStream[activeHexByteStream.length - 1].offset + 1;
    const newBytes = newItems.map(item => item.byte);
    bufferRef.current.push(...newBytes);

    const extracted = [];
    const buf = bufferRef.current;

    if (frameMode === 'startEnd') {
      const sVal = parseInt(startByte, 16);
      const eVal = parseInt(endByte, 16);

      let startIdx = -1;
      let i = 0;
      while (i < buf.length) {
        if (startIdx === -1 && buf[i] === sVal) {
          startIdx = i;
        } else if (startIdx !== -1 && buf[i] === eVal) {
          const rawPacket = buf.slice(startIdx, i + 1);
          extracted.push(createPacketObject(rawPacket));
          buf.splice(0, i + 1);
          startIdx = -1;
          i = -1; // reset search
        }
        i++;
      }
    } else if (frameMode === 'fixedLen') {
      const len = Number(fixedLength) || 16;
      while (buf.length >= len) {
        const rawPacket = buf.splice(0, len);
        extracted.push(createPacketObject(rawPacket));
      }
    } else if (frameMode === 'slip') {
      const SLIP_END = 0xC0;
      let start = -1;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === SLIP_END) {
          if (start !== -1 && i > start + 1) {
            const rawPacket = buf.slice(start, i + 1);
            extracted.push(createPacketObject(rawPacket));
            buf.splice(0, i + 1);
            start = -1;
            i = -1;
          } else {
            start = i;
          }
        }
      }
    }

    if (extracted.length > 0) {
      setPackets(prev => [...prev.slice(-300), ...extracted]);
    }
  }, [activeHexByteStream, frameMode, startByte, endByte, fixedLength, isPaused]);

  const createPacketObject = (rawBytes) => {
    const time = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    const hex = rawBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const ascii = rawBytes.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    const opcode = rawBytes.length > 1 ? `0x${rawBytes[1].toString(16).padStart(2, '0').toUpperCase()}` : 'N/A';

    return {
      id: Math.random().toString(36).substring(2, 9),
      time,
      length: rawBytes.length,
      opcode,
      hex,
      ascii,
      raw: rawBytes
    };
  };

  const handleExportJson = () => {
    if (packets.length === 0) return;
    const blob = new Blob([JSON.stringify(packets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `framed_packets_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredPackets = useMemo(() => {
    if (!searchQuery.trim()) return packets;
    return packets.filter(p => p.hex.includes(searchQuery.toUpperCase()) || p.ascii.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [packets, searchQuery]);

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title & Framing Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Binary className="w-4 h-4 text-cyber-emerald" />
          <h2 className="font-bold text-slate-100 tracking-wider">BINARY PACKET FRAMER & PROTOCOL DECODER</h2>
        </div>

        {/* Framing Mode Selection */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setFrameMode('startEnd')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                frameMode === 'startEnd' ? 'bg-emerald-500/20 text-cyber-emerald border border-emerald-500/40' : 'text-slate-400'
              }`}
            >
              Start / End Byte
            </button>
            <button
              onClick={() => setFrameMode('fixedLen')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                frameMode === 'fixedLen' ? 'bg-cyan-500/20 text-cyber-cyan border border-cyan-500/40' : 'text-slate-400'
              }`}
            >
              Fixed Length
            </button>
            <button
              onClick={() => setFrameMode('slip')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                frameMode === 'slip' ? 'bg-amber-500/20 text-cyber-amber border border-amber-500/40' : 'text-slate-400'
              }`}
            >
              SLIP (0xC0)
            </button>
          </div>

          {frameMode === 'startEnd' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">START:</span>
              <input
                type="text"
                value={startByte}
                onChange={(e) => setStartByte(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 outline-none w-14 text-center font-mono"
              />
              <span className="text-slate-500">END:</span>
              <input
                type="text"
                value={endByte}
                onChange={(e) => setEndByte(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 outline-none w-14 text-center font-mono"
              />
            </div>
          )}

          {frameMode === 'fixedLen' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">LENGTH:</span>
              <input
                type="number"
                value={fixedLength}
                onChange={(e) => setFixedLength(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 outline-none w-16 text-center font-mono"
              />
              <span className="text-slate-500">BYTES</span>
            </div>
          )}

          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Capture" : "Pause Capture"}
            className={`p-1.5 rounded border ${
              isPaused ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Filter / Search & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#030712] border border-slate-800 rounded-lg p-2 text-xs">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search hex bytes or ASCII payload..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-0.5 text-xs text-slate-200 outline-none focus:border-emerald-500 w-64"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            {packets.length} Packets Decoded
          </span>

          <button
            onClick={handleExportJson}
            disabled={packets.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>

          <button
            onClick={() => setPackets([])}
            className="p-1 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
            title="Clear Packets"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Framed Packet Table */}
      <div className="h-64 overflow-y-auto bg-[#030712] border border-slate-800 rounded-xl overflow-hidden">
        {filteredPackets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-1 select-none">
            <Layers className="w-6 h-6 text-slate-700" />
            <span>Awaiting incoming structured frames...</span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-[11px] font-mono">
            <thead className="bg-[#090e1a] border-b border-slate-800 text-slate-400 text-[10px] uppercase sticky top-0">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Bytes</th>
                <th className="p-2">Opcode</th>
                <th className="p-2">Hex Payload</th>
                <th className="p-2">ASCII</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {filteredPackets.map((pkt) => (
                <tr
                  key={pkt.id}
                  onClick={() => setSelectedPacket(pkt)}
                  className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                    selectedPacket?.id === pkt.id ? 'bg-emerald-950/20 text-emerald-300' : 'text-slate-300'
                  }`}
                >
                  <td className="p-2 text-slate-500 whitespace-nowrap">{pkt.time}</td>
                  <td className="p-2 font-bold text-cyber-cyan">{pkt.length} B</td>
                  <td className="p-2 text-cyber-amber">{pkt.opcode}</td>
                  <td className="p-2 text-slate-200 truncate max-w-xs">{pkt.hex}</td>
                  <td className="p-2 text-slate-400 truncate max-w-xs">{pkt.ascii}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Selected Packet Byte Inspector Drawer */}
      {selectedPacket && (
        <div className="bg-[#090e1a] border border-emerald-500/40 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-200">
            <span>PACKET INSPECTOR: {selectedPacket.length} Bytes @ {selectedPacket.time}</span>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-cyber-amber">
                CRC-16/Modbus: {calculateModbusCRC16(new Uint8Array(selectedPacket.raw || [])).hexLE}
              </span>
              <button
                onClick={() => setSelectedPacket(null)}
                className="text-slate-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="bg-[#030712] border border-slate-800 rounded p-2 text-xs font-mono text-cyber-emerald break-all">
            {selectedPacket.hex}
          </div>
          <div className="bg-[#030712] border border-slate-800 rounded p-2 text-xs font-mono text-slate-300 break-all">
            ASCII: {selectedPacket.ascii}
          </div>
        </div>
      )}
    </div>
  );
}
