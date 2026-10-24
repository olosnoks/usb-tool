import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Cpu, 
  Download, 
  ExternalLink, 
  Sparkles, 
  RefreshCw, 
  Layers, 
  CheckCircle2, 
  AlertCircle,
  HardDrive,
  Info,
  Radio,
  FileCode,
  Sliders,
  ChevronRight
} from 'lucide-react';
import { fetchFirmwareCatalog, getCachedCatalogSync, downloadFirmwareBinary, BUNDLED_FALLBACK_PRESETS } from '../../services/firmwareCatalogService';

export default function CloudFirmwareCatalog({ onSelectFirmwareForFlashing }) {
  const [catalog, setCatalog] = useState(() => getCachedCatalogSync() || BUNDLED_FALLBACK_PRESETS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedRemote, setHasLoadedRemote] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChip, setSelectedChip] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedFirmware, setSelectedFirmware] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);

  const loadCatalog = async (force = false) => {
    setIsLoading(true);
    try {
      const res = await fetchFirmwareCatalog(force);
      if (res && res.options && res.options.length > 0) {
        setCatalog(res.options);
        setHasLoadedRemote(true);
      }
    } catch (e) {
      console.warn('Catalog load notice:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // If user enters a search query and hasn't loaded remote catalog yet, trigger background load
  useEffect(() => {
    if (searchQuery.trim().length > 1 && !hasLoadedRemote && !isLoading) {
      loadCatalog(false);
    }
  }, [searchQuery, hasLoadedRemote, isLoading]);

  // Filter chips
  const CHIP_FILTERS = ['ALL', 'ESP32', 'ESP32-S3', 'ESP32-S2', 'ESP32-C3', 'ESP32-C5', 'ESP32-C6', 'ESP8266', 'BW16'];

  const filteredFirmware = useMemo(() => {
    return catalog.filter(item => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || 
        item.name?.toLowerCase().includes(q) || 
        item.description?.toLowerCase().includes(q) ||
        item.device?.toLowerCase().includes(q) ||
        item.type?.toLowerCase().includes(q);

      const matchesChip = selectedChip === 'ALL' || 
        item.device?.toUpperCase().includes(selectedChip) ||
        (selectedChip === 'ESP32' && item.device?.toUpperCase() === 'ESP32');

      const matchesCategory = selectedCategory === 'ALL' || item.type?.toLowerCase() === selectedCategory.toLowerCase();

      return matchesSearch && matchesChip && matchesCategory;
    });
  }, [catalog, searchQuery, selectedChip, selectedCategory]);

  const handleDownloadAndFlash = async (firmware) => {
    if (!onSelectFirmwareForFlashing) return;
    setDownloadProgress({ status: 'fetching', message: `Initializing download for ${firmware.name}...` });

    try {
      // Prepare partition files list
      const filesToLoad = [];
      const files = firmware.files && firmware.files.length > 0 
        ? firmware.files 
        : [{ name: `${firmware.name}.bin`, address: firmware.isMergedBinary ? '0x0' : '0x10000', downloadUrl: firmware.downloadUrl }];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setDownloadProgress({ 
          status: 'downloading', 
          message: `Downloading part ${i + 1}/${files.length}: ${file.name}...` 
        });

        const { data, size } = await downloadFirmwareBinary(file.downloadUrl, (step) => {
          setDownloadProgress({ status: 'downloading', message: `[${file.name}] ${step}` });
        });

        filesToLoad.push({
          name: file.name,
          address: file.address || (i === 0 && firmware.isMergedBinary ? '0x0' : '0x10000'),
          data,
          size
        });
      }

      setDownloadProgress({ status: 'ready', message: `Successfully loaded ${filesToLoad.length} partition(s)! Redirecting to flasher...` });
      setTimeout(() => setDownloadProgress(null), 2500);

      onSelectFirmwareForFlashing({
        firmware,
        files: filesToLoad,
        flashConfig: firmware.flashConfig || { baudRate: 921600, eraseAll: Boolean(firmware.isMergedBinary) }
      });
    } catch (err) {
      console.error('Firmware download error:', err);
      setDownloadProgress({ status: 'error', message: `Download failed: ${err.message}` });
      setTimeout(() => setDownloadProgress(null), 5000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Header */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search 400+ cloud firmwares (Marauder, Meshtastic, Bruce, WLED...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#1e212b] border border-[#2b303c] rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 font-mono transition"
            />
          </div>

          <div className="flex items-center gap-2 self-end">
            <button
              onClick={() => loadCatalog(true)}
              disabled={isLoading}
              className="px-3 py-2 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs font-mono transition flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Catalog</span>
            </button>
            <span className="text-[11px] font-mono text-slate-400 px-2 py-1 bg-[#101216] rounded-lg border border-[#232733]">
              {filteredFirmware.length} Presets Available
            </span>
          </div>
        </div>

        {/* Chip Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px] font-mono">
          <span className="text-slate-500 mr-1 flex items-center gap-1"><Cpu className="w-3 h-3" /> Target:</span>
          {CHIP_FILTERS.map(chip => (
            <button
              key={chip}
              onClick={() => setSelectedChip(chip)}
              className={`px-2.5 py-1 rounded-lg border transition whitespace-nowrap ${
                selectedChip === chip 
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold' 
                  : 'bg-[#1e212b] border-[#2b303c] text-slate-400 hover:text-slate-200'
              }`}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Download Alert Notification */}
      {downloadProgress && (
        <div className={`p-3 rounded-xl border flex items-center gap-3 text-xs font-mono transition ${
          downloadProgress.status === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : downloadProgress.status === 'ready'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-300 animate-pulse'
        }`}>
          <RefreshCw className={`w-4 h-4 shrink-0 ${downloadProgress.status === 'downloading' ? 'animate-spin' : ''}`} />
          <span>{downloadProgress.message}</span>
        </div>
      )}

      {/* Grid of Firmware Options */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 space-y-3 font-mono text-xs">
          <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
          <span>Fetching cloud catalog manifest...</span>
        </div>
      ) : filteredFirmware.length === 0 ? (
        <div className="py-16 text-center text-slate-500 font-mono text-xs bg-[#171920] border border-[#2b303c] rounded-2xl">
          No firmware matched your search criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredFirmware.map((fw, idx) => (
            <div
              key={fw.name + idx}
              className="bg-[#171920] hover:bg-[#1a1d26] border border-[#2b303c] hover:border-amber-500/40 rounded-2xl p-4 flex flex-col justify-between transition group space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-slate-100 group-hover:text-amber-300 transition flex items-center gap-1.5">
                      <span>{fw.name}</span>
                    </h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                        {fw.device || 'ESP32'}
                      </span>
                      {fw.version && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                          {fw.version}
                        </span>
                      )}
                      {fw.isMergedBinary && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                          Factory Merged
                        </span>
                      )}
                    </div>
                  </div>

                  {fw.websiteUrl && (
                    <a
                      href={fw.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-400 hover:text-amber-400 bg-[#1e212b] rounded-lg border border-[#2b303c] transition"
                      title="Documentation & Project Page"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                  {fw.description}
                </p>

                {/* Features Badges */}
                {fw.features && fw.features.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    {fw.features.slice(0, 3).map((feat, fIdx) => (
                      <span key={fIdx} className="text-[9px] px-1.5 py-0.5 rounded bg-[#1e212b] text-slate-400 font-mono truncate max-w-[140px]">
                        • {feat}
                      </span>
                    ))}
                    {fw.features.length > 3 && (
                      <span className="text-[9px] text-slate-500 font-mono">
                        +{fw.features.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-[#232733] flex items-center justify-between">
                <button
                  onClick={() => setSelectedFirmware(fw)}
                  className="text-xs text-slate-400 hover:text-slate-200 font-mono flex items-center gap-1 transition"
                >
                  <Info className="w-3.5 h-3.5" />
                  <span>Inspect</span>
                </button>

                <button
                  onClick={() => handleDownloadAndFlash(fw)}
                  className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs font-mono shadow-md shadow-amber-500/10 flex items-center gap-1.5 transition active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Load Preset</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Firmware Detail & Inspection Modal */}
      {selectedFirmware && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl overflow-y-auto max-h-[85vh]">
            <div className="flex items-start justify-between border-b border-[#232733] pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>{selectedFirmware.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-normal">
                    {selectedFirmware.device}
                  </span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">{selectedFirmware.version || 'Latest'}</span>
              </div>
              <button
                onClick={() => setSelectedFirmware(null)}
                className="text-slate-400 hover:text-slate-100 p-1 font-mono text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p className="leading-relaxed text-slate-300 bg-[#1e212b] p-3 rounded-xl border border-[#2b303c]">
                {selectedFirmware.description}
              </p>

              {selectedFirmware.note && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1">
                  <span className="font-bold text-amber-300 font-mono flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Hardware & Flashing Notes:
                  </span>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed font-mono">
                    {selectedFirmware.note}
                  </p>
                </div>
              )}

              {selectedFirmware.features && (
                <div className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-slate-400 font-mono">Key Features:</span>
                  <ul className="space-y-1 font-mono text-[11px] text-slate-300 pl-2">
                    {selectedFirmware.features.map((feat, fIdx) => (
                      <li key={fIdx} className="flex items-start gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Partition layout breakdown */}
              <div className="space-y-1.5 pt-2">
                <span className="text-[11px] uppercase font-bold text-slate-400 font-mono">Partition Addresses:</span>
                <div className="bg-[#12141a] rounded-xl p-2.5 border border-[#232733] font-mono text-[11px] space-y-1">
                  {(selectedFirmware.files || [{ name: `${selectedFirmware.name}.bin`, address: '0x0' }]).map((f, fIdx) => (
                    <div key={fIdx} className="flex items-center justify-between text-slate-300">
                      <span className="text-amber-400">{f.address || '0x0'}</span>
                      <span className="truncate max-w-[280px]">{f.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#232733]">
              <button
                onClick={() => setSelectedFirmware(null)}
                className="px-4 py-2 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs font-mono transition"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const fw = selectedFirmware;
                  setSelectedFirmware(null);
                  handleDownloadAndFlash(fw);
                }}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs font-mono transition shadow-lg shadow-amber-500/20 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Load into Flasher Slots</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
