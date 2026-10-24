import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Binary, 
  Trash2, 
  Plus, 
  Copy, 
  Check, 
  Download, 
  Upload, 
  RefreshCw, 
  Sparkles, 
  Layers, 
  RotateCcw, 
  Search, 
  GripVertical, 
  File as FileIcon, 
  X, 
  Share2, 
  Zap,
  Play,
  StepForward,
  Bookmark,
  Save,
  FolderOpen,
  PauseCircle,
  PlayCircle,
  FileCode,
  Sliders,
  Radio,
  Wifi,
  Cpu,
  Activity,
  BarChart2,
  TrendingUp,
  Edit3,
  SlidersHorizontal,
  Table,
  Terminal,
  Command,
  Clock,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Sun,
  Moon
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';

import { registry, Chef, Dish, magic } from '../../utils/cyberchef/index.js';
import { useSerial } from '../../context/SerialContext.jsx';
import CyberChefCharts from '../workbenches/CyberChefCharts.jsx';
import CyberChefHexEditor from '../workbenches/CyberChefHexEditor.jsx';
import CyberChefStructuredView from '../workbenches/CyberChefStructuredView.jsx';
import CyberChefCommandPalette from '../workbenches/CyberChefCommandPalette.jsx';
import CyberChefRecipeTestModal from '../workbenches/CyberChefRecipeTestModal.jsx';
import { downloadStandaloneHtml } from '../../utils/cyberchef/exportStandalone.js';
import sessionHistory from '../../utils/cyberchef/history.js';



/**
 * Safe Serial Hook Wrapper
 * Guarantees component stability even outside SerialProvider or in unit test runners.
 */
function useSafeSerial() {
  try {
    return useSerial();
  } catch {
    return null;
  }
}


// Built-in Recipe Presets
const RECIPE_PRESETS = [
  {
    name: 'Deobfuscate Base64 Gzip',
    steps: [
      { op: 'From Base64', args: {} },
      { op: 'Gunzip', args: {} }
    ]
  },
  {
    name: 'JWT Decoder & Formatter',
    steps: [
      { op: 'Parse JWT', args: {} }
    ]
  },
  {
    name: 'Extract Network Indicators',
    steps: [
      { op: 'Extract IP addresses', args: { includeIpv6: 'Yes', uniqueOnly: 'Yes' } },
      { op: 'Extract URLs', args: { uniqueOnly: 'Yes' } }
    ]
  },
  {
    name: 'Hex to Canonical Hexdump',
    steps: [
      { op: 'From Hex', args: {} },
      { op: 'To Hexdump', args: { width: 16 } }
    ]
  },
  {
    name: 'Line-by-Line Fork Base64',
    steps: [
      { op: 'Fork', args: { splitDelimiter: '\\n', mergeDelimiter: '\\n' } },
      { op: 'To Base64', args: {} },
      { op: 'Merge', args: { delimiter: ',' } }
    ]
  }
];

// ============================================================================
// SORTABLE RECIPE ITEM WITH BREAKPOINTS
// ============================================================================

