// One tool window: lean application window title bar (drag, double-click to maximize),
// sleek window controls (traffic lights or modern native), content zoom (−/+, fit-to-width, Ctrl+wheel),
// window instance duplicating, eight resize handles, and a scrolling body. The window stays mounted while
// minimized so device connections survive.
//
// Zoom is CSS `zoom` on the tool's wrapper, so the tool lays out at a larger
// or smaller size inside the window while the browser viewport is untouched.
// The wrapper is also a container-query root (`@container`), so tools that use
// `@md:` / `@lg:` breakpoints respond to the window width, not the screen.
import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  Minus, Square, Copy, X, ZoomIn, ZoomOut, CopyPlus,
  MoreHorizontal, RotateCcw, Check, BookOpen
} from 'lucide-react';
import { TITLE_BAR_H, MIN_W, MIN_H, fitZoomFor, displayTitle, instanceOf } from '../../utils/windowManager';

const ACCENT = {
  cyan: 'border-cyan-500/50 shadow-2xl shadow-black/80 ring-1 ring-cyan-500/30',
  amber: 'border-amber-500/50 shadow-2xl shadow-black/80 ring-1 ring-amber-500/30',
  emerald: 'border-emerald-500/50 shadow-2xl shadow-black/80 ring-1 ring-emerald-500/30',
  purple: 'border-purple-500/50 shadow-2xl shadow-black/80 ring-1 ring-purple-500/30',
  rose: 'border-rose-500/50 shadow-2xl shadow-black/80 ring-1 ring-rose-500/30'
};
const ACCENT_TEXT = {
  cyan: 'text-cyan-400',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
  purple: 'text-purple-400',
  rose: 'text-rose-400'
};

