import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, 
  ExternalLink, 
  Info, 
  Cpu, 
  ChevronDown,
  Layers,
  Sparkles
} from 'lucide-react';

/**
 * Interactive card for any grouped firmware project suite.
 * Features:
 * - Board / Hardware Target dropdown
 * - Firmware Version / Flavor dropdown
 * - Auto-adapting chip filter selection
 * - Live dynamic description, tags, features, and baud rate
 */
export default function FirmwareGroupCard({ 
  group, 
  onSelectFirmwareForFlashing, 
  onInspect,
  currentChipFilter = 'ALL'
}) {
  const boards = group.boards || [];
  
  // Track selected board ID / index
  const [selectedBoardIndex, setSelectedBoardIndex] = useState(0);

  // Auto-adapt selected board if user changes chip filter
  useEffect(() => {
    if (currentChipFilter !== 'ALL' && boards.length > 1) {
      const matchingIdx = boards.findIndex(b => 
        b.device?.toUpperCase().includes(currentChipFilter.toUpperCase()) ||
        (currentChipFilter === 'ESP32' && b.device?.toUpperCase() === 'ESP32')
      );
      if (matchingIdx !== -1) {
        setSelectedBoardIndex(matchingIdx);
      }
    }
  }, [currentChipFilter, boards]);

  const currentBoard = boards[selectedBoardIndex] || boards[0];

  // Resolve available versions for the current board
  const availableVersions = useMemo(() => {
    if (!currentBoard) return [];
    if (Array.isArray(currentBoard.availableVersions) && currentBoard.availableVersions.length > 0) {
      return currentBoard.availableVersions;
    }
    return [{
      name: currentBoard.version || 'Latest',
      version: currentBoard.version || 'Latest',
      downloadUrl: currentBoard.downloadUrl,
      files: currentBoard.files,
      description: currentBoard.description,
      features: currentBoard.features,
      isMergedBinary: currentBoard.isMergedBinary,
      flashConfig: currentBoard.flashConfig
    }];
  }, [currentBoard]);

  // Track selected version index
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(0);

  // Reset version index if board changes
  useEffect(() => {
    setSelectedVersionIndex(0);
  }, [selectedBoardIndex]);

  const currentVersion = availableVersions[selectedVersionIndex] || availableVersions[0];

  if (!currentBoard) return null;

  // Build the effective active firmware object
  const activeFirmware = {
    ...currentBoard,
    ...currentVersion,
    name: boards.length > 1 
      ? `${currentBoard.name}` 
      : currentBoard.name,
    version: currentVersion?.version || currentBoard.version,
    description: currentVersion?.description || currentBoard.description,
    features: (currentVersion?.features && currentVersion.features.length > 0) 
      ? currentVersion.features 
      : currentBoard.features,
    downloadUrl: currentVersion?.downloadUrl || currentBoard.downloadUrl,
    files: currentVersion?.files || currentBoard.files,
    isMergedBinary: currentVersion?.isMergedBinary !== undefined 
      ? currentVersion.isMergedBinary 
      : currentBoard.isMergedBinary,
    flashConfig: currentVersion?.flashConfig || currentBoard.flashConfig
  };

  const baudRate = activeFirmware.flashConfig?.baudRate || 921600;

  return (
    <div className="bg-[#171920] hover:bg-[#1a1d26] border border-[#2b303c] hover:border-amber-500/50 rounded-2xl p-4 flex flex-col justify-between transition-all duration-200 group space-y-3">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-100 group-hover:text-amber-300 transition flex items-center gap-1.5 flex-wrap">
              <span>{group.familyName}</span>
              {boards.length > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252a37] text-slate-300 font-mono font-normal">
                  {boards.length} Boards
                </span>
              )}
            </h4>

            {/* Status Pills */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                {activeFirmware.device || 'ESP32'}
              </span>
              {activeFirmware.version && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {activeFirmware.version}
                </span>
              )}
              {activeFirmware.isMergedBinary && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                  Merged 0x0
                </span>
              )}
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                {baudRate} baud
              </span>
            </div>
          </div>

          {activeFirmware.websiteUrl && (
            <a
              href={activeFirmware.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-slate-400 hover:text-amber-400 bg-[#1e212b] rounded-lg border border-[#2b303c] transition shrink-0"
              title="Documentation & Project Page"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Dropdowns Section */}
        <div className="space-y-2 bg-[#12141a]/60 p-2.5 rounded-xl border border-[#232733]">
          {/* Board Selector Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Board / Target:</span>
              <span className="text-amber-400 font-semibold">{activeFirmware.device}</span>
            </label>
            <div className="relative">
              <select
                value={selectedBoardIndex}
                onChange={(e) => setSelectedBoardIndex(Number(e.target.value))}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-400 transition cursor-pointer appearance-none pr-7"
              >
                {boards.map((b, idx) => (
                  <option key={b.name + idx} value={idx}>
                    {b.name} ({b.device || 'ESP32'})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Version / Build Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Firmware Version / Flavor:</span>
              <span className="text-slate-500 text-[9px]">{availableVersions.length} build(s)</span>
            </label>
            <div className="relative">
              <select
                value={selectedVersionIndex}
                onChange={(e) => setSelectedVersionIndex(Number(e.target.value))}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-400 transition cursor-pointer appearance-none pr-7"
              >
                {availableVersions.map((v, idx) => (
                  <option key={(v.name || v.version) + idx} value={idx}>
                    {v.name || v.version || 'Latest'} {v.size ? `(${v.size})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Dynamic Description */}
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
          {activeFirmware.description}
        </p>

        {/* Feature Badges */}
        {activeFirmware.features && activeFirmware.features.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {activeFirmware.features.slice(0, 3).map((feat, fIdx) => (
              <span 
                key={fIdx} 
                className="text-[9px] px-1.5 py-0.5 rounded bg-[#1e212b] text-slate-300 font-mono border border-[#2b303c]/60 truncate max-w-[150px]"
              >
                • {feat}
              </span>
            ))}
            {activeFirmware.features.length > 3 && (
              <span className="text-[9px] text-amber-400/80 font-mono">
                +{activeFirmware.features.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="pt-3 border-t border-[#232733] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onInspect && onInspect(activeFirmware)}
          className="text-xs text-slate-400 hover:text-slate-200 font-mono flex items-center gap-1 transition py-1"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectFirmwareForFlashing && onSelectFirmwareForFlashing(activeFirmware)}
          className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs font-mono shadow-md shadow-amber-500/10 flex items-center gap-1.5 transition active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Load Preset</span>
        </button>
      </div>
    </div>
  );
}
