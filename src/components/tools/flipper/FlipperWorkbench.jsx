import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Bot, 
  RotateCcw, 
  Terminal as TerminalIcon, 
  HardDrive, 
  Download, 
  Play, 
  Send, 
  Zap, 
  RefreshCw, 
  ChevronUp, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight, 
  Trash2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Cpu, 
  Radio, 
  Wifi, 
  ExternalLink,
  Folder,
  FolderOpen,
  FileCode,
  Upload,
  CreditCard,
  Tv,
  Power,
  Volume2,
  VolumeX,
  Keyboard,
  Monitor,
  Usb,
  Vibrate,
  Sparkles,
  Save,
  Camera,
  Layers,
  ArrowRight,
  ShieldCheck,
  FolderPlus,
  Compass,
  Sliders,
  Battery,
  BatteryCharging,
  ArrowUp,
  Plus
} from 'lucide-react';
import { FlipperZeroDriver, getFlipperDriver } from '../../../utils/flipperDriver';
import { useSerial } from '../../../context/SerialContext';
import { identifyUsbChip } from '../../../utils/usbDatabase';
import flipperSvg from '../../../assets/flipper/flipper.svg';
import typecSvg from '../../../assets/flipper/typec.svg';

/**
 * Renders real Flipper Zero 1024-byte framebuffer (128x64 ST7567 LCD) onto HTML5 Canvas
 */
export function renderFlipperLcdToCanvas(buffer, canvas, fallbackState = null, orientation = 0) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 128;
  const height = 64;

  if (buffer && buffer.length === 1024) {
    const imgData = ctx.createImageData(width, height);
    const isFlipped = orientation === 1 || orientation === 3;
    // ST7567 display layout: 128 columns x 8 pages (each page is 8 vertical rows)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const drawX = isFlipped ? 127 - x : x;
        const drawY = isFlipped ? 63 - y : y;
        const byteIdx = drawX + Math.floor(drawY / 8) * width;
        const bitMask = 1 << (drawY % 8);
        const isPixelSet = (buffer[byteIdx] & bitMask) !== 0;
        const targetIdx = (y * width + x) * 4;

        if (isPixelSet) {
          // Dark LCD Pixel (#120a00)
          imgData.data[targetIdx]     = 18;
          imgData.data[targetIdx + 1] = 12;
          imgData.data[targetIdx + 2] = 4;
        } else {
          // Orange Backlight (#fe8a2c)
          imgData.data[targetIdx]     = 254;
          imgData.data[targetIdx + 1] = 138;
          imgData.data[targetIdx + 2] = 44;
        }
        imgData.data[targetIdx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    // Draw crisp Flipper standby display with real device stats
    ctx.fillStyle = '#fe8a2c';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#120a00';
    ctx.font = 'bold 8px monospace';
    ctx.fillText(fallbackState?.deviceName || 'FLIPPER ZERO', 8, 14);

    ctx.font = '6px monospace';
    const fwText = fallbackState?.firmwareVersion ? fallbackState.firmwareVersion.slice(0, 24) : (fallbackState?.isConnected ? 'ONLINE // USB CDC' : 'OFFLINE');
    ctx.fillText(fwText, 8, 26);

    const batText = fallbackState?.batteryPercent !== null && fallbackState?.batteryPercent !== undefined ? `BAT: ${fallbackState.batteryPercent}%` : 'BAT: --';
    ctx.fillText(batText, 8, 38);
    ctx.fillText(fallbackState?.sdMounted ? 'SD: OK' : 'SD: --', 80, 38);

    ctx.fillStyle = '#612a02';
    ctx.fillRect(8, 44, 112, 1);

    ctx.fillStyle = '#120a00';
    ctx.font = 'bold 6px monospace';
    ctx.fillText(fallbackState?.isConnected ? 'CLICK TO STREAM LCD' : 'PLUG IN & CONNECT', 12, 56);
  }
}

