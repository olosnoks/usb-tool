import React, { useState, useEffect } from 'react';
import { 
  Download, 
  ExternalLink, 
  Info, 
  Cpu, 
  Sliders, 
  Layers, 
  Check, 
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { PIGLET_VARIANTS } from '../../services/firmwareCatalogService';

export default function PigletUnifiedCard({ 
  onSelectFirmwareForFlashing, 
  onInspect,
  currentChipFilter = 'ALL'
}) {
  // 'skon' or 'ham'
  const [sourceType, setSourceType] = useState('skon');
  
  // Available list for active source
  const variants = PIGLET_VARIANTS[sourceType] || [];
  
  // Selected variant ID
  const [selectedVariantId, setSelectedVariantId] = useState(() => variants[0]?.id || 'freenove-s3-cyd');

  // If user switches source, pick first available variant in that source
  const handleSourceChange = (newSource) => {
    setSourceType(newSource);
    const newVariants = PIGLET_VARIANTS[newSource] || [];
    if (newVariants.length > 0) {
      // If current chip filter matches something in the new list, try to preserve chip
      if (currentChipFilter !== 'ALL') {
        const matchingChip = newVariants.find(v => v.device?.toUpperCase() === currentChipFilter.toUpperCase());
        if (matchingChip) {
          setSelectedVariantId(matchingChip.id);
          return;
        }
      }
      setSelectedVariantId(newVariants[0].id);
    }
  };

  // If currentChipFilter changes to a specific chip, auto-adapt selection if possible
  useEffect(() => {
    if (currentChipFilter !== 'ALL') {
      const matchInCurrent = variants.find(v => v.device?.toUpperCase() === currentChipFilter.toUpperCase());
      if (matchInCurrent) {
        setSelectedVariantId(matchInCurrent.id);
      } else {
        // check other source
        const otherSource = sourceType === 'skon' ? 'ham' : 'skon';
        const matchInOther = PIGLET_VARIANTS[otherSource]?.find(v => v.device?.toUpperCase() === currentChipFilter.toUpperCase());
        if (matchInOther) {
          setSourceType(otherSource);
          setSelectedVariantId(matchInOther.id);
        }
      }
    }
  }, [currentChipFilter]);

  const selectedFirmware = variants.find(v => v.id === selectedVariantId) || variants[0];

  if (!selectedFirmware) return null;

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
                {selectedFirmware.device}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {selectedFirmware.version}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                Merged 0x0
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono">
                {selectedFirmware.flashConfig?.baudRate || 921600} baud
              </span>
            </div>
          </div>

          {selectedFirmware.websiteUrl && (
            <a
              href={selectedFirmware.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-slate-400 hover:text-pink-400 bg-[#1e212b] rounded-lg border border-[#2b303c] transition shrink-0"
              title="Documentation & Project Page"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Fork / Official Toggle Button Group */}
        <div className="bg-[#12141a] p-1 rounded-xl border border-[#262a36] flex items-center gap-1 text-xs font-mono">
          <button
            type="button"
            onClick={() => handleSourceChange('skon')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 font-bold ${
              sourceType === 'skon'
                ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-sm shadow-pink-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1d26]'
            }`}
          >
            <span>skon's forks</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-black/30 rounded-full">6</span>
          </button>

          <button
            type="button"
            onClick={() => handleSourceChange('ham')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 font-bold ${
              sourceType === 'ham'
                ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-sm shadow-pink-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1d26]'
            }`}
          >
            <span>Ham's official</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-black/30 rounded-full">3</span>
          </button>
        </div>

        {/* Dropdowns Section */}
        <div className="space-y-2 bg-[#12141a]/60 p-2.5 rounded-xl border border-[#232733]">
          {/* Board Selector Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Target Hardware / Board:</span>
              <span className="text-pink-400 font-semibold">{selectedFirmware.device}</span>
            </label>
            <div className="relative">
              <select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-pink-400 transition cursor-pointer appearance-none pr-7"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.boardName} ({v.device})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Firmware Build Flavor Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
              <span>Firmware Build:</span>
              <span className="text-slate-500 text-[9px]">{selectedFirmware.files[0]?.name}</span>
            </label>
            <div className="relative">
              <select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2b303c] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-pink-400 transition cursor-pointer appearance-none pr-7"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.fwName} [{v.version}]
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Dynamic Description */}
        <p className="text-xs text-slate-400 leading-relaxed min-h-[40px]">
          {selectedFirmware.description}
        </p>

        {/* Feature Badges */}
        {selectedFirmware.features && selectedFirmware.features.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {selectedFirmware.features.slice(0, 3).map((feat, fIdx) => (
              <span 
                key={fIdx} 
                className="text-[9px] px-1.5 py-0.5 rounded bg-[#1e212b] text-slate-300 font-mono border border-[#2b303c]/60 truncate max-w-[150px]"
              >
                • {feat}
              </span>
            ))}
            {selectedFirmware.features.length > 3 && (
              <span className="text-[9px] text-pink-400/80 font-mono">
                +{selectedFirmware.features.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="pt-3 border-t border-[#232733] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onInspect && onInspect(selectedFirmware)}
          className="text-xs text-slate-400 hover:text-pink-300 font-mono flex items-center gap-1 transition py-1"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectFirmwareForFlashing && onSelectFirmwareForFlashing(selectedFirmware)}
          className="px-3.5 py-1.5 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white font-bold rounded-xl text-xs font-mono shadow-md shadow-pink-500/20 flex items-center gap-1.5 transition active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Load Preset</span>
        </button>
      </div>
    </div>
  );
}