// Resize handles: which edges each one moves.
const HANDLES = [
  { k: 'n', cls: 'top-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { k: 's', cls: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { k: 'e', cls: 'right-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { k: 'w', cls: 'left-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { k: 'ne', cls: 'top-0 right-0 w-3 h-3 cursor-nesw-resize' },
  { k: 'nw', cls: 'top-0 left-0 w-3 h-3 cursor-nwse-resize' },
  { k: 'se', cls: 'bottom-0 right-0 w-3 h-3 cursor-nwse-resize' },
  { k: 'sw', cls: 'bottom-0 left-0 w-3 h-3 cursor-nesw-resize' }
];

export default function ToolWindow({
  win, focused, forceMaximized = false, icon: Icon = null, naturalWidth = 1100, children,
  onFocus, onMove, onResize, onMinimize, onToggleMaximize, onClose, onZoomStep, onToggleFit, onDuplicate, onResetZoom, onDragMove, onDragEnd
}) {
  const dragRef = useRef(null);
  const sectionRef = useRef(null);
  const bodyRef = useRef(null);
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);
  const maximized = win.maximized || forceMaximized;

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Window control style: 'traffic-lights' (macOS application style) or 'native-windows'
  const [controlStyle, setControlStyle] = useState(() => {
    try {
      return localStorage.getItem('skon_window_control_style') || 'traffic-lights';
    } catch (e) {
      return 'traffic-lights';
    }
  });

  const setGlobalControlStyle = (style) => {
    setControlStyle(style);
    try {
      localStorage.setItem('skon_window_control_style', style);
      window.dispatchEvent(new CustomEvent('skon_control_style_changed', { detail: style }));
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    const handler = (e) => { if (e.detail) setControlStyle(e.detail); };
    window.addEventListener('skon_control_style_changed', handler);
    return () => window.removeEventListener('skon_control_style_changed', handler);
  }, []);

  // Close options menu on outside click or Escape
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !menuBtnRef.current?.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    window.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  // Fit-to-width: measure the body and scale the tool's natural width into it.
  const [fitZoom, setFitZoom] = useState(1);
  useEffect(() => {
    const el = bodyRef.current;
    if (!win.fit || !el) return undefined;
    const measure = () => setFitZoom(fitZoomFor(el.clientWidth, naturalWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [win.fit, naturalWidth, win.w, win.maximized]);
  const zoom = win.fit ? fitZoom : (win.zoom ?? 1);

  // Ctrl+wheel over the window zooms the tool, not the page (native listener)
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoomStep?.(win.id, e.deltaY < 0 ? 1 : -1, zoomRef.current);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [win.id, onZoomStep]);

  const startDrag = useCallback((e) => {
    if (maximized || e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    onFocus?.(win.id);
    dragRef.current = { kind: 'move', sx: e.clientX, sy: e.clientY, x: win.x, y: win.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [maximized, onFocus, win.id, win.x, win.y]);

  const startResize = (k) => (e) => {
    if (maximized || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    onFocus?.(win.id);
    dragRef.current = { kind: k, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.kind === 'move') { onMove?.(win.id, d.x + dx, d.y + dy); onDragMove?.(win.id, e.clientX, e.clientY); return; }
    let { x, y, w, h } = d;
    if (d.kind.includes('e')) w = Math.max(MIN_W, d.w + dx);
    if (d.kind.includes('s')) h = Math.max(MIN_H, d.h + dy);
    if (d.kind.includes('w')) { w = Math.max(MIN_W, d.w - dx); x = d.x + (d.w - w); }
    if (d.kind.includes('n')) { h = Math.max(MIN_H, d.h - dy); y = d.y + (d.h - h); }
    onResize?.(win.id, { x, y, w, h });
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) { /* not captured */ }
    if (d.kind === 'move') onDragEnd?.(win.id);
  };

  const style = maximized
    ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };
  const pct = Math.round(zoom * 100);
  const instNum = win.instance || instanceOf(win.id);

  return (
    <section
      ref={sectionRef}
      data-window={win.id}
      role="dialog" aria-label={win.title}
      onPointerDownCapture={() => onFocus?.(win.id)}
      className={`absolute flex flex-col bg-cyber-dark border rounded-xl font-mono transition-shadow duration-150 ${
        focused ? ACCENT[win.accent] || ACCENT.cyan : 'border-slate-800 shadow-xl shadow-black/60'
      } ${win.minimized ? 'hidden' : ''} ${maximized ? 'rounded-none' : ''}`}
      style={style}
    >
      {/* Lean Application Title Bar */}
      <header
        onPointerDown={startDrag} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={() => onToggleMaximize?.(win.id)}
        style={{ height: TITLE_BAR_H }}
        className={`shrink-0 flex items-center justify-between px-3 border-b select-none touch-none backdrop-blur-md transition-colors relative ${
          focused
            ? 'bg-slate-900/95 border-slate-700/80 text-slate-100'
            : 'bg-slate-950/90 border-slate-800/80 text-slate-400'
        } ${maximized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {/* Left Section: macOS Traffic Lights or Tool Icon & Title */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
          {controlStyle === 'traffic-lights' && (
            <div
              className="flex items-center gap-2 group/lights shrink-0 py-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Close */}
              <button
                type="button"
                onClick={() => onClose?.(win.id)}
                title="Close window"
                className={`w-3 h-3 rounded-full flex items-center justify-center transition-all ${
                  focused ? 'bg-[#ff5f56] border border-[#e0443e]/70' : 'bg-slate-700/80 hover:bg-[#ff5f56]'
                } hover:brightness-110 active:brightness-95`}
              >
                <X className="w-2 h-2 text-[#4c0000] opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
              </button>

              {/* Minimize */}
              <button
                type="button"
                onClick={() => onMinimize?.(win.id)}
                title="Minimize window"
                className={`w-3 h-3 rounded-full flex items-center justify-center transition-all ${
                  focused ? 'bg-[#ffbd2e] border border-[#dea123]/70' : 'bg-slate-700/80 hover:bg-[#ffbd2e]'
                } hover:brightness-110 active:brightness-95`}
              >
                <Minus className="w-2 h-2 text-[#5c4000] opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
              </button>

              {/* Maximize / Restore */}
              {!forceMaximized && (
                <button
                  type="button"
                  onClick={() => onToggleMaximize?.(win.id)}
                  title={win.maximized ? 'Restore window size' : 'Maximize window'}
                  className={`w-3 h-3 rounded-full flex items-center justify-center transition-all ${
                    focused ? 'bg-[#27c93f] border border-[#1aab29]/70' : 'bg-slate-700/80 hover:bg-[#27c93f]'
                  } hover:brightness-110 active:brightness-95`}
                >
                  {win.maximized ? (
                    <Minus className="w-2 h-2 text-[#004d10] opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5] rotate-45" />
                  ) : (
                    <Square className="w-1.5 h-1.5 text-[#004d10] opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
                  )}
                </button>
              )}
            </div>
          )}

          {/* Application Identity: Icon, Title, and Instance Pill */}
          <div className="flex items-center gap-2 min-w-0 truncate">
            {Icon && (
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  focused ? ACCENT_TEXT[win.accent] || ACCENT_TEXT.cyan : 'text-slate-500'
                }`}
              />
            )}
            <span className={`text-xs font-semibold tracking-wide truncate ${focused ? 'text-slate-200' : 'text-slate-400'}`}>
              {win.title}
            </span>
            {instNum > 1 && (
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 tabular-nums">
                #{instNum}
              </span>
            )}
          </div>
        </div>

        {/* Right Section: Lean Utility Controls & Windows Native Controls */}
        <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          {/* Quick Zoom Indicator / Fit Pill */}
          <div data-zoom-controls className="flex items-center">
            {(win.fit || zoom !== 1) ? (
              <button
                type="button"
                onClick={() => onToggleFit?.(win.id)}
                data-zoom-pct
                title={win.fit ? 'Fit to width active. Click for manual zoom.' : `Tool zoom: ${pct}%. Click to fit to window.`}
                style={{ backgroundColor: '#082f49' }}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums border transition-all border-cyan-500/50 text-cyan-300 hover:brightness-125 hover:border-cyan-400"
              >
                {win.fit ? `FIT ${pct}%` : `${pct}%`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggleFit?.(win.id)}
                data-zoom-pct
                title="Fit tool to window width (or Ctrl+wheel to zoom)"
                className="opacity-0 hover:opacity-100 focus:opacity-100 px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-white hover:bg-slate-800 transition-opacity tabular-nums"
              >
                100%
              </button>
            )}
          </div>

          {/* Quick Wiki Link for this Tool */}
          <a
            href={`./wiki/?tool=${win.toolId}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open Wiki Manual for ${win.title}`}
            className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <BookOpen className="w-3.5 h-3.5" />
          </a>

          {/* Window Options Menu Trigger (...) */}
          <div className="relative">
            <button
              ref={menuBtnRef}
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="Window options & zoom"
              aria-label="Window options"
              className={`p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors ${
                isMenuOpen ? 'bg-slate-800 text-white' : ''
              }`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {/* Window Options Popover (100% SOLID OPAQUE DARK SLATE) */}
            {isMenuOpen && (
              <div
                ref={menuRef}
                data-no-drag
                style={{ backgroundColor: '#0a0f1d' }}
                className="absolute right-0 top-full mt-2 z-[99999] w-72 rounded-xl border border-slate-700 shadow-[0_20px_60px_rgba(0,0,0,0.95)] p-3 text-xs font-mono text-slate-100 animate-in fade-in zoom-in-95 duration-100"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[11px] font-bold tracking-wider text-slate-200">
                  <span>WINDOW OPTIONS</span>
                  <button
                    type="button"
                    onClick={() => setIsMenuOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Close menu"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Zoom Controls */}
                <div className="py-2.5 space-y-2 border-b border-slate-800">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-300">CONTENT ZOOM</span>
                    <span
                      className="text-cyan-300 font-bold tabular-nums px-2 py-0.5 rounded border border-slate-700"
                      style={{ backgroundColor: '#131c31' }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onZoomStep?.(win.id, -1, zoom)}
                      style={{ backgroundColor: '#162238' }}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded hover:brightness-125 text-slate-100 font-semibold border border-slate-700 transition-all text-xs"
                      title="Zoom out"
                    >
                      <ZoomOut className="w-3.5 h-3.5 text-slate-300" />
                      <span>Zoom -</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onZoomStep?.(win.id, 1, zoom)}
                      style={{ backgroundColor: '#162238' }}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded hover:brightness-125 text-slate-100 font-semibold border border-slate-700 transition-all text-xs"
                      title="Zoom in"
                    >
                      <ZoomIn className="w-3.5 h-3.5 text-slate-300" />
                      <span>Zoom +</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => { onToggleFit?.(win.id); setIsMenuOpen(false); }}
                      style={win.fit ? { backgroundColor: '#082f49' } : { backgroundColor: '#162238' }}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[11px] font-semibold border transition-all ${
                        win.fit
                          ? 'border-cyan-400 text-cyan-200'
                          : 'border-slate-700 text-slate-200 hover:brightness-125'
                      }`}
                    >
                      {win.fit && <Check className="w-3.5 h-3.5 text-cyan-300" />}
                      <span>Fit to Width</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { onResetZoom ? onResetZoom(win.id) : onZoomStep?.(win.id, 0, 1); setIsMenuOpen(false); }}
                      style={{ backgroundColor: '#162238' }}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded hover:brightness-125 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold transition-all"
                      title="Reset zoom to 100%"
                    >
                      <RotateCcw className="w-3 h-3 text-slate-400" />
                      <span>Reset 100%</span>
                    </button>
                  </div>
                </div>

                {/* Instance Duplication */}
                {onDuplicate && (
                  <div className="py-2.5 border-b border-slate-800">
                    <button
                      type="button"
                      onClick={() => { onDuplicate(win.id); setIsMenuOpen(false); }}
                      style={{ backgroundColor: '#131c31' }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:brightness-125 border border-slate-700 text-left transition-all group"
                    >
                      <div
                        className="p-1.5 rounded border border-cyan-500/40 text-cyan-300 group-hover:border-cyan-400 shrink-0"
                        style={{ backgroundColor: '#082f49' }}
                      >
                        <CopyPlus className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-100 text-xs">Duplicate Window</div>
                        <div className="text-[10px] text-slate-400 truncate">Run another board concurrently</div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Window Control Style Switcher */}
                <div className="py-2.5 border-b border-slate-800 space-y-1.5">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">WINDOW CONTROLS STYLE</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setGlobalControlStyle('traffic-lights')}
                      style={controlStyle === 'traffic-lights' ? { backgroundColor: '#082f49' } : { backgroundColor: '#162238' }}
                      className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded text-[11px] font-semibold border transition-all ${
                        controlStyle === 'traffic-lights'
                          ? 'border-cyan-400 text-cyan-200'
                          : 'border-slate-700 text-slate-300 hover:brightness-125'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 border border-rose-600 inline-block shrink-0" />
                      <span>macOS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGlobalControlStyle('native-windows')}
                      style={controlStyle === 'native-windows' ? { backgroundColor: '#082f49' } : { backgroundColor: '#162238' }}
                      className={`flex items-center justify-center gap-2 py-1.5 px-2 rounded text-[11px] font-semibold border transition-all ${
                        controlStyle === 'native-windows'
                          ? 'border-cyan-400 text-cyan-200'
                          : 'border-slate-700 text-slate-300 hover:brightness-125'
                      }`}
                    >
                      <Square className="w-3 h-3 text-slate-300 inline-block shrink-0" />
                      <span>Windows</span>
                    </button>
                  </div>
                </div>

                {/* Knowledge Base Wiki Link */}
                <div className="py-2.5 border-b border-slate-800">
                  <a
                    href={`./wiki/?tool=${win.toolId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsMenuOpen(false)}
                    style={{ backgroundColor: '#131c31' }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:brightness-125 border border-indigo-500/40 text-left transition-all group"
                  >
                    <div
                      className="p-1.5 rounded border border-indigo-500/40 text-indigo-300 group-hover:border-indigo-400 shrink-0"
                      style={{ backgroundColor: '#1e1b4b' }}
                    >
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-100 text-xs">Knowledge Base Manual</div>
                      <div className="text-[10px] text-slate-400 truncate">Read wiki documentation for {win.title}</div>
                    </div>
                  </a>
                </div>

                {/* Pro-Tips / Hotkeys */}
                <div className="pt-2 text-[10px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400 font-bold">•</span>
                    <span><strong className="text-slate-200">Ctrl + Wheel</strong> zooms tool content</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400 font-bold">•</span>
                    <span><strong className="text-slate-200">Double-click</strong> header maximizes</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400 font-bold">•</span>
                    <span><strong className="text-slate-200">Drag to edges</strong> snaps & tiles</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Native Windows Controls (when controlStyle === 'native-windows') */}
          {controlStyle === 'native-windows' && (
            <div className="flex items-center pl-1 border-l border-slate-800 ml-0.5">
              <button
                type="button"
                onClick={() => onMinimize?.(win.id)}
                title="Minimize window"
                className="p-1 px-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              {!forceMaximized && (
                <button
                  type="button"
                  onClick={() => onToggleMaximize?.(win.id)}
                  title={win.maximized ? 'Restore window size' : 'Maximize window'}
                  className="p-1 px-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {win.maximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => onClose?.(win.id)}
                title="Close window"
                className="p-1 px-1.5 rounded text-slate-400 hover:text-white hover:bg-rose-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Body: the tool scrolls inside its window. The inner wrapper carries the
          zoom and is the container-query root for the tool's @md:/@lg: classes. */}
      <div ref={bodyRef} className="flex-1 min-h-0 min-w-0 overflow-auto scrollbar-thin scrollbar-thumb-slate-800 bg-cyber-darkest">
        <div data-tool-zoom={pct} className="@container h-full p-3" style={zoom !== 1 ? { zoom } : undefined}>
          {children}
        </div>
      </div>

      {/* Resize handles */}
      {!maximized && HANDLES.map((h) => (
        <div key={h.k} data-resize={h.k} onPointerDown={startResize(h.k)} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          className={`absolute touch-none ${h.cls}`} />
      ))}
    </section>
  );
}
