// The workspace desktop: hosts every open tool window, measures its own size
// so windows stay reachable, and shows a taskbar with one button per window
// (click to focus or restore) plus tile / cascade / close-all.
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { LayoutGrid, Layers, X, AppWindow } from 'lucide-react';
import ToolWindow from './ToolWindow';
import CircuitBoardBackground from './CircuitBoardBackground';
import { displayTitle, snapZoneFor, snapGeometry } from '../../utils/windowManager';

// Below this width (phones, narrow split screens) every window fills the desktop.
export const FORCE_MAXIMIZE_BELOW_PX = 768;

export default function Desktop({
  state, viewport, onViewport, renderTool, metaFor,
  onFocus, onMove, onResize, onMinimize, onToggleMaximize, onClose, onTile, onCascade, onCloseAll,
  onZoomStep, onToggleFit, onDuplicate, onSnap, onResetZoom
}) {
  const ref = useRef(null);
  const rectRef = useRef({ left: 0, top: 0 });
  const [snapZone, setSnapZone] = useState(null);   // live snap preview while dragging

  // Measure the desktop (ResizeObserver where available, window resize otherwise).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      onViewport?.({ width: el.clientWidth, height: el.clientHeight });
      const r = el.getBoundingClientRect();
      rectRef.current = { left: r.left, top: r.top };
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      window.addEventListener('scroll', measure, true);
      return () => { ro.disconnect(); window.removeEventListener('scroll', measure, true); };
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [onViewport]);

  // While a window's title bar is dragged, show where it would tile.
  const onDragMove = useCallback((id, clientX, clientY) => {
    const px = clientX - rectRef.current.left, py = clientY - rectRef.current.top;
    setSnapZone(snapZoneFor(px, py, viewport));
  }, [viewport]);
  const onDragEnd = useCallback((id) => {
    setSnapZone((z) => { if (z) onSnap?.(id, z); return null; });
  }, [onSnap]);

  const forceMax = (viewport?.width || 0) > 0 && viewport.width < FORCE_MAXIMIZE_BELOW_PX;
  // Render in insertion order and stack with z-index. Re-sorting by z would move
  // DOM nodes between pointerdown and click when a background window is focused,
  // and the browser then drops the click (its title-bar buttons stop working).
  const windows = state.windows;
  const anyOpen = windows.some((w) => !w.minimized);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div ref={ref} data-testid="desktop" className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <CircuitBoardBackground />
        {!anyOpen && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-500 font-mono text-xs space-y-2 pointer-events-none px-6">
            <AppWindow className="w-8 h-8 text-slate-700" />
            <div className="text-slate-400 font-bold tracking-wide">{state.windows.length ? 'ALL WINDOWS MINIMIZED' : 'WORKSPACE EMPTY'}</div>
            <div>
              {state.windows.length
                ? 'Click a window in the taskbar below to bring it back.'
                : 'Pick a tool from the sidebar. Open several at once, each in its own window, to watch different devices side by side.'}
            </div>
          </div>
        )}
        {/* Snap-tiling preview: where the dragged window would land */}
        {snapZone && (() => {
          const g = snapGeometry(snapZone, viewport);
          if (!g) return null;
          return <div data-testid="snap-preview" className="absolute z-[9999] pointer-events-none rounded-lg border-2 border-cyan-400/70 bg-cyan-400/10 transition-all duration-75"
            style={{ left: g.x, top: g.y, width: g.w, height: g.h }} />;
        })()}
        {windows.map((win) => (
          <ToolWindow
            key={win.id} win={win} focused={state.focusedId === win.id} forceMaximized={forceMax}
            icon={metaFor?.(win.toolId)?.icon} naturalWidth={metaFor?.(win.toolId)?.naturalWidth}
            onFocus={onFocus} onMove={onMove} onResize={onResize} onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} onClose={onClose}
            onZoomStep={onZoomStep} onToggleFit={onToggleFit} onResetZoom={onResetZoom} onDuplicate={onDuplicate}
            onDragMove={onDragMove} onDragEnd={onDragEnd}
          >
            <React.Suspense fallback={
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 font-mono text-xs space-y-3">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-cyan-300 tracking-wider">LOADING WORKBENCH MODULE...</span>
              </div>
            }>
              {renderTool(win.toolId)}
            </React.Suspense>
          </ToolWindow>
        ))}
      </div>

      {/* Taskbar */}
      {state.windows.length > 0 && (
        <div data-testid="taskbar" className="shrink-0 h-9 border-t border-slate-800 bg-slate-950/90 backdrop-blur flex items-center gap-1 px-2 font-mono text-[11px] overflow-x-auto">
          {[...state.windows].sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)).map((w) => {
            const Icon = metaFor?.(w.toolId)?.icon;
            const active = state.focusedId === w.id && !w.minimized;
            return (
              <button key={w.id} onClick={() => onFocus?.(w.id)} title={w.minimized ? `Restore ${displayTitle(w)}` : `Focus ${displayTitle(w)}`}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border max-w-[14rem] truncate ${
                  active ? 'bg-slate-800 border-slate-600 text-white' : w.minimized ? 'bg-transparent border-slate-800 text-slate-500 italic' : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}>
                {Icon && <Icon className="w-3 h-3 shrink-0" />}
                <span className="truncate">{displayTitle(w)}</span>
              </button>
            );
          })}
          <span className="flex-1" />
          <button onClick={onTile} disabled={!anyOpen} title="Tile the open windows in a grid" className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button onClick={onCascade} disabled={!anyOpen} title="Cascade the open windows" className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"><Layers className="w-3.5 h-3.5" /></button>
          <button onClick={onCloseAll} title="Close every window" className="p-1.5 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}
