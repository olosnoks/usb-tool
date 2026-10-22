import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Binary, 
  Search, 
  Copy, 
  Check, 
  Trash2, 
  Layers, 
  ArrowDown, 
  SlidersHorizontal,
  Info
} from 'lucide-react';

export default function HexInspection({
  byteStream = [], // Array of { offset, byte, type: 'rx' | 'tx' }
  onClear,
  maxDisplayBytes = 2048
}) {
  const [rowWidth, setRowWidth] = useState(8); // 8-byte grid by default (from spec)
  const [hoveredByte, setHoveredByte] = useState(null);
  const [searchHex, setSearchHex] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [copiedFormat, setCopiedFormat] = useState(null);

  const containerRef = useRef(null);

  // Auto-follow newest bytes
  useEffect(() => {
    if (autoFollow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [byteStream, autoFollow]);

  // Sliced for performance if stream gets massive
  const displayedBytes = useMemo(() => {
    if (byteStream.length > maxDisplayBytes) {
      return byteStream.slice(byteStream.length - maxDisplayBytes);
    }
    return byteStream;
  }, [byteStream, maxDisplayBytes]);

  // Group bytes into rows based on rowWidth (8 or 16)
  const rows = useMemo(() => {
    const result = [];
    const total = displayedBytes.length;
    for (let i = 0; i < total; i += rowWidth) {
      const slice = displayedBytes.slice(i, i + rowWidth);
      const startOffset = slice[0]?.offset || 0;
      result.push({
        offset: startOffset,
        bytes: slice
      });
    }
    return result;
  }, [displayedBytes, rowWidth]);

  // Search matches
  const matchOffsets = useMemo(() => {
    if (!searchHex.trim()) return new Set();
    const cleanSearch = searchHex.replace(/\s+/g, '').toUpperCase();
    const matches = new Set();

    // Check hex byte search
    const hexFull = displayedBytes.map(b => (b.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()).join('');
    let idx = hexFull.indexOf(cleanSearch);
    while (idx !== -1 && cleanSearch.length > 0) {
      const byteIdx = Math.floor(idx / 2);
      const matchLen = Math.ceil(cleanSearch.length / 2);
      for (let m = 0; m < matchLen; m++) {
        if (displayedBytes[byteIdx + m]) {
          matches.add(displayedBytes[byteIdx + m].offset);
        }
      }
      idx = hexFull.indexOf(cleanSearch, idx + 1);
    }

    return matches;
  }, [displayedBytes, searchHex]);

  // Copy helper
  const handleCopy = (format) => {
    if (displayedBytes.length === 0) return;

    let text = '';
    if (format === 'hex') {
      text = displayedBytes.map(b => (b.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ');
    } else if (format === 'c-array') {
      const hexList = displayedBytes.map(b => '0x' + (b.byte & 0xff).toString(16).padStart(2, '0').toUpperCase());
      text = `const uint8_t packet[${displayedBytes.length}] = {\n  ${hexList.join(', ')}\n};`;
    } else if (format === 'ascii') {
      text = displayedBytes.map(b => (b.byte >= 32 && b.byte <= 126) ? String.fromCharCode(b.byte) : '.').join('');
    }

    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl overflow-hidden">
      {/* Hex Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#090e1a] border-b border-cyber-border text-xs font-mono">
        <div className="flex items-center gap-2">
          <Binary className="w-4 h-4 text-cyber-amber" />
          <span className="font-bold text-slate-200 tracking-wider">HEX INSPECTION PANE</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-cyber-amber font-semibold">
            {byteStream.length} Bytes
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Search Hex input */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search Hex (e.g. 55 AA)..."
              value={searchHex}
              onChange={(e) => setSearchHex(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-0.5 text-[11px] text-slate-200 focus:border-cyber-amber outline-none w-32 sm:w-40"
            />
          </div>

          {/* Grid Width Toggle (8-byte vs 16-byte) */}
          <div className="flex items-center bg-slate-950 rounded-lg border border-slate-800 p-0.5 text-[10px]">
            <button
              onClick={() => setRowWidth(8)}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                rowWidth === 8 ? 'bg-amber-500/20 text-cyber-amber' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              8-Byte
            </button>
            <button
              onClick={() => setRowWidth(16)}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                rowWidth === 16 ? 'bg-amber-500/20 text-cyber-amber' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              16-Byte
            </button>
          </div>

          {/* Auto follow toggle */}
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            title="Auto-scroll to latest bytes"
            className={`p-1.5 rounded-lg border transition-all ${
              autoFollow 
                ? 'bg-amber-500/10 text-cyber-amber border-amber-500/30' 
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Copy Options Dropdown */}
          <div className="relative group">
            <button
              title="Copy hex memory"
              className="flex items-center gap-1 p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors"
            >
              {copiedFormat ? <Check className="w-3.5 h-3.5 text-cyber-emerald" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 w-32 z-30 text-[11px]">
              <button 
                onClick={() => handleCopy('hex')}
                className="px-3 py-1 text-left text-slate-300 hover:bg-slate-800 hover:text-cyber-amber"
              >
                Copy Raw Hex
              </button>
              <button 
                onClick={() => handleCopy('c-array')}
                className="px-3 py-1 text-left text-slate-300 hover:bg-slate-800 hover:text-cyber-cyan"
              >
                Copy C Array
              </button>
              <button 
                onClick={() => handleCopy('ascii')}
                className="px-3 py-1 text-left text-slate-300 hover:bg-slate-800 hover:text-cyber-emerald"
              >
                Copy ASCII
              </button>
            </div>
          </div>

          {/* Clear Button */}
          <button
            onClick={onClear}
            title="Clear Hex Buffer"
            className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Synchronized Hex Memory Table */}
      <div 
        ref={containerRef}
        className="flex-1 p-3 overflow-y-auto font-mono text-xs select-text bg-[#030712] relative min-h-[220px]"
      >
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 py-12 select-none">
            <Binary className="w-8 h-8 mb-2 opacity-40 text-cyber-amber" />
            <p className="text-xs">HEX MEMORY BUFFER EMPTY</p>
            <p className="text-[10px] text-slate-700">Serial bytes will assemble into synchronous Offset | Hex | ASCII view</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Table Header */}
            <div className="flex items-center text-[10px] text-slate-500 uppercase tracking-wider pb-1 border-b border-slate-800/80 select-none">
              <span className="w-20 text-slate-600">OFFSET</span>
              <span className="w-4 text-slate-800 text-center">|</span>
              <div className={`flex gap-1.5 ${rowWidth === 8 ? 'w-48 sm:w-56' : 'w-96'}`}>
                {Array.from({ length: rowWidth }).map((_, idx) => (
                  <span key={idx} className="w-5 text-center text-slate-600">
                    {idx.toString(16).toUpperCase()}
                  </span>
                ))}
              </div>
              <span className="w-4 text-slate-800 text-center">|</span>
              <span className="text-slate-600">ASCII DECODE</span>
            </div>

            {/* Rows */}
            {rows.map((row) => (
              <div 
                key={row.offset} 
                className="flex items-center hover:bg-slate-900/50 rounded py-0.5 transition-colors group"
              >
                {/* 8-digit Hex Offset */}
                <span className="w-20 text-slate-500 select-none font-semibold text-[11px]">
                  {row.offset.toString(16).padStart(8, '0').toUpperCase()}
                </span>

                <span className="w-4 text-slate-800 text-center select-none">|</span>

                {/* Hex Bytes */}
                <div className={`flex gap-1.5 ${rowWidth === 8 ? 'w-48 sm:w-56' : 'w-96'}`}>
                  {Array.from({ length: rowWidth }).map((_, idx) => {
                    const item = row.bytes[idx];
                    if (!item) {
                      return <span key={idx} className="w-5 text-center text-slate-800 select-none">..</span>;
                    }

                    const hexVal = (item.byte & 0xff).toString(16).padStart(2, '0').toUpperCase();
                    const isRx = item.type === 'rx';
                    const isMatched = matchOffsets.has(item.offset);

                    return (
                      <span
                        key={idx}
                        onMouseEnter={() => setHoveredByte(item)}
                        onMouseLeave={() => setHoveredByte(null)}
                        className={`w-5 text-center rounded cursor-pointer transition-colors ${
                          isMatched 
                            ? 'bg-rose-500 text-white font-bold animate-pulse' :
                          isRx 
                            ? 'text-cyber-cyan hover:bg-cyan-950/80 hover:text-cyan-200' 
                            : 'text-cyber-amber hover:bg-amber-950/80 hover:text-amber-200'
                        }`}
                      >
                        {hexVal}
                      </span>
                    );
                  })}
                </div>

                <span className="w-4 text-slate-800 text-center select-none">|</span>

                {/* ASCII Representation */}
                <div className="flex gap-0.5 text-slate-300">
                  {Array.from({ length: rowWidth }).map((_, idx) => {
                    const item = row.bytes[idx];
                    if (!item) {
                      return <span key={idx} className="text-slate-800 select-none">.</span>;
                    }
                    const isPrintable = item.byte >= 32 && item.byte <= 126;
                    const char = isPrintable ? String.fromCharCode(item.byte) : '.';

                    return (
                      <span
                        key={idx}
                        onMouseEnter={() => setHoveredByte(item)}
                        onMouseLeave={() => setHoveredByte(null)}
                        className={`hover:bg-slate-700 px-0.5 rounded cursor-pointer ${
                          !isPrintable ? 'text-slate-600' : 'text-slate-200'
                        }`}
                      >
                        {char}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inspector Bottom Bar / Byte Tooltip Telemetry */}
      <div className="px-3 py-1.5 bg-[#090e1a] border-t border-cyber-border text-[11px] font-mono flex items-center justify-between text-slate-400">
        {hoveredByte ? (
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-slate-200">
              Offset: <span className="text-cyber-amber font-bold">0x{hoveredByte.offset.toString(16).padStart(8, '0').toUpperCase()}</span> ({hoveredByte.offset})
            </span>
            <span>
              Hex: <span className="text-cyber-cyan font-bold">0x{(hoveredByte.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()}</span>
            </span>
            <span>
              Dec: <span className="text-emerald-400 font-bold">{hoveredByte.byte & 0xff}</span>
            </span>
            <span>
              Bin: <span className="text-purple-400 font-bold">{(hoveredByte.byte & 0xff).toString(2).padStart(8, '0')}</span>
            </span>
            <span>
              ASCII: <span className="text-slate-100 font-bold bg-slate-800 px-1 rounded">
                {(hoveredByte.byte >= 32 && hoveredByte.byte <= 126) ? String.fromCharCode(hoveredByte.byte) : 'NUL/CTRL'}
              </span>
            </span>
            <span className={`px-1 rounded text-[10px] font-bold ${hoveredByte.type === 'rx' ? 'bg-cyan-950 text-cyan-300' : 'bg-amber-950 text-amber-300'}`}>
              {hoveredByte.type.toUpperCase()}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-500">
            <Info className="w-3.5 h-3.5" />
            <span>Hover any byte to inspect Offset, Dec, Binary, ASCII, and Direction</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-cyber-cyan text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan"></span> RX Bytes
          </span>
          <span className="flex items-center gap-1 text-cyber-amber text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyber-amber"></span> TX Bytes
          </span>
        </div>
      </div>
    </div>
  );
}
