// Windows-style Start menu: a Start button at the left of the desktop taskbar
// that pops a cascading category menu up from the taskbar. Typing in the search
// field swaps the cascade for a flat, ranked result list. Launching a tool goes
// through the same handler the old sidebar used.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, ChevronLeft, Search, Folder, LayoutGrid, BookOpen, Cpu, Clock,
  Terminal, HardDrive, Binary, Activity, Wifi, Radio, Zap, ShieldCheck, Keyboard, Bluetooth,
  Smartphone, Network, Database, Bot, Usb, Compass, Gauge, Flame, Sparkles, Camera, MapPin, Layers, Sliders,
  SquareTerminal, HardDriveDownload, RadioTower, Globe, KeyRound, Hash, BadgeCheck, FileCode, ScanSearch, Radar
} from 'lucide-react';
import skonLogo from '../../assets/skon-logo.svg';
import { SIDEBAR_SECTIONS } from './Sidebar';
import { TOOL_CATEGORIES, flattenToolIds, findCategoryPath } from './toolCategories';
import { searchTools } from '../../utils/toolSearch';

// Category icons are named by string in toolCategories.js; a curated map keeps the
// bundle small. Anything unknown falls back to its first tool's icon (see iconFor).
const CATEGORY_ICONS = {
  Terminal, HardDrive, Binary, Activity, Wifi, Radio, Zap, ShieldCheck, Keyboard, Bluetooth,
  Smartphone, Network, Database, Bot, Usb, Compass, Gauge, Flame, Sparkles, Camera, MapPin,
  Layers, Sliders, SquareTerminal, HardDriveDownload, RadioTower, Globe, KeyRound, Hash, BadgeCheck, FileCode, ScanSearch, Radar, Cpu, BookOpen, Search, Folder, LayoutGrid
};

export const RECENT_KEY = 'skon_start_recent';
export const MAX_RECENT = 5;
const ALL_NODE_ID = '__all-tools';

/** Map of tool id -> sidebar item (name, icon, accent, desc, keywords). */
export function buildToolMap(sections = SIDEBAR_SECTIONS) {
  const map = new Map();
  for (const s of sections) for (const item of s.items) map.set(item.id, item);
  return map;
}

export const isCategory = (node) => !!node && Array.isArray(node.children);

/** Every launchable item (the search corpus), de-duplicated by id. */
export function allItems(map) { return [...map.values()]; }

/** Ranked search results for the flat list. */
export function searchResults(map, query) {
  if (!String(query || '').trim()) return [];
  return searchTools(allItems(map), query);
}

/** Readable "Category > Sub" path for a tool, '' when it is not categorised. */
export function pathLabel(toolId, categories = TOOL_CATEGORIES) {
  let p;
  try { p = findCategoryPath(toolId, categories); } catch (e) { p = null; }
  if (!Array.isArray(p)) return '';
  // findCategoryPath returns category ids (root -> parent); show their names.
  const names = new Map();
  const walk = (nodes) => { for (const n of nodes || []) if (isCategory(n)) { names.set(n.id, n.name); walk(n.children); } };
  walk(categories);
  return p.map((n) => (typeof n === 'string' ? (names.get(n) || n) : n?.name)).filter(Boolean).join(' › ');
}

