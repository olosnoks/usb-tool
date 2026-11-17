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
  Search
} from 'lucide-react';
import { pyStr, buildDeleteScript, writeFileChunked, readFileChunked } from '../utils/micropythonFiles';
import { resolvePackage } from '../utils/micropythonMip';
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
    const full = currentPath === '.' ? name : `${currentPath}/${name}`;
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
    return currentPath === '.' ? fileName : `${currentPath}/${fileName}`;
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

  // Delete file from device
  const handleDeleteFile = async (fileName) => {
    const fullPath = getFullPath(fileName);
    if (!confirm(`Are you sure you want to delete "${fullPath}" from the device filesystem?`)) return;

    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON] Removing "${fullPath}"...`, 'sys');

    const delPython = buildDeleteScript(fullPath);

    try {
      const output = await executeInRawRepl(delPython);
      if (output.includes('__FILE_DEL_SUCCESS__')) {
        onLogMessage?.(`[MICROPYTHON] Deleted "${fullPath}"`, 'sys');
        await handleScanFiles(currentPath);
      } else {
        alert('Failed to delete file from device.');
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Host file upload handler
  const handleLocalFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const target = getFullPath(file.name);
    const reader = new FileReader();
    reader.onload = async (event) => {
      await handleSaveFileContent(target, new Uint8Array(event.target.result));
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
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
    const parts = currentPath.split('/');
    parts.pop();
    const parent = parts.join('/') || '.';
    handleScanFiles(parent);
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

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {transfer && (
        <div className="flex items-center gap-2 bg-slate-950 border border-cyan-800 rounded-lg px-3 py-2 text-[11px] text-slate-300">
          <span className="truncate">{transfer.label}</span>
          <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
            <div className="h-full bg-cyan-500" style={{ width: `${transfer.total ? Math.round((transfer.done / transfer.total) * 100) : 0}%` }} />
          </div>
          <span>{transfer.done}/{transfer.total} B</span>
          <button onClick={cancelTransfer} className="px-2 py-0.5 rounded bg-rose-700 text-white font-bold">CANCEL</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button onClick={() => handleDeviceControl('stop')} disabled={!isConnected} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40">Stop (Ctrl-C)</button>
        <button onClick={() => handleDeviceControl('soft')} disabled={!isConnected} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40">Soft reset</button>
        <button onClick={() => handleDeviceControl('hard')} disabled={!isConnected} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40">Hard reset</button>
        <button onClick={handleMkdir} disabled={!isConnected || isExecuting} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40">New folder</button>
      </div>
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">
            MICROPYTHON / CIRCUITPYTHON WORKBENCH
          </h2>
          {platformInfo && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-cyber-amber border border-amber-500/30 uppercase font-bold">
              {platformInfo}
            </span>
          )}
        </div>

        {/* View Mode Switcher Pills: Files vs Package Manager (mip) */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setSubView('files')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
              subView === 'files' ? 'bg-amber-600 text-white shadow-amber-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>FILES ({deviceFiles.length})</span>
          </button>
          <button
            onClick={() => setSubView('mip')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
              subView === 'mip' ? 'bg-cyan-600 text-white shadow-cyan-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>PACKAGE MANAGER (mip)</span>
          </button>
        </div>

        {/* Target Board Selector & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {boards.length > 0 && onSelectBoard && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
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
            </div>
          )}

          {subView === 'files' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleLocalFileUpload}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConnected || isScanning || isExecuting}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-500 disabled:opacity-50 transition-all"
                title="Upload script or config file from PC to on-chip flash"
              >
                <Upload className="w-3.5 h-3.5 text-cyber-cyan" />
                <span>UPLOAD</span>
              </button>

              <button
                onClick={() => setIsNewFileModal(true)}
                disabled={!isConnected || isScanning || isExecuting}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-500 disabled:opacity-50 transition-all"
              >
                <Plus className="w-3.5 h-3.5 text-cyber-emerald" />
                <span>NEW SCRIPT</span>
              </button>

              <button
                onClick={() => handleScanFiles(currentPath)}
                disabled={!isConnected || isScanning || isExecuting}
                className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-cyber-amber font-bold border border-amber-500/40 hover:border-amber-400 disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'SCANNING...' : 'SCAN FILES'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {subView === 'files' ? (
        <>
          {/* Breadcrumb Path & Storage Gauge */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <FolderTree className="w-4 h-4 text-cyber-cyan" />
              <span className="text-slate-500 uppercase font-bold">DIRECTORY:</span>
              <span className="text-slate-200 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                /{currentPath === '.' ? '' : currentPath}
              </span>
              {currentPath !== '.' && (
                <button
                  onClick={handleGoUp}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-amber border border-slate-800 text-[11px]"
                  title="Navigate to parent directory"
                >
                  <CornerLeftUp className="w-3 h-3" />
                  <span>UP</span>
                </button>
              )}
            </div>

            {storageInfo.totalKb > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <HardDrive className="w-3.5 h-3.5 text-cyber-cyan" />
                <span>{storageInfo.freeKb} KB Free / {storageInfo.totalKb} KB Total</span>
              </div>
            )}
          </div>

          {/* File List Table */}
          <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase bg-slate-900/60">
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Filename</th>
                  <th className="py-2 px-3">Size</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentPath !== '.' && (
                  <tr 
                    onClick={handleGoUp}
                    className="border-b border-slate-900 hover:bg-slate-900/50 cursor-pointer text-cyber-amber transition-colors"
                  >
                    <td className="py-2 px-3 w-10">
                      <Folder className="w-4 h-4 text-cyber-amber" />
                    </td>
                    <td colSpan="3" className="py-2 px-3 font-mono font-bold">
                      .. [Parent Directory]
                    </td>
                  </tr>
                )}

                {deviceFiles.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-slate-500">
                      {isConnected 
                        ? 'No files detected in this directory. Click "SCAN FILES" to query the MicroPython filesystem.' 
                        : 'Device not connected. Connect serial port to browse on-chip files.'}
                    </td>
                  </tr>
                ) : (
                  deviceFiles.map((file, idx) => (
                    <tr 
                      key={file.name || idx} 
                      className="border-b border-slate-900 hover:bg-slate-900/40 transition-colors"
                    >
                      <td className="py-2 px-3 w-10">
                        {file.isDir ? (
                          <Folder className="w-4 h-4 text-cyber-amber" />
                        ) : file.name.endsWith('.py') ? (
                          <FileCode className="w-4 h-4 text-cyber-cyan" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-400" />
                        )}
                      </td>
                      <td 
                        onClick={() => {
                          if (file.isDir) {
                            const next = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
                            handleScanFiles(next);
                          }
                        }}
                        className={`py-2 px-3 font-mono font-bold ${file.isDir ? 'text-cyber-amber cursor-pointer hover:underline' : 'text-slate-200'}`}
                      >
                        {file.name} {file.isDir && '/'}
                      </td>
                      <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">
                        {file.size > 0 ? `${file.size} B` : file.isDir ? '<DIR>' : '-'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {file.isDir ? (
                            <button
                              onClick={() => {
                                const next = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
                                handleScanFiles(next);
                              }}
                              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-amber border border-slate-800 text-[11px] font-bold"
                            >
                              ENTER
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleReadFile(file.name)}
                                disabled={isExecuting}
                                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyber-cyan border border-slate-800 hover:border-cyan-500/50 text-[11px] font-bold transition-all"
                                title="View / Edit in browser"
                              >
                                EDIT
                              </button>
                              <button
                                onClick={() => handleDownloadFile(file.name)}
                                disabled={isExecuting}
                                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-600 transition-all"
                                title="Download to PC"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteFile(file.name)}
                            disabled={isExecuting}
                            className="p-1 rounded bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-cyber-rose border border-slate-800 hover:border-rose-900/50 transition-all"
                            title="Delete from on-chip flash"
                          >
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

          {/* Quick REPL One-liner execution bar */}
          <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
            <Terminal className="w-4 h-4 text-cyber-cyan shrink-0" />
            <span className="text-[10px] text-slate-500 uppercase font-bold shrink-0">EXECUTE REPL:</span>
            <input
              type="text"
              value={quickCode}
              onChange={(e) => setQuickCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunQuickCode()}
              placeholder="e.g. import machine; machine.Pin(2, machine.Pin.OUT).value(1)"
              className="flex-1 bg-transparent text-slate-200 placeholder-slate-600 outline-none font-mono text-xs"
            />
            <button
              onClick={handleRunQuickCode}
              disabled={!isConnected || isExecuting}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyber-cyan border border-cyan-500/40 text-xs font-bold transition-all shrink-0"
            >
              <Play className="w-3 h-3" />
              <span>RUN</span>
            </button>
          </div>
        </>
      ) : (
        /* Package Manager (mip / ViperIDE style) */
        <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-cyber-cyan" />
              <div>
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  OFFLINE DRIVERS (bundled) + mip
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    VIPERIDE / MIP INTEGRATION
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Deploy verified sensor and display drivers directly into your microcontroller's <code className="text-cyber-amber">/lib</code> directory.
                </p>
              </div>
            </div>

            {/* Driver Search Input */}
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search drivers (OLED, BME280, AHT20)..."
                value={driverSearch}
                onChange={e => setDriverSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-slate-200 text-xs outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Real mip: name, github: spec or URL (fetched in the browser, https + allow-listed hosts) */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="mip install: umqtt.simple, github:org/repo/path, or https://.../package.json"
              value={customPackageName}
              onChange={e => setCustomPackageName(e.target.value)}
              className="flex-1 min-w-[16rem] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleMipInstall}
              disabled={!isConnected || isExecuting || !customPackageName.trim()}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white font-bold text-xs disabled:opacity-40"
            >
              mip install
            </button>
            {mipStatus && <span className="text-[11px] text-slate-400 w-full">{mipStatus}</span>}
          </div>

          {/* Drivers Grid */}
          <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-3 pt-1">
            {MICROPYTHON_DRIVERS
              .filter(d => 
                !driverSearch || 
                d.name.toLowerCase().includes(driverSearch.toLowerCase()) || 
                d.description.toLowerCase().includes(driverSearch.toLowerCase()) ||
                d.category.toLowerCase().includes(driverSearch.toLowerCase())
              )
              .map(pkg => (
                <div 
                  key={pkg.id} 
                  className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 text-xs">{pkg.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800 uppercase font-bold">
                        {pkg.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {pkg.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px]">
                    <span className="text-slate-500 font-mono">
                      /lib/{pkg.filename} ({pkg.size})
                    </span>
                    <button
                      onClick={() => handleInstallPackage(pkg)}
                      disabled={!isConnected || isExecuting}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all shadow-sm ${
                        !isConnected
                          ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                          : installingDriverId === pkg.id
                            ? 'bg-amber-600 text-white animate-pulse'
                            : 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 font-extrabold shadow-cyan-glow'
                      }`}
                    >
                      {installingDriverId === pkg.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      <span>{installingDriverId === pkg.id ? 'FLASHING...' : 'INSTALL TO /lib/'}</span>
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
