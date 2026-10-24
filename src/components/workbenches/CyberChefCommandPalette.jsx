/**
 * CyberChefCommandPalette.jsx
 * Global Command Palette (Ctrl+K / Cmd+K) for CyberChef Workbench.
 * Quick-search operations, execute actions, switch views, and manage pipeline with full keyboard navigation.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Command, Zap, Play, RotateCcw, Trash2, Download, Copy, Upload, FileCode, Radio, Eye, X } from 'lucide-react';

export default function CyberChefCommandPalette({
  isOpen,
  onClose,
  operations = [],
  onSelectOperation,
  onAction,
  autoBake = false
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Built-in actions
  const quickActions = useMemo(() => [
    {
      id: 'bake',
      name: 'Force Bake Pipeline',
      category: 'Actions',
      icon: Play,
      shortcut: 'Ctrl+Enter',
      description: 'Executes all recipe operations immediately on current input.'
    },
    {
      id: 'toggle_autobake',
      name: autoBake ? 'Disable Auto-Bake' : 'Enable Auto-Bake',
      category: 'Actions',
      icon: Zap,
      description: 'Automatically bakes on every input or recipe adjustment.'
    },
    {
      id: 'undo',
      name: 'Undo Last Recipe Change',
      category: 'Actions',
      icon: RotateCcw,
      shortcut: 'Ctrl+Z',
      description: 'Reverts the most recent recipe pipeline edit.'
    },
    {
      id: 'clear_input',
      name: 'Clear Input Payload',
      category: 'Actions',
      icon: Trash2,
      description: 'Empties the current input text/dish deck.'
    },
    {
      id: 'clear_recipe',
      name: 'Clear Entire Recipe',
      category: 'Actions',
      icon: Trash2,
      description: 'Removes all operations from the active recipe pipeline.'
    },
    {
      id: 'copy_recipe',
      name: 'Copy Recipe JSON to Clipboard',
      category: 'Portability',
      icon: Copy,
      description: 'Copies serialized recipe JSON array to system clipboard.'
    },
    {
      id: 'save_recipe',
      name: 'Save Recipe (.cyberchef)',
      category: 'Portability',
      icon: Download,
      shortcut: 'Ctrl+S',
      description: 'Downloads current recipe as a portable .cyberchef JSON file.'
    },
    {
      id: 'load_recipe',
      name: 'Load Recipe from File',
      category: 'Portability',
      icon: Upload,
      description: 'Uploads and loads a saved recipe into the pipeline.'
    },
    {
      id: 'export_html',
      name: 'Export Standalone HTML Report',
      category: 'Portability',
      icon: FileCode,
      description: 'Generates self-contained offline session report with embedded styles.'
    },
    {
      id: 'pipe_hardware',
      name: 'Pipe Live Hardware Data',
      category: 'Hardware',
      icon: Radio,
      description: 'Opens hardware ingestion modal for WebSerial/WebUSB live streams.'
    },
    {
      id: 'view_text',
      name: 'Switch Output View: Raw Text',
      category: 'Views',
      icon: Eye,
      description: 'Displays baked output in standard monospace text format.'
    },
    {
      id: 'view_tree',
      name: 'Switch Output View: JSON Tree',
      category: 'Views',
      icon: Eye,
      description: 'Displays collapsible, searchable tree of parsed JSON output.'
    },
    {
      id: 'view_table',
      name: 'Switch Output View: HTML Table',
      category: 'Views',
      icon: Eye,
      description: 'Displays delimiter-separated data in structured table rows.'
    },
    {
      id: 'view_jwt',
      name: 'Switch Output View: JWT Decoder',
      category: 'Views',
      icon: Eye,
      description: 'Inspects header, claims, and signature blocks of JWT tokens.'
    },
    {
      id: 'view_hexeditor',
      name: 'Switch Output View: Hex Editor',
      category: 'Views',
      icon: Eye,
      description: 'Interactive 16-bytes-per-line binary inspector and patcher.'
    },
    {
      id: 'view_charts',
      name: 'Switch Output View: Analytics Charts',
      category: 'Views',
      icon: Eye,
      description: 'Rolling Shannon entropy curve and 256-bin byte frequency histogram.'
    }
  ], [autoBake]);

  // Combined filtered items
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const actionMatches = quickActions.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q) || (a.description && a.description.toLowerCase().includes(q))
    ).map(a => ({ ...a, type: 'action' }));

    const opMatches = operations.filter(op => {
      if (!q) return true;
      const name = (op.name || '').toLowerCase();
      const mod = (op.module || op.category || '').toLowerCase();
      const desc = (op.description || '').toLowerCase();
      return name.includes(q) || mod.includes(q) || desc.includes(q);
    }).map(op => ({
      id: `op_${op.id || op.name}`,
      name: op.name,
      category: op.module || op.category || 'Operations',
      description: op.description || '',
      type: 'operation',
      op
    }));

    return [...actionMatches, ...opMatches];
  }, [query, quickActions, operations]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation inside modal
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredItems[selectedIndex];
      if (item) {
        handleSelectItem(item);
      }
    }
  };

  const handleSelectItem = (item) => {
    if (item.type === 'action') {
      onAction?.(item.id);
    } else if (item.type === 'operation') {
      onSelectOperation?.(item.op);
    }
    onClose();
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex];
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-950/70">
          <Search className="w-5 h-5 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or search 80+ operations (e.g., DNS, Untar, Force Bake)..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-slate-500 hover:text-slate-300 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            ESC to close
          </span>
        </div>

        {/* Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-slate-800/40">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No matching commands or operations found for "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon || Command;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-cyan-500/15 border border-cyan-500/30 text-white'
                      : 'hover:bg-slate-800/50 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-1.5 rounded-lg shrink-0 ${isSelected ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs sm:text-sm truncate text-slate-100">
                          {item.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/60 shrink-0">
                          {item.category}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.shortcut && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-800/50">
                        {item.shortcut}
                      </span>
                    )}
                    {isSelected && (
                      <span className="text-[10px] font-mono text-cyan-400 hidden sm:inline">
                        ↵ Run
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <div className="flex items-center gap-3">
            <span><strong className="text-slate-400">↑↓</strong> Navigate</span>
            <span><strong className="text-slate-400">↵</strong> Select</span>
            <span><strong className="text-slate-400">ESC</strong> Dismiss</span>
          </div>
          <div>
            Showing {filteredItems.length} items
          </div>
        </div>
      </div>
    </div>
  );
}