export function readRecent(storage) {
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const v = JSON.parse(s?.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch (e) { return []; }
}

/** Pure: new recent list with `id` first, no duplicates, capped at MAX_RECENT. */
export function pushRecent(list, id) {
  return [id, ...(list || []).filter((x) => x !== id)].slice(0, MAX_RECENT);
}

function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

/** Categories plus a synthetic "All tools" entry at the end. */
export function withAllTools(categories, map) {
  const ids = flattenToolIds(categories).filter((id) => map.has(id));
  return [...categories, { id: ALL_NODE_ID, name: 'All tools', icon: 'LayoutGrid', desc: `${ids.length} tools, flat list`, children: ids.map((toolId) => ({ toolId })) }];
}

const ACCENT_TEXT = {
  amber: 'text-amber-300', emerald: 'text-emerald-300', purple: 'text-purple-300', rose: 'text-rose-300',
  indigo: 'text-indigo-300', cyan: 'text-cyan-300'
};

/** The popup. Exported separately so it can be rendered/tested without the button. */
export function StartMenu({
  categories = TOOL_CATEGORIES, onLaunch, onClose, onOpenPinouts, onOpenHardwareIntel, activeTool,
  initialQuery = '', initialPath = [], initialRecent
}) {
  const map = useMemo(() => buildToolMap(), []);
  const roots = useMemo(() => withAllTools(categories, map), [categories, map]);
  const [query, setQuery] = useState(initialQuery);
  const [openPath, setOpenPath] = useState(initialPath);   // category nodes open, one per column after the root
  const [cursor, setCursor] = useState({ col: 0, idx: 0 });
  const [recent, setRecent] = useState(() => initialRecent || readRecent());
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const searching = query.trim().length > 0;
  const results = useMemo(() => searchResults(map, query), [map, query]);

  const resolve = useCallback((node) => (isCategory(node) ? node : { ...node, item: map.get(node.toolId) }), [map]);
  const column = useCallback((col) => {
    const nodes = col === 0 ? roots : (openPath[col - 1]?.children || []);
    return nodes.map(resolve).filter((n) => isCategory(n) || n.item);
  }, [roots, openPath, resolve]);
  const columns = [];
  for (let c = 0; c <= openPath.length; c++) columns.push(column(c));

  const iconFor = (node) => {
    if (!isCategory(node)) return node.item?.icon || Folder;
    if (CATEGORY_ICONS[node.icon]) return CATEGORY_ICONS[node.icon];
    const first = flattenToolIds([node]).map((id) => map.get(id)).find(Boolean);
    return first?.icon || Folder;
  };

  const launch = useCallback((id, ev) => {
    const item = map.get(id);
    if (!item) return;
    if (item.href || item.id === 'wiki-external') {
      window.open(item.id === 'wiki-external' ? (activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace') : item.href, '_blank', 'noopener,noreferrer');
    } else if (item.id === 'pinouts-modal') onOpenPinouts?.();
    else if (item.id === 'intel-modal') onOpenHardwareIntel?.();
    else {
      onLaunch?.(id, ev && (ev.altKey || ev.ctrlKey || ev.metaKey) ? { forceNew: true } : undefined);
      const next = pushRecent(readRecent(), id);
      writeRecent(next); setRecent(next);
    }
    onClose?.();
  }, [map, activeTool, onLaunch, onOpenPinouts, onOpenHardwareIntel, onClose]);

  const openCategory = (col, idx, node) => {
    setOpenPath((p) => [...p.slice(0, col), node]);
    setCursor({ col, idx });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (query) { setQuery(''); setCursor({ col: 0, idx: 0 }); } else onClose?.();
      return;
    }
    if (searching) {
      const n = results.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => ({ col: 0, idx: n ? (c.idx + 1) % n : 0 })); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => ({ col: 0, idx: n ? (c.idx - 1 + n) % n : 0 })); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = results[Math.min(cursor.idx, n - 1)]; if (r) launch(r.id, e); }
      return;
    }
    const col = Math.min(cursor.col, columns.length - 1);
    const items = columns[col] || [];
    const n = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = n ? (cursor.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : 0;
      setOpenPath((p) => p.slice(0, col));
      setCursor({ col, idx });
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      const node = items[cursor.idx];
      if (!node) return;
      e.preventDefault();
      if (isCategory(node)) {
        openCategory(col, cursor.idx, node);
        setCursor({ col: col + 1, idx: 0 });
      } else launch(node.toolId, e);
    } else if (e.key === 'ArrowLeft' && col > 0) {
      e.preventDefault();
      const parent = openPath[col - 1];
      setOpenPath((p) => p.slice(0, col - 1));
      setCursor({ col: col - 1, idx: Math.max(0, column(col - 1).findIndex((x) => x.id === parent?.id)) });
    }
  };

  const rowCls = (active) => `w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-left border transition-colors ${
    active ? 'bg-cyan-500/15 border-cyan-500/40 text-white' : 'border-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white'}`;

  const renderRow = (node, col, idx) => {
    const Icon = iconFor(node);
    const cat = isCategory(node);
    const active = cursor.col === col && cursor.idx === idx;
    const opened = cat && openPath[col]?.id === node.id;
    const accent = cat ? 'text-cyan-300' : (ACCENT_TEXT[node.item.accent] || 'text-cyan-300');
    return (
      <li key={cat ? node.id : node.toolId}>
        <button
          type="button"
          data-testid={cat ? `start-category-${node.id}` : `start-tool-${node.toolId}`}
          onMouseEnter={() => (cat ? openCategory(col, idx, node) : (setOpenPath((p) => p.slice(0, col)), setCursor({ col, idx })))}
          onClick={(e) => (cat ? openCategory(col, idx, node) : launch(node.toolId, e))}
          className={rowCls(active || opened)}
        >
          <Icon className={`w-4 h-4 shrink-0 ${accent}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold">{cat ? node.name : node.item.name}</span>
            {(cat ? node.desc : node.item.desc) && <span className="block truncate text-[10px] text-slate-500 font-normal">{cat ? node.desc : node.item.desc}</span>}
          </span>
          {cat && <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
        </button>
      </li>
    );
  };

  const panelCls = 'bg-slate-950/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl shadow-black/60 w-full md:w-72 max-h-[min(30rem,calc(100vh-7rem))] overflow-y-auto p-1.5';
  const recentItems = recent.map((id) => map.get(id)).filter(Boolean);

  return (
    <div data-testid="start-menu" role="menu" aria-label="Start menu" onKeyDown={onKeyDown}
      className="flex flex-col md:flex-row md:items-end gap-1 font-mono">
      <div className="flex flex-col w-full md:w-80 bg-slate-950/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl shadow-black/60">
        <div className="p-2 border-b border-slate-800">
          <label className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 focus-within:border-cyan-500/60">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              ref={inputRef} data-testid="start-search" value={query} autoFocus
              onChange={(e) => { setQuery(e.target.value); setCursor({ col: 0, idx: 0 }); setOpenPath([]); }}
              placeholder="Type to search tools" aria-label="Search tools"
              className="flex-1 bg-transparent outline-none text-xs text-slate-200 placeholder-slate-600"
            />
          </label>
        </div>

        <div className="max-h-[min(24rem,calc(100vh-14rem))] overflow-y-auto p-1.5">
          {searching ? (
            results.length === 0 ? (
              <div data-testid="start-no-results" className="px-3 py-6 text-center text-[11px] text-slate-500">No tools match &ldquo;{query}&rdquo;</div>
            ) : (
              <ul data-testid="start-results" className="space-y-0.5">
                {results.map((item, idx) => {
                  const Icon = item.icon || Folder;
                  const where = pathLabel(item.id, categories);
                  return (
                    <li key={item.id}>
                      <button type="button" data-testid={`start-result-${item.id}`} onMouseEnter={() => setCursor({ col: 0, idx })}
                        onClick={(e) => launch(item.id, e)} className={rowCls(cursor.idx === idx)}>
                        <Icon className={`w-4 h-4 shrink-0 ${ACCENT_TEXT[item.accent] || 'text-cyan-300'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">{item.name}</span>
                          {where && <span className="block truncate text-[10px] text-slate-500 font-normal">{where}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <>
              {recentItems.length > 0 && (
                <div data-testid="start-recent" className="mb-1.5 pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[9px] font-bold tracking-widest text-slate-500"><Clock className="w-3 h-3" />RECENT</div>
                  <div className="flex flex-wrap gap-1 px-1">
                    {recentItems.map((item) => {
                      const Icon = item.icon || Folder;
                      return (
                        <button key={item.id} type="button" data-testid={`start-recent-${item.id}`} onClick={(e) => launch(item.id, e)} title={item.desc}
                          className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-800 bg-slate-900 hover:border-cyan-500/40 text-[10px] text-slate-300 hover:text-white max-w-full">
                          <Icon className={`w-3 h-3 shrink-0 ${ACCENT_TEXT[item.accent] || 'text-cyan-300'}`} />
                          <span className="truncate">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <ul data-testid="start-root" className="space-y-0.5">{columns[0].map((n, i) => renderRow(n, 0, i))}</ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 p-1.5 border-t border-slate-800 text-[10px]">
          {[['wiki-external', 'Wiki'], ['pinouts-modal', 'Pinouts'], ['intel-modal', 'Chip Intel']].map(([id, label]) => {
            const item = map.get(id);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <button key={id} type="button" data-testid={`start-footer-${id}`} onClick={(e) => launch(id, e)} title={item.desc}
                className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800">
                <Icon className="w-3 h-3" /><span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cascading flyouts: side by side on wide screens, stacked on narrow ones */}
      {!searching && columns.slice(1).map((nodes, i) => (
        <div key={openPath[i]?.id || i} data-testid={`start-flyout-${i + 1}`} className={panelCls}>
          <div className="flex items-center gap-1 px-2 pb-1 text-[9px] font-bold tracking-widest text-slate-500 uppercase">
            <ChevronLeft className="w-3 h-3 md:hidden" />{openPath[i]?.name}
          </div>
          <ul className="space-y-0.5">{nodes.map((n, idx) => renderRow(n, i + 1, idx))}</ul>
        </div>
      ))}
    </div>
  );
}

/** The taskbar's Start button plus the popup it toggles. */
export default function StartButton({ onLaunch, onOpenPinouts, onOpenHardwareIntel, activeTool }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Alt+S toggles the menu (Ctrl+K stays the command palette).
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button" data-testid="start-button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-label="Start: all tools" title="Start: all tools (Alt+S)"
        className={`flex items-center justify-center h-7 w-8 rounded border transition-colors ${
          open ? 'bg-cyan-500/20 border-cyan-500/50 shadow-cyan-glow' : 'bg-gradient-to-br from-cyan-500/15 to-amber-500/10 border-cyan-500/30 hover:border-cyan-400/60'}`}
      >
        <img src={skonLogo} alt="" className="w-6 h-auto select-none" draggable="false" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 z-[10000] w-[calc(100vw-1rem)] md:w-auto">
          <StartMenu onLaunch={onLaunch} onClose={close} onOpenPinouts={onOpenPinouts} onOpenHardwareIntel={onOpenHardwareIntel} activeTool={activeTool} />
        </div>
      )}
    </div>
  );
}
