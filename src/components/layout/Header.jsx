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
  PanelBottom
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { identifyUsbChip } from '../../utils/usbDatabase';
import StatusBadge from '../common/StatusBadge';

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
  const {
    isConnected,
    isConnecting,
    portInfo,
    baudRate,
    setBaudRate,
    connect,
    disconnect,
    rxActivity,
    txActivity,
    transportType,
    hasWebSerialSupport,
    hasWebUsbSupport,
    boards,
    activeBoardId,
    setActiveBoardId
  } = useSerial();

  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const standardBauds = [
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 
    230400, 460800, 921600, 1000000, 1500000, 2000000
  ];

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

        {/* Port, Baud & Connection Controls */}
        <div className="flex items-center gap-2">
          {/* Multi-Board Selector */}
          {boards.length > 1 && (
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <select
                value={activeBoardId}
                onChange={(e) => setActiveBoardId(e.target.value)}
                className="bg-transparent text-cyan-300 text-xs font-bold outline-none cursor-pointer"
              >
                {boards.map(b => (
                  <option key={b.id} value={b.id} className="bg-slate-900 text-slate-200">
                    {b.name} {b.isConnected ? '●' : '○'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Active Baud Rate Selector */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs">
            <span className="text-slate-500 text-[10px] font-bold mr-1 hidden sm:inline">BAUD:</span>
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              disabled={isConnected}
              className={`bg-transparent outline-none font-bold text-xs cursor-pointer ${
                isConnected ? 'text-amber-400 cursor-not-allowed' : 'text-slate-200 hover:text-cyan-300'
              }`}
              title={isConnected ? "Disconnect to change baud rate or use Baud Hunter" : "Select port communication baud rate"}
            >
              {standardBauds.map((b) => (
                <option key={b} value={b} className="bg-slate-900 text-slate-200">
                  {b} bps {b === 115200 ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Live RX/TX activity */}
          <div className="hidden sm:flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${rxActivity ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-slate-800'}`} />
            <span className={rxActivity ? 'text-cyan-400 font-bold' : 'text-slate-500'}>RX</span>
            <span className="text-slate-700">|</span>
            <span className={`w-1.5 h-1.5 rounded-full ${txActivity ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' : 'bg-slate-800'}`} />
            <span className={txActivity ? 'text-amber-400 font-bold' : 'text-slate-500'}>TX</span>
          </div>

          {/* Status Badge */}
          <StatusBadge
            status={isConnected ? 'online' : isConnecting ? 'connecting' : 'offline'}
            value={isConnected ? 'ONLINE' : isConnecting ? 'CONNECTING...' : 'OFFLINE'}
            size="sm"
            pulse={isConnecting}
          />

          {/* Connect / Disconnect Button */}
          {!isConnected ? (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
              <span>{isConnecting ? '...' : 'CONNECT'}</span>
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 hover:border-rose-400 text-xs font-bold transition-all active:scale-95"
            >
              <Unplug className="w-3.5 h-3.5" />
              <span>DISCONNECT</span>
            </button>
          )}

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

          {/* Standalone Wiki Link (Deep-linked to current active tool) */}
          <a
            href={`./wiki/?tool=${activeTool || 'flasher'}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open Wiki Documentation for ${activeTool}`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-bold font-mono transition-all active:scale-95 shadow-sm shadow-indigo-500/10"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">WIKI</span>
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
