import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Copy,
  Check,
  Download,
  Edit3,
  FileCode,
  ArrowRightLeft,
  X
} from 'lucide-react';
import { toUint8Array } from '../../utils/cyberchef/analytics.js';

/**
 * CyberChefHexEditor
 * Interactive 16-bytes-per-line Hex Editor with search highlighting,
 * two-way in-place editing, and pipeline feedforward.
 *
 * @param {Object} props
 * @param {string|ArrayBuffer|Uint8Array} props.data - Active output data
 * @param {Function} [props.onApplyToInput] - Callback when user wants to use modified bytes as recipe input
 * @param {Function} [props.onDataChange] - Callback when bytes are modified in place
 */
export default function CyberChefHexEditor({ data, onApplyToInput, onDataChange }) {
  // Original and working byte buffers
  const originalBytes = useMemo(() => toUint8Array(data), [data]);
  const [workingBytes, setWorkingBytes] = useState(() => new Uint8Array(originalBytes));
  const [modifiedOffsets, setModifiedOffsets] = useState(new Set());

  // Editing state
  const [editingOffset, setEditingOffset] = useState(null); // number | null
  const [editMode, setEditMode] = useState('hex'); // 'hex' | 'ascii'
  const [cellInputValue, setCellInputValue] = useState('');
  const editInputRef = useRef(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('auto'); // 'auto' | 'hex' | 'ascii'
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Pagination / Page size (512 bytes = 32 lines of 16 bytes)
  const pageSize = 512;
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(workingBytes.length / pageSize));

  // Copy status
  const [copiedHex, setCopiedHex] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Sync workingBytes when data prop changes from outside
  useEffect(() => {
    setWorkingBytes(new Uint8Array(originalBytes));
    setModifiedOffsets(new Set());
    setEditingOffset(null);
  }, [originalBytes]);

  // Focus input on edit
  useEffect(() => {
    if (editingOffset !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingOffset]);

  // Calculate search matches
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || workingBytes.length === 0) return [];

    let targetBytes;
    const clean = searchQuery.trim();

    // Determine target pattern
    if (searchType === 'hex' || (searchType === 'auto' && /^[0-9a-fA-F\s]+$/.test(clean) && clean.length % 2 === 0)) {
      const hexTokens = clean.replace(/[^0-9a-fA-F]/g, '');
      if (hexTokens.length >= 2 && hexTokens.length % 2 === 0) {
        targetBytes = [];
        for (let i = 0; i < hexTokens.length; i += 2) {
          targetBytes.push(parseInt(hexTokens.slice(i, i + 2), 16));
        }
      } else {
        targetBytes = Array.from(new TextEncoder().encode(clean));
      }
    } else {
      targetBytes = Array.from(new TextEncoder().encode(clean));
    }

    if (!targetBytes || targetBytes.length === 0) return [];

    const matches = [];
    const tLen = targetBytes.length;
    const bLen = workingBytes.length;

    for (let i = 0; i <= bLen - tLen; i++) {
      let isMatch = true;
      for (let j = 0; j < tLen; j++) {
        if (workingBytes[i + j] !== targetBytes[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matches.push({ offset: i, length: tLen });
      }
    }
    return matches;
  }, [searchQuery, searchType, workingBytes]);

  // Set of matching byte offsets for instant O(1) cell lookup
  const matchOffsetSet = useMemo(() => {
    const set = new Set();
    for (const m of searchMatches) {
      for (let k = 0; k < m.length; k++) {
        set.add(m.offset + k);
      }
    }
    return set;
  }, [searchMatches]);

  // Navigate matches
  const goToMatch = (index) => {
    if (searchMatches.length === 0) return;
    const normalized = (index + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(normalized);
    const match = searchMatches[normalized];
    if (match) {
      const targetPage = Math.floor(match.offset / pageSize);
      setCurrentPage(targetPage);
    }
  };

  // Start cell editing
  const handleStartEdit = (offset, mode = 'hex') => {
    setEditingOffset(offset);
    setEditMode(mode);
    if (mode === 'hex') {
      setCellInputValue(workingBytes[offset].toString(16).padStart(2, '0').toUpperCase());
    } else {
      const b = workingBytes[offset];
      setCellInputValue((b >= 32 && b <= 126) ? String.fromCharCode(b) : '.');
    }
  };

  // Commit cell edit
  const commitEdit = () => {
    if (editingOffset === null) return;
    let newByteVal = workingBytes[editingOffset];

    if (editMode === 'hex') {
      const parsed = parseInt(cellInputValue, 16);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 255) {
        newByteVal = parsed;
      }
    } else {
      if (cellInputValue.length > 0) {
        newByteVal = cellInputValue.charCodeAt(0) & 0xff;
      }
    }

    if (newByteVal !== workingBytes[editingOffset]) {
      const nextArr = new Uint8Array(workingBytes);
      nextArr[editingOffset] = newByteVal;
      setWorkingBytes(nextArr);

      setModifiedOffsets((prev) => {
        const nextSet = new Set(prev);
        nextSet.add(editingOffset);
        return nextSet;
      });

      if (onDataChange) {
        onDataChange(nextArr);
      }
    }

    setEditingOffset(null);
  };

  // Reset modifications
  const handleReset = () => {
    setWorkingBytes(new Uint8Array(originalBytes));
    setModifiedOffsets(new Set());
    setEditingOffset(null);
  };

  // Copy as Hex
  const handleCopyHex = () => {
    const hex = Array.from(workingBytes)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    navigator.clipboard.writeText(hex);
    setCopiedHex(true);
    setTimeout(() => setCopiedHex(false), 1500);
  };

  // Copy as Raw Text
  const handleCopyText = () => {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(workingBytes);
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1500);
  };

  // Download modified binary
  const handleDownloadBin = () => {
    const blob = new Blob([workingBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cyberchef_edit_${Date.now()}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Page slice
  const pageStart = currentPage * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, workingBytes.length);
  const pageSlice = workingBytes.subarray(pageStart, pageEnd);

  // Group into 16-byte rows
  const rows = useMemo(() => {
    const r = [];
    for (let offset = 0; offset < pageSlice.length; offset += 16) {
      const globalOffset = pageStart + offset;
      const end = Math.min(offset + 16, pageSlice.length);
      const rowBytes = Array.from(pageSlice.subarray(offset, end));
      r.push({
        globalOffset,
        bytes: rowBytes
      });
    }
    return r;
  }, [pageSlice, pageStart]);

  if (workingBytes.length === 0) {
    return (
      <div className="py-16 text-center text-slate-500 bg-[#12141a] rounded-xl border border-[#282d3a] p-6 space-y-2">
        <FileCode className="w-8 h-8 mx-auto text-slate-600 animate-pulse" />
        <p className="text-xs font-mono">No data to display in Hex Editor.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-3 space-y-3">
      {/* Editor Top Controls & Search Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        {/* Search Input */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[240px] max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentMatchIndex(0);
              }}
              placeholder="Search Hex (e.g. 1f 8b) or ASCII (e.g. HTTP)..."
              className="w-full bg-[#171920] border border-[#282d3a] rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                type="button"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchMatches.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 shrink-0">
              <span className="text-amber-400 font-bold">
                {currentMatchIndex + 1}/{searchMatches.length}
              </span>
              <button
                onClick={() => goToMatch(currentMatchIndex - 1)}
                className="p-1 hover:bg-[#1f232d] rounded text-slate-300"
                title="Previous match"
                type="button"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                onClick={() => goToMatch(currentMatchIndex + 1)}
                className="p-1 hover:bg-[#1f232d] rounded text-slate-300"
                title="Next match"
                type="button"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {modifiedOffsets.size > 0 && (
            <button
              onClick={handleReset}
              className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg flex items-center gap-1 font-mono transition"
              title="Reset all modifications"
              type="button"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset ({modifiedOffsets.size})</span>
            </button>
          )}

          {onApplyToInput && (
            <button
              onClick={() => onApplyToInput(workingBytes)}
              className="px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg flex items-center gap-1 font-mono transition font-bold"
              title="Send modified bytes to Recipe Input"
              type="button"
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span>Pipe to Input</span>
            </button>
          )}

          <button
            onClick={handleCopyHex}
            className="px-2 py-1 bg-[#1a1d26] hover:bg-[#232733] text-slate-300 border border-[#282d3a] rounded-lg flex items-center gap-1 font-mono transition"
            type="button"
          >
            {copiedHex ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
            <span>{copiedHex ? 'Copied' : 'Hex'}</span>
          </button>

          <button
            onClick={handleCopyText}
            className="px-2 py-1 bg-[#1a1d26] hover:bg-[#232733] text-slate-300 border border-[#282d3a] rounded-lg flex items-center gap-1 font-mono transition"
            type="button"
          >
            {copiedText ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
            <span>{copiedText ? 'Copied' : 'Text'}</span>
          </button>

          <button
            onClick={handleDownloadBin}
            className="px-2 py-1 bg-[#1a1d26] hover:bg-[#232733] text-slate-300 border border-[#282d3a] rounded-lg flex items-center gap-1 font-mono transition"
            title="Download modified binary"
            type="button"
          >
            <Download className="w-3 h-3 text-slate-400" />
            <span>Bin</span>
          </button>
        </div>
      </div>

      {/* Hex Grid Table */}
      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-[#1f232d] bg-[#0d0f14]">
        <table className="w-full border-collapse font-mono text-[11px] select-text">
          <thead>
            <tr className="bg-[#14161f] text-slate-500 border-b border-[#1f232d] text-left">
              <th className="px-2.5 py-1 text-slate-400 w-24">Offset</th>
              <th className="px-2 py-1 text-center" colSpan={8}>
                00 01 02 03 04 05 06 07
              </th>
              <th className="px-2 py-1 text-center border-l border-[#1f232d]" colSpan={8}>
                08 09 0A 0B 0C 0D 0E 0F
              </th>
              <th className="px-3 py-1 text-slate-400 border-l border-[#1f232d]">ASCII Decode</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.globalOffset} className="hover:bg-[#161822] transition-colors border-b border-[#131620]">
                {/* Offset Column */}
                <td className="px-2.5 py-0.5 text-cyan-500/80 font-bold tracking-wider select-none bg-[#0e1017]">
                  {row.globalOffset.toString(16).padStart(8, '0').toUpperCase()}
                </td>

                {/* 16 Hex Byte Cells */}
                {Array.from({ length: 16 }).map((_, colIdx) => {
                  const currentGlobalOffset = row.globalOffset + colIdx;
                  const hasByte = colIdx < row.bytes.length;
                  const byteVal = hasByte ? row.bytes[colIdx] : null;
                  const isModified = modifiedOffsets.has(currentGlobalOffset);
                  const isMatch = matchOffsetSet.has(currentGlobalOffset);
                  const isEditing = editingOffset === currentGlobalOffset && editMode === 'hex';

                  if (!hasByte) {
                    return (
                      <td
                        key={colIdx}
                        className={`px-1 py-0.5 text-center text-slate-800 ${colIdx === 8 ? 'border-l border-[#1f232d]' : ''}`}
                      >
                        ..
                      </td>
                    );
                  }

                  let cellBg = '';
                  let textColor = 'text-slate-300';
                  if (byteVal === 0) textColor = 'text-slate-600';
                  else if (byteVal >= 32 && byteVal <= 126) textColor = 'text-emerald-300';
                  else if (byteVal >= 128) textColor = 'text-purple-300';

                  if (isModified) {
                    cellBg = 'bg-rose-500/20 text-rose-300 font-bold';
                  } else if (isMatch) {
                    cellBg = 'bg-amber-400/20 text-amber-300 font-bold';
                  }

                  return (
                    <td
                      key={colIdx}
                      onClick={() => handleStartEdit(currentGlobalOffset, 'hex')}
                      className={`px-1 py-0.5 text-center cursor-pointer transition ${colIdx === 8 ? 'border-l border-[#1f232d]' : ''} ${cellBg} hover:bg-cyan-500/20`}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          maxLength={2}
                          value={cellInputValue}
                          onChange={(e) => setCellInputValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditingOffset(null);
                          }}
                          className="w-6 bg-cyan-950 text-cyan-200 border border-cyan-400 rounded px-0.5 text-center text-[10px] font-mono outline-none"
                        />
                      ) : (
                        <span className={textColor}>
                          {byteVal.toString(16).padStart(2, '0').toUpperCase()}
                        </span>
                      )}
                    </td>
                  );
                })}

                {/* ASCII Column */}
                <td className="px-3 py-0.5 border-l border-[#1f232d] select-text">
                  <div className="flex items-center gap-[1px]">
                    {row.bytes.map((b, colIdx) => {
                      const currentGlobalOffset = row.globalOffset + colIdx;
                      const isModified = modifiedOffsets.has(currentGlobalOffset);
                      const isMatch = matchOffsetSet.has(currentGlobalOffset);
                      const isPrintable = b >= 32 && b <= 126;
                      const char = isPrintable ? String.fromCharCode(b) : '.';

                      let charColor = isPrintable ? 'text-slate-300' : 'text-slate-600';
                      if (isModified) charColor = 'text-rose-400 font-bold bg-rose-500/20';
                      else if (isMatch) charColor = 'text-amber-300 font-bold bg-amber-400/20';

                      return (
                        <span
                          key={colIdx}
                          onClick={() => handleStartEdit(currentGlobalOffset, 'ascii')}
                          className={`cursor-pointer hover:text-cyan-300 px-[1px] ${charColor}`}
                        >
                          {char}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
          <div>
            Bytes {pageStart.toLocaleString()} - {pageEnd.toLocaleString()} of {workingBytes.length.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="px-2 py-0.5 rounded bg-[#171920] border border-[#282d3a] hover:bg-[#202430] disabled:opacity-40"
              type="button"
            >
              Prev
            </button>
            <span>
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="px-2 py-0.5 rounded bg-[#171920] border border-[#282d3a] hover:bg-[#202430] disabled:opacity-40"
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
