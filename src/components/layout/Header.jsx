import React, { useState, useEffect } from 'react';
import { 
  Unplug, 
  Sliders, 
  Activity, 
  Zap, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle, 
  Cpu, 
  RefreshCw,
  Search,
  Download,
  Smartphone,
  Bluetooth,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { identifyUsbChip } from '../../utils/usbDatabase';
import { APP_THEMES, applyAppTheme, loadAppThemeId, saveAppThemeId, themeSwatch } from '../../utils/appThemes';
import SerialControls from './SerialControls';
import skonLogo from '../../assets/skon-logo.svg';

export default function Header({
  activeTool = 'flasher',
  activePreset,
  onSelectPreset,
  isDrawerOpen,
  onToggleDrawer,
  onOpenCommandPalette,
  onOpenHardwareIntel,
  onOpenPinouts
}) {
  const { isConnected, portInfo, entries } = useSerial();
  const latestEntry = entries?.[entries.length - 1];

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [appTheme, setAppTheme] = useState(() => loadAppThemeId());

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const chipMetadata = identifyUsbChip(
    portInfo?.usbVendorId, 
    portInfo?.usbProductId
  );

  return (
    <header className="border-b border-cyber-border bg-[#070c18]/95 backdrop-blur-md sticky top-0 z-40 px-3 sm:px-4 py-2 shadow-xl font-mono">
      <div className="w-full flex flex-wrap items-center justify-between gap-2.5">
        {/* Brand & System Title */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-amber-500/10 border border-cyan-500/40 shadow-cyan-glow flex-shrink-0">
            <img src={skonLogo} alt="Skon" className="w-7 h-auto sm:w-8 select-none" draggable="false" />
            <span className="absolute -bottom-1 -right-1 flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-slate-600'}`}></span>
            </span>
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xs sm:text-sm font-bold tracking-wider text-slate-100 flex items-center gap-1">
                <span>SKON'S</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-amber-300 to-amber-500">
                  USB TOOL
                </span>
              </h1>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700/60 text-cyan-400 font-mono hidden md:inline">
                v2.0
              </span>
            </div>
            {chipMetadata.name !== 'Generic / Unknown UART Bridge' && isConnected && (
              <div className="text-[10px] text-cyan-400 truncate max-w-48 hidden lg:block">
                {chipMetadata.name}
              </div>
            )}
          </div>
        </div>

        {/* Serial: drawer toggle, connection controls and the latest line (the drawer drops down below the header) */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 justify-center order-last w-full lg:order-none lg:w-auto">
          {onToggleDrawer && (
            <button
              onClick={onToggleDrawer}
              aria-expanded={!!isDrawerOpen}
              title={isDrawerOpen ? 'Hide the serial terminal drawer (Ctrl+J)' : 'Show the serial terminal drawer (Ctrl+J)'}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-bold transition-all shrink-0 ${
                isDrawerOpen
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-cyan-glow'
                  : 'bg-slate-900 text-cyan-400 hover:text-cyan-300 border-slate-800'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">SERIAL</span>
              {isDrawerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          <SerialControls />
          {!isDrawerOpen && latestEntry && (
            <div className="hidden 2xl:flex items-center gap-2 text-[11px] text-slate-400 truncate min-w-0 max-w-md">
              <span className="text-slate-600 text-[10px] shrink-0">{latestEntry.timestamp}</span>
              <span className={`truncate ${latestEntry.type === 'rx' ? 'text-cyan-300' : latestEntry.type === 'tx' ? 'text-amber-400' : 'text-slate-400'}`}>
                {latestEntry.text}
              </span>
            </div>
          )}
        </div>

        {/* Utility controls */}
        <div className="flex items-center gap-2">

          {/* App colour theme: just the palette swatch; the native select sits invisibly on top so a click opens the list */}
          <label
            className="relative flex items-center justify-center p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 cursor-pointer"
            title={`App colour theme: ${APP_THEMES.find((t) => t.id === appTheme)?.name || appTheme}`}
          >
            <span className="flex rounded-sm overflow-hidden border border-slate-700 w-6 h-3.5 shrink-0 pointer-events-none">
              {themeSwatch(appTheme).map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
            </span>
            <select
              aria-label="App colour theme"
              value={appTheme}
              onChange={(e) => { setAppTheme(e.target.value); applyAppTheme(e.target.value); saveAppThemeId(e.target.value); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {APP_THEMES.map((t) => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">{t.name}</option>
              ))}
            </select>
          </label>

          {/* Command Palette Trigger */}
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              title="Command Palette (Ctrl+K)"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 text-xs transition-colors hidden sm:block"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}

          {deferredPrompt && (
            <button
              onClick={handleInstallPwa}
              title="Install Web App"
              className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs animate-pulse"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
