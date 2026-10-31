import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback
} from 'react';
import {
  Bot,
  RotateCcw,
  Terminal as TerminalIcon,
  Zap,
  RefreshCw,
  AlertTriangle,
  FolderOpen,
  Monitor
} from 'lucide-react';
import { getFlipperDriver } from '../../../utils/flipperDriver';
import { useSerial } from '../../../context/SerialContext';
import { identifyUsbChip } from '../../../utils/usbDatabase';
import flipperSvg from '../../../assets/flipper/flipper.svg';
import typecSvg from '../../../assets/flipper/typec.svg';
import DeviceView from './views/DeviceView';
import ScreenView from './views/ScreenView';
import FilesView from './views/FilesView';
import CliView from './views/CliView';

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
            <DeviceView
              driver={driver}
              formatKb={formatKb}
              handleDpadPress={handleDpadPress}
              handleVibrateTest={handleVibrateTest}
              miniCanvasRef={miniCanvasRef}
              selectedChannel={selectedChannel}
              setActiveView={setActiveView}
              setSelectedChannel={setSelectedChannel}
              state={state}
              vibrating={vibrating}
            />
          )}

          {/* VIEW 2: qFlipper Screen Streaming View (Live Screen Mirror + Keyboard Control) */}
          {activeView === 'screen' && (
            <ScreenView
              driver={driver}
              handleDpadPress={handleDpadPress}
              handleScreenshot={handleScreenshot}
              keyboardNavEnabled={keyboardNavEnabled}
              screenCanvasRef={screenCanvasRef}
              setKeyboardNavEnabled={setKeyboardNavEnabled}
              setState={setState}
              state={state}
            />
          )}

          {/* VIEW 3: qFlipper File Manager (FileManager.qml style Two-Pane Tree Browser) */}
          {activeView === 'files' && (
            <FilesView
              currentDir={currentDir}
              dirItems={dirItems}
              fileContent={fileContent}
              fileUploadInputRef={fileUploadInputRef}
              handleCreateFolder={handleCreateFolder}
              handleDeleteItem={handleDeleteItem}
              handleGoUp={handleGoUp}
              handleSelectFile={handleSelectFile}
              handleUploadFile={handleUploadFile}
              isLoadingFiles={isLoadingFiles}
              loadDirectory={loadDirectory}
              selectedFile={selectedFile}
              setCurrentDir={setCurrentDir}
            />
          )}

          {/* VIEW 4: CLI Console (qFlipper Serial Shell) */}
          {activeView === 'cli' && (
            <CliView
              cliInput={cliInput}
              driver={driver}
              handleSendCli={handleSendCli}
              logContainerRef={logContainerRef}
              logs={logs}
              setCliInput={setCliInput}
            />
          )}
        </div>
      )}
    </div>
  );
}
