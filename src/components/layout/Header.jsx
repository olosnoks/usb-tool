import React, { useState, useEffect } from 'react';
import { 
  Usb, 
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
  BookOpen,
  Download,
  Smartphone,
  PanelBottom,
  Bluetooth
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { identifyUsbChip } from '../../utils/usbDatabase';
import { APP_THEMES, applyAppTheme, loadAppThemeId, saveAppThemeId, themeSwatch } from '../../utils/appThemes';
import { toolMeta } from '../ToolRegistry';

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
  const { isConnected, portInfo } = useSerial();

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
            <Usb className="w-4 h-4 text-cyan-400" />
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

        {/* Utility controls (serial connection controls now live in the terminal drawer) */}
        <div className="flex items-center gap-2">
          {/* Terminal Drawer Toggle Button */}
          {onToggleDrawer && (
            <button
              onClick={onToggleDrawer}
              title={isDrawerOpen ? "Hide Live Terminal Drawer" : "Show Live Terminal Drawer"}
              className={`p-1.5 rounded-lg border text-xs transition-all ${
                isDrawerOpen 
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-cyan-glow' 
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800'
              }`}
            >
              <PanelBottom className="w-3.5 h-3.5" />
            </button>
          )}

          {/* App colour theme (VS Code palettes + Dracula) */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-800 pl-2 pr-0.5" title="App colour theme">
            <span className="flex rounded-sm overflow-hidden border border-slate-700 w-6 h-3.5 shrink-0">
              {themeSwatch(appTheme).map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
            </span>
            <select
              value={appTheme}
              onChange={(e) => { setAppTheme(e.target.value); applyAppTheme(e.target.value); saveAppThemeId(e.target.value); }}
              className="bg-transparent text-xs font-mono text-slate-300 px-1 py-1.5 outline-none cursor-pointer max-w-[6.5rem] md:max-w-[10rem]"
            >
              {APP_THEMES.map((t) => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">{t.name}</option>
              ))}
            </select>
          </div>

          {/* Standalone Wiki Link (Deep-linked to current active tool or Workspace) */}
          <a
            href={activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace'}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open Wiki Documentation for ${activeTool ? toolMeta(activeTool).title : 'Workspace'}`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-bold font-mono transition-all active:scale-95 shadow-sm shadow-indigo-500/10"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">WIKI</span>
            <span className="text-[10px] text-indigo-200/80 max-w-[8rem] truncate hidden xl:inline">
              {`(${activeTool ? toolMeta(activeTool).title : 'Workspace'})`}
            </span>
          </a>

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