export default function FlipperWorkbench() {
  const serialCtx = useSerial();
  const driver = useMemo(() => getFlipperDriver(), []);
  const [state, setState] = useState(() => driver.state);

  // Auto-detected USB / Serial ports
  const [detectedPorts, setDetectedPorts] = useState([]);

  // qFlipper Navigation Views: 'device' (Home/Overview) | 'files' (File Manager) | 'screen' (Screen Streaming) | 'cli' (Console)
  const [activeView, setActiveView] = useState('device');

  // Connection State
  const [connectError, setConnectError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [cliInput, setCliInput] = useState('');

  // Keyboard Navigation Mode (Allows using PC Arrow keys + Enter + Esc)
  const [keyboardNavEnabled, setKeyboardNavEnabled] = useState(true);

  // Storage / File Manager State
  const [currentDir, setCurrentDir] = useState('/ext');
  const [dirItems, setDirItems] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const fileUploadInputRef = useRef(null);

  // Hardware Actions State
  const [vibrating, setVibrating] = useState(false);
  const [ledColor, setLedColor] = useState('off');
  const [selectedChannel, setSelectedChannel] = useState('Release');

  // Screen Canvas Refs (Large screen viewer & Mini screen on Flipper casing)
  const screenCanvasRef = useRef(null);
  const miniCanvasRef = useRef(null);
  const logContainerRef = useRef(null);

  // Subscribe to driver state & logs without killing the connection on unmount
  useEffect(() => {
    driver.onStateChangeCallback = (s) => setState({ ...s });
    driver.onLogCallback = (log) => {
      setLogs(prev => [...prev.slice(-200), log]);
    };
    driver.onScreenUpdateCallback = (buf, orientation = 0) => {
      if (screenCanvasRef.current) {
        renderFlipperLcdToCanvas(buf, screenCanvasRef.current, driver.state, orientation);
      }
      if (miniCanvasRef.current) {
        renderFlipperLcdToCanvas(buf, miniCanvasRef.current, driver.state, orientation);
      }
    };

    // Sync current state in case already connected
    setState({ ...driver.state });

    // Initial render of standby / current buffer
    if (screenCanvasRef.current) renderFlipperLcdToCanvas(driver.state.screenBuffer, screenCanvasRef.current, driver.state, driver.state.screenOrientation || 0);
    if (miniCanvasRef.current) renderFlipperLcdToCanvas(driver.state.screenBuffer, miniCanvasRef.current, driver.state, driver.state.screenOrientation || 0);

    return () => {
      driver.onStateChangeCallback = null;
      driver.onLogCallback = null;
      driver.onScreenUpdateCallback = null;
    };
  }, [driver]);

  // Manage Protobuf RPC Screen Stream session when switching tabs (mirror LCD on both device view & screen tab)
  useEffect(() => {
    if (state.isConnected && (activeView === 'device' || activeView === 'screen')) {
      driver.startScreenStream();
      // Paint latest framebuffer immediately upon tab switch so no blank frame occurs
      if (driver.state.screenBuffer) {
        if (screenCanvasRef.current) renderFlipperLcdToCanvas(driver.state.screenBuffer, screenCanvasRef.current, driver.state, driver.state.screenOrientation || 0);
        if (miniCanvasRef.current) renderFlipperLcdToCanvas(driver.state.screenBuffer, miniCanvasRef.current, driver.state, driver.state.screenOrientation || 0);
      }
    } else if (state.isConnected && activeView !== 'device' && activeView !== 'screen' && driver.isScreenStreaming) {
      driver.stopScreenStream();
    }
  }, [state.isConnected, activeView, driver]);

  // Scan for pre-authorized or plugged-in Web Serial ports
  const scanPorts = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return;
    try {
      const ports = await navigator.serial.getPorts();
      const mapped = ports.map((p, idx) => {
        const info = p.getInfo ? p.getInfo() : {};
        const isFlipper = (info.usbVendorId === 0x0483 && info.usbProductId === 0x5740) ||
                          info.usbVendorId === 0x0483 ||
                          (info.usbVendorId === 0x1d50 && info.usbProductId === 0x6018);
        const chip = identifyUsbChip(info.usbVendorId, info.usbProductId);
        return {
          port: p,
          index: idx,
          info,
          chip,
          isFlipper,
          label: isFlipper 
            ? 'Flipper Zero USB CDC' 
            : (chip.name !== 'Generic / Unknown UART Bridge' ? chip.name : `USB Serial Port ${idx + 1}`)
        };
      });
      setDetectedPorts(mapped);
    } catch (e) {
      console.warn('Error reading Web Serial ports:', e);
    }
  }, []);

  useEffect(() => {
    scanPorts();
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      const handleConnectEvent = () => {
        scanPorts();
        driver.log('USB device plugged in detected!', 'info');
      };
      const handleDisconnectEvent = () => {
        scanPorts();
        driver.log('USB device unplugged.', 'warning');
      };
      navigator.serial.addEventListener('connect', handleConnectEvent);
      navigator.serial.addEventListener('disconnect', handleDisconnectEvent);
      return () => {
        navigator.serial.removeEventListener('connect', handleConnectEvent);
        navigator.serial.removeEventListener('disconnect', handleDisconnectEvent);
      };
    }
  }, [scanPorts, driver]);

  // Scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Load real files when switching to File Manager
  useEffect(() => {
    if (state.isConnected && activeView === 'files') {
      loadDirectory(currentDir);
    }
  }, [state.isConnected, activeView, currentDir]);

  const loadDirectory = async (dirPath) => {
    setIsLoadingFiles(true);
    try {
      const items = await driver.listRealDirectory(dirPath);
      setDirItems(items);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSelectFile = async (item) => {
    if (item.isDir) {
      setCurrentDir(item.path);
      loadDirectory(item.path);
    } else {
      setSelectedFile(item);
      const content = await driver.readRealFile(item.path);
      setFileContent(content);
    }
  };

  // Go up one directory level
  const handleGoUp = () => {
    if (currentDir === '/' || currentDir === '/ext' || currentDir === '/int') {
      if (currentDir !== '/ext') {
        setCurrentDir('/ext');
        loadDirectory('/ext');
      }
      return;
    }
    const parts = currentDir.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    setCurrentDir(parentPath);
    loadDirectory(parentPath);
  };

  // Create new folder
  const handleCreateFolder = async () => {
    const name = window.prompt('Enter folder name:');
    if (!name || !name.trim()) return;
    const fullPath = `${currentDir}/${name.trim()}`.replace(/\/+/g, '/');
    try {
      await driver.createRealDirectory(fullPath);
      await loadDirectory(currentDir);
    } catch (e) {
      alert(`Failed to create folder: ${e.message}`);
    }
  };

  // Delete file or folder
  const handleDeleteItem = async (item, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Delete ${item.isDir ? 'folder' : 'file'} "${item.name}" from Flipper?`)) return;
    try {
      await driver.removeRealFile(item.path);
      if (selectedFile?.path === item.path) {
        setSelectedFile(null);
        setFileContent('');
      }
      await loadDirectory(currentDir);
    } catch (err) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  // Upload file to Flipper
  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target.result;
      const targetPath = `${currentDir}/${file.name}`.replace(/\/+/g, '/');
      try {
        await driver.writeRealFile(targetPath, content);
        await loadDirectory(currentDir);
      } catch (err) {
        alert(`Failed to upload: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Connect directly to a detected port
  const handleConnectToPort = async (port) => {
    setConnectError(null);
    setIsConnecting(true);
    try {
      if (serialCtx?.isConnected) {
        driver.log('Releasing COM port from Main Flasher...', 'warning');
        await serialCtx.disconnect();
        await new Promise(r => setTimeout(r, 200));
      }
      await driver.connectPort(port);
      await scanPorts();
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // Connect handler - defaults to noFilter=true (all ports) so device always shows on Windows
  const handleConnect = async (noFilter = true) => {
    setConnectError(null);
    setIsConnecting(true);
    try {
      if (serialCtx?.isConnected) {
        driver.log('Releasing active COM port from Main Flasher...', 'warning');
        await serialCtx.disconnect();
        await new Promise(r => setTimeout(r, 200));
      }
      await driver.connectHardware({ noFilter });
      await scanPorts();
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // Transfer active connection from SerialContext (Local test)
  const handleTransferFromMainSerial = async () => {
    setConnectError(null);
    setIsConnecting(true);
    try {
      const activePort = serialCtx.port;
      driver.log('Transferring active connection from Main Flasher to qFlipper Suite...', 'info');
      await serialCtx.disconnect();
      await new Promise(r => setTimeout(r, 200));
      if (activePort) {
        await driver.connectPort(activePort);
      } else {
        await driver.connectHardware({ noFilter: true });
      }
      await scanPorts();
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // D-Pad Key Press Handler
  const handleDpadPress = async (key) => {
    if (!state.isConnected) return;
    await driver.sendInput(key, 'short');
  };

  // Physical Keyboard Navigation (Arrow Keys + Enter + Esc)
  useEffect(() => {
    if (!state.isConnected || !keyboardNavEnabled) return;

    const handleKeyDown = (e) => {
      // Ignore if user is currently typing inside an input or textarea
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        driver.sendInput('up', 'short');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        driver.sendInput('down', 'short');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        driver.sendInput('left', 'short');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        driver.sendInput('right', 'short');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        driver.sendInput('ok', 'short');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        driver.sendInput('back', 'short');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isConnected, keyboardNavEnabled, driver]);

  // Vibration test
  const handleVibrateTest = async () => {
    setVibrating(true);
    await driver.testVibration();
    setTimeout(() => setVibrating(false), 500);
  };

  // LED test
  const handleLedTest = async (color) => {
    setLedColor(color);
    await driver.testLed(color);
  };

  // Screenshot capture
  const handleScreenshot = () => {
    const canvas = screenCanvasRef.current || miniCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `flipper_screenshot_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    driver.log('[Screen] Captured screenshot PNG of Flipper 128x64 display', 'success');
  };

  // CLI command submission
  const handleSendCli = (e) => {
    e.preventDefault();
    if (!cliInput.trim()) return;
    driver.executeCommand(cliInput.trim());
    setCliInput('');
  };

  // Format KB to MB or GB
  const formatKb = (kb) => {
    if (!kb) return '0 MB';
    if (kb < 1024) return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="w-full space-y-4 font-mono text-xs select-none">
      {/* 1. Official qFlipper Window Header Bar */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-3 sm:p-4 shadow-2xl flex flex-wrap items-center justify-between gap-3">
        {/* Left: Device Selector (qFlipper Style) */}
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border flex-shrink-0 transition-all ${
            state.isConnected 
              ? 'bg-[#fe8a2c]/20 border-[#fe8a2c]/60 text-[#fe8a2c] shadow-[0_0_20px_rgba(254,138,44,0.3)]' 
              : 'bg-[#1e212b] border-[#2b303c] text-slate-500'
          }`}>
            <Bot className={`w-5 h-5 ${state.isConnected ? 'animate-pulse' : ''}`} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-wide font-sans">
                {state.isConnected ? (state.deviceName || 'Flipper Zero') : 'qFlipper Web'}
              </span>
              {state.isConnected ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  CONNECTED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#21242d] text-slate-400 border border-slate-700 font-mono">
                  DISCONNECTED
                </span>
              )}
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
              <span>{state.isConnected ? (state.hardwareModel || 'Detecting Target...') : 'qFlipper Companion (VID: 0483, PID: 5740)'}</span>
              {state.firmwareVersion && (
                <>
                  <span>•</span>
                  <span className="text-[#fe8a2c] font-bold">{state.firmwareVersion}</span>
                </>
              )}
              {state.batteryPercent !== null && (
                <>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">BAT: {state.batteryPercent}%{state.batteryVoltageMv ? ` (${state.batteryVoltageMv} mV)` : ''}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: qFlipper View Selector Tabs (Iconic Qt Header Tabs) */}
        {state.isConnected && (
          <div className="flex items-center bg-[#1e212b] border border-[#2e3444] p-1 rounded-xl gap-1">
            {[
              { id: 'device', name: 'Device', icon: Bot },
              { id: 'files', name: 'File Manager', icon: FolderOpen },
              { id: 'screen', name: 'Screen Streaming', icon: Monitor },
              { id: 'cli', name: 'Console', icon: TerminalIcon },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveView(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono transition-all ${
                    isActive 
                      ? 'bg-[#fe8a2c] text-slate-950 font-bold shadow-lg shadow-[#fe8a2c]/30' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Right: Connect / Disconnect Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {state.isConnected ? (
            <>
              <button
                onClick={() => driver.refreshAllRealData()}
                className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-lg text-xs font-mono transition flex items-center gap-1.5"
                title="Refresh hardware info"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Sync</span>
              </button>

              <button
                onClick={() => driver.disconnect()}
                className="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {serialCtx?.isConnected && (
                <button
                  onClick={handleTransferFromMainSerial}
                  disabled={isConnecting}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/25 transition active:scale-95 animate-pulse"
                  title="Transfer active port from Main Flasher Header"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>Transfer from Header</span>
                </button>
              )}

              <button
                onClick={() => handleConnect(true)}
                disabled={isConnecting}
                className="px-5 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] active:scale-95 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs font-sans transition shadow-lg shadow-[#fe8a2c]/25 flex items-center gap-2"
                title="Connect Flipper Zero via Web Serial (All Ports)"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>{isConnecting ? 'Connecting...' : 'CONNECT FLIPPER'}</span>
              </button>

              <button
                onClick={() => handleConnect(false)}
                className="px-3 py-2 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-xl text-xs font-mono transition"
                title="Filter for Flipper VID:PID (0483:5740)"
              >
                Filtered
              </button>
            </div>
          )}
        </div>
      </div>

      {connectError && (
        <div className="bg-rose-950/60 border border-rose-500/50 rounded-2xl p-4 text-xs font-mono text-rose-200 flex items-start justify-between gap-3 shadow-2xl animate-in fade-in">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-sm">Connection Failed: {connectError}</div>
              <div className="text-[11px] text-rose-300/80 mt-1 leading-relaxed">
                Tip: If the desktop <strong>qFlipper</strong> application or the top Header HUD flasher is open on your PC, make sure the port is released first. Then click Connect or Transfer.
              </div>
            </div>
          </div>
          <button onClick={() => setConnectError(null)} className="text-slate-400 hover:text-white px-2">✕</button>
        </div>
      )}

      {/* 2. Official qFlipper Disconnected Welcome Screen (NoDeviceOverlay) */}
      {!state.isConnected ? (
        <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-8 sm:p-12 shadow-2xl flex flex-col items-center justify-center text-center max-w-4xl mx-auto my-4">
          {/* Active Serial Connection in Main Header Alert */}
          {serialCtx?.isConnected && (
            <div className="w-full max-w-xl bg-amber-950/40 border-2 border-amber-500/60 rounded-2xl p-4 sm:p-5 mb-6 text-amber-200 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xl text-left">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex-shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-sm text-white flex items-center gap-2">
                    <span>Flipper Connected in Main Flasher</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500 text-slate-950 font-black">OPEN</span>
                  </div>
                  <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
                    Your Flipper Zero is currently connected in the top Header HUD ({serialCtx.activeBoard?.name || 'COM Port'}). Web Serial requires exclusive access. Transfer it directly to the qFlipper suite:
                  </p>
                </div>
              </div>
              <button
                onClick={handleTransferFromMainSerial}
                disabled={isConnecting}
                className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 flex-shrink-0 shadow-lg shadow-amber-500/25 transition whitespace-nowrap"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>Transfer to qFlipper</span>
              </button>
            </div>
          )}

          {/* Plugged-in / Pre-Authorized Device Detected Card */}
          {detectedPorts.length > 0 && !serialCtx?.isConnected && (
            <div className="w-full max-w-xl bg-emerald-950/40 border border-emerald-500/50 rounded-2xl p-4 sm:p-5 mb-6 text-emerald-200 text-left shadow-2xl">
              <div className="flex items-center justify-between mb-3 border-b border-emerald-500/20 pb-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>PLUGGED IN & RECOGNIZED</span>
                </div>
                <span className="text-[10px] text-emerald-300/70 font-mono">Web Serial Ready</span>
              </div>
              <div className="space-y-2">
                {detectedPorts.map((dp, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#13151c] p-3 rounded-xl border border-emerald-500/30">
                    <div>
                      <div className="font-bold text-white text-xs flex items-center gap-2">
                        <Bot className="w-4 h-4 text-[#fe8a2c]" />
                        <span>{dp.label}</span>
                        {dp.isFlipper && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#fe8a2c]/20 text-[#fe8a2c] border border-[#fe8a2c]/40 font-bold">
                            FLIPPER ZERO
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        VID: 0x{dp.info.usbVendorId?.toString(16).toUpperCase() || '0483'} | PID: 0x{dp.info.usbProductId?.toString(16).toUpperCase() || '5740'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnectToPort(dp.port)}
                      disabled={isConnecting}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold rounded-lg text-xs transition shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-1.5 flex-shrink-0"
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Connect Now</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Authentic qFlipper Vector Graphics: Flipper + Type-C Plug */}
          <div className="relative w-full max-w-lg h-44 sm:h-52 flex items-center justify-center mb-6">
            <img 
              src={flipperSvg} 
              alt="Flipper Zero Outline" 
              className="w-72 sm:w-80 h-auto object-contain filter drop-shadow-[0_0_35px_rgba(254,138,44,0.18)]"
            />
            {/* Sliding Type-C Cable inserting into top-left USB port */}
            <div className="absolute top-[32px] sm:top-[38px] right-[10px] sm:right-[38px] flex items-center animate-pulse">
              <img src={typecSvg} alt="USB Type-C" className="w-24 sm:w-32 h-auto" />
            </div>
          </div>

          <h3 className="text-xl sm:text-2xl font-bold text-white tracking-wide mb-2 font-sans">
            CONNECT YOUR FLIPPER ZERO
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mb-8 leading-relaxed font-sans">
            Connect your Flipper Zero via USB cable to update firmware, manage MicroSD files, view real-time screen streaming, and control device peripherals.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3.5">
            <button
              onClick={() => handleConnect(true)}
              disabled={isConnecting}
              className="px-8 py-3.5 bg-[#fe8a2c] hover:bg-[#ff9722] active:scale-95 disabled:opacity-50 text-slate-950 font-bold rounded-2xl text-sm font-sans transition shadow-xl shadow-[#fe8a2c]/30 flex items-center gap-2.5"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{isConnecting ? 'CONNECTING...' : 'CONNECT VIA USB'}</span>
            </button>

            <button
              onClick={() => handleConnect(false)}
              className="px-5 py-3.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-2xl text-xs font-mono transition"
            >
              Filtered Search
            </button>
          </div>

          <div className="mt-12 pt-6 border-t border-[#232733] flex flex-wrap items-center justify-center gap-8 text-[11px] text-slate-500 font-mono">
            <span>• STMicroelectronics (VID: 0483, PID: 5740)</span>
            <span>• 115200 8-N-1 Virtual COM Port</span>
            <span>• Official, Unleashed, Momentum, Xtreme</span>
          </div>
        </div>
      ) : (
        /* 3. Official qFlipper Connected Experience */
        <div className="w-full">
          {/* VIEW 1: qFlipper Main Device View (HomeOverlay + DeviceInfo + DeviceWidget) */}
          {activeView === 'device' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column (5 cols): Authentic Flipper Zero Device Silhouette & Screen */}
              <div className="lg:col-span-5 bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col items-center">
                {/* Header: Model & Edition */}
                <div className="w-full flex items-center justify-between pb-3 border-b border-[#232733] mb-5">
                  <span className="text-xs font-bold text-[#fe8a2c] flex items-center gap-1.5 font-sans">
                    <Bot className="w-4 h-4" />
                    <span>FLIPPER ZERO // {state.hardwareModel || (state.isConnected ? 'Querying...' : 'F7')}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {state.hardwareColor ? `${state.hardwareColor} Edition` : (state.isConnected ? 'Hardware Connected' : '')}
                  </span>
                </div>

                {/* Interactive Flipper Zero Body with Live 128x64 LCD Screen */}
                <div className="relative w-full max-w-sm aspect-[360/156] mb-5 flex items-center justify-center group select-none">
                  {/* Vector SVG Background Frame */}
                  <img 
                    src={flipperSvg} 
                    alt="Flipper Zero Casing" 
                    className="w-full h-full object-contain filter drop-shadow-[0_0_40px_rgba(254,138,44,0.15)]"
                  />

                  {/* 128x64 Live Monochrome LCD Canvas positioned on LCD cutout (88, 19, 136, 73) */}
                  <div 
                    onClick={() => setActiveView('screen')}
                    className="absolute cursor-pointer rounded overflow-hidden shadow-inner border border-[#9e5823]/60 transition-transform group-hover:scale-[1.02] bg-[#fe8a2c]"
                    style={{
                      left: '24.4%',
                      top: '12.2%',
                      width: '37.8%',
                      height: '46.8%',
                    }}
                    title="Click to open full Screen Stream"
                  >
                    <canvas 
                      ref={miniCanvasRef}
                      width={128} 
                      height={64}
                      className="w-full h-full object-fill"
                      style={{ imageRendering: 'pixelated' }}
                    />

                    {/* Screen Stream Hover Cue */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-[9px] gap-1">
                      <Monitor className="w-3 h-3 text-[#fe8a2c]" />
                      <span>Live Stream</span>
                    </div>
                  </div>

                  {/* Interactive D-Pad Hitboxes on the SVG */}
                  {/* Up */}
                  <div 
                    onClick={() => handleDpadPress('up')}
                    className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
                    style={{ left: '73%', top: '20%', width: '12%', height: '22%' }}
                    title="Press D-Pad Up"
                  />
                  {/* Down */}
                  <div 
                    onClick={() => handleDpadPress('down')}
                    className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
                    style={{ left: '73%', top: '56%', width: '12%', height: '22%' }}
                    title="Press D-Pad Down"
                  />
                  {/* Left */}
                  <div 
                    onClick={() => handleDpadPress('left')}
                    className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
                    style={{ left: '64%', top: '38%', width: '10%', height: '22%' }}
                    title="Press D-Pad Left"
                  />
                  {/* Right */}
                  <div 
                    onClick={() => handleDpadPress('right')}
                    className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
                    style={{ left: '84%', top: '38%', width: '10%', height: '22%' }}
                    title="Press D-Pad Right"
                  />
                  {/* OK */}
                  <div 
                    onClick={() => handleDpadPress('ok')}
                    className="absolute cursor-pointer hover:bg-[#ff9722]/40 rounded-full transition active:scale-90"
                    style={{ left: '74%', top: '38%', width: '10%', height: '22%' }}
                    title="Press D-Pad OK"
                  />
                  {/* Back */}
                  <div 
                    onClick={() => handleDpadPress('back')}
                    className="absolute cursor-pointer hover:bg-[#fe8a2c]/40 rounded-full transition active:scale-90"
                    style={{ left: '89%', top: '50%', width: '8%', height: '18%' }}
                    title="Press Back Button"
                  />
                </div>

                {/* Tactile D-Pad Controller (DirectionalKeypad.qml style) */}
                <div className="w-full bg-[#1e212b] border border-[#2b303c] rounded-2xl p-4 flex flex-col items-center gap-3">
                  <div className="text-[10px] font-mono text-slate-400 tracking-wider">
                    DIRECTIONAL KEYPAD (D-PAD)
                  </div>

                  <div className="flex items-center justify-around w-full">
                    {/* Circular Dark Orange Ring Keypad */}
                    <div className="relative w-32 h-32 rounded-full bg-[#491d00] border-2 border-[#ff9722] flex items-center justify-center shadow-lg">
                      {/* Up */}
                      <button
                        onClick={() => handleDpadPress('up')}
                        className="absolute top-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                        title="D-Pad Up"
                      >
                        <ChevronUp className="w-6 h-6 stroke-[3]" />
                      </button>

                      {/* Left */}
                      <button
                        onClick={() => handleDpadPress('left')}
                        className="absolute left-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                        title="D-Pad Left"
                      >
                        <ChevronLeft className="w-6 h-6 stroke-[3]" />
                      </button>

                      {/* OK Center Button */}
                      <button
                        onClick={() => handleDpadPress('ok')}
                        className="w-10 h-10 rounded-full bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold flex items-center justify-center shadow-md active:scale-90 transition text-xs font-mono"
                        title="D-Pad OK"
                      >
                        OK
                      </button>

                      {/* Right */}
                      <button
                        onClick={() => handleDpadPress('right')}
                        className="absolute right-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                        title="D-Pad Right"
                      >
                        <ChevronRight className="w-6 h-6 stroke-[3]" />
                      </button>

                      {/* Down */}
                      <button
                        onClick={() => handleDpadPress('down')}
                        className="absolute bottom-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                        title="D-Pad Down"
                      >
                        <ChevronDown className="w-6 h-6 stroke-[3]" />
                      </button>
                    </div>

                    {/* Back Button & Vibration Motor */}
                    <div className="flex flex-col items-center gap-3">
                      <button
                        onClick={() => handleDpadPress('back')}
                        className="px-4 py-2.5 bg-[#2a1708] hover:bg-[#3d220c] border border-[#ff9722]/50 text-[#ff9722] rounded-xl text-xs font-mono font-bold transition active:scale-95 shadow"
                        title="Press Back Button"
                      >
                        ◀ BACK
                      </button>

                      <button
                        onClick={handleVibrateTest}
                        disabled={vibrating}
                        className="px-3.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded-xl text-[10px] font-mono transition flex items-center gap-1.5"
                        title="Test physical vibration motor"
                      >
                        <Vibrate className="w-3.5 h-3.5" />
                        <span>{vibrating ? 'Buzzing...' : 'Vibrate'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column (7 cols): qFlipper Hardware, Storage & Firmware Overview */}
              <div className="lg:col-span-7 bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
                <div>
                  {/* Top Bar: Device Name & Action */}
                  <div className="flex items-center justify-between pb-4 border-b border-[#232733]">
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-wide font-sans">
                        {state.deviceName || (state.isConnected ? 'Flipper Zero' : 'qFlipper Suite')}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Target: <span className="text-slate-200 font-semibold">{state.hardwareModel || (state.isConnected ? 'Querying Target...' : '--')}</span>
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveView('screen')}
                      className="px-4 py-2 bg-[#fe8a2c]/20 hover:bg-[#fe8a2c]/30 border border-[#fe8a2c]/50 text-[#fe8a2c] rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 shadow"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Screen Stream</span>
                    </button>
                  </div>

                  {/* Firmware Section (qFlipper Style with Update / Reinstall Button) */}
                  <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">FIRMWARE VERSION</span>
                        <div className="text-base font-bold text-white mt-0.5 flex items-center gap-2">
                          <span>{state.firmwareVersion || (state.isConnected ? 'Reading Firmware...' : '--')}</span>
                          {state.firmwareVersion && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Active</span>
                          )}
                        </div>
                      </div>

                      {/* Firmware Channel Selector */}
                      <div className="flex items-center bg-[#171920] border border-[#2b303c] p-1 rounded-xl gap-1">
                        {['Release', 'Release-Candidate', 'Dev'].map(ch => (
                          <button
                            key={ch}
                            onClick={() => setSelectedChannel(ch)}
                            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition ${
                              selectedChannel === ch 
                                ? 'bg-[#fe8a2c] text-slate-950 shadow' 
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[#232733] text-xs">
                      <span className="text-slate-400">Branch: <strong className="text-slate-200 font-mono text-[11px]">{state.firmwareBranch || (state.isConnected ? 'installed' : '--')}</strong></span>
                      <button
                        onClick={() => driver.refreshAllRealData()}
                        className="px-4 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl text-xs font-sans transition shadow-lg shadow-[#fe8a2c]/25 flex items-center gap-1.5 active:scale-95"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>SYNC TELEMETRY</span>
                      </button>
                    </div>
                  </div>

                  {/* Storage Meters (qFlipper Style Progress Bars) */}
                  <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl space-y-4">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">STORAGE CAPACITY</span>

                    {/* MicroSD Card Progress */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-200 font-bold flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-[#fe8a2c]" />
                          <span>MicroSD Card (/ext)</span>
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {state.sdMounted === true && state.sdTotalKb 
                            ? `${formatKb(state.sdFreeKb)} Free / ${formatKb(state.sdTotalKb)} Total` 
                            : (state.sdMounted === false 
                                ? 'No MicroSD Card Inserted' 
                                : (state.isConnected ? 'Reading MicroSD...' : '--'))}
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                        <div 
                          className="h-full bg-gradient-to-r from-[#fe8a2c] to-[#ff9722] rounded-full transition-all duration-500"
                          style={{ width: state.sdTotalKb && state.sdFreeKb ? `${Math.max(2, Math.min(100, ((state.sdTotalKb - state.sdFreeKb) / state.sdTotalKb) * 100))}%` : '0%' }}
                        />
                      </div>
                    </div>

                    {/* Internal Flash Memory Progress */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-200 font-bold flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-[#228cff]" />
                          <span>Internal Flash (/int)</span>
                        </span>
                        <span className="text-slate-400">
                          {state.intTotalKb 
                            ? `${formatKb(state.intFreeKb)} Free / ${formatKb(state.intTotalKb)} Total` 
                            : (state.isConnected ? 'Reading Internal Flash...' : '--')}
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                        <div 
                          className="h-full bg-[#228cff] rounded-full transition-all duration-500"
                          style={{ width: state.intTotalKb && state.intFreeKb ? `${Math.max(2, Math.min(100, ((state.intTotalKb - state.intFreeKb) / state.intTotalKb) * 100))}%` : '0%' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Battery & Power Info */}
                  <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">BATTERY HEALTH</span>
                      <div className="text-base font-bold text-emerald-400 mt-0.5 flex items-center gap-2">
                        <span>{state.batteryPercent !== null ? `${state.batteryPercent}%` : '--'}</span>
                        <span className="text-xs text-slate-400 font-normal">{state.batteryVoltageMv ? `(${state.batteryVoltageMv} mV)` : ''}</span>
                        {state.chargeState && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono capitalize">
                            {state.chargeState}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-400 space-y-0.5">
                      <div>Temp: <strong className="text-slate-200">{state.batteryTempC !== null ? `${state.batteryTempC} °C` : '--'}</strong></div>
                      <div>Health: <strong className="text-emerald-400">{state.batteryHealth !== null ? `${state.batteryHealth}%` : '--'}</strong></div>
                    </div>
                  </div>
                </div>

                {/* Bottom Hardware Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-[#232733]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => driver.reboot()}
                      className="px-3.5 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#fe8a2c]" />
                      <span>Reboot Flipper</span>
                    </button>

                    <button
                      onClick={() => driver.dfu()}
                      className="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 rounded-xl text-xs font-mono transition"
                    >
                      DFU Recovery
                    </button>
                  </div>

                  <button
                    onClick={() => setActiveView('files')}
                    className="px-4 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl text-xs font-sans transition flex items-center gap-1.5 shadow-md shadow-[#fe8a2c]/20 active:scale-95"
                  >
                    <span>OPEN FILE MANAGER</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: qFlipper Screen Streaming View (Live Screen Mirror + Keyboard Control) */}
          {activeView === 'screen' && (
            <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center">
              {/* Screen Stream Toolbar */}
              <div className="w-full flex items-center justify-between pb-4 border-b border-[#232733] mb-6">
                <div className="flex items-center gap-2 font-sans">
                  <Monitor className="w-4 h-4 text-[#fe8a2c]" />
                  <span className="font-bold text-white text-sm">SCREEN STREAMING // 128x64 LCD</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">LIVE</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (driver.isScreenStreaming) {
                        await driver.stopScreenStream();
                      } else {
                        await driver.startScreenStream();
                      }
                      setState({ ...driver.state });
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 ${
                      driver.isScreenStreaming 
                        ? 'bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30' 
                        : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30'
                    }`}
                    title={driver.isScreenStreaming ? "Pause Live Screen Streaming" : "Start Live Screen Streaming"}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>{driver.isScreenStreaming ? 'Pause Stream' : 'Start Stream'}</span>
                  </button>

                  <button
                    onClick={() => setKeyboardNavEnabled(!keyboardNavEnabled)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition flex items-center gap-1.5 ${
                      keyboardNavEnabled 
                        ? 'bg-[#fe8a2c]/20 text-[#fe8a2c] border border-[#fe8a2c]/50 font-bold' 
                        : 'bg-[#1e212b] text-slate-400 border border-[#2e3444]'
                    }`}
                    title="Control Flipper using your PC keyboard arrow keys + Enter + Esc"
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    <span>Keyboard Remote: {keyboardNavEnabled ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    onClick={handleScreenshot}
                    className="px-3.5 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5"
                    title="Save current screen as PNG"
                  >
                    <Camera className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Screenshot</span>
                  </button>
                </div>
              </div>

              {/* Large Screen Frame (Scaled 128x64 Monochrome Orange Display) */}
              <div className="relative p-6 bg-[#1e212b] border-4 border-[#9e5823] rounded-3xl shadow-[0_0_60px_rgba(254,138,44,0.25)] max-w-xl w-full flex flex-col items-center">
                <div className="w-full aspect-[2/1] bg-[#fe8a2c] rounded-2xl overflow-hidden shadow-inner border border-[#ce5300] relative flex items-center justify-center p-2">
                  <canvas 
                    ref={screenCanvasRef}
                    width={128} 
                    height={64}
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between w-full px-2 text-[10px] text-amber-500/80 font-bold uppercase tracking-widest font-mono">
                  <span>FLIPPER ZERO // 128x64 ST7567 LCD</span>
                  <span className={driver.isScreenStreaming ? 'text-emerald-400 font-mono flex items-center gap-1.5' : 'text-slate-400 font-mono flex items-center gap-1.5'}>
                    {driver.isScreenStreaming && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>}
                    {driver.isScreenStreaming 
                      ? `STREAMING REAL HARDWARE LCD ${state.screenFrameCount ? `(${state.screenFrameCount} frames)` : ''}` 
                      : 'STREAM STANDBY'}
                  </span>
                </div>
              </div>

              {/* Directional Keypad Controls */}
              <div className="mt-8 flex items-center justify-center gap-6">
                <button
                  onClick={() => handleDpadPress('left')}
                  className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
                  title="Left Arrow"
                >
                  <ChevronLeft className="w-5 h-5 text-[#fe8a2c]" />
                </button>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleDpadPress('up')}
                    className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
                    title="Up Arrow"
                  >
                    <ChevronUp className="w-5 h-5 text-[#fe8a2c]" />
                  </button>

                  <button
                    onClick={() => handleDpadPress('ok')}
                    className="px-6 py-3 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl active:scale-95 transition shadow-lg shadow-[#fe8a2c]/30 text-sm font-mono"
                    title="Enter / OK"
                  >
                    OK
                  </button>

                  <button
                    onClick={() => handleDpadPress('down')}
                    className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
                    title="Down Arrow"
                  >
                    <ChevronDown className="w-5 h-5 text-[#fe8a2c]" />
                  </button>
                </div>

                <button
                  onClick={() => handleDpadPress('right')}
                  className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
                  title="Right Arrow"
                >
                  <ChevronRight className="w-5 h-5 text-[#fe8a2c]" />
                </button>

                <button
                  onClick={() => handleDpadPress('back')}
                  className="px-4 py-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-[#fe8a2c] rounded-xl active:scale-95 transition font-bold text-xs"
                  title="Escape / Back"
                >
                  ◀ BACK
                </button>
              </div>

              <p className="mt-4 text-[11px] text-slate-500 font-mono">
                Tip: Use your computer's <strong>Arrow keys</strong>, <strong>Enter</strong> (OK), and <strong>Esc / Backspace</strong> (Back) to navigate your Flipper!
              </p>
            </div>
          )}

          {/* VIEW 3: qFlipper File Manager (FileManager.qml style Two-Pane Tree Browser) */}
          {activeView === 'files' && (
            <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col space-y-4">
              {/* Hidden file upload input */}
              <input 
                type="file" 
                ref={fileUploadInputRef} 
                onChange={handleUploadFile} 
                className="hidden" 
              />

              {/* Path, Breadcrumbs and Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#232733]">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleGoUp}
                    disabled={currentDir === '/' || currentDir === '/ext'}
                    className="p-1.5 rounded-lg bg-[#1e212b] border border-[#2e3444] text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="Up one level (..)"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1.5 bg-[#13151c] px-3 py-1.5 rounded-xl border border-[#282d38] text-xs font-mono">
                    <FolderOpen className="w-4 h-4 text-[#fe8a2c] shrink-0" />
                    <button
                      onClick={() => { setCurrentDir('/ext'); loadDirectory('/ext'); }}
                      className="text-slate-400 hover:text-[#fe8a2c] font-bold"
                    >
                      /ext
                    </button>
                    {currentDir.replace(/^\/ext/, '').split('/').filter(Boolean).map((part, idx, arr) => {
                      const subPath = '/ext/' + arr.slice(0, idx + 1).join('/');
                      const isLast = idx === arr.length - 1;
                      return (
                        <React.Fragment key={subPath}>
                          <span className="text-slate-600">/</span>
                          <button
                            onClick={() => { setCurrentDir(subPath); loadDirectory(subPath); }}
                            className={`font-semibold hover:underline ${isLast ? 'text-white font-bold' : 'text-slate-400 hover:text-[#fe8a2c]'}`}
                          >
                            {part}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => loadDirectory(currentDir)}
                    disabled={isLoadingFiles}
                    className="p-1.5 rounded-lg bg-[#1e212b] border border-[#2e3444] text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 transition disabled:opacity-50"
                    title="Reload directory"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  </button>

                  {isLoadingFiles && (
                    <span className="text-[#fe8a2c] text-[11px] animate-pulse font-mono flex items-center gap-1">
                      <span>Reading Flipper Storage...</span>
                    </span>
                  )}
                </div>

                {/* File Operations: New Folder, Upload */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateFolder}
                    className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5 active:scale-95"
                    title="Create new folder"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>New Folder</span>
                  </button>

                  <button
                    onClick={() => fileUploadInputRef.current?.click()}
                    className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5 active:scale-95"
                    title="Upload file to Flipper SD card"
                  >
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Upload</span>
                  </button>
                </div>
              </div>

              {/* Quick Jump Directory Bar (qFlipper shortcuts) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mr-1">Quick Jump:</span>
                {['/ext', '/ext/subghz', '/ext/nfc', '/ext/rfid', '/ext/badusb', '/ext/infrared', '/ext/ibutton', '/ext/apps', '/int'].map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      setCurrentDir(p);
                      loadDirectory(p);
                    }}
                    className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap ${
                      currentDir === p 
                        ? 'bg-[#fe8a2c] text-slate-950 font-bold shadow' 
                        : 'bg-[#1e212b] text-slate-400 border border-[#2e3444] hover:text-white'
                    }`}
                  >
                    {p.split('/').pop() || 'ext'}
                  </button>
                ))}
              </div>

              {/* Two-Pane Tree & Inspector */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* File List Table */}
                <div className="md:col-span-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-3 max-h-[460px] overflow-y-auto space-y-1">
                  {/* Up One Level row */}
                  {currentDir !== '/' && currentDir !== '/ext' && (
                    <div
                      onClick={handleGoUp}
                      className="p-2.5 rounded-xl border border-transparent hover:border-[#2e3444] hover:bg-[#171920] text-slate-400 cursor-pointer transition flex items-center gap-2"
                    >
                      <Folder className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold">.. (Parent Directory)</span>
                    </div>
                  )}

                  {dirItems.length === 0 && !isLoadingFiles && (
                    <div className="p-8 text-center text-slate-500 text-xs font-mono">
                      <Folder className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                      <div>No files or folders found in {currentDir}</div>
                      <div className="text-[10px] text-slate-600 mt-1">Click "Reload" or "New Folder" to create one.</div>
                    </div>
                  )}

                  {dirItems.map(item => (
                    <div
                      key={item.path}
                      onClick={() => handleSelectFile(item)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between group ${
                        selectedFile?.path === item.path
                          ? 'bg-[#fe8a2c]/20 border-[#fe8a2c]/60 text-[#fe8a2c] font-bold shadow'
                          : 'bg-[#171920]/80 border-[#282d38] text-slate-300 hover:bg-[#212530]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1 min-w-0 mr-2">
                        {item.isDir ? (
                          <Folder className="w-4 h-4 text-[#fe8a2c] shrink-0" />
                        ) : (
                          <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                        )}
                        <span className="truncate text-xs">{item.name}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!item.isDir && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            {item.size ? (item.size.endsWith('b') || item.size.endsWith('B') ? item.size : `${item.size} B`) : ''}
                          </span>
                        )}
                        <button
                          onClick={(e) => handleDeleteItem(item, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition rounded"
                          title={`Delete ${item.name} from Flipper`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* File Viewer & Content */}
                <div className="md:col-span-7 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-4 flex flex-col justify-between min-h-[460px]">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-[#2b303c] mb-3">
                      <div className="truncate mr-2">
                        <span className="font-bold text-white text-xs truncate block">
                          {selectedFile ? selectedFile.path : 'Select a file to inspect'}
                        </span>
                        {selectedFile && (
                          <span className="text-[10px] text-slate-400">
                            {selectedFile.size ? `${selectedFile.size}` : ''}
                          </span>
                        )}
                      </div>

                      {selectedFile && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => {
                              const blob = new Blob([fileContent || ''], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = selectedFile.name;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="px-3 py-1 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-lg text-xs font-mono transition flex items-center gap-1.5 shadow"
                          >
                            <Download className="w-3.5 h-3.5" /> Export
                          </button>

                          <button
                            onClick={(e) => handleDeleteItem(selectedFile, e)}
                            className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-mono transition flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>

                    <pre className="text-[11px] font-mono text-[#fe8a2c] whitespace-pre-wrap max-h-[380px] overflow-y-auto bg-[#171920] p-4 rounded-xl border border-[#232733] select-text">
                      {fileContent || '// Select a file on your Flipper to inspect contents'}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 4: CLI Console (qFlipper Serial Shell) */}
          {activeView === 'cli' && (
            <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#232733]">
                <div className="flex items-center gap-2 font-sans">
                  <TerminalIcon className="w-4 h-4 text-[#fe8a2c]" />
                  <span className="font-bold text-white text-sm">FLIPPER SERIAL CLI SHELL</span>
                </div>

                {/* Quick CLI actions */}
                <div className="flex flex-wrap gap-1.5">
                  {['device_info', 'power info', 'storage info /ext', 'vibro 1', 'vibro 0', 'led r 255', 'led off', 'uptime', 'date'].map(cmd => (
                    <button
                      key={cmd}
                      onClick={() => driver.executeCommand(cmd)}
                      className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded text-[10px] font-mono transition"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log Output Box */}
              <div 
                ref={logContainerRef}
                className="bg-[#0e1015] border border-[#232733] rounded-2xl p-4 h-96 overflow-y-auto font-mono text-[11px] space-y-1 select-text"
              >
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="text-slate-600 select-none">[{log.timestamp}]</span>
                    <span className={
                      log.type === 'error' ? 'text-rose-400' :
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'warning' ? 'text-amber-400' :
                      log.type === 'tx' ? 'text-cyan-300' :
                      'text-slate-300'
                    }>
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>

              {/* Command Input Bar */}
              <form onSubmit={handleSendCli} className="flex gap-2">
                <input
                  type="text"
                  value={cliInput}
                  onChange={(e) => setCliInput(e.target.value)}
                  placeholder="e.g. device_info, power info, storage list /ext, subghz rx, reboot"
                  className="flex-1 bg-[#1e212b] border border-[#2b303c] text-slate-100 font-mono px-3.5 py-2 rounded-xl text-xs focus:outline-none focus:border-[#fe8a2c]"
                />
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-mono text-xs font-bold rounded-xl transition shadow-md shadow-[#fe8a2c]/25"
                >
                  SEND
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
