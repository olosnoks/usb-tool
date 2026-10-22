import React, { useState, useRef, useEffect } from 'react';
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
  FolderTree
} from 'lucide-react';

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

  // Quick One-liner runner
  const [quickCode, setQuickCode] = useState('import sys; print("MicroPython on:", sys.platform)');

  const rxBufferRef = useRef('');
  const fileInputRef = useRef(null);

  // Accumulate RX text
  useEffect(() => {
    if (latestRxText) {
      rxBufferRef.current += latestRxText;
    }
  }, [latestRxText]);

  // Helper to execute Python code via MicroPython Raw REPL
  const executeInRawRepl = async (codeStr, timeoutMs = 4000) => {
    rxBufferRef.current = '';
    
    // Step 1: Interrupt currently running code with Ctrl-C twice
    onSendString?.('\x03\x03');
    await new Promise(r => setTimeout(r, 200));

    // Step 2: Enter raw REPL with Ctrl-A
    rxBufferRef.current = '';
    onSendString?.('\x01');
    await new Promise(r => setTimeout(r, 200));

    // Step 3: Send code and execute with Ctrl-D
    rxBufferRef.current = '';
    onSendString?.(codeStr + '\x04');
    
    // Wait for output or return after timeout
    await new Promise(r => setTimeout(r, Math.min(timeoutMs, 2500)));

    // Step 4: Return to normal friendly REPL with Ctrl-B
    onSendString?.('\x02');

    return rxBufferRef.current;
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
target_dir = '${dirToScan}'
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

    const readPython = `
import ubinascii
try:
    with open('${fullPath}', 'rb') as f:
        print("__FILE_DATA_START__")
        print(ubinascii.b2a_base64(f.read()).decode().strip())
        print("__FILE_DATA_END__")
except Exception as e:
    print("__FILE_DATA_ERROR__", str(e))
`.trim();

    try {
      const output = await executeInRawRepl(readPython);
      const startMarker = '__FILE_DATA_START__';
      const endMarker = '__FILE_DATA_END__';

      const sIdx = output.indexOf(startMarker);
      const eIdx = output.indexOf(endMarker);

      if (sIdx !== -1 && eIdx !== -1) {
        const b64 = output.substring(sIdx + startMarker.length, eIdx).trim();
        const textContent = atob(b64);
        setEditingFile({ name: fullPath, content: textContent });
        onLogMessage?.(`[MICROPYTHON] Successfully loaded "${fullPath}" (${textContent.length} chars)`, 'sys');
      } else {
        alert(`Could not read "${fullPath}" from device. See console for details.`);
      }
    } catch (err) {
      alert(`Error reading file: ${err.message}`);
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

    const readPython = `
import ubinascii
try:
    with open('${fullPath}', 'rb') as f:
        print("__FILE_DATA_START__")
        print(ubinascii.b2a_base64(f.read()).decode().strip())
        print("__FILE_DATA_END__")
except Exception as e:
    print("__FILE_DATA_ERROR__", str(e))
`.trim();

    try {
      const output = await executeInRawRepl(readPython);
      const startMarker = '__FILE_DATA_START__';
      const endMarker = '__FILE_DATA_END__';

      const sIdx = output.indexOf(startMarker);
      const eIdx = output.indexOf(endMarker);

      if (sIdx !== -1 && eIdx !== -1) {
        const b64 = output.substring(sIdx + startMarker.length, eIdx).trim();
        const rawContent = atob(b64);
        const blob = new Blob([rawContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        onLogMessage?.(`[MICROPYTHON] "${fileName}" downloaded to host`, 'sys');
      }
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Save / Upload File Content to Device
  const handleSaveFileContent = async (targetFilePath, content) => {
    if (!isConnected) return;
    setIsExecuting(true);
    onLogMessage?.(`[MICROPYTHON] Writing file "${targetFilePath}" to flash...`, 'sys');

    const b64 = btoa(content);
    const writePython = `
import ubinascii
try:
    with open('${targetFilePath}', 'wb') as f:
        f.write(ubinascii.a2b_base64('${b64}'))
    print("__FILE_WRITE_SUCCESS__")
except Exception as e:
    print("__FILE_WRITE_ERROR__", str(e))
`.trim();

    try {
      const output = await executeInRawRepl(writePython);
      if (output.includes('__FILE_WRITE_SUCCESS__')) {
        onLogMessage?.(`[MICROPYTHON] Successfully saved "${targetFilePath}"!`, 'sys');
        setEditingFile(null);
        setIsNewFileModal(false);
        await handleScanFiles(currentPath);
      } else {
        alert('File write failed. See logs for details.');
      }
    } catch (err) {
      alert(`Write failed: ${err.message}`);
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

    const delPython = `
import os
try:
    os.remove('${fullPath}')
    print("__FILE_DEL_SUCCESS__")
except Exception as e:
    print("__FILE_DEL_ERROR__", str(e))
`.trim();

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
      const content = event.target.result;
      await handleSaveFileContent(target, content);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
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

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">
            MICROPYTHON / CIRCUITPYTHON ON-CHIP FILE EXPLORER
          </h2>
          {platformInfo && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-cyber-amber border border-amber-500/30 uppercase font-bold">
              {platformInfo}
            </span>
          )}
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
            <span>UPLOAD FILE</span>
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
            <span>{isScanning ? 'SCANNING...' : 'SCAN DEVICE FILES'}</span>
          </button>
        </div>
      </div>

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
                    ? 'No files detected in this directory. Click "SCAN DEVICE FILES" to query the MicroPython filesystem.' 
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
