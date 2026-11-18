// Controls that used to sit in the top header and now live in the desktop taskbar:
// the serial drawer toggle + connection controls, and the tray (theme, search, install).
import React, { useState, useEffect } from 'react';
import { Terminal, Search, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { APP_THEMES, applyAppTheme, loadAppThemeId, saveAppThemeId, themeSwatch } from '../../utils/appThemes';
import SerialControls from './SerialControls';

/** SERIAL drawer toggle followed by the connection controls (baud, RX/TX, status, connect, BLE). */
export function TaskbarSerial({ isDrawerOpen, onToggleDrawer }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {onToggleDrawer && (
        <button
          type="button"
          onClick={onToggleDrawer}
          aria-expanded={!!isDrawerOpen}
          title={isDrawerOpen ? 'Hide the serial terminal drawer (Ctrl+J)' : 'Show the serial terminal drawer (Ctrl+J)'}
          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-bold transition-all shrink-0 ${
            isDrawerOpen
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-cyan-glow'
              : 'bg-slate-900 text-cyan-400 hover:text-cyan-300 border-slate-800'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">SERIAL</span>
          {isDrawerOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      )}
      <SerialControls />
    </div>
  );
}

/** App colour theme, command palette and (when offered) the PWA install button. */
export function TaskbarTray({ onOpenCommandPalette }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [appTheme, setAppTheme] = useState(() => loadAppThemeId());

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Theme: just the palette swatch; the native select sits invisibly on top so a click opens the list */}
      <label
        className="relative flex items-center justify-center p-1.5 rounded hover:bg-slate-800 cursor-pointer"
        title={`App colour theme: ${APP_THEMES.find((t) => t.id === appTheme)?.name || appTheme}`}
      >
        <span className="flex rounded-sm overflow-hidden border border-slate-700 w-5 h-3 shrink-0 pointer-events-none">
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

      {onOpenCommandPalette && (
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Command Palette (Ctrl+K)"
          className="p-1.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}

      {deferredPrompt && (
        <button
          type="button"
          onClick={handleInstallPwa}
          title="Install Web App"
          className="p-1.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
