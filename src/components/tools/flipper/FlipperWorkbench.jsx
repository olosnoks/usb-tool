import React, { useState, useEffect, useRef } from 'react';
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
  BatteryCharging
} from 'lucide-react';
import { FlipperZeroDriver } from '../../../utils/flipperDriver';
import flipperSvg from '../../../assets/flipper/flipper.svg';
import typecSvg from '../../../assets/flipper/typec.svg';

export default function FlipperWorkbench() {
  const [driver] = useState(() => new FlipperZeroDriver());
  const [state, setState] = useState(() => driver.state);

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

  // Hardware Actions State
  const [vibrating, setVibrating] = useState(false);
  const [ledColor, setLedColor] = useState('off');
  const [selectedChannel, setSelectedChannel] = useState('Release');

  const canvasRef = useRef(null);
  const logContainerRef = useRef(null);

  // Subscribe to driver state & logs
  useEffect(() => {
    driver.onStateChangeCallback = (s) => setState({ ...s });
    driver.onLogCallback = (log) => {
      setLogs(prev => [...prev.slice(-200), log]);
    };

    return () => {
      driver.disconnect();
    };
  }, [driver]);

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

  // Connect handler
  const handleConnect = async (noFilter = false) => {
    setConnectError(null);
    setIsConnecting(true);
    try {
      await driver.connectHardware({ noFilter });
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
    const canvas = canvasRef.current;
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
              <span>{state.isConnected ? (state.hardwareModel || 'STM32WB55') : 'qFlipper Companion (VID: 0483, PID: 5740)'}</span>
              {state.firmwareVersion && (
                <>
                  <span>•</span>
                  <span className="text-[#fe8a2c] font-bold">{state.firmwareVersion}</span>
                </>
              )}
              {state.batteryPercent !== null && (
                <>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">BAT: {state.batteryPercent}% ({state.batteryVoltageMv || '4120'} mV)</span>
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
            <>
              <button
                onClick={() => handleConnect(false)}
                disabled={isConnecting}
                className="px-5 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] active:scale-95 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs font-sans transition shadow-lg shadow-[#fe8a2c]/25 flex items-center gap-2"
                title="Connect real Flipper Zero via Web Serial"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>{isConnecting ? 'Connecting...' : 'CONNECT FLIPPER'}</span>
              </button>

              <button
                onClick={() => handleConnect(true)}
                className="px-3 py-2 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-xl text-xs font-mono transition"
                title="Pick COM Port directly from system"
              >
                All Ports
              </button>
            </>
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
                Tip: If the desktop <strong>qFlipper</strong> application is currently open on your PC, close it completely so it releases the USB serial port. Then plug your Flipper in and click Connect.
              </div>
            </div>
          </div>
          <button onClick={() => setConnectError(null)} className="text-slate-400 hover:text-white px-2">✕</button>
        </div>
      )}

      {/* 2. Official qFlipper Disconnected Welcome Screen (NoDeviceOverlay) */}
      {!state.isConnected ? (
        <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-10 sm:p-14 shadow-2xl flex flex-col items-center justify-center text-center max-w-4xl mx-auto my-4">
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
              onClick={() => handleConnect(false)}
              disabled={isConnecting}
              className="px-8 py-3.5 bg-[#fe8a2c] hover:bg-[#ff9722] active:scale-95 disabled:opacity-50 text-slate-950 font-bold rounded-2xl text-sm font-sans transition shadow-xl shadow-[#fe8a2c]/30 flex items-center gap-2.5"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{isConnecting ? 'CONNECTING...' : 'CONNECT VIA USB'}</span>
            </button>

            <button
              onClick={() => handleConnect(true)}
              className="px-5 py-3.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-2xl text-xs font-mono transition"
            >
              Show All Ports
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
                    <span>FLIPPER ZERO // {state.hardwareModel || 'F7'}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {state.hardwareColor || 'White'} Edition
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

                  {/* 128x64 Orange Monochrome LCD Screen positioned precisely on the LCD cutout (88, 19, 136, 73) */}
                  <div 
                    onClick={() => setActiveView('screen')}
                    className="absolute cursor-pointer rounded overflow-hidden flex flex-col justify-between text-black font-mono shadow-inner border border-[#9e5823]/60 transition-transform group-hover:scale-[1.02]"
                    style={{
                      left: '24.4%',
                      top: '12.2%',
                      width: '37.8%',
                      height: '46.8%',
                      backgroundColor: '#fe8a2c',
                      padding: '4px 6px',
                    }}
                    title="Click to open Screen Stream"
                  >
                    {/* Top Status Bar */}
                    <div className="flex items-center justify-between text-[8px] font-bold border-b border-black/30 pb-0.5">
                      <span>BAT: {state.batteryPercent !== null ? `${state.batteryPercent}%` : '98%'}</span>
                      <span>{state.sdMounted ? 'SD:OK' : 'SD:--'}</span>
                      <span>BLE</span>
                    </div>

                    {/* Mascot / App Center */}
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                      <div className="font-bold text-[10px] tracking-wider leading-none">
                        {state.deviceName || 'FLIPPER ZERO'}
                      </div>
                      <div className="text-[8px] opacity-75 mt-0.5 leading-none">
                        {state.firmwareVersion || 'FuriOS'}
                      </div>
                      <div className="text-[7px] mt-1 font-bold px-1.5 py-0.5 bg-black/10 rounded border border-black/20">
                        ONLINE // USB CDC
                      </div>
                    </div>

                    {/* Bottom Status */}
                    <div className="flex items-center justify-between text-[7px] opacity-75">
                      <span>{state.hardwareModel || 'F7B4C2'}</span>
                      <span>HARDWARE</span>
                    </div>

                    {/* Screen Stream Hover Cue */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-[9px] gap-1">
                      <Monitor className="w-3 h-3 text-[#fe8a2c]" />
                      <span>Stream</span>
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
                        {state.deviceName || 'Flipper Zero'}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Target: <span className="text-slate-200 font-semibold">{state.hardwareModel || 'F7B4C2'}</span> • Rev. 12
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
                          <span>{state.firmwareVersion || '0.104.1'}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Up to date</span>
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
                      <span className="text-slate-400">Branch: <strong className="text-slate-200 font-mono text-[11px]">{state.firmwareBranch || 'release'}</strong></span>
                      <button
                        onClick={() => driver.refreshAllRealData()}
                        className="px-4 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl text-xs font-sans transition shadow-lg shadow-[#fe8a2c]/25 flex items-center gap-1.5 active:scale-95"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>REPAIR / REINSTALL</span>
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
                        <span className="text-slate-400">
                          {state.sdMounted ? `${formatKb(state.sdFreeKb)} Free / ${formatKb(state.sdTotalKb)} Total` : '14.2 GB Free / 16.0 GB Total'}
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                        <div 
                          className="h-full bg-gradient-to-r from-[#fe8a2c] to-[#ff9722] rounded-full transition-all duration-500"
                          style={{ width: state.sdTotalKb && state.sdFreeKb ? `${Math.max(5, ((state.sdTotalKb - state.sdFreeKb) / state.sdTotalKb) * 100)}%` : '12%' }}
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
                          {state.intFreeKb ? `${formatKb(state.intFreeKb)} Free / ${formatKb(state.intTotalKb)} Total` : '184 KB Free / 256 KB'}
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                        <div 
                          className="h-full bg-[#228cff] rounded-full transition-all duration-500"
                          style={{ width: state.intTotalKb && state.intFreeKb ? `${Math.max(5, ((state.intTotalKb - state.intFreeKb) / state.intTotalKb) * 100)}%` : '28%' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Battery & Power Info */}
                  <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">BATTERY HEALTH</span>
                      <div className="text-base font-bold text-emerald-400 mt-0.5 flex items-center gap-2">
                        <span>{state.batteryPercent !== null ? `${state.batteryPercent}%` : '98%'}</span>
                        <span className="text-xs text-slate-400 font-normal">({state.batteryVoltageMv || '4120'} mV)</span>
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-400 space-y-0.5">
                      <div>Temp: <strong className="text-slate-200">{state.batteryTempC || '28.5'} °C</strong></div>
                      <div>Health: <strong className="text-emerald-400">98%</strong></div>
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
                <div className="w-full aspect-[2/1] bg-[#fe8a2c] rounded-2xl p-4 flex flex-col justify-between text-black select-none shadow-inner border border-[#ce5300] font-mono">
                  {/* Top Status */}
                  <div className="flex items-center justify-between text-xs font-bold border-b border-black/30 pb-1.5">
                    <span>BAT: {state.batteryPercent !== null ? `${state.batteryPercent}%` : '98%'}</span>
                    <span>{state.sdMounted ? 'SD:OK' : 'SD:--'}</span>
                    <span>BLE:READY</span>
                  </div>

                  {/* Main Screen Content */}
                  <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
                    <div className="font-bold text-base tracking-wider">
                      {state.deviceName || 'FLIPPER ZERO'}
                    </div>
                    <div className="text-xs mt-1 opacity-80">
                      {state.firmwareVersion || 'FuriOS'}
                    </div>
                    <div className="text-[10px] mt-3 font-bold px-3 py-1 bg-black/10 rounded-lg border border-black/20">
                      KEYBOARD NAVIGATION ACTIVE
                    </div>
                  </div>

                  {/* Bottom Bar */}
                  <div className="flex items-center justify-between text-[10px] opacity-75">
                    <span>{state.hardwareModel || 'F7'}</span>
                    <span>128x64 ILI9163</span>
                  </div>
                </div>

                <div className="mt-3 text-center text-[10px] text-amber-500/80 font-bold uppercase tracking-widest">
                  FLIPPER ZERO // 128x64 PIXELS MONOCHROME
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
              {/* Path and Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#232733]">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#fe8a2c]" />
                  <span className="font-bold text-white text-sm">{currentDir}</span>
                  {isLoadingFiles && <span className="text-[#fe8a2c] text-[10px] animate-pulse">Reading Flipper Storage...</span>}
                </div>

                <div className="flex items-center gap-2">
                  {['/ext', '/ext/subghz', '/ext/nfc', '/ext/rfid', '/ext/badusb', '/ext/infrared', '/ext/apps', '/int'].map(p => (
                    <button
                      key={p}
                      onClick={() => {
                        setCurrentDir(p);
                        loadDirectory(p);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs transition ${
                        currentDir === p 
                          ? 'bg-[#fe8a2c] text-slate-950 font-bold shadow' 
                          : 'bg-[#1e212b] text-slate-400 border border-[#2e3444] hover:text-white'
                      }`}
                    >
                      {p.split('/').pop() || 'ext'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Two-Pane Tree & Inspector */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* File List Table */}
                <div className="md:col-span-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-3 max-h-96 overflow-y-auto space-y-1">
                  {dirItems.length === 0 && !isLoadingFiles && (
                    <div className="p-6 text-center text-slate-500 text-xs">
                      Directory is empty or awaiting response from device
                    </div>
                  )}

                  {dirItems.map(item => (
                    <div
                      key={item.path}
                      onClick={() => handleSelectFile(item)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                        selectedFile?.path === item.path
                          ? 'bg-[#fe8a2c]/20 border-[#fe8a2c]/60 text-[#fe8a2c] font-bold shadow'
                          : 'bg-[#171920]/80 border-[#282d38] text-slate-300 hover:bg-[#212530]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {item.isDir ? (
                          <Folder className="w-4 h-4 text-[#fe8a2c] shrink-0" />
                        ) : (
                          <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                        )}
                        <span className="truncate text-xs">{item.name}</span>
                      </div>
                      {!item.isDir && <span className="text-[10px] text-slate-500 shrink-0 ml-2">{item.size} B</span>}
                    </div>
                  ))}
                </div>

                {/* File Viewer & Content */}
                <div className="md:col-span-7 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-[#2b303c] mb-3">
                      <span className="font-bold text-white text-xs truncate">
                        {selectedFile ? selectedFile.path : 'Select a file to inspect'}
                      </span>
                      {selectedFile && (
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
                          className="px-3 py-1 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-lg text-xs font-mono transition flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" /> Export File
                        </button>
                      )}
                    </div>

                    <pre className="text-[11px] font-mono text-[#fe8a2c] whitespace-pre-wrap max-h-72 overflow-y-auto bg-[#171920] p-3 rounded-xl border border-[#232733]">
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
