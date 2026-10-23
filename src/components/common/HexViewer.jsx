import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Binary, 
  Search, 
  Copy, 
  Check, 
  Trash2, 
  SlidersHorizontal,
  ArrowDown,
  Info
} from 'lucide-react';

export default function HexViewer({
  byteStream = [], // Array of { offset, byte, type: 'rx' | 'tx' }
  onClear,
  maxDisplayBytes = 2048,
  compact = false
}) {
  const [rowWidth, setRowWidth] = useState(8);
  const [hoveredByte, setHoveredByte] = useState(null);
  const [searchHex, setSearchHex] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [copiedFormat, setCopiedFormat] = useState(null);

  const containerRef = useRef(null);

  useEffect(() => {
    if (autoFollow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [byteStream, autoFollow]);

  const displayedBytes = useMemo(() => {
    if (byteStream.length > maxDisplayBytes) {
      return byteStream.slice(byteStream.length - maxDisplayBytes);
    }
    return byteStream;
  }, [byteStream, maxDisplayBytes]);

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

  const matchOffsets = useMemo(() => {
    if (!searchHex.trim()) return new Set();
    const cleanSearch = searchHex.replace(/\s+/g, '').toUpperCase();
    const matches = new Set();

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

  const handleCopy = (format) => {
    let text = '';
    if (format === 'hex') {
      text = displayedBytes.map(b => (b.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ');
    } else if (format === 'c-array') {
      text = 'const uint8_t data[] = {\n  ' + 
        displayedBytes.map(b => `0x${(b.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()}`).join(', ') + 
        '\n};';
    } else if (format === 'ascii') {
      text = displayedBytes.map(b => {
        const c = b.byte;
        return (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
      }).join('');
    }

    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  return (
    <div className="bg-[#030712] border border-slate-800 rounded-xl flex flex-col font-mono text-xs overflow-hidden shadow-xl">
      {/* Hex Viewer Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900/60 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Binary className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-slate-200">HEX / ASCII STREAM</span>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-cyan-300 font-bold">
            {displayedBytes.length} BYTES
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Row width toggle */}
          <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-[11px]">
            <button
              onClick={() => setRowWidth(8)}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                rowWidth === 8 ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              8-Byte
            </button>
            <button
              onClick={() => setRowWidth(16)}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                rowWidth === 16 ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              16-Byte
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search hex (e.g. 55 AA)..."
              value={searchHex}
              onChange={(e) => setSearchHex(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500 w-36 sm:w-44"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
          </div>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            title="Auto-scroll on incoming bytes"
            className={`p-1.5 rounded-lg border text-xs transition-all ${
              autoFollow 
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Copy Dropdown / Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleCopy('hex')}
              title="Copy as Hex String"
              className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 flex items-center gap-1"
            >
              {copiedFormat === 'hex' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-400" />}
              <span>HEX</span>
            </button>
            <button
              onClick={() => handleCopy('c-array')}
              title="Copy as C-Array"
              className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 flex items-center gap-1"
            >
              {copiedFormat === 'c-array' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-amber-400" />}
              <span>C[]</span>
            </button>
          </div>

          {/* Clear */}
          {onClear && (
            <button
              onClick={onClear}
              title="Clear Hex Stream Buffer"
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hex Stream Content Table */}
      <div 
        ref={containerRef}
        className={`overflow-y-auto p-3 space-y-1 font-mono text-[11px] leading-tight select-text scrollbar-thin scrollbar-thumb-slate-800 ${
          compact ? 'max-h-60' : 'max-h-96'
        }`}
      >
        {rows.length === 0 ? (
          <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
            <Binary className="w-8 h-8 text-slate-600 stroke-[1.5]" />
            <span>Awaiting incoming/outgoing serial byte packets...</span>
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.offset} className="flex items-center hover:bg-slate-900/50 rounded px-1">
              {/* Offset header */}
              <span className="text-slate-500 w-20 shrink-0 select-none">
                {row.offset.toString(16).padStart(8, '0').toUpperCase()}:
              </span>

              {/* Hex bytes block */}
              <div className="flex items-center gap-1.5 flex-1 pr-4">
                {row.bytes.map((item, idx) => {
                  const isHovered = hoveredByte?.offset === item.offset;
                  const isMatch = matchOffsets.has(item.offset);
                  const isTx = item.type === 'tx';

                  return (
                    <span
                      key={item.offset}
                      onMouseEnter={() => setHoveredByte(item)}
                      onMouseLeave={() => setHoveredByte(null)}
                      className={`cursor-pointer px-1 py-0.5 rounded transition-colors ${
                        isMatch
                          ? 'bg-amber-400 text-slate-950 font-bold'
                          : isHovered
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : isTx
                          ? 'text-amber-400 hover:bg-amber-500/20'
                          : 'text-cyan-300 hover:bg-cyan-500/20'
                      }`}
                    >
                      {(item.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()}
                      {idx === Math.floor(rowWidth / 2) - 1 && <span className="text-slate-600 select-none ml-1"> </span>}
                    </span>
                  );
                })}
                {/* Pad empty columns if row is not full */}
                {row.bytes.length < rowWidth && Array.from({ length: rowWidth - row.bytes.length }).map((_, i) => (
                  <span key={i} className="text-slate-800 px-1 py-0.5 select-none">..</span>
                ))}
              </div>

              {/* ASCII representation */}
              <div className="text-slate-400 border-l border-slate-800 pl-3 w-32 sm:w-44 shrink-0 tracking-widest">
                {row.bytes.map((item) => {
                  const c = item.byte;
                  const isPrintable = c >= 32 && c <= 126;
                  const char = isPrintable ? String.fromCharCode(c) : '·';
                  const isHovered = hoveredByte?.offset === item.offset;

                  return (
                    <span
                      key={item.offset}
                      className={isHovered ? 'text-cyan-300 font-bold bg-cyan-900/40 rounded' : isPrintable ? 'text-slate-300' : 'text-slate-600'}
                    >
                      {char}
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Hover Status Footer */}
      <div className="bg-slate-950 px-3 py-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center gap-4">
          {hoveredByte ? (
            <>
              <span>Offset: <strong className="text-cyan-400">0x{hoveredByte.offset.toString(16).toUpperCase()}</strong></span>
              <span>Hex: <strong className="text-cyan-400">0x{(hoveredByte.byte & 0xff).toString(16).padStart(2, '0').toUpperCase()}</strong></span>
              <span>Dec: <strong className="text-amber-400">{hoveredByte.byte}</strong></span>
              <span>Bin: <strong className="text-emerald-400">{(hoveredByte.byte & 0xff).toString(2).padStart(8, '0')}</strong></span>
              <span>ASCII: <strong className="text-purple-400">{hoveredByte.byte >= 32 && hoveredByte.byte <= 126 ? `'${String.fromCharCode(hoveredByte.byte)}'` : 'Non-printable'}</strong></span>
            </>
          ) : (
            <span className="text-slate-500 italic">Hover over any byte for inspector telemetry</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-cyan-400"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> RX</span>
          <span className="flex items-center gap-1 text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> TX</span>
        </div>
      </div>
    </div>
  );
}
