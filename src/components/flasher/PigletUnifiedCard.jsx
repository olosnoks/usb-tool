import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, 
  ExternalLink, 
  Info, 
  Cpu, 
  Sliders, 
  Layers, 
  Check, 
  Sparkles,
  ChevronDown,
  AlertCircle,
  Github
} from 'lucide-react';
import { PIGLET_BOARDS } from '../../services/firmwareCatalogService';

export default function PigletUnifiedCard({ 
  onSelectFirmwareForFlashing, 
  onInspect,
  currentChipFilter = 'ALL'
}) {
  // Selected Board from PIGLET_BOARDS
  const [selectedBoardId, setSelectedBoardId] = useState('freenove-s3-cyd');
  
  // 'skon' or 'ham'
  const [sourceType, setSourceType] = useState('skon');

  // Auto-adapt selected board if currentChipFilter changes to a specific chip
  useEffect(() => {
    if (currentChipFilter !== 'ALL') {
      const match = PIGLET_BOARDS.find(b => b.device?.toUpperCase() === currentChipFilter.toUpperCase());
      if (match) {
        setSelectedBoardId(match.id);
      }
    }
  }, [currentChipFilter]);

  const currentBoard = useMemo(() => {
    return PIGLET_BOARDS.find(b => b.id === selectedBoardId) || PIGLET_BOARDS[0];
  }, [selectedBoardId]);

  // Check what firmware sources exist for the current board
  const hasSkon = Boolean(currentBoard.builds.skon && currentBoard.builds.skon.length > 0);
  const hasHam = Boolean(currentBoard.builds.ham && currentBoard.builds.ham.length > 0);

  // If the active source is not available on this board, auto-switch to the available one
  useEffect(() => {
    if (sourceType === 'skon' && !hasSkon && hasHam) {
      setSourceType('ham');
    } else if (sourceType === 'ham' && !hasHam && hasSkon) {
      setSourceType('skon');
    }
  }, [currentBoard, sourceType, hasSkon, hasHam]);

  // Available builds strictly for this board and active source
  const availableBuilds = useMemo(() => {
    return currentBoard.builds[sourceType] || currentBoard.builds.skon || currentBoard.builds.ham || [];
  }, [currentBoard, sourceType]);

  // Selected build index within this board
  const [selectedBuildIndex, setSelectedBuildIndex] = useState(0);

  // Track whether hardware flashing note is expanded
  const [isNoteExpanded, setIsNoteExpanded] = useState(false);

  // Reset build index and note dropdown when board or source changes
  useEffect(() => {
    setSelectedBuildIndex(0);
    setIsNoteExpanded(false);
  }, [selectedBoardId, sourceType]);

  const selectedBuild = availableBuilds[selectedBuildIndex] || availableBuilds[0];

  if (!currentBoard || !selectedBuild) return null;

  // Active firmware ready for flashing or inspecting
  const activeFirmware = {
    ...currentBoard,
    ...selectedBuild,
    name: selectedBuild.name,
    device: currentBoard.device,
    type: 'piglet',
    source: sourceType,
    version: selectedBuild.version,
    description: selectedBuild.description || currentBoard.description,
    note: currentBoard.note,
    features: currentBoard.features,
    downloadUrl: selectedBuild.downloadUrl,
    files: selectedBuild.files,
    isMergedBinary: selectedBuild.isMergedBinary,
    flashConfig: selectedBuild.flashConfig || currentBoard.flashConfig,
    websiteUrl: selectedBuild.websiteUrl,
    repoUrl: selectedBuild.repoUrl
  };

  const baudRate = activeFirmware.flashConfig?.baudRate || 921600;

  return (
    <div className="bg-gradient-to-b from-[#1c1e27] to-[#15171f] border-2 border-pink-500/30 hover:border-pink-500/60 rounded-2xl p-4.5 flex flex-col justify-between transition-all duration-200 shadow-lg shadow-pink-950/10 group space-y-3.5">
      {/* Top Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">🐽</span>
              <h4 className="text-sm font-bold text-slate-100 group-hover:text-pink-300 transition flex items-center gap-1.5">
                <span>Piglet Wardriver Suite</span>
              </h4>
            </div>
            
            {/* Quick Status Tags */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 font-mono font-bold border border-pink-500/30">
                {currentBoard.device}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {activeFirmware.version}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                Merged 0x0
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono font-bold">
                {baudRate} baud
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {activeFirmware.repoUrl && (
              <a
                href={activeFirmware.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-slate-400 hover:text-pink-400 bg-[#1e212b] rounded-lg border border-[#2b303c] transition"
                title={`GitHub Source (${sourceType === 'skon' ? 'olosnoks/piglet' : 'Hamspiced/piglet'})`}
              >
                <Github className="w-3.5 h-3.5" />
              </a>
            )}
            {activeFirmware.websiteUrl && (
              <a
                href={activeFirmware.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-slate-400 hover:text-pink-400 bg-[#1e212b] rounded-lg border border-[#2b303c] transition"
                title="Documentation & Web Flasher"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Fork / Official Toggle Button Group */}
        <div className="bg-[#12141a] p-1 rounded-xl border border-[#262a36] flex items-center gap-1 text-xs font-mono">
          <button
            type="button"
            disabled={!hasSkon}
            onClick={() => hasSkon && setSourceType('skon')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 font-bold ${
              !hasSkon 
                ? 'opacity-40 cursor-not-allowed text-slate-500' 
                : sourceType === 'skon'
                  ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-sm shadow-pink-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1d26]'
            }`}
            title={!hasSkon ? 'This board only tracks upstream official releases' : "skon's customized fork"}
          >
            <span>skon's fork</span>
            {hasSkon && <span className="text-[9px] px-1 py-0.2 bg-black/30 rounded">main+fe55704</span>}
          </button>

          <button
            type="button"
            disabled={!hasHam}
            onClick={() => hasHam && setSourceType('ham')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 font-bold ${
              !hasHam 
                ? 'opacity-40 cursor-not-allowed text-slate-500' 
                : sourceType === 'ham'
                  ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-sm shadow-pink-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1d26]'
            }`}
            title={!hasHam ? 'This board is exclusive to skon’s fork' : 'Hamspiced official v2.7 release'}
          >
            <span>Ham's official</span>
            {hasHam && <span className="text-[9px] px-1 py-0.2 bg-black/30 rounded">v2.7</span>}
          </button>
        </div>

        {/* Dropdowns Section */}
        <div className="space-y-2 bg-[#12141a]/60 p-2.5 rounded-xl border border-[#232733]">
          {/* Board Selector Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Target Hardware / Board:</span>
              <span className="text-pink-400 font-semibold">{currentBoard.device} • {currentBoard.flashSize}</span>
            </label>
            <div className="relative">
              <select
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-pink-400 transition cursor-pointer appearance-none pr-7"
              >
                {PIGLET_BOARDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.boardName} ({b.device})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Firmware Build Dropdown — ONLY builds for this board */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Firmware Build:</span>
              <span className="text-slate-400 text-[9px] font-mono">{selectedBuild.fileName}</span>
            </label>
            <div className="relative">
              <select
                value={selectedBuildIndex}
                onChange={(e) => setSelectedBuildIndex(Number(e.target.value))}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-pink-400 transition cursor-pointer appearance-none pr-7"
              >
                {availableBuilds.map((build, idx) => (
                  <option key={build.id || idx} value={idx}>
                    {build.fwName} [{build.version}]
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Hardware & Flashing Notes Dropdown (Collapsible so row cards maintain uniform height) */}
        {currentBoard.note && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 overflow-hidden font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setIsNoteExpanded(!isNoteExpanded)}
              className="w-full px-2.5 py-1.5 flex items-center justify-between text-amber-300 font-semibold hover:bg-amber-500/20 transition text-left"
            >
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>Hardware Flashing Note</span>
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-amber-400 transition-transform duration-200 ${isNoteExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isNoteExpanded && (
              <div className="px-2.5 py-2 text-[10px] text-amber-200/90 leading-relaxed border-t border-amber-500/20 bg-black/30">
                {currentBoard.note}
              </div>
            )}
          </div>
        )}

        {/* Dynamic Description */}
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
          {currentBoard.description}
        </p>

        {/* Feature Badges */}
        {currentBoard.features && currentBoard.features.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {currentBoard.features.slice(0, 3).map((feat, fIdx) => (
              <span 
                key={fIdx} 
                className="text-[9px] px-1.5 py-0.5 rounded bg-[#1e212b] text-slate-300 font-mono border border-[#2b303c]/60 truncate max-w-[160px]"
              >
                • {feat}
              </span>
            ))}
            {currentBoard.features.length > 3 && (
              <span className="text-[9px] text-pink-400/80 font-mono">
                +{currentBoard.features.length - 3} more
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
          className="text-xs text-slate-400 hover:text-pink-300 font-mono flex items-center gap-1 transition py-1"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectFirmwareForFlashing && onSelectFirmwareForFlashing(activeFirmware)}
          className="px-3.5 py-1.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white font-bold rounded-xl text-xs font-mono shadow-md shadow-pink-500/20 flex items-center gap-1.5 transition active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Load Preset</span>
        </button>
      </div>
    </div>
  );
}
