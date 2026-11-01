// One tool window: title bar (drag, double-click to maximize), content zoom
// (−/+, fit-to-width, Ctrl+wheel), minimize / maximize / close buttons, eight
// resize handles, and a scrolling body. The window stays mounted while
// minimized so device connections survive.
//
// Zoom is CSS `zoom` on the tool's wrapper, so the tool lays out at a larger
// or smaller size inside the window while the browser viewport is untouched.
// The wrapper is also a container-query root (`@container`), so tools that use
// `@md:` / `@lg:` breakpoints respond to the window width, not the screen.
import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Minus, Square, Copy, X, ZoomIn, ZoomOut, CopyPlus } from 'lucide-react';
import { TITLE_BAR_H, MIN_W, MIN_H, fitZoomFor, displayTitle } from '../../utils/windowManager';

const ACCENT = {
  cyan: 'border-cyan-500/60 shadow-cyan-glow', amber: 'border-amber-500/60 shadow-amber-glow',
  emerald: 'border-emerald-500/60 shadow-emerald-glow', purple: 'border-purple-500/60',
  rose: 'border-rose-500/60 shadow-rose-glow'
};
const ACCENT_TEXT = { cyan: 'text-cyan-300', amber: 'text-amber-300', emerald: 'text-emerald-300', purple: 'text-purple-300', rose: 'text-rose-300' };

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

const iconBtn = 'p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800';

export default function ToolWindow({
  win, focused, forceMaximized = false, icon: Icon = null, naturalWidth = 1100, children,
  onFocus, onMove, onResize, onMinimize, onToggleMaximize, onClose, onZoomStep, onToggleFit, onDuplicate, onDragMove, onDragEnd
}) {
  const dragRef = useRef(null);
  const sectionRef = useRef(null);
  const bodyRef = useRef(null);
  const maximized = win.maximized || forceMaximized;

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

  // Ctrl+wheel over the window zooms the tool, not the page (native listener:
  // React's wheel handlers are passive, so they cannot preventDefault).
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
    if (e.target.closest('button')) return;
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

  return (
    <section
      ref={sectionRef}
      data-window={win.id}
      role="dialog" aria-label={win.title}
      onPointerDownCapture={() => onFocus?.(win.id)}
      className={`absolute flex flex-col bg-cyber-dark border rounded-xl overflow-hidden font-mono ${
        focused ? ACCENT[win.accent] || ACCENT.cyan : 'border-slate-800 shadow-xl'
      } ${win.minimized ? 'hidden' : ''} ${maximized ? 'rounded-none' : ''}`}
      style={style}
    >
      {/* Title bar */}
      <header
        onPointerDown={startDrag} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={() => onToggleMaximize?.(win.id)}
        style={{ height: TITLE_BAR_H }}
        className={`shrink-0 flex items-center gap-2 px-2.5 border-b select-none touch-none ${
          focused ? 'bg-slate-900 border-slate-700' : 'bg-slate-950 border-slate-800'
        } ${maximized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${focused ? ACCENT_TEXT[win.accent] || ACCENT_TEXT.cyan : 'text-slate-500'}`} />}
        <span className={`text-xs font-bold tracking-wide truncate flex-1 ${focused ? 'text-slate-100' : 'text-slate-400'}`}>{displayTitle(win)}</span>

        {/* Content zoom */}
        <div className="flex items-center gap-0.5 mr-1" data-zoom-controls title="Tool zoom: scales this tool inside its window (Ctrl+wheel also works). The page itself is not zoomed.">
          <button onClick={() => onZoomStep?.(win.id, -1, zoom)} className={iconBtn} title="Zoom the tool out"><ZoomOut className="w-3.5 h-3.5" /></button>
          <button onClick={() => onToggleFit?.(win.id)} data-zoom-pct
            className={`px-1 py-0.5 rounded text-[10px] font-bold tabular-nums min-w-[2.6rem] text-center ${win.fit ? 'bg-cyan-600/30 text-cyan-200 border border-cyan-500/40' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title={win.fit ? 'Fit to width is on: the tool scales so its full layout fits this window. Click for manual zoom.' : 'Fit to width: scale the tool so its full layout fits this window'}>
            {win.fit ? `FIT ${pct}%` : `${pct}%`}
          </button>
          <button onClick={() => onZoomStep?.(win.id, 1, zoom)} className={iconBtn} title="Zoom the tool in"><ZoomIn className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex items-center gap-0.5">
          {onDuplicate && <button onClick={() => onDuplicate(win.id)} title="Open another instance of this tool (new window, its own device)" className={iconBtn}><CopyPlus className="w-3.5 h-3.5" /></button>}
          <button onClick={() => onMinimize?.(win.id)} title="Minimize to the taskbar" className={iconBtn}><Minus className="w-3.5 h-3.5" /></button>
          {!forceMaximized && (
            <button onClick={() => onToggleMaximize?.(win.id)} title={win.maximized ? 'Restore size' : 'Maximize'} className={iconBtn}>
              {win.maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3 h-3" />}
            </button>
          )}
          <button onClick={() => onClose?.(win.id)} title="Close (disconnects this tool's device)" className="p-1 rounded text-slate-400 hover:text-white hover:bg-rose-600"><X className="w-3.5 h-3.5" /></button>
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