function SortableRecipeItem({
  step,
  index,
  op,
  isPausedHere,
  onRemove,
  onUpdateArg,
  onToggleBreakpoint
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: step.uniqueId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 bg-[#1e212b] border ${
        isPausedHere
          ? 'border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/20'
          : isDragging
          ? 'border-cyan-400 shadow-lg shadow-cyan-500/20'
          : 'border-[#2b303c]'
      } rounded-xl space-y-2 relative group transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            {...attributes}
            {...listeners}
            className="text-slate-500 hover:text-cyan-400 cursor-grab active:cursor-grabbing p-0.5 rounded transition"
            title="Drag to reorder"
            type="button"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>

          {/* Breakpoint toggle button */}
          <button
            onClick={() => onToggleBreakpoint(index)}
            className={`w-3.5 h-3.5 rounded-full border transition flex items-center justify-center shrink-0 ${
              step.breakpoint
                ? 'bg-rose-500 border-rose-400 ring-2 ring-rose-500/30 shadow-sm'
                : 'border-slate-600 hover:border-rose-400 bg-transparent'
            }`}
            title={step.breakpoint ? 'Breakpoint active (click to remove)' : 'Set breakpoint'}
            type="button"
          />

          <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] flex items-center justify-center font-mono shrink-0">
            {index + 1}
          </span>

          <span className="text-xs font-bold text-slate-200 truncate">
            {op?.name || step.op || step.name || step.id}
          </span>

          {op?.module && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#14161d] text-slate-400 border border-[#2b303c] hidden sm:inline">
              {op.module}
            </span>
          )}

          {isPausedHere && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 animate-pulse">
              PAUSED
            </span>
          )}
        </div>

        <button
          onClick={() => onRemove(index)}
          className="text-slate-500 hover:text-rose-400 p-1 rounded transition shrink-0"
          title="Remove Step"
          type="button"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {op?.args && op.args.length > 0 && (
        <div className="pt-2 border-t border-[#282d3b] space-y-1.5">
          {op.args.map((arg) => (
            <div key={arg.name} className="flex flex-col gap-1 text-[11px]">
              {arg.name === 'code' || arg.type === 'textarea' || (arg.type === 'text' && String(step.args?.[arg.name] ?? arg.default ?? '').length > 40) ? (
                <div className="w-full space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span className="font-bold">{arg.label || arg.name}:</span>
                    {arg.name === 'code' && (
                      <div className="flex items-center gap-1 text-[9px]">
                        <button
                          type="button"
                          onClick={() => onUpdateArg(index, 'code', "return input.split('').reverse().join('');")}
                          className="hover:text-cyan-400 px-1 py-0.5 rounded bg-[#101217] border border-[#2b303c]"
                          title="Reverse string"
                        >
                          Reverse
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateArg(index, 'code', "return input.toUpperCase();")}
                          className="hover:text-cyan-400 px-1 py-0.5 rounded bg-[#101217] border border-[#2b303c]"
                          title="Uppercase"
                        >
                          Upper
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateArg(index, 'code', "return input.split('\\n').filter(Boolean).join('\\n');")}
                          className="hover:text-cyan-400 px-1 py-0.5 rounded bg-[#101217] border border-[#2b303c]"
                          title="Filter empty lines"
                        >
                          Filter
                        </button>
                      </div>
                    )}
                  </div>
                  <textarea
                    rows={4}
                    value={step.args?.[arg.name] ?? arg.default ?? ''}
                    onChange={(e) => onUpdateArg(index, arg.name, e.target.value)}
                    className="w-full bg-[#101217] border border-[#2b303c] rounded-lg p-2 text-slate-200 text-[11px] focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                    placeholder="Enter JavaScript code..."
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 truncate">{arg.label || arg.name}:</span>
                  {arg.type === 'select' ? (
                    <select
                      value={step.args?.[arg.name] ?? arg.default}
                      onChange={(e) => onUpdateArg(index, arg.name, e.target.value)}
                      className="bg-[#14161d] border border-[#2b303c] rounded-lg px-2 py-0.5 text-slate-200 text-[11px] focus:outline-none focus:border-cyan-400 font-mono"
                    >
                      {arg.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={arg.type === 'number' ? 'number' : 'text'}
                      value={step.args?.[arg.name] ?? arg.default ?? ''}
                      onChange={(e) => onUpdateArg(index, arg.name, e.target.value)}
                      className="bg-[#14161d] border border-[#2b303c] rounded-lg px-2 py-0.5 text-slate-200 text-[11px] w-28 text-right focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// ============================================================================
// MAIN MULTI-TAB WORKBENCH
// ============================================================================

export default function CyberChefWorkbench() {
  // Tabs State
  const [tabs, setTabs] = useState([
    {
      id: 'tab-1',
      title: 'Input 1',
      inputText: 'Skon USB Flasher CyberChef Pipeline',
      inputBuffer: null,
      fileMeta: null,
      activeRecipe: [{ op: 'To Base64', uniqueId: 'step-1', args: {}, breakpoint: false }],
      outputText: '',
      outputHex: '',
      outputBase64: '',
      outputHexdump: '',
      outputFormat: 'text',
      bakeDurationMs: null,
      errorMsg: null,
      paused: false,
      pausedStepIndex: null,
      pausedStepOp: null
    }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');

  // Global Settings
  const [autoBake, setAutoBake] = useState(true);
  const [isBaking, setIsBaking] = useState(false);
  const [searchOp, setSearchOp] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [magicResult, setMagicResult] = useState(null);
  const [showMagicModal, setShowMagicModal] = useState(false);
  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [savedUserPresets, setSavedUserPresets] = useState([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Hardware Ingestion & Piping State
  const safeSerial = useSafeSerial();
  const [showHardwareModal, setShowHardwareModal] = useState(false);
  const [isPipingActive, setIsPipingActive] = useState(false);
  const [pipingSource, setPipingSource] = useState('mock_nmea'); // 'serial' | 'alfa_wifi' | 'mock_nmea' | 'mock_esp32' | 'mock_binary'
  const [pipingBufferLimit, setPipingBufferLimit] = useState(10240); // 10KB rolling window
  const [pipingIntervalMs, setPipingIntervalMs] = useState(300);
  const [pipingStats, setPipingStats] = useState({ bytes: 0, frames: 0 });
  const pipingBufferRef = useRef(new Uint8Array(0));
  const lastProcessedSerialIdRef = useRef(null);

  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const fileInputRef = useRef(null);
  const recipeFileInputRef = useRef(null);
  const [copiedRecipe, setCopiedRecipe] = useState(false);

  // Command Palette & Time Machine History
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('operations'); // 'operations' | 'history'
  const [historySnapshots, setHistorySnapshots] = useState(() => sessionHistory.getSnapshots());
  const recipeUndoStackRef = useRef([]);

  // Phase 10: Presentation Mode, Theming & Recipe Test Suite
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testingRecipe, setTestingRecipe] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('cyberchef_theme') || 'cyberpunk';
    } catch {
      return 'cyberpunk';
    }
  });

  const handleThemeChange = (newTheme) => {
    setThemeMode(newTheme);
    try {
      localStorage.setItem('cyberchef_theme', newTheme);
    } catch {}
  };

  // Subscribe to session history changes
  useEffect(() => {
    return sessionHistory.subscribe((snapshots) => {
      setHistorySnapshots(snapshots);
    });
  }, []);


  // Active Tab Selector
  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
  }, [tabs, activeTabId]);

  // Update Active Tab Helper
  const updateActiveTab = useCallback((updater) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? (typeof updater === 'function' ? updater(t) : { ...t, ...updater }) : t))
    );
  }, [activeTabId]);

  // Copy Recipe JSON to clipboard
  const copyRecipeToClipboard = useCallback(() => {
    const minified = activeTab.activeRecipe.map((s) => ({ op: s.op, args: s.args }));
    navigator.clipboard.writeText(JSON.stringify(minified, null, 2));
    setCopiedRecipe(true);
    setTimeout(() => setCopiedRecipe(false), 2000);
  }, [activeTab.activeRecipe]);

  // Export Recipe as a .cyberchef / .json file download
  const exportRecipeFile = useCallback(() => {
    const minified = activeTab.activeRecipe.map((s) => ({ op: s.op, args: s.args }));
    const blob = new Blob([JSON.stringify(minified, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipe_${Date.now()}.cyberchef`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeTab.activeRecipe]);

  // Import Recipe from JSON / .cyberchef file
  const importRecipeFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (Array.isArray(parsed)) {
          const newRecipe = parsed.map((s, idx) => ({
            op: s.op || s.name || s.id,
            args: s.args || {},
            uniqueId: `imported-step-${Date.now()}-${idx}`,
            breakpoint: false
          }));
          updateActiveTab({ activeRecipe: newRecipe, paused: false, pausedStepIndex: null });
        }
      } catch (err) {
        alert('Invalid recipe JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [updateActiveTab]);


  // Append incoming hardware stream bytes into rolling buffer & active tab input
  const appendHardwareBytes = useCallback((newBytes) => {
    if (!newBytes || newBytes.length === 0) return;
    const current = pipingBufferRef.current;
    const combined = new Uint8Array(current.length + newBytes.length);
    combined.set(current, 0);
    combined.set(newBytes, current.length);

    let trimmed = combined;
    if (pipingBufferLimit > 0 && combined.length > pipingBufferLimit) {
      trimmed = combined.slice(combined.length - pipingBufferLimit);
    }
    pipingBufferRef.current = trimmed;

    setPipingStats((prev) => ({
      bytes: prev.bytes + newBytes.length,
      frames: prev.frames + 1
    }));

    const text = new TextDecoder('utf-8', { fatal: false }).decode(trimmed);
    updateActiveTab({
      inputBuffer: trimmed.buffer.slice(trimmed.byteOffset, trimmed.byteOffset + trimmed.byteLength),
      inputText: text,
      fileMeta: null
    });
  }, [pipingBufferLimit, updateActiveTab]);

  // Reset rolling hardware buffer
  const clearHardwareBuffer = useCallback(() => {
    pipingBufferRef.current = new Uint8Array(0);
    setPipingStats({ bytes: 0, frames: 0 });
    updateActiveTab({
      inputBuffer: null,
      inputText: '',
      fileMeta: null
    });
  }, [updateActiveTab]);

  // WebSerial Ingestion Listener
  useEffect(() => {
    if (!isPipingActive || pipingSource !== 'serial' || !safeSerial?.activeBoard) return;
    const entries = safeSerial.activeBoard.entries || [];
    if (entries.length === 0) return;

    let startIndex = 0;
    if (lastProcessedSerialIdRef.current) {
      const idx = entries.findIndex((e) => e.id === lastProcessedSerialIdRef.current);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    const toProcess = entries.slice(startIndex).filter((e) => e.type === 'rx');
    if (toProcess.length > 0) {
      lastProcessedSerialIdRef.current = entries[entries.length - 1].id;
      for (const ent of toProcess) {
        if (ent.rawBytes && ent.rawBytes.length > 0) {
          appendHardwareBytes(new Uint8Array(ent.rawBytes));
        } else if (ent.text) {
          appendHardwareBytes(new TextEncoder().encode(ent.text));
        }
      }
    }
  }, [isPipingActive, pipingSource, safeSerial?.activeBoard?.entries, appendHardwareBytes]);

  // Mock Telemetry & Wi-Fi Generator Loop
  useEffect(() => {
    if (!isPipingActive || pipingSource === 'serial') return;
    let counter = 0;
    const interval = setInterval(() => {
      counter++;
      let chunk;
      if (pipingSource === 'mock_nmea') {
        const lat = (4807.038 + (counter % 50) * 0.001).toFixed(3);
        const lon = (1131.000 + (counter % 50) * 0.001).toFixed(3);
        const time = String(120000 + (counter % 3600)).padStart(6, '0');
        const str = `$GNGGA,${time},${lat},N,0${lon},E,1,08,0.9,545.4,M,46.9,M,,*47\r\n$GPRMC,${time},A,${lat},N,0${lon},E,022.4,084.4,241026,003.1,W*6A\r\n`;
        chunk = new TextEncoder().encode(str);
      } else if (pipingSource === 'mock_esp32') {
        const heap = 280000 - (counter % 100) * 128;
        const rssi = 45 + (counter % 35);
        const str = `[${new Date().toISOString().slice(11, 23)}] [ESP32-S3] HEAP: ${heap}B RSSI: -${rssi}dBm CH: 6 IP: 192.168.4.1 PKT_RX: ${counter * 4}\r\n`;
        chunk = new TextEncoder().encode(str);
      } else if (pipingSource === 'mock_binary') {
        const frame = new Uint8Array(16);
        frame[0] = 0xAA;
        frame[1] = 0x55;
        frame[2] = counter & 0xff;
        frame[3] = (counter >> 8) & 0xff;
        for (let i = 4; i < 14; i++) frame[i] = (counter * i + 33) & 0xff;
        frame[14] = 0x0D;
        frame[15] = 0x0A;
        chunk = frame;
      } else if (pipingSource === 'alfa_wifi') {
        const frame = new Uint8Array(32);
        frame[0] = 0x80; // Beacon frame
        frame[1] = 0x00;
        frame[2] = 0x00;
        frame[3] = 0x00;
        for (let i = 4; i < 10; i++) frame[i] = 0xff; // Broadcast dest
        for (let i = 10; i < 16; i++) frame[i] = (0x00 + i * 17) & 0xff; // Source MAC
        for (let i = 16; i < 22; i++) frame[i] = (0x00 + i * 17) & 0xff; // BSSID
        frame[22] = counter & 0xff;
        frame[23] = (counter >> 8) & 0xff;
        const tag = new TextEncoder().encode('SKON_WIFI');
        frame[24] = 0x00;
        frame[25] = tag.length;
        frame.set(tag, 26);
        chunk = frame;
      }
      if (chunk) {
        appendHardwareBytes(chunk);
      }
    }, pipingIntervalMs);

    return () => clearInterval(interval);
  }, [isPipingActive, pipingSource, pipingIntervalMs, appendHardwareBytes]);


  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Load Saved Recipes from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('cyberchef_saved_recipes');
      if (stored) {
        setSavedUserPresets(JSON.parse(stored));
      }
    } catch {}
  }, []);

  // Save Presets to localStorage
  const saveCurrentRecipeAsPreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset = {
      name: newPresetName.trim(),
      steps: activeTab.activeRecipe.map((s) => ({ op: s.op, args: s.args }))
    };
    const updated = [...savedUserPresets, newPreset];
    setSavedUserPresets(updated);
    try {
      localStorage.setItem('cyberchef_saved_recipes', JSON.stringify(updated));
    } catch {}
    setNewPresetName('');
  };

  const deletePreset = (presetName) => {
    const updated = savedUserPresets.filter((p) => p.name !== presetName);
    setSavedUserPresets(updated);
    try {
      localStorage.setItem('cyberchef_saved_recipes', JSON.stringify(updated));
    } catch {}
  };

  const loadPreset = (preset) => {
    const newSteps = preset.steps.map((s, idx) => ({
      op: s.op,
      args: s.args || {},
      uniqueId: `preset-${Date.now()}-${idx}`,
      breakpoint: false
    }));
    updateActiveTab({ activeRecipe: newSteps, paused: false, pausedStepIndex: null });
    setShowPresetsModal(false);
  };

  // Initialize Web Worker with fallback
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(new URL('../../workers/chefWorker.js', import.meta.url), {
          type: 'module'
        });

        worker.onmessage = (event) => {
          const data = event.data;
          if (!data) return;

          if (data.id === requestIdRef.current) {
            setIsBaking(false);
            if (data.success) {
              const dur = data.durationMs;
              updateActiveTab({
                outputText: data.result || '',
                outputHex: data.hex || '',
                outputBase64: data.base64 || '',
                outputHexdump: data.hexdump || '',
                bakeDurationMs: dur,
                paused: data.paused,
                pausedStepIndex: data.pausedStepIndex,
                pausedStepOp: data.pausedStepOp,
                errorMsg: null
              });
              sessionHistory.addSnapshot({
                input: activeTab.inputText,
                recipe: activeTab.activeRecipe,
                output: data.result || '',
                outputHex: data.hex || '',
                durationMs: dur
              });
            } else {
              updateActiveTab({
                errorMsg: `Worker Step Error: ${data.error}`
              });
            }
          }
        };

        workerRef.current = worker;
      } catch (err) {
        console.warn('Worker initialization failed, fallback to main thread:', err);
      }
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [updateActiveTab]);

  // Deep Link Restoration on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return;
    try {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);

      if (params.has('recipe')) {
        const parsed = JSON.parse(decodeURIComponent(params.get('recipe')));
        if (Array.isArray(parsed)) {
          updateActiveTab({
            activeRecipe: parsed.map((step, idx) => ({
              op: step.op || step.name || step.id,
              args: step.args || {},
              uniqueId: `hash-step-${idx}-${Date.now()}`,
              breakpoint: false
            }))
          });
        }
      }

      if (params.has('input')) {
        updateActiveTab({
          inputText: decodeURIComponent(params.get('input'))
        });
      }
    } catch {}
  }, [updateActiveTab]);

  // Deep Link Hash Sync (debounced)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = setTimeout(() => {
      try {
        const minified = activeTab.activeRecipe.map((s) => ({ op: s.op, args: s.args }));
        const hashParams = new URLSearchParams();
        hashParams.set('recipe', JSON.stringify(minified));
        if (activeTab.inputText && !activeTab.fileMeta && activeTab.inputText.length < 500) {
          hashParams.set('input', activeTab.inputText);
        }
        window.history.replaceState(null, '', `#${hashParams.toString()}`);
      } catch {}
    }, 400);

    return () => clearTimeout(timer);
  }, [activeTab.activeRecipe, activeTab.inputText, activeTab.fileMeta]);

  // Core Bake Execution
  const executeBake = useCallback(async (options = {}) => {
    setIsBaking(true);
    const reqId = ++requestIdRef.current;
    const payloadInput = activeTab.inputBuffer || activeTab.inputText;
    const recipeConfig = activeTab.activeRecipe.map((s) => ({
      op: s.op,
      args: s.args,
      breakpoint: s.breakpoint,
      uniqueId: s.uniqueId
    }));

    if (workerRef.current) {
      workerRef.current.postMessage({
        id: reqId,
        input: payloadInput,
        recipe: recipeConfig,
        options
      });
    } else {
      const start = performance.now();
      try {
        const chef = new Chef();
        const dish = await chef.bake(payloadInput, recipeConfig, options);
        if (reqId === requestIdRef.current) {
          const duration = Math.round((performance.now() - start) * 100) / 100;
          const outText = dish.toString();
          const outHex = dish.toHex(' ');
          updateActiveTab({
            outputText: outText,
            outputHex: outHex,
            outputBase64: dish.toBase64(),
            outputHexdump: dish.toHexdump ? dish.toHexdump() : '',
            bakeDurationMs: duration,
            paused: !!dish.paused,
            pausedStepIndex: dish.pausedStepIndex !== undefined ? dish.pausedStepIndex : null,
            pausedStepOp: dish.pausedStepOp || null,
            errorMsg: null
          });
          sessionHistory.addSnapshot({
            input: activeTab.inputText,
            recipe: activeTab.activeRecipe,
            output: outText,
            outputHex: outHex,
            durationMs: duration
          });
        }
      } catch (err) {
        if (reqId === requestIdRef.current) {
          updateActiveTab({ errorMsg: `Recipe Error: ${err.message}` });
        }
      } finally {
        if (reqId === requestIdRef.current) setIsBaking(false);
      }
    }
  }, [activeTab.inputBuffer, activeTab.inputText, activeTab.activeRecipe, updateActiveTab]);

  // Auto-Bake trigger (300ms debounce)
  useEffect(() => {
    if (!autoBake) return;
    const timer = setTimeout(() => {
      executeBake();
    }, 300);
    return () => clearTimeout(timer);
  }, [autoBake, activeTab.inputText, activeTab.inputBuffer, activeTab.activeRecipe, executeBake]);

  // Magic Heuristic calculation
  useEffect(() => {
    try {
      const data = activeTab.inputBuffer || activeTab.inputText;
      const res = magic(data, { maxDepth: 3 });
      setMagicResult(res);
    } catch {
      setMagicResult(null);
    }
  }, [activeTab.inputBuffer, activeTab.inputText]);

  // Multi-Tab Management
  const addTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTabNum = tabs.length + 1;
    const newTab = {
      id: newId,
      title: `Input ${newTabNum}`,
      inputText: '',
      inputBuffer: null,
      fileMeta: null,
      activeRecipe: [{ op: 'To Base64', uniqueId: `step-${Date.now()}`, args: {}, breakpoint: false }],
      outputText: '',
      outputHex: '',
      outputBase64: '',
      outputHexdump: '',
      outputFormat: 'text',
      bakeDurationMs: null,
      errorMsg: null,
      paused: false,
      pausedStepIndex: null,
      pausedStepOp: null
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (tabId, e) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[0].id);
    }
  };

  // Recipe Step Actions
  const addOperation = (opIdentifier) => {
    const op = registry.get(opIdentifier);
    const defaultArgs = {};
    if (op?.args) {
      for (const a of op.args) {
        if (a.default !== undefined) defaultArgs[a.name] = a.default;
      }
    }
    const newStep = {
      op: op?.name || opIdentifier,
      args: defaultArgs,
      uniqueId: `step-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      breakpoint: false
    };
    updateActiveTab((tab) => {
      recipeUndoStackRef.current.push([...tab.activeRecipe]);
      if (recipeUndoStackRef.current.length > 30) recipeUndoStackRef.current.shift();
      return { ...tab, activeRecipe: [...tab.activeRecipe, newStep] };
    });
  };

  const removeStep = (index) => {
    updateActiveTab((tab) => {
      recipeUndoStackRef.current.push([...tab.activeRecipe]);
      if (recipeUndoStackRef.current.length > 30) recipeUndoStackRef.current.shift();
      return {
        ...tab,
        activeRecipe: tab.activeRecipe.filter((_, idx) => idx !== index)
      };
    });
  };

  const handleUndoRecipe = useCallback(() => {
    if (recipeUndoStackRef.current.length > 0) {
      const prev = recipeUndoStackRef.current.pop();
      updateActiveTab({ activeRecipe: prev, paused: false, pausedStepIndex: null });
    }
  }, [updateActiveTab]);

  const updateStepArg = (index, argName, val) => {
    updateActiveTab((tab) => ({
      ...tab,
      activeRecipe: tab.activeRecipe.map((step, idx) => {
        if (idx !== index) return step;
        return { ...step, args: { ...step.args, [argName]: val } };
      })
    }));
  };

  const toggleBreakpoint = (index) => {
    updateActiveTab((tab) => ({
      ...tab,
      activeRecipe: tab.activeRecipe.map((step, idx) => {
        if (idx !== index) return step;
        return { ...step, breakpoint: !step.breakpoint };
      })
    }));
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateActiveTab((tab) => {
      const oldIndex = tab.activeRecipe.findIndex((i) => i.uniqueId === active.id);
      const newIndex = tab.activeRecipe.findIndex((i) => i.uniqueId === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        return { ...tab, activeRecipe: arrayMove(tab.activeRecipe, oldIndex, newIndex) };
      }
      return tab;
    });
  };

  // Breakpoints Debugging Steps
  const stepOneOperation = () => {
    const nextStart = activeTab.pausedStepIndex !== null ? activeTab.pausedStepIndex : 0;
    executeBake({ startStep: nextStart, maxSteps: 1 });
  };

  const continueExecution = () => {
    const nextStart = activeTab.pausedStepIndex !== null ? activeTab.pausedStepIndex + 1 : 0;
    executeBake({ startStep: nextStart });
  };

  // File Handling with Chunking
  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) processFile(files[0]);
  };

  const processFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      updateActiveTab({
        inputBuffer: buffer,
        fileMeta: { name: file.name, size: file.size, type: file.type || 'binary/octet-stream' },
        inputText: `[Loaded Binary File: ${file.name} - ${file.size} bytes]`
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const clearFile = () => {
    updateActiveTab({ inputBuffer: null, fileMeta: null, inputText: '' });
  };

  // Output Actions
  const currentOutputDisplay = useMemo(() => {
    if (activeTab.outputFormat === 'hex') return activeTab.outputHex;
    if (activeTab.outputFormat === 'base64') return activeTab.outputBase64;
    if (activeTab.outputFormat === 'hexdump') return activeTab.outputHexdump;
    return activeTab.outputText;
  }, [activeTab]);

  const isInputJson = useMemo(() => {
    const trimmed = (activeTab.inputText || '').trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }, [activeTab.inputText]);

  const isOutputJson = useMemo(() => {
    const trimmed = (currentOutputDisplay || '').trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }, [currentOutputDisplay]);

  const copyOutput = () => {

    navigator.clipboard.writeText(currentOutputDisplay);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyShareLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const downloadOutput = () => {
    let blob;
    let filename = 'cyberchef_output.txt';

    if (activeTab.outputFormat === 'hex') {
      blob = new Blob([activeTab.outputHex], { type: 'text/plain' });
      filename = 'cyberchef_output.hex';
    } else if (activeTab.outputFormat === 'base64') {
      blob = new Blob([activeTab.outputBase64], { type: 'text/plain' });
      filename = 'cyberchef_output.b64';
    } else if (activeTab.outputFormat === 'hexdump') {
      blob = new Blob([activeTab.outputHexdump], { type: 'text/plain' });
      filename = 'cyberchef_hexdump.txt';
    } else {
      blob = new Blob([activeTab.outputText], { type: 'text/plain;charset=utf-8' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportHtmlSession = () => {
    downloadStandaloneHtml({
      title: `${activeTab.title} - CyberChef Workbench Session`,
      input: activeTab.inputText,
      recipe: activeTab.activeRecipe,
      output: activeTab.outputText || currentOutputDisplay,
      outputHex: activeTab.outputHex,
      durationMs: activeTab.bakeDurationMs
    });
  };

  const swapOutputToInput = () => {
    updateActiveTab({
      inputBuffer: null,
      fileMeta: null,
      inputText: activeTab.outputText
    });
  };


  // Operation Library Filtering
  const allOps = useMemo(() => registry.getAll(), []);
  const categories = useMemo(() => ['All', ...registry.getCategories()], []);

  const filteredOps = useMemo(() => {
    const q = searchOp.toLowerCase();
    return allOps.filter((op) => {
      const matchCat = selectedCategory === 'All' || op.module === selectedCategory;
      const matchQuery =
        !q ||
        op.name.toLowerCase().includes(q) ||
        (op.description && op.description.toLowerCase().includes(q)) ||
        (op.module && op.module.toLowerCase().includes(q));
      return matchCat && matchQuery;
    });
  }, [allOps, searchOp, selectedCategory]);

  // Command Palette Action Dispatcher
  const handleCommandPaletteAction = useCallback((actionId) => {
    if (actionId === 'bake') {
      executeBake();
    } else if (actionId === 'toggle_autobake') {
      setAutoBake((prev) => !prev);
    } else if (actionId === 'undo') {
      handleUndoRecipe();
    } else if (actionId === 'clear_input') {
      updateActiveTab({ inputText: '', inputBuffer: null, fileMeta: null });
    } else if (actionId === 'clear_recipe') {
      recipeUndoStackRef.current.push([...activeTab.activeRecipe]);
      updateActiveTab({ activeRecipe: [] });
    } else if (actionId === 'copy_recipe') {
      copyRecipeToClipboard();
    } else if (actionId === 'save_recipe') {
      exportRecipeFile();
    } else if (actionId === 'load_recipe') {
      recipeFileInputRef.current?.click();
    } else if (actionId === 'export_html') {
      exportHtmlSession();
    } else if (actionId === 'pipe_hardware') {
      setShowHardwareModal(true);
    } else if (actionId.startsWith('view_')) {
      const fmt = actionId.replace('view_', '');
      updateActiveTab({ outputFormat: fmt });
    }
  }, [executeBake, handleUndoRecipe, updateActiveTab, activeTab.activeRecipe, copyRecipeToClipboard, exportRecipeFile, exportHtmlSession]);

  // Global Keyboard Shortcuts (Ctrl+K, Ctrl+Enter, Ctrl+S, Ctrl+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          setIsCommandPaletteOpen((prev) => !prev);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeBake();
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          exportRecipeFile();
        } else if (e.key === 'z' || e.key === 'Z') {
          const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
          if (!isInput) {
            e.preventDefault();
            handleUndoRecipe();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [executeBake, exportRecipeFile, handleUndoRecipe]);

  const themeClass =
    themeMode === 'matrix'
      ? 'cyberchef-theme-matrix bg-black text-[#00ff66] font-mono'
      : themeMode === 'light'
      ? 'cyberchef-theme-light bg-slate-100 text-slate-800'
      : 'cyberchef-theme-cyberpunk bg-[#0c0d12] text-slate-200 font-mono';

  return (
    <div className={`flex flex-col gap-4 p-2 rounded-2xl transition-colors duration-200 ${themeClass}`}>
      {/* Theme Embedded Styles */}
      <style>{`
        .cyberchef-theme-matrix .bg-\\[\\#171920\\],
        .cyberchef-theme-matrix .bg-\\[\\#14161d\\],
        .cyberchef-theme-matrix .bg-\\[\\#12141a\\],
        .cyberchef-theme-matrix .bg-\\[\\#1e212b\\] {
          background-color: #030a04 !important;
          border-color: rgba(0, 255, 102, 0.25) !important;
          color: #00ff66 !important;
        }
        .cyberchef-theme-matrix .cm-editor,
        .cyberchef-theme-matrix .cm-theme {
          background-color: #010502 !important;
          color: #00ff66 !important;
        }
        .cyberchef-theme-light .bg-\\[\\#171920\\],
        .cyberchef-theme-light .bg-\\[\\#14161d\\],
        .cyberchef-theme-light .bg-\\[\\#12141a\\],
        .cyberchef-theme-light .bg-\\[\\#1e212b\\] {
          background-color: #ffffff !important;
          border-color: #cbd5e1 !important;
          color: #0f172a !important;
        }
        .cyberchef-theme-light .text-slate-400,
        .cyberchef-theme-light .text-slate-300,
        .cyberchef-theme-light .text-slate-200 {
          color: #334155 !important;
        }
        .cyberchef-theme-light .cm-editor {
          background-color: #f8fafc !important;
          color: #0f172a !important;
        }
      `}</style>

      {/* Top Header Card */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>CYBERCHEF & DATA OBFUSCATOR WORKBENCH</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                v3.5 Enterprise Multi-Tab
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Web Worker data pipeline with 80+ operations, Breakpoints, Auto-Bake, Presets, and Magic v2 Chaining.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Theme Selector */}
          <div className="flex items-center bg-[#1e212b] border border-[#2b303c] rounded-xl p-0.5 text-xs">
            <button
              onClick={() => handleThemeChange('cyberpunk')}
              className={`px-2 py-1 rounded-lg transition font-mono text-[11px] flex items-center gap-1 ${
                themeMode === 'cyberpunk'
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Cyberpunk Dark Mode"
              type="button"
            >
              <Moon className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Cyber</span>
            </button>
            <button
              onClick={() => handleThemeChange('matrix')}
              className={`px-2 py-1 rounded-lg transition font-mono text-[11px] flex items-center gap-1 ${
                themeMode === 'matrix'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Matrix Green Terminal Mode"
              type="button"
            >
              <Terminal className="w-3 h-3 text-emerald-400" />
              <span className="hidden sm:inline">Matrix</span>
            </button>
            <button
              onClick={() => handleThemeChange('light')}
              className={`px-2 py-1 rounded-lg transition font-mono text-[11px] flex items-center gap-1 ${
                themeMode === 'light'
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Classic Light Mode"
              type="button"
            >
              <Sun className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">Light</span>
            </button>
          </div>
        </div>
      </div>



      {/* Tabs Header Bar */}
      <div className="flex items-center gap-1 bg-[#171920] border border-[#2b303c] rounded-xl p-1.5 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition select-none ${
              activeTabId === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'bg-[#14161d] text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>{tab.title}</span>
            {tab.paused && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
            {tabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="hover:text-rose-400 p-0.5 rounded transition"
                type="button"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        <button
          onClick={addTab}
          className="px-2.5 py-1.5 rounded-lg bg-[#14161d] hover:bg-[#1f232d] border border-[#2b303c] text-slate-400 hover:text-cyan-400 text-xs transition flex items-center gap-1"
          title="Open new input/recipe tab"
          type="button"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Tab</span>
        </button>
      </div>

      {/* Breakpoint Paused Banner */}
      {activeTab.paused && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>
              Execution paused at step {(activeTab.pausedStepIndex || 0) + 1}:{' '}
              <strong>{activeTab.pausedStepOp || 'Breakpoint'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={stepOneOperation}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-300 flex items-center gap-1 font-bold"
              type="button"
            >
              <StepForward className="w-3.5 h-3.5" />
              <span>Step</span>
            </button>
            <button
              onClick={continueExecution}
              className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-lg text-emerald-300 flex items-center gap-1 font-bold"
              type="button"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Continue</span>
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Column Layout: Operations Library | Recipe Pipeline | Input & Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Operations Library & Time Machine History (3 cols) */}
        {!isPresentationMode && (
          <div className="lg:col-span-3 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[750px] overflow-hidden">

          {/* Left Column Tabs: Operations vs History */}
          <div className="flex items-center gap-1 bg-[#14161f] p-1 rounded-xl border border-[#2b303c]">
            <button
              onClick={() => setLeftTab('operations')}
              className={`flex-1 py-1 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                leftTab === 'operations'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              type="button"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Operations</span>
            </button>
            <button
              onClick={() => setLeftTab('history')}
              className={`flex-1 py-1 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                leftTab === 'history'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              type="button"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>History ({historySnapshots.length})</span>
            </button>
          </div>

          {leftTab === 'operations' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    OPERATIONS ({allOps.length})
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">Registry Active</span>
                </div>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search 80+ operations..."
                    value={searchOp}
                    onChange={(e) => setSearchOp(e.target.value)}
                    className="w-full bg-[#1e212b] border border-[#2b303c] rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition"
                  />
                </div>

                {/* Category pills */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px]">
                  {categories.slice(0, 8).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition ${
                        selectedCategory === cat
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                          : 'bg-[#1e212b] text-slate-400 hover:text-slate-200 border border-[#2b303c]'
                      }`}
                      type="button"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-y-auto space-y-1 pr-1 scrollbar-none flex-1">
                {filteredOps.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">No matching operations.</div>
                ) : (
                  filteredOps.map((op) => (
                    <button
                      key={op.id || op.name}
                      onClick={() => addOperation(op.id || op.name)}
                      className="w-full text-left p-2 rounded-xl bg-[#1e212b] hover:bg-[#252a37] border border-[#2b303c] hover:border-cyan-500/40 text-xs text-slate-300 transition flex items-center justify-between group"
                      type="button"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-bold text-slate-200 group-hover:text-cyan-300 transition truncate block">
                          {op.name}
                        </span>
                        <span className="text-[10px] text-slate-500 line-clamp-1">{op.description}</span>
                      </div>
                      <Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0 ml-1" />
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            /* Time Machine History View */
            <div className="flex flex-col flex-1 min-h-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  TIME MACHINE ({historySnapshots.length}/20)
                </span>
                {historySnapshots.length > 0 && (
                  <button
                    onClick={() => sessionHistory.clear()}
                    className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition"
                    type="button"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <div className="overflow-y-auto space-y-2 pr-1 scrollbar-none flex-1">
                {historySnapshots.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 text-xs leading-relaxed">
                    No bake snapshots recorded yet.
                    <br />
                    Bake any recipe to capture a snapshot.
                  </div>
                ) : (
                  historySnapshots.map((snap) => (
                    <div
                      key={snap.id}
                      onClick={() => {
                        updateActiveTab({
                          inputText: snap.input,
                          inputBuffer: null,
                          activeRecipe: JSON.parse(JSON.stringify(snap.recipe)),
                          outputText: snap.output,
                          outputHex: snap.outputHex || '',
                          bakeDurationMs: snap.durationMs,
                          errorMsg: null,
                          paused: false
                        });
                      }}
                      className="p-2.5 rounded-xl bg-[#1e212b] hover:bg-[#252a37] border border-[#2b303c] hover:border-cyan-500/40 cursor-pointer transition space-y-1.5 group"
                      title="Click to restore this snapshot"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-cyan-400">
                          {new Date(snap.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-slate-500 font-mono">
                          {snap.durationMs !== undefined ? `${snap.durationMs}ms` : ''}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-200 group-hover:text-cyan-300 truncate">
                        {snap.recipeSummary || 'Empty Pipeline'}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 truncate bg-[#14161f] px-1.5 py-0.5 rounded border border-[#232733]">
                        In: {snap.inputPreview || '(empty)'}
                      </div>
                      {snap.outputPreview && (
                        <div className="text-[10px] font-mono text-emerald-400/80 truncate">
                          Out: {snap.outputPreview}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Column 2: Recipe Pipeline (4 cols) */}
        {!isPresentationMode && (
          <div className="lg:col-span-4 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[750px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#232733] pb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>RECIPE ({activeTab.activeRecipe.length})</span>
              </span>

              <div className="flex items-center gap-1.5 text-[10px]">
                {/* Recipe Test Suite Button */}
                <button
                  onClick={() => {
                    setTestingRecipe(activeTab.activeRecipe);
                    setShowTestModal(true);
                  }}
                  disabled={activeTab.activeRecipe.length === 0}
                  className="text-slate-400 hover:text-emerald-300 disabled:opacity-40 disabled:hover:text-slate-400 px-1.5 py-0.5 rounded bg-[#14161f] border border-[#2b303c] transition flex items-center gap-1"
                  title="Run Recipe Test Suite"
                  type="button"
                >
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                  <span>Test</span>
                </button>
                <button
                  onClick={handleUndoRecipe}
                  disabled={recipeUndoStackRef.current.length === 0}
                  className="text-slate-400 hover:text-cyan-300 disabled:opacity-40 disabled:hover:text-slate-400 px-1.5 py-0.5 rounded bg-[#14161f] border border-[#2b303c] transition flex items-center gap-1"
                  title="Undo last recipe change (Ctrl+Z)"
                  type="button"
                >
                  <RotateCcw className="w-2.5 h-2.5 text-slate-400" />
                  <span>Undo</span>
                </button>

              <button
                onClick={copyRecipeToClipboard}
                className="text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded bg-[#14161f] border border-[#2b303c] transition flex items-center gap-1"
                title="Copy Recipe JSON to clipboard"
                type="button"
              >
                {copiedRecipe ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-slate-400" />}
                <span>{copiedRecipe ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={exportRecipeFile}
                className="text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded bg-[#14161f] border border-[#2b303c] transition flex items-center gap-1"
                title="Save Recipe JSON (.cyberchef file) (Ctrl+S)"
                type="button"
              >
                <Download className="w-2.5 h-2.5 text-slate-400" />
                <span>Save</span>
              </button>
              <input
                type="file"
                ref={recipeFileInputRef}
                onChange={importRecipeFile}
                accept=".json,.cyberchef"
                className="hidden"
              />
              <button
                onClick={() => recipeFileInputRef.current?.click()}
                className="text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded bg-[#14161f] border border-[#2b303c] transition flex items-center gap-1"
                title="Load Recipe JSON (.cyberchef file)"
                type="button"
              >
                <Upload className="w-2.5 h-2.5 text-slate-400" />
                <span>Load</span>
              </button>
              <button
                onClick={() => {
                  recipeUndoStackRef.current.push([...activeTab.activeRecipe]);
                  updateActiveTab({ activeRecipe: [] });
                }}
                className="text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded transition"
                title="Clear all operations"
                type="button"
              >
                Clear
              </button>
            </div>
          </div>


          <div className="overflow-y-auto space-y-2 pr-1 scrollbar-none flex-1">
            {activeTab.activeRecipe.length === 0 ? (
              <div className="py-20 text-center text-slate-500 text-xs leading-relaxed">
                No operations in recipe.
                <br />
                Click an operation from the library to add.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={activeTab.activeRecipe.map((s) => s.uniqueId)}
                  strategy={verticalListSortingStrategy}
                >
                  {activeTab.activeRecipe.map((step, idx) => {
                    const op = registry.get(step.op || step.name || step.id);
                    const isPausedHere = activeTab.paused && activeTab.pausedStepIndex === idx;
                    return (
                      <SortableRecipeItem
                        key={step.uniqueId}
                        step={step}
                        index={idx}
                        op={op}
                        isPausedHere={isPausedHere}
                        onRemove={removeStep}
                        onUpdateArg={updateStepArg}
                        onToggleBreakpoint={toggleBreakpoint}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
        )}

        {/* Column 3: Input & Output Areas */}
        <div className={`${isPresentationMode ? 'lg:col-span-12' : 'lg:col-span-5'} flex flex-col space-y-4`}>
          {isPresentationMode && (
            <div className="flex items-center justify-between p-3 bg-purple-950/30 border border-purple-500/40 rounded-2xl text-xs text-purple-200 shadow-lg">
              <div className="flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-purple-400" />
                <span className="font-bold">PRESENTATION MODE</span>
                <span className="text-purple-300/70 text-[11px] hidden sm:inline">— Sidebars hidden for focused payload analysis and clean screenshots.</span>
              </div>
              <button
                onClick={() => setIsPresentationMode(false)}
                className="px-2.5 py-1 bg-purple-500 hover:bg-purple-400 text-slate-950 font-bold rounded-lg text-xs transition"
                type="button"
              >
                Exit Presentation
              </button>
            </div>
          )}

          {/* Input Deck with File Drop Zone & Magic Heuristic */}
          <div

            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={handleFileDrop}
            className={`bg-[#171920] border ${
              isDraggingFile ? 'border-cyan-400 bg-cyan-950/20' : 'border-[#2b303c]'
            } rounded-2xl p-4 flex flex-col space-y-2 transition-colors relative`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-[11px]">INPUT DATA</span>
                {activeTab.fileMeta && (
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                    <FileIcon className="w-3 h-3" />
                    <span className="truncate max-w-[120px]">{activeTab.fileMeta.name}</span>
                    <button onClick={clearFile} className="hover:text-rose-400 ml-0.5" type="button">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Pipe Hardware Data Button */}
                <button
                  onClick={() => setShowHardwareModal(true)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 border shadow-sm ${
                    isPipingActive
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 animate-pulse'
                      : 'bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border-[#2b303c]'
                  }`}
                  title="Pipe live data stream from WebSerial, WebUSB, or Mock Hardware"
                  type="button"
                >
                  <Radio className={`w-3 h-3 ${isPipingActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{isPipingActive ? 'Piping Active' : 'Pipe Hardware'}</span>
                  {isPipingActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping ml-0.5" />
                  )}
                </button>

                {/* Magic Heuristic Button */}
                <button
                  onClick={() => setShowMagicModal(true)}
                  className="px-2.5 py-1 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 hover:from-purple-500/30 hover:to-cyan-500/30 border border-purple-500/40 text-purple-300 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-sm"
                  title="Inspect Shannon Entropy & Auto-Detect Decoder"
                  type="button"
                >
                  <Sparkles className="w-3 h-3 text-purple-300" />
                  <span>Magic</span>
                  {magicResult?.bestMatch && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
                  )}
                </button>

                {/* File Upload Button */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      processFile(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 rounded-lg border border-[#2b303c] transition flex items-center gap-1 text-[11px]"
                  title="Upload File"
                  type="button"
                >
                  <Upload className="w-3 h-3 text-slate-400" />
                  <span>Upload</span>
                </button>

                <span className="text-[10px] font-mono text-slate-500">
                  {activeTab.inputBuffer ? `${activeTab.inputBuffer.byteLength} bytes` : `${activeTab.inputText.length} chars`}
                </span>
              </div>
            </div>

            {/* Live Streaming Activity Banner */}
            {isPipingActive && (
              <div className="flex items-center justify-between text-[10px] font-mono px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-cyan-300">
                <div className="flex items-center gap-2 truncate mr-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                  <span className="font-bold">STREAMING ({pipingSource.replace('_', ' ').toUpperCase()}):</span>
                  <span>{pipingStats.bytes.toLocaleString()} bytes ingested ({pipingStats.frames} frames)</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400">
                    Buffer: {pipingBufferLimit > 0 ? `${(pipingBufferLimit / 1024).toFixed(0)}KB rolling` : 'Unlimited'}
                  </span>
                  <button
                    onClick={() => setIsPipingActive(false)}
                    className="px-1.5 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded text-[9px] border border-rose-500/30"
                    type="button"
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}

            <CodeMirror
              value={activeTab.inputText}
              height={isPresentationMode ? '280px' : '150px'}
              minHeight="140px"
              theme={themeMode === 'light' ? 'light' : 'dark'}
              extensions={isInputJson ? [json()] : []}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false
              }}
              onChange={(val) => {
                updateActiveTab({
                  inputBuffer: null,
                  fileMeta: null,
                  inputText: val
                });
              }}
              placeholder="Paste or type raw string, hex payload, drag & drop a file, or pipe live hardware data..."
              className="w-full text-xs font-mono rounded-xl overflow-hidden border border-[#282d3a] focus-within:border-cyan-400 transition"
            />
          </div>


          {/* Feedback Button: Send Output -> Input */}
          <div className="flex items-center justify-center">
            <button
              onClick={swapOutputToInput}
              disabled={!activeTab.outputText}
              className="px-3 py-1.5 bg-[#171920] hover:bg-[#1f232d] text-cyan-400 border border-[#2b303c] rounded-xl text-xs font-mono transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
              title="Replace input with current output for recursive transforms"
              type="button"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Use Output as Input</span>
            </button>
          </div>

          {/* Output Deck with Multi-Format Viewers, Hex Editor & Charts */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-2 flex-1">
            <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-[11px] text-emerald-400">
                  BAKED OUTPUT
                </span>
                {isBaking && (
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono animate-pulse">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    <span>Processing in Web Worker...</span>
                  </span>
                )}
                {!isBaking && activeTab.bakeDurationMs !== null && (
                  <span className="text-[10px] text-slate-500 font-mono">{activeTab.bakeDurationMs} ms</span>
                )}
              </div>

              {/* Format Switcher */}
              <div className="flex items-center gap-1 bg-[#12141a] p-0.5 rounded-lg border border-[#2b303c] overflow-x-auto max-w-sm sm:max-w-md scrollbar-none">
                {[
                  { id: 'text', label: 'Text' },
                  { id: 'hex', label: 'Hex' },
                  { id: 'base64', label: 'Base64' },
                  { id: 'hexdump', label: 'Hexdump' },
                  { id: 'hexeditor', label: 'Hex Editor' },
                  { id: 'charts', label: 'Charts' },
                  { id: 'tree', label: 'JSON Tree' },
                  { id: 'table', label: 'Table' },
                  { id: 'jwt', label: 'JWT' }
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    onClick={() => updateActiveTab({ outputFormat: fmt.id })}
                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono transition whitespace-nowrap ${
                      activeTab.outputFormat === fmt.id
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    type="button"
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={exportHtmlSession}
                  disabled={!currentOutputDisplay && !activeTab.inputText}
                  className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-cyan-300 rounded-lg border border-cyan-500/30 transition flex items-center gap-1 text-[11px] disabled:opacity-40"
                  title="Download standalone offline HTML report"
                  type="button"
                >
                  <FileCode className="w-3 h-3 text-cyan-400" />
                  <span>HTML</span>
                </button>

                <button
                  onClick={downloadOutput}
                  disabled={!currentOutputDisplay}
                  className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 rounded-lg border border-[#2b303c] transition flex items-center gap-1 text-[11px] disabled:opacity-40"
                  title="Download baked output file"
                  type="button"
                >
                  <Download className="w-3 h-3 text-slate-400" />
                  <span>Download</span>
                </button>

                <button
                  onClick={copyOutput}
                  disabled={!currentOutputDisplay}
                  className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 rounded-lg border border-[#2b303c] transition flex items-center gap-1 text-[11px] disabled:opacity-40"
                  type="button"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-slate-400" />
                  )}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {activeTab.errorMsg ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
                {activeTab.errorMsg}
              </div>
            ) : activeTab.outputFormat === 'charts' ? (
              <CyberChefCharts data={activeTab.outputText || currentOutputDisplay} />
            ) : activeTab.outputFormat === 'hexeditor' ? (
              <CyberChefHexEditor
                data={activeTab.outputText || currentOutputDisplay}
                onApplyToInput={(modifiedBytes) => {
                  const text = new TextDecoder('utf-8', { fatal: false }).decode(modifiedBytes);
                  updateActiveTab({
                    inputBuffer: modifiedBytes.buffer.slice(modifiedBytes.byteOffset, modifiedBytes.byteOffset + modifiedBytes.byteLength),
                    inputText: text,
                    fileMeta: null
                  });
                }}
              />
            ) : (activeTab.outputFormat === 'tree' || activeTab.outputFormat === 'table' || activeTab.outputFormat === 'jwt') ? (
              <CyberChefStructuredView mode={activeTab.outputFormat} data={activeTab.outputText || currentOutputDisplay} />
            ) : (
              <CodeMirror
                value={currentOutputDisplay || ''}
                height={isPresentationMode ? '340px' : '220px'}
                minHeight="180px"
                readOnly={true}
                editable={false}
                theme={themeMode === 'light' ? 'light' : 'dark'}
                extensions={isOutputJson ? [json()] : []}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: false
                }}
                className="w-full text-xs font-mono rounded-xl overflow-hidden border border-[#282d3a] transition"
              />
            )}
          </div>


        </div>
      </div>

      {/* Magic Heuristic Inspection Modal */}
      {showMagicModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2b303c] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-slate-100">"MAGIC" HEURISTIC ENGINE v2</h3>
              </div>
              <button
                onClick={() => setShowMagicModal(false)}
                className="text-slate-400 hover:text-slate-200"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {magicResult && (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-[#12141a] p-3 rounded-xl border border-[#282d3a]">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Shannon Entropy</span>
                    <span className="text-sm font-bold text-cyan-300 font-mono">
                      {magicResult.entropy} / 8.0
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {magicResult.isEncryptedOrCompressed ? 'High (Compressed/Encrypted)' : 'Normal (Plaintext/Structured)'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Detected Header</span>
                    <span className="text-sm font-bold text-purple-300 font-mono">
                      {magicResult.magicBytes || 'None'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Printable: {Math.round(magicResult.printableRatio * 100)}%
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    RECOMMENDED DECODING RECIPES (DEPTH ≤ 3)
                  </span>

                  {magicResult.suggestions.length === 0 ? (
                    <div className="py-6 text-center text-slate-500">
                      No automated decoding pattern detected for current input.
                    </div>
                  ) : (
                    magicResult.suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#1e212b] border border-[#2b303c] hover:border-purple-500/40 space-y-2 transition flex items-center justify-between"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200">{s.op}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono">
                              {Math.round(s.confidence * 100)}% confidence
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">{s.reason}</p>
                          {s.preview && (
                            <p className="text-[10px] text-emerald-400 font-mono truncate mt-1">
                              Preview: {s.preview}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            updateActiveTab({
                              activeRecipe: s.recipe.map((step, sIdx) => ({
                                op: step.op,
                                args: step.args || {},
                                uniqueId: `magic-${Date.now()}-${sIdx}`,
                                breakpoint: false
                              }))
                            });
                            setShowMagicModal(false);
                          }}
                          className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-400 hover:to-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition shrink-0"
                          type="button"
                        >
                          Apply
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Presets Management Modal */}
      {showPresetsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2b303c] pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">RECIPE PRESETS</h3>
              </div>
              <button
                onClick={() => setShowPresetsModal(false)}
                className="text-slate-400 hover:text-slate-200"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Save current recipe as preset */}
            <div className="bg-[#12141a] p-3 rounded-xl border border-[#282d3a] space-y-2">
              <span className="text-[11px] font-bold text-slate-300 block">SAVE CURRENT RECIPE</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Preset Name..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="bg-[#1a1d26] border border-[#2b303c] rounded-lg px-3 py-1.5 text-xs text-slate-200 flex-1 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <button
                  onClick={saveCurrentRecipeAsPreset}
                  className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition"
                  type="button"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Built-in and Saved Presets list */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                BUILT-IN PRESETS
              </span>
              {RECIPE_PRESETS.map((p) => (
                <div
                  key={p.name}
                  className="p-2.5 rounded-xl bg-[#1e212b] border border-[#2b303c] hover:border-cyan-500/40 flex items-center justify-between transition"
                >
                  <div>
                    <span className="font-bold text-slate-200 block">{p.name}</span>
                    <span className="text-[10px] text-slate-500">{p.steps.map((s) => s.op).join(' → ')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setTestingRecipe(p.steps);
                        setShowTestModal(true);
                      }}
                      className="px-2 py-1 bg-[#14161d] hover:bg-emerald-500/20 text-emerald-300 border border-[#2b303c] rounded-lg text-[11px] font-bold transition flex items-center gap-1"
                      title="Run Test Suite for this preset"
                      type="button"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Test</span>
                    </button>
                    <button
                      onClick={() => loadPreset(p)}
                      className="px-2.5 py-1 bg-[#14161d] hover:bg-cyan-500/20 text-cyan-300 border border-[#2b303c] rounded-lg text-[11px] font-bold transition"
                      type="button"
                    >
                      Load
                    </button>
                  </div>
                </div>
              ))}

              {savedUserPresets.length > 0 && (
                <>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block pt-2">
                    SAVED RECIPES (LOCALSTORAGE)
                  </span>
                  {savedUserPresets.map((p) => (
                    <div
                      key={p.name}
                      className="p-2.5 rounded-xl bg-[#1e212b] border border-[#2b303c] hover:border-amber-500/40 flex items-center justify-between transition"
                    >
                      <div>
                        <span className="font-bold text-slate-200 block">{p.name}</span>
                        <span className="text-[10px] text-slate-500">{p.steps.map((s) => s.op).join(' → ')}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setTestingRecipe(p.steps);
                            setShowTestModal(true);
                          }}
                          className="px-2 py-1 bg-[#14161d] hover:bg-emerald-500/20 text-emerald-300 border border-[#2b303c] rounded-lg text-[11px] font-bold transition flex items-center gap-1"
                          title="Run Test Suite for this saved recipe"
                          type="button"
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>Test</span>
                        </button>
                        <button
                          onClick={() => loadPreset(p)}
                          className="px-2.5 py-1 bg-[#14161d] hover:bg-amber-500/20 text-amber-300 border border-[#2b303c] rounded-lg text-[11px] font-bold transition"
                          type="button"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => deletePreset(p.name)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                          type="button"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pipe Hardware Telemetry Modal */}
      {showHardwareModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2b303c] pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">PIPE HARDWARE TELEMETRY</h3>
              </div>
              <button
                onClick={() => setShowHardwareModal(false)}
                className="text-slate-400 hover:text-slate-200"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Source Selection */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-300 block uppercase font-mono">
                  1. Select Hardware Stream Source
                </span>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    {
                      id: 'serial',
                      name: 'WebSerial Active COM Port',
                      desc: safeSerial?.activeBoard
                        ? `Port: ${safeSerial.activeBoard.name || 'COM Device'} (${safeSerial.activeBoard.status})`
                        : 'WebSerial port stream (Flasher / Terminal)',
                      icon: Cpu
                    },
                    {
                      id: 'alfa_wifi',
                      name: 'Alfa Wi-Fi 802.11 RX Stream (WebUSB)',
                      desc: 'Captures raw 802.11 frames (Management Beacons, Probe Reqs)',
                      icon: Wifi
                    },
                    {
                      id: 'mock_nmea',
                      name: 'Mock GPS NMEA-0183 Telemetry',
                      desc: 'Continuous $GNGGA / $GPRMC satellite navigation coordinates',
                      icon: Activity
                    },
                    {
                      id: 'mock_esp32',
                      name: 'Mock ESP32 Firmware Telemetry',
                      desc: 'Live boot logs, heap memory status, and Wi-Fi RSSI events',
                      icon: Terminal
                    },
                    {
                      id: 'mock_binary',
                      name: 'Mock Binary Sensor Frames',
                      desc: '16-byte raw sync frames [0xAA, 0x55, seq, sensor, crc16]',
                      icon: Binary
                    }
                  ].map((src) => (
                    <div
                      key={src.id}
                      onClick={() => setPipingSource(src.id)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                        pipingSource === src.id
                          ? 'bg-cyan-500/10 border-cyan-400 text-cyan-200'
                          : 'bg-[#12141a] border-[#282d3a] hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <src.icon className={`w-4 h-4 ${pipingSource === src.id ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <div>
                          <span className="font-bold block text-[11px]">{src.name}</span>
                          <span className="text-[10px] text-slate-500 block">{src.desc}</span>
                        </div>
                      </div>
                      <input
                        type="radio"
                        name="pipingSource"
                        checked={pipingSource === src.id}
                        onChange={() => setPipingSource(src.id)}
                        className="accent-cyan-400"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rolling Buffer Configuration */}
              <div className="space-y-2 bg-[#12141a] p-3 rounded-xl border border-[#282d3a]">
                <span className="text-[11px] font-bold text-slate-300 block uppercase font-mono">
                  2. Rolling Capture Buffer Window
                </span>
                <p className="text-[10px] text-slate-500">
                  Retains only the latest bytes to prevent memory crashes when streaming high-frequency telemetry.
                </p>
                <div className="flex items-center gap-1.5 pt-1">
                  {[
                    { label: '2 KB', value: 2048 },
                    { label: '5 KB', value: 5120 },
                    { label: '10 KB (Default)', value: 10240 },
                    { label: '50 KB', value: 51200 },
                    { label: 'Unlimited', value: 0 }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPipingBufferLimit(opt.value)}
                      className={`px-2 py-1 rounded text-[10px] font-mono transition ${
                        pipingBufferLimit === opt.value
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 font-bold'
                          : 'bg-[#1a1d26] text-slate-400 border border-[#282d3a] hover:text-slate-200'
                      }`}
                      type="button"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* WebSerial Connection Quick Actions if selected */}
              {pipingSource === 'serial' && safeSerial && (
                <div className="bg-[#12141a] p-3 rounded-xl border border-[#282d3a] flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-slate-300 block font-mono">WebSerial Connection</span>
                    <span className="text-[10px] text-slate-500">
                      Status: {safeSerial.activeBoard?.status || 'disconnected'} | Baud: {safeSerial.activeBoard?.baudRate || 115200}
                    </span>
                  </div>
                  {safeSerial.activeBoard?.status !== 'connected' ? (
                    <button
                      onClick={() => safeSerial.connect?.()}
                      className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400 rounded-lg text-[11px] font-mono font-bold"
                      type="button"
                    >
                      Connect Port
                    </button>
                  ) : (
                    <button
                      onClick={() => safeSerial.disconnect?.()}
                      className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400 rounded-lg text-[11px] font-mono font-bold"
                      type="button"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              )}

              {/* Modal Bottom Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-[#232733]">
                <button
                  onClick={clearHardwareBuffer}
                  className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-400 hover:text-rose-400 border border-[#2b303c] rounded-lg text-xs font-mono transition"
                  type="button"
                >
                  Clear Buffer ({pipingStats.bytes.toLocaleString()}B)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsPipingActive(!isPipingActive);
                      if (!isPipingActive) setShowHardwareModal(false);
                    }}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold font-mono transition flex items-center gap-1.5 ${
                      isPipingActive
                        ? 'bg-rose-500 hover:bg-rose-600 text-white'
                        : 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    }`}
                    type="button"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>{isPipingActive ? 'Stop Stream' : 'Start Piping Stream'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Command Palette (Ctrl+K) */}
      <CyberChefCommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        operations={allOps}
        onSelectOperation={(op) => addOperation(op.id || op.name)}
        onAction={handleCommandPaletteAction}
        autoBake={autoBake}
      />

      {/* Recipe Test Suites & Validation Modal */}
      <CyberChefRecipeTestModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        recipe={testingRecipe || activeTab.activeRecipe}
      />
    </div>
  );
}


