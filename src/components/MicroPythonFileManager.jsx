import React, { useState, useRef, useEffect } from 'react';
import { useSerial } from '../context/SerialContext';
import { runInRawRepl, withRawRepl } from '../utils/micropythonRawRepl';
import { 
  FileCode, 
  Folder, 
  Upload, 
  Download, 
  Trash2, 
  RefreshCw, 
  Play, 
  FileText, 
  Save, 
  HardDrive, 
  Terminal, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle,
  Plus,
  X,
  Code,
  CornerLeftUp,
  FolderTree,
  Package,
  Search,
  Pencil,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { pyStr, buildDeleteScript, writeFileChunked, readFileChunked } from '../utils/micropythonFiles';
import { resolvePackage } from '../utils/micropythonMip';
import {
  joinPath, parentPath, formatSize, sortFilterEntries, validateName,
  buildRemoveTreeScript, buildRenameScript, buildRunFileScript, parseMarker,
} from '../utils/micropythonTools';
import { MICROPYTHON_DRIVERS } from '../utils/microPythonDrivers';

export default function MicroPythonFileManager({
  isConnected,
  onSendString,
  latestRxText = '',
  onLogMessage,
  boards = [],
  activeBoardId,
  onSelectBoard
}) {
  const [deviceFiles, setDeviceFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [platformInfo, setPlatformInfo] = useState('');
  const [storageInfo, setStorageInfo] = useState({ totalKb: 0, freeKb: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  
  // File Editor Modal State
  const [editingFile, setEditingFile] = useState(null); // { name, content }
  const [isNewFileModal, setIsNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('main.py');
  const [newFileContent, setNewFileContent] = useState('# MicroPython entrypoint\nprint("Hello from Skon\'s USB Tool!")\n');

  // View Mode: 'files' | 'mip'
  const [subView, setSubView] = useState('files');
  const [driverSearch, setDriverSearch] = useState('');
  const [installingDriverId, setInstallingDriverId] = useState(null);
  const [customPackageName, setCustomPackageName] = useState('');

  // Quick One-liner runner
  const [quickCode, setQuickCode] = useState('import sys; print("MicroPython on:", sys.platform)');

  const fileInputRef = useRef(null);
  // Raw REPL I/O goes through the shared connection directly: every received
  // chunk (subscribeRx) and unmodified bytes (no line ending added).
  const { sendRawBytes, subscribeRx } = useSerial();

  // Helper to execute Python code via MicroPython Raw REPL
  // Run code in the raw REPL and return its output (stdout, then any traceback).
  // Waits for the REPL's own terminators instead of fixed delays.
  const executeInRawRepl = async (codeStr, timeoutMs = 15000) => {
    try {
      return await runInRawRepl(sendRawBytes, subscribeRx, codeStr, timeoutMs);
    } catch (err) {
      // Surface the real failure to the caller/UI instead of looking like an empty result.
      onLogMessage?.(`[MICROPYTHON] ${err.message}`, 'sys');
      throw err;
    }
  };

  // Transfer progress + cancel for chunked reads/writes
  const [transfer, setTransfer] = useState(null); // { label, done, total }
  const abortRef = useRef(null);
  const runTransfer = async (label, fn) => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setTransfer({ label, done: 0, total: 0 });
    try {
      return await withRawRepl(sendRawBytes, subscribeRx, (repl) => fn(repl, {
        signal: ctl.signal,
        onProgress: (done, total) => setTransfer({ label, done, total }),
      }));
    } finally {
      abortRef.current = null;
      setTransfer(null);
    }
  };
  const cancelTransfer = () => abortRef.current?.abort();

  // Device control: Ctrl-C stop, soft reset (Ctrl-D), hard reset (machine.reset)
  const handleDeviceControl = async (kind) => {
    if (!isConnected) return;
    try {
      if (kind === 'stop') await sendRawBytes(Uint8Array.of(0x03, 0x03));
      else if (kind === 'soft') await sendRawBytes(Uint8Array.of(0x03, 0x03, 0x04));
      else if (kind === 'hard') {
        if (!confirm('Hard reset the board? The serial connection may drop.')) return;
        await sendRawBytes(new TextEncoder().encode('\x03\x03import machine; machine.reset()\r\n'));
      }
      onLogMessage?.(`[MICROPYTHON] ${kind} sent`, 'sys');
    } catch (err) {
      onLogMessage?.(`[MICROPYTHON] ${kind} failed: ${err.message}`, 'sys');
    }
  };

  const handleMkdir = async () => {
    const name = prompt('New folder name');
    if (!name) return;
    const full = joinPath(currentPath, name);
    setIsExecuting(true);
    try {
      const out = await executeInRawRepl(`import os\nos.mkdir(${pyStr(full)})\nprint("__OK__")`);
      if (!out.includes('__OK__')) throw new Error(out.trim() || 'mkdir failed');
      await handleScanFiles(currentPath);
    } catch (err) {
      alert(`mkdir failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // mip: install by name / github: spec / URL, fetched in the browser, written to /lib
  const [mipStatus, setMipStatus] = useState('');
  const handleMipInstall = async () => {
    const spec = customPackageName.trim();
    if (!isConnected || !spec) return;
    setIsExecuting(true);
    setMipStatus('Resolving...');
    try {
      const files = await resolvePackage(spec, { onStatus: setMipStatus });
      await runTransfer(`mip ${spec}`, async (repl, opts) => {
        const dirs = new Set(['/lib']);
        for (const f of files) {
          const parts = f.path.split('/').slice(1, -1);
          let cur = '';
          for (const part of parts) { cur += '/' + part; dirs.add(cur); }
        }
        for (const d of [...dirs].sort()) {
          await repl.execChecked(`import os\ntry:\n    os.mkdir(${pyStr(d)})\nexcept OSError:\n    pass`);
        }
        for (const f of files) {
          setMipStatus(`Writing ${f.path}`);
          await writeFileChunked(repl, f.path, f.bytes, opts);
        }
      });
      setMipStatus(`Installed ${files.length} file(s): ${files.map((f) => f.path).join(', ')}`);
      onLogMessage?.(`[MIP] Installed ${spec}: ${files.map((f) => f.path).join(', ')}`, 'sys');
    } catch (err) {
      setMipStatus(`Failed: ${err.message}`);
      onLogMessage?.(`[MIP ERROR] ${err.message}`, 'err');
    } finally {
      setIsExecuting(false);
    }
  };

  // Scan Flash Filesystem in currentPath
  const handleScanFiles = async (dirToScan = currentPath) => {
    if (!isConnected) {
      alert('Please connect to a MicroPython/CircuitPython serial port first.');
      return;
    }

    setIsScanning(true);
    setCurrentPath(dirToScan);
    onLogMessage?.(`[MICROPYTHON] Interrogating directory "${dirToScan}" via Raw REPL...`, 'sys');

    const scanPython = `
import os, sys, ujson
plat = getattr(sys, 'platform', 'unknown')
tot_kb, free_kb = 0, 0
try:
    s = os.statvfs('/')
    tot_kb = (s[0] * s[2]) // 1024
    free_kb = (s[0] * s[3]) // 1024
except:
    pass
items = []
target_dir = ${pyStr(dirToScan)}
try:
    for entry in os.ilistdir(target_dir):
        name = entry[0]
        mode = entry[1]
        sz = entry[3] if len(entry) > 3 else 0
        is_dir = bool(mode & 0x4000)
        items.append({'name': name, 'size': sz, 'isDir': is_dir})
except:
    try:
        for name in os.listdir(target_dir):
            items.append({'name': name, 'size': 0, 'isDir': False})
    except:
        pass
print("__PY_DATA_START__")
print(ujson.dumps({'platform': plat, 'total_kb': tot_kb, 'free_kb': free_kb, 'files': items}))
print("__PY_DATA_END__")
`.trim();

    try {
      const output = await executeInRawRepl(scanPython);
      
      const startMarker = '__PY_DATA_START__';
      const endMarker = '__PY_DATA_END__';
      
      const sIdx = output.indexOf(startMarker);
      const eIdx = output.indexOf(endMarker);

      if (sIdx !== -1 && eIdx !== -1) {
        const jsonPart = output.substring(sIdx + startMarker.length, eIdx).trim();
        const data = JSON.parse(jsonPart);
        setPlatformInfo(data.platform || 'MicroPython Device');
        setStorageInfo({ totalKb: data.total_kb, freeKb: data.free_kb });
        setDeviceFiles(data.files || []);
        onLogMessage?.(`[MICROPYTHON] Scanned "${dirToScan}": ${data.files.length} items found on ${data.platform}`, 'sys');
      } else {
        onLogMessage?.('[MICROPYTHON] RAW REPL output did not contain structured JSON marker. Raw response:\n' + output, 'sys');
      }
    } catch (err) {
      onLogMessage?.(`[MICROPYTHON] Scan failed: ${err.message}`, 'sys');
    } finally {
      setIsScanning(false);
    }
  };

  const getFullPath = (fileName) => {
    return joinPath(currentPath, fileName);
  };

  // Read file from device to view/edit
  const handleReadFile = async (fileName) => {
    if (!isConnected) return;
    setIsExecuting(true);
    const fullPath = getFullPath(fileName);
    onLogMessage?.(`[MICROPYTHON] Reading file "${fullPath}"...`, 'sys');

    try {
      const bytes = await runTransfer(`Reading ${fullPath}`, (repl, opts) => readFileChunked(repl, fullPath, opts));
      const textContent = new TextDecoder().decode(bytes);
      setEditingFile({ name: fullPath, content: textContent });
      onLogMessage?.(`[MICROPYTHON] Successfully loaded "${fullPath}" (${bytes.length} bytes)`, 'sys');
    } catch (err) {
      if (err.name !== 'AbortError') alert(`Error reading file: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Download file to PC
  const handleDownloadFile = async (fileName) => {
    if (!isConnected) return;
    setIsExecuting(true);
    const fullPath = getFullPath(fileName);
    onLogMessage?.(`[MICROPYTHON] Downloading "${fullPath}" to PC...`, 'sys');

    try {
      const bytes = await runTransfer(`Downloading ${fullPath}`, (repl, opts) => readFileChunked(repl, fullPath, opts));
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      onLogMessage?.(`[MICROPYTHON] "${fileName}" downloaded to host`, 'sys');
    } catch (err) {
      if (err.name !== 'AbortError') alert(`Download failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Save / Upload File Content to Device
  const handleSaveFileContent = async (targetFilePath, content) => {
    if (!isConnected) return;
    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON] Writing file "${targetFilePath}" to flash...`, 'sys');

    try {
      await runTransfer(`Writing ${targetFilePath}`, (repl, opts) => writeFileChunked(repl, targetFilePath, content, opts));
      onLogMessage?.(`[MICROPYTHON] Successfully saved "${targetFilePath}"!`, 'sys');
      setEditingFile(null);
      setIsNewFileModal(false);
      await handleScanFiles(currentPath);
    } catch (err) {
      if (err.name === 'AbortError') onLogMessage?.(`[MICROPYTHON] Write of "${targetFilePath}" cancelled (file may be partial)`, 'sys');
      else alert(`Write failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Delete a file, or a folder with everything in it (confirmed first)
  const handleDeleteFile = async (file) => {
    const fullPath = getFullPath(file.name);
    const msg = file.isDir
      ? `Delete folder "${fullPath}" and EVERYTHING inside it from the device? This cannot be undone.`
      : `Are you sure you want to delete "${fullPath}" from the device filesystem?`;
    if (!confirm(msg)) return;

    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON] Removing "${fullPath}"...`, 'sys');
    try {
      const output = await executeInRawRepl(buildRemoveTreeScript(fullPath), 60000);
      const r = parseMarker(output, '__RM_OK__', '__RM_ERR__');
      if (r.ok) {
        onLogMessage?.(`[MICROPYTHON] Deleted "${fullPath}"`, 'sys');
        await handleScanFiles(currentPath);
      } else {
        alert(`Failed to delete: ${r.error}`);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Rename / move within the device filesystem (os.rename)
  const handleRename = async (file) => {
    const from = getFullPath(file.name);
    const input = prompt(`Rename / move "${from}" to (path relative to the current folder, or absolute with a leading /)`, file.name);
    if (input === null) return;
    const err = validateName(input);
    if (err) { alert(err); return; }
    const to = input.trim().startsWith('/') ? input.trim() : getFullPath(input.trim());
    if (to === from) return;
    setIsExecuting(true);
    try {
      const output = await executeInRawRepl(buildRenameScript(from, to));
      const r = parseMarker(output, '__MV_OK__', '__MV_ERR__');
      if (!r.ok) throw new Error(r.error);
      onLogMessage?.(`[MICROPYTHON] Renamed "${from}" -> "${to}"`, 'sys');
      await handleScanFiles(currentPath);
    } catch (e) {
      alert(`Rename failed: ${e.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Run a script that is stored on the device (exec of its source) and show its output
  const [runOutput, setRunOutput] = useState(null); // { title, text }
  const handleRunFile = async (file) => {
    if (!isConnected) return;
    const fullPath = getFullPath(file.name);
    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON EXEC] run ${fullPath}`, 'tx');
    setRunOutput({ title: `run ${fullPath}`, text: 'Running... (a script that never returns will time out; use Stop)' });
    try {
      const output = await executeInRawRepl(buildRunFileScript(fullPath), 30000);
      setRunOutput({ title: `run ${fullPath}`, text: output || '(no output)' });
      onLogMessage?.(`[MICROPYTHON OUTPUT]
${output}`, 'rx');
    } catch (err) {
      setRunOutput({ title: `run ${fullPath}`, text: `Error: ${err.message}` });
    } finally {
      setIsExecuting(false);
    }
  };

  // File list view state
  const [fileFilter, setFileFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const shownFiles = sortFilterEntries(deviceFiles, { filter: fileFilter, key: sortKey, desc: sortDesc });
  const toggleSort = (k) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(false); }
  };

  // Upload one or more host files (picker or drag-and-drop) into the current directory
  const uploadHostFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!isConnected || files.length === 0) return;
    for (const file of files) {
      const buf = new Uint8Array(await file.arrayBuffer());
      try {
        await handleSaveFileContent(getFullPath(file.name), buf);
      } catch { /* handleSaveFileContent reports its own errors */ }
    }
  };
  const handleLocalFileUpload = async (e) => {
    const list = e.target.files;
    await uploadHostFiles(list);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!isScanning && !isExecuting) uploadHostFiles(e.dataTransfer?.files);
  };

  // Run Quick One-liner
  const handleRunQuickCode = async () => {
    if (!isConnected || !quickCode.trim()) return;
    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON EXEC] ${quickCode}`, 'tx');

    try {
      const output = await executeInRawRepl(quickCode);
      onLogMessage?.(`[MICROPYTHON OUTPUT]\n${output}`, 'rx');
    } catch (err) {
      onLogMessage?.(`[MICROPYTHON ERROR] ${err.message}`, 'sys');
    } finally {
      setIsExecuting(false);
    }
  };

  // Parent dir navigation helper
  const handleGoUp = () => {
    if (currentPath === '.') return;
    handleScanFiles(parentPath(currentPath));
  };

  // 1-Click Package Installer to /lib/
  const handleInstallPackage = async (pkg) => {
    if (!isConnected) return;
    setInstallingDriverId(pkg.id);
    setIsExecuting(true);
    onLogMessage?.(`[MIP] Installing package "${pkg.name}" to /lib/${pkg.filename}...`, 'sys');

    try {
      // Step 1: Ensure /lib and any subfolder exists
      const ensureLibDir = `
import os
try:
    os.mkdir('/lib')
except:
    pass
try:
    os.mkdir('/lib/umqtt')
except:
    pass
`.trim();
      await executeInRawRepl(ensureLibDir);

      // Step 2: Write driver code to device
      const target = `/lib/${pkg.filename}`;
      await handleSaveFileContent(target, pkg.code);
      onLogMessage?.(`[MIP] Driver "${pkg.name}" successfully installed to ${target}!`, 'sys');
    } catch (err) {
      onLogMessage?.(`[MIP ERROR] Failed to install ${pkg.name}: ${err.message}`, 'err');
    } finally {
      setInstallingDriverId(null);
      setIsExecuting(false);
    }
  };

  const btn = 'px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-300 disabled:opacity-40 transition-colors';
  const iconBtn = 'p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-600 disabled:opacity-40 transition-all';
  const busy = isScanning || isExecuting;

  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      {transfer && (
        <div className="flex items-center gap-2 bg-slate-950 border border-cyan-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-300">
          <span className="truncate">{transfer.label}</span>
          <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
            <div className="h-full bg-cyan-500" style={{ width: `${transfer.total ? Math.round((transfer.done / transfer.total) * 100) : 0}%` }} />
          </div>
          <span className="whitespace-nowrap">{transfer.done}/{transfer.total} B</span>
          <button onClick={cancelTransfer} className="px-2 py-0.5 rounded bg-rose-700 text-white font-bold">CANCEL</button>
        </div>
      )}

      {/* Toolbar: view tabs, device control */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setSubView('files')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-bold transition-all ${subView === 'files' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>FILES ({deviceFiles.length})</span>
          </button>
          <button
            onClick={() => setSubView('mip')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-bold transition-all ${subView === 'mip' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>MIP</span>
          </button>
        </div>
        {platformInfo && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-cyber-amber border border-amber-500/30 uppercase font-bold">
            {platformInfo}
          </span>
        )}
        {boards.length > 0 && onSelectBoard && (
          <label className="flex items-center gap-1 bg-slate-950 px-1.5 py-1 rounded-lg border border-slate-800">
            <span className="text-slate-500 font-bold">TARGET:</span>
            <select
              value={activeBoardId}
              onChange={(e) => onSelectBoard(e.target.value)}
              className="bg-transparent text-cyber-cyan font-bold outline-none cursor-pointer"
            >
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
              ))}
            </select>
          </label>
        )}
        <span className="flex-1" />
        <button onClick={() => handleDeviceControl('stop')} disabled={!isConnected} className={btn} title="Send Ctrl-C twice to interrupt the running program">Stop</button>
        <button onClick={() => handleDeviceControl('soft')} disabled={!isConnected} className={btn} title="Soft reset (Ctrl-C, Ctrl-C, Ctrl-D)">Soft reset</button>
        <button onClick={() => handleDeviceControl('hard')} disabled={!isConnected} className={btn} title="Hard reset (machine.reset()); the serial connection may drop">Hard reset</button>
      </div>

      {subView === 'files' ? (
        <>
          {/* Path, storage, actions */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
            <FolderTree className="w-3.5 h-3.5 text-cyber-cyan shrink-0" />
            <span className="text-slate-200 font-bold bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 break-all">
              /{currentPath === '.' ? '' : currentPath}
            </span>
            {currentPath !== '.' && (
              <button onClick={handleGoUp} className={`${btn} flex items-center gap-1 !py-0.5 text-cyber-amber`} title="Navigate to parent directory">
                <CornerLeftUp className="w-3 h-3" /><span>UP</span>
              </button>
            )}
            {storageInfo.totalKb > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400" title="Free / total flash from os.statvfs('/')">
                <HardDrive className="w-3 h-3 text-cyber-cyan" />
                {storageInfo.freeKb} / {storageInfo.totalKb} KB free
              </span>
            )}
            <span className="flex-1" />
            <input type="file" multiple ref={fileInputRef} onChange={handleLocalFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} disabled={!isConnected || busy} className={`${btn} flex items-center gap-1`} title="Upload one or more files from the PC into this folder (you can also drop files on the list)">
              <Upload className="w-3.5 h-3.5 text-cyber-cyan" /><span>UPLOAD</span>
            </button>
            <button onClick={() => setIsNewFileModal(true)} disabled={!isConnected || busy} className={`${btn} flex items-center gap-1`} title="Create a new script on the device">
              <Plus className="w-3.5 h-3.5 text-cyber-emerald" /><span>NEW</span>
            </button>
            <button onClick={handleMkdir} disabled={!isConnected || busy} className={btn} title="Create a folder in the current directory">Folder</button>
            <button
              onClick={() => handleScanFiles(currentPath)}
              disabled={!isConnected || busy}
              className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-cyber-amber font-bold border border-amber-500/40 hover:border-amber-400 disabled:opacity-50 transition-all"
              title="List this directory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SCANNING...' : 'SCAN'}</span>
            </button>
          </div>

          {/* File list (drop files here to upload) */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`bg-slate-950 rounded-lg border overflow-hidden ${dragOver ? 'border-cyan-400' : 'border-slate-800'}`}
          >
            <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-800 bg-slate-900/60">
              <Search className="w-3 h-3 text-slate-500 shrink-0" />
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="Filter files"
                aria-label="Filter files"
                className="flex-1 min-w-0 bg-transparent text-slate-200 placeholder-slate-600 outline-none text-[11px]"
              />
              {fileFilter && <span className="text-[10px] text-slate-500">{shownFiles.length}/{deviceFiles.length}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase bg-slate-900/40">
                    <th className="py-1 px-2 w-8" />
                    {[['name', 'Name'], ['size', 'Size']].map(([k, label]) => (
                      <th key={k} className="py-1 px-2" aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
                        <button onClick={() => toggleSort(k)} className="flex items-center gap-0.5 uppercase hover:text-slate-200" title={`Sort by ${label.toLowerCase()}`}>
                          {label}
                          {sortKey === k && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                        </button>
                      </th>
                    ))}
                    <th className="py-1 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPath !== '.' && (
                    <tr onClick={handleGoUp} className="border-b border-slate-900 hover:bg-slate-900/50 cursor-pointer text-cyber-amber transition-colors">
                      <td className="py-1 px-2"><Folder className="w-4 h-4 text-cyber-amber" /></td>
                      <td colSpan="3" className="py-1 px-2 font-bold">.. [Parent Directory]</td>
                    </tr>
                  )}
                  {shownFiles.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="py-6 px-2 text-center text-slate-500">
                        {deviceFiles.length > 0
                          ? 'No files match the filter.'
                          : isConnected
                            ? 'No files listed. Click SCAN to read the device filesystem, or drop files here to upload.'
                            : 'Device not connected. Connect a serial port to browse on-chip files.'}
                      </td>
                    </tr>
                  ) : (
                    shownFiles.map((file, idx) => (
                      <tr key={file.name || idx} className="border-b border-slate-900 hover:bg-slate-900/40 transition-colors">
                        <td className="py-1 px-2">
                          {file.isDir ? (
                            <Folder className="w-4 h-4 text-cyber-amber" />
                          ) : file.name.endsWith('.py') ? (
                            <FileCode className="w-4 h-4 text-cyber-cyan" />
                          ) : (
                            <FileText className="w-4 h-4 text-slate-400" />
                          )}
                        </td>
                        <td
                          onClick={() => { if (file.isDir) handleScanFiles(joinPath(currentPath, file.name)); }}
                          className={`py-1 px-2 font-bold break-all ${file.isDir ? 'text-cyber-amber cursor-pointer hover:underline' : 'text-slate-200'}`}
                        >
                          {file.name}{file.isDir && '/'}
                        </td>
                        <td className="py-1 px-2 text-slate-400 text-[11px] whitespace-nowrap">
                          {file.size > 0 ? formatSize(file.size) : file.isDir ? '<DIR>' : '-'}
                        </td>
                        <td className="py-1 px-2">
                          <div className="flex items-center justify-end gap-1">
                            {file.isDir ? (
                              <button onClick={() => handleScanFiles(joinPath(currentPath, file.name))} className={`${btn} !py-0.5 text-cyber-amber font-bold`}>ENTER</button>
                            ) : (
                              <>
                                {file.name.endsWith('.py') && (
                                  <button onClick={() => handleRunFile(file)} disabled={!isConnected || isExecuting} className={`${iconBtn} text-cyber-emerald`} title="Run this script on the device and show its output" aria-label={`Run ${file.name}`}>
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button onClick={() => handleReadFile(file.name)} disabled={isExecuting} className={`${btn} !py-0.5 text-cyber-cyan font-bold`} title="View / Edit in browser">EDIT</button>
                                <button onClick={() => handleDownloadFile(file.name)} disabled={isExecuting} className={iconBtn} title="Download to PC" aria-label={`Download ${file.name}`}>
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button onClick={() => handleRename(file)} disabled={isExecuting} className={iconBtn} title="Rename / move" aria-label={`Rename ${file.name}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteFile(file)} disabled={isExecuting} className={`${iconBtn} hover:text-cyber-rose`} title={file.isDir ? 'Delete folder and all its contents' : 'Delete from on-chip flash'} aria-label={`Delete ${file.name}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* One-liner REPL */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
            <Terminal className="w-3.5 h-3.5 text-cyber-cyan shrink-0" />
            <input
              type="text"
              value={quickCode}
              onChange={(e) => setQuickCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunQuickCode()}
              placeholder="e.g. import machine; machine.Pin(2, machine.Pin.OUT).value(1)"
              aria-label="Python one-liner to run on the device"
              className="flex-1 min-w-0 bg-transparent text-slate-200 placeholder-slate-600 outline-none text-xs"
            />
            <button
              onClick={handleRunQuickCode}
              disabled={!isConnected || isExecuting}
              className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyber-cyan border border-cyan-500/40 text-xs font-bold transition-all shrink-0 disabled:opacity-40"
            >
              <Play className="w-3 h-3" />
              <span>RUN</span>
            </button>
          </div>

          {runOutput && (
            <div className="bg-slate-950 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800 text-[10px] text-slate-500 uppercase">
                <span className="truncate">Output: {runOutput.title}</span>
                <button onClick={() => setRunOutput(null)} className="hover:text-slate-200" title="Clear output" aria-label="Clear output"><X className="w-3 h-3" /></button>
              </div>
              <pre className="p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-200">{runOutput.text}</pre>
            </div>
          )}
        </>
      ) : (
        /* Package Manager (mip / ViperIDE style) */
        <div className="space-y-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search bundled drivers (OLED, BME280, AHT20)..."
              aria-label="Search bundled drivers"
              value={driverSearch}
              onChange={e => setDriverSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2 py-1.5 text-slate-200 text-xs outline-none focus:border-cyan-500"
            />
          </div>

          {/* Real mip: name, github: spec or URL (fetched in the browser, https + allow-listed hosts) */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="mip install: umqtt.simple, github:org/repo/path, or https://.../package.json"
              aria-label="mip package to install"
              value={customPackageName}
              onChange={e => setCustomPackageName(e.target.value)}
              className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 text-xs outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleMipInstall}
              disabled={!isConnected || isExecuting || !customPackageName.trim()}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white font-bold text-xs disabled:opacity-40"
            >
              mip install
            </button>
            {mipStatus && <span className="text-[11px] text-slate-400 w-full break-all">{mipStatus}</span>}
          </div>

          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-300">How installs work</summary>
            <p className="mt-1">The browser downloads packages (https, micropython.org and raw.githubusercontent.com only) and writes them to <code className="text-cyber-amber">/lib</code> on the board, which needs no network. Bundled drivers install offline.</p>
          </details>

          {/* Drivers Grid */}
          <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-2">
            {MICROPYTHON_DRIVERS
              .filter(d =>
                !driverSearch ||
                d.name.toLowerCase().includes(driverSearch.toLowerCase()) ||
                d.description.toLowerCase().includes(driverSearch.toLowerCase()) ||
                d.category.toLowerCase().includes(driverSearch.toLowerCase())
              )
              .map(pkg => (
                <div key={pkg.id} className="bg-slate-900/70 p-2 rounded-lg border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-200 text-xs">{pkg.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800 uppercase font-bold">{pkg.category}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{pkg.description}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80 text-[10px]">
                    <span className="text-slate-500 break-all">/lib/{pkg.filename} ({pkg.size})</span>
                    <button
                      onClick={() => handleInstallPackage(pkg)}
                      disabled={!isConnected || isExecuting}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all shrink-0 ${
                        !isConnected
                          ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                          : installingDriverId === pkg.id
                            ? 'bg-amber-600 text-white animate-pulse'
                            : 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 font-extrabold'
                      }`}
                    >
                      {installingDriverId === pkg.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      <span>{installingDriverId === pkg.id ? 'FLASHING...' : 'INSTALL'}</span>
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modal: View / Edit File with Line Numbers Gutter */}
      {editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono">
          <div className="bg-[#030712] border border-cyan-500/40 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyber-cyan" />
                <span className="font-bold text-slate-200 text-sm">{editingFile.name}</span>
                <span className="text-[10px] text-slate-500">// ON-CHIP FLASH SCRIPT</span>
              </div>
              <button 
                onClick={() => setEditingFile(null)} 
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Editor with Line Numbers */}
            <div className="p-3 flex-1 flex flex-col min-h-[360px] overflow-hidden">
              <div className="flex bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex-1">
                {/* Line Numbers Gutter */}
                <div className="py-3 px-2 bg-slate-900/80 text-slate-600 font-mono text-xs select-none text-right border-r border-slate-800 flex flex-col min-w-[2.8rem]">
                  {editingFile.content.split('\n').map((_, i) => (
                    <span key={i} className="leading-relaxed">{i + 1}</span>
                  ))}
                </div>
                {/* Textarea */}
                <textarea
                  value={editingFile.content}
                  onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                  className="w-full flex-1 bg-transparent p-3 text-slate-100 font-mono text-xs focus:outline-none resize-none leading-relaxed overflow-y-auto"
                  spellCheck="false"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950">
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span>{editingFile.content.split('\n').length} lines</span>
                <span>•</span>
                <span>{editingFile.content.length} characters</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingFile(null)}
                  className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-xs"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => handleSaveFileContent(editingFile.name, editingFile.content)}
                  disabled={isExecuting}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 font-bold shadow-cyan-glow text-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isExecuting ? 'WRITING FLASH...' : 'SAVE TO ON-CHIP FLASH'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New File */}
      {isNewFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono">
          <div className="bg-[#030712] border border-amber-500/40 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyber-amber" />
                <span className="font-bold text-slate-200 text-sm">CREATE NEW SCRIPT IN /{currentPath === '.' ? '' : currentPath}</span>
              </div>
              <button 
                onClick={() => setIsNewFileModal(false)} 
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Filename (e.g. main.py, config.json, sensor.py)
                </label>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Initial Code Content
                </label>
                <textarea
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full h-44 bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 font-mono text-xs focus:border-amber-500 outline-none resize-none leading-relaxed"
                  spellCheck="false"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-3 border-t border-slate-800 bg-slate-950">
              <button
                onClick={() => setIsNewFileModal(false)}
                className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-xs"
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  const target = getFullPath(newFileName.trim());
                  handleSaveFileContent(target, newFileContent);
                }}
                disabled={!newFileName.trim() || isExecuting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold shadow-amber-glow text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>CREATE & FLASH</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
