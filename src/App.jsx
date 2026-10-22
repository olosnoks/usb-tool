import React, { useState, useEffect, useRef, useCallback } from 'react';
import HeaderHud from './components/HeaderHud';
import StreamConsole from './components/StreamConsole';
import HexInspection from './components/HexInspection';
import FileFlasher from './components/FileFlasher';
import Diagnostics from './components/Diagnostics';
import FrameInjector from './components/FrameInjector';
import MacroDecks from './components/MacroDecks';
import { parseHexInput } from './utils/checksums';
import { 
  Terminal, 
  Binary, 
  HardDrive, 
  Radar, 
  Command, 
  Zap, 
  Sliders, 
  HelpCircle,
  ExternalLink,
  Laptop
} from 'lucide-react';

export default function App() {
  // Web Serial Port & Connection State
  const [port, setPort] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [portInfo, setPortInfo] = useState(null);
  const [baudRate, setBaudRate] = useState(115200);
  const [serialConfig, setSerialConfig] = useState({
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none'
  });

  // Simulated Demo Mode (for testing without physical hardware)
  const [isDemoMode, setIsDemoMode] = useState(false);
  const demoIntervalRef = useRef(null);

  // Hardware Signals
  const [hardwareSignals, setHardwareSignals] = useState({
    dtr: false,
    rts: false,
    cts: false,
    dsr: false,
    dcd: false,
    ri: false
  });

  // Activity Indicators
  const [rxActivity, setRxActivity] = useState(false);
  const [txActivity, setTxActivity] = useState(false);
  const rxTimerRef = useRef(null);
  const txTimerRef = useRef(null);

  // Telemetry & Stats
  const [stats, setStats] = useState({
    rxBytes: 0,
    txBytes: 0,
    rxCount: 0,
    txCount: 0
  });

  // Stream & Hex Memory
  const [consoleEntries, setConsoleEntries] = useState([]);
  const [hexByteStream, setHexByteStream] = useState([]); // { offset, byte, type: 'rx' | 'tx' }
  const globalOffsetRef = useRef(0);

  // Active Bottom Workbench Tab
  const [activeBottomTab, setActiveBottomTab] = useState('flasher'); // 'flasher' | 'injector' | 'diagnostics' | 'macros'

  // Serial Streams & Reader Refs
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const keepReadingRef = useRef(false);
  const signalsPollIntervalRef = useRef(null);

  const hasWebSerialSupport = typeof navigator !== 'undefined' && 'serial' in navigator;

  // Pulse Activity LEDs
  const triggerRxActivity = useCallback(() => {
    setRxActivity(true);
    if (rxTimerRef.current) clearTimeout(rxTimerRef.current);
    rxTimerRef.current = setTimeout(() => setRxActivity(false), 90);
  }, []);

  const triggerTxActivity = useCallback(() => {
    setTxActivity(true);
    if (txTimerRef.current) clearTimeout(txTimerRef.current);
    txTimerRef.current = setTimeout(() => setTxActivity(false), 90);
  }, []);

  // System Log Entry Helper
  const addLog = useCallback((text, type = 'sys', rawBytes = null) => {
    const timestamp = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    setConsoleEntries(prev => [
      ...prev.slice(-999), // Keep latest 1000 lines
      {
        id: Math.random().toString(36).substring(2, 9),
        type,
        text,
        timestamp,
        rawBytes
      }
    ]);
  }, []);

  // Ingest incoming bytes into both console and synchronized hex stream
  const ingestIncomingBytes = useCallback((bytes) => {
    if (!bytes || bytes.length === 0) return;

    triggerRxActivity();

    // 1. Update stats
    setStats(prev => ({
      ...prev,
      rxBytes: prev.rxBytes + bytes.length,
      rxCount: prev.rxCount + 1
    }));

    // 2. Decode text for console
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(bytes);
    addLog(text, 'rx', bytes);

    // 3. Assemble into synchronized hex memory
    const startOffset = globalOffsetRef.current;
    const newHexItems = [];
    for (let i = 0; i < bytes.length; i++) {
      newHexItems.push({
        offset: startOffset + i,
        byte: bytes[i],
        type: 'rx'
      });
    }
    globalOffsetRef.current += bytes.length;

    setHexByteStream(prev => [...prev.slice(-4096), ...newHexItems]);
  }, [addLog, triggerRxActivity]);

  // Connect to Hardware Web Serial Port
  const handleConnect = async () => {
    if (!hasWebSerialSupport) {
      alert('Web Serial API is not supported in this browser. Please use Google Chrome, Edge, or Chromium.');
      return;
    }

    try {
      setIsConnecting(true);
      addLog('Requesting USB / Serial port...', 'sys');
      const selectedPort = await navigator.serial.requestPort();
      
      const info = selectedPort.getInfo ? selectedPort.getInfo() : {};
      const vidPid = info.usbVendorId 
        ? `VID:0x${info.usbVendorId.toString(16).padStart(4, '0').toUpperCase()} PID:0x${info.usbProductId?.toString(16).padStart(4, '0').toUpperCase()}`
        : 'Generic Serial Port';
      setPortInfo(vidPid);

      addLog(`Opening port @ ${baudRate} bps (${serialConfig.dataBits}${serialConfig.parity[0].toUpperCase()}${serialConfig.stopBits})...`, 'sys');
      await selectedPort.open({
        baudRate: Number(baudRate),
        dataBits: serialConfig.dataBits,
        stopBits: serialConfig.stopBits,
        parity: serialConfig.parity,
        flowControl: serialConfig.flowControl,
        bufferSize: 16384
      });

      setPort(selectedPort);
      setIsConnected(true);
      setIsConnecting(false);
      keepReadingRef.current = true;
      addLog(`Connected to ${vidPid} successfully!`, 'sys');

      // Start Read Loop
      startReading(selectedPort);

      // Start Polling Hardware Signals
      startSignalPolling(selectedPort);

    } catch (err) {
      console.error(err);
      setIsConnecting(false);
      addLog(`Connection Failed: ${err.message}`, 'sys');
    }
  };

  // Continuous Serial Read Loop
  const startReading = async (activePort) => {
    while (activePort && activePort.readable && keepReadingRef.current) {
      try {
        const reader = activePort.readable.getReader();
        readerRef.current = reader;

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            ingestIncomingBytes(value);
          }
        }
      } catch (err) {
        if (keepReadingRef.current) {
          console.error('Read loop error:', err);
          addLog(`Serial Read Error: ${err.message}`, 'sys');
        }
        break;
      } finally {
        if (readerRef.current) {
          try {
            readerRef.current.releaseLock();
          } catch (e) {}
          readerRef.current = null;
        }
      }
    }
  };

  // Poll Hardware Signals (CTS, DSR, DCD, RI)
  const startSignalPolling = (activePort) => {
    if (signalsPollIntervalRef.current) clearInterval(signalsPollIntervalRef.current);

    signalsPollIntervalRef.current = setInterval(async () => {
      if (!activePort || !activePort.getSignals) return;
      try {
        const signals = await activePort.getSignals();
        setHardwareSignals(prev => ({
          ...prev,
          cts: !!signals.clearToSend,
          dsr: !!signals.dataSetReady,
          dcd: !!signals.dataCarrierDetect,
          ri: !!signals.ringIndicator
        }));
      } catch (e) {
        // Some USB-UART bridges don't implement getSignals
      }
    }, 250);
  };

  // Disconnect Port
  const handleDisconnect = async () => {
    if (signalsPollIntervalRef.current) {
      clearInterval(signalsPollIntervalRef.current);
      signalsPollIntervalRef.current = null;
    }

    if (isDemoMode) {
      stopDemoSimulator();
      setIsConnected(false);
      addLog('Disconnected from Simulated Hardware.', 'sys');
      return;
    }

    keepReadingRef.current = false;

    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (e) {}
    }

    if (port) {
      try {
        await port.close();
      } catch (e) {
        console.warn('Port close warning:', e);
      }
      setPort(null);
    }

    setIsConnected(false);
    addLog('Serial port disconnected.', 'sys');
  };

  // Toggle Output Signal (DTR or RTS)
  const handleToggleSignal = async (signalName) => {
    const nextVal = !hardwareSignals[signalName];
    setHardwareSignals(prev => ({ ...prev, [signalName]: nextVal }));

    if (port && port.setSignals) {
      try {
        const payload = signalName === 'dtr' ? { dataTerminalReady: nextVal } : { requestToSend: nextVal };
        await port.setSignals(payload);
        addLog(`[SIGNAL] Set ${signalName.toUpperCase()} = ${nextVal ? 'HIGH' : 'LOW'}`, 'sys');
      } catch (err) {
        addLog(`Signal control error: ${err.message}`, 'sys');
      }
    } else if (isDemoMode) {
      addLog(`[SIM SIGNAL] Set ${signalName.toUpperCase()} = ${nextVal ? 'HIGH' : 'LOW'}`, 'sys');
    }
  };

  // Assert Hardware UART Break
  const handleAssertBreak = async (durationMs = 250) => {
    if (port && port.setSignals) {
      try {
        addLog(`[BREAK] Asserting UART Break for ${durationMs}ms...`, 'sys');
        await port.setSignals({ break: true });
        await new Promise(r => setTimeout(r, durationMs));
        await port.setSignals({ break: false });
        addLog(`[BREAK] UART Break released.`, 'sys');
      } catch (err) {
        addLog(`Break assertion error: ${err.message}`, 'sys');
      }
    } else if (isDemoMode) {
      addLog(`[SIM BREAK] Asserted ${durationMs}ms UART Break.`, 'sys');
    }
  };

  // Set Signals helper (for ESP32 bootloader strapping, etc.)
  const handleSetSignals = async (signalsObj) => {
    setHardwareSignals(prev => ({
      ...prev,
      dtr: signalsObj.dataTerminalReady !== undefined ? signalsObj.dataTerminalReady : prev.dtr,
      rts: signalsObj.requestToSend !== undefined ? signalsObj.requestToSend : prev.rts
    }));

    if (port && port.setSignals) {
      await port.setSignals(signalsObj);
    }
  };

  // Transmit Raw Bytes to Serial Port
  const handleSendRawBytes = async (uint8Array) => {
    if (!uint8Array || uint8Array.length === 0) return;

    triggerTxActivity();

    // 1. Update stats
    setStats(prev => ({
      ...prev,
      txBytes: prev.txBytes + uint8Array.length,
      txCount: prev.txCount + 1
    }));

    // 2. Append to hex memory stream
    const startOffset = globalOffsetRef.current;
    const newHexItems = [];
    for (let i = 0; i < uint8Array.length; i++) {
      newHexItems.push({
        offset: startOffset + i,
        byte: uint8Array[i],
        type: 'tx'
      });
    }
    globalOffsetRef.current += uint8Array.length;
    setHexByteStream(prev => [...prev.slice(-4096), ...newHexItems]);

    // 3. Physical write
    if (port && port.writable) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(uint8Array);
      } finally {
        writer.releaseLock();
      }
    } else if (isDemoMode) {
      // Loopback / Simulator response
      handleDemoSimulatorRx(uint8Array);
    }
  };

  // Transmit Text String
  const handleSendString = async (text, lineEnding = '\r\n') => {
    if (lineEnding === 'hex') {
      try {
        const parsed = parseHexInput(text);
        addLog(`[HEX TX] ${text}`, 'tx', parsed);
        await handleSendRawBytes(parsed);
      } catch (err) {
        addLog(`Hex Parse Error: ${err.message}`, 'sys');
      }
      return;
    }

    const fullStr = text + lineEnding;
    const bytes = new TextEncoder().encode(fullStr);
    addLog(fullStr, 'tx', bytes);
    await handleSendRawBytes(bytes);
  };

  // Baud Hunter Scan Helper
  const handleRunBaudScan = async (testBaud, sendProbe = true) => {
    if (isDemoMode) {
      // Simulate realistic entropy for baud 115200 and noise for others
      await new Promise(r => setTimeout(r, 400));
      if (testBaud === 115200) {
        return new TextEncoder().encode("rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\r\nets Jun  8 2016 00:22:57\r\n\r\nrst:0x10 (RTCWDT_RTC_RESET)\r\nMicroPython v1.22.0 on 2024-02-12; ESP32 module with ESP32\r\nType \"help()\" for more information.\r\n>>> ");
      } else {
        const noise = new Uint8Array(24);
        for (let i = 0; i < 24; i++) noise[i] = Math.floor(Math.random() * 256);
        return noise;
      }
    }

    if (!port) return new Uint8Array(0);

    // Safely reopen port at testBaud
    keepReadingRef.current = false;
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch (e) {}
    }
    try { await port.close(); } catch (e) {}

    await port.open({
      baudRate: testBaud,
      dataBits: serialConfig.dataBits,
      stopBits: serialConfig.stopBits,
      parity: serialConfig.parity,
      flowControl: serialConfig.flowControl,
      bufferSize: 4096
    });

    // If active probe, send \r\n
    if (sendProbe && port.writable) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode('\r\n'));
      } catch (e) {}
      finally {
        writer.releaseLock();
      }
    }

    // Read sample window (400ms)
    const sampleChunks = [];
    const reader = port.readable.getReader();
    const readDeadline = Date.now() + 400;

    try {
      while (Date.now() < readDeadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise(r => setTimeout(() => r({ done: true }), 150))
        ]);
        if (value) sampleChunks.push(value);
        if (done) break;
      }
    } catch (e) {
    } finally {
      try { reader.releaseLock(); } catch (e) {}
    }

    // Reopen at standard baud or continue
    return sampleChunks.length > 0 
      ? new Uint8Array(sampleChunks.flatMap(c => Array.from(c))) 
      : new Uint8Array(0);
  };

  // Toggle Demo Simulator
  const toggleDemoSimulator = () => {
    if (isConnected) {
      handleDisconnect();
    }
    const next = !isDemoMode;
    setIsDemoMode(next);
    if (next) {
      setIsConnected(true);
      setPortInfo('Simulated ESP32-WROOM-32 (Virtual Demo)');
      addLog('[SIMULATOR] Connected to Virtual ESP32 Serial Workbench.', 'sys');
      startDemoSimulatorStream();
    } else {
      stopDemoSimulator();
      setIsConnected(false);
      addLog('[SIMULATOR] Virtual hardware disconnected.', 'sys');
    }
  };

  const startDemoSimulatorStream = () => {
    // Initial ESP32 Boot log with ANSI colors
    const bootSequence = [
      "\x1b[33mrst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\x1b[0m\r\n",
      "configsip: 0, SPIWP:0xee\r\n",
      "clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00\r\n",
      "mode:DIO, clock div:2\r\n",
      "load:0x3fff0018,len:4\r\n",
      "load:0x3fff001c,len:1044\r\n",
      "load:0x40078000,len:10124\r\n",
      "ho 0 tail 12 room 4\r\n",
      "\x1b[32m[SYS] CPU0 & CPU1 Clocks initialized @ 240MHz\x1b[0m\r\n",
      "\x1b[36m[WiFi] MAC: 24:0A:C4:58:91:DE\x1b[0m\r\n",
      "Hit any key to stop autoboot: 3...\r\n",
      "Hit any key to stop autoboot: 2...\r\n",
      "Hit any key to stop autoboot: 1...\r\n",
      "\x1b[32mStarting MicroPython v1.22.0 on ESP32-D0WDQ6\x1b[0m\r\n",
      "Type \"help()\" for more information.\r\n",
      ">>> "
    ];

    let delay = 100;
    bootSequence.forEach((line) => {
      setTimeout(() => {
        if (keepReadingRef.current || isDemoMode) {
          ingestIncomingBytes(new TextEncoder().encode(line));
        }
      }, delay);
      delay += 120;
    });

    // Simulate periodic telemetry ping every 5 seconds
    demoIntervalRef.current = setInterval(() => {
      const freeMem = Math.floor(110000 + Math.random() * 4000);
      const pingText = `[TELEMETRY] Heap Free: ${freeMem} B | RSSI: -64 dBm | CTS: HIGH\r\n`;
      ingestIncomingBytes(new TextEncoder().encode(pingText));
      setHardwareSignals(prev => ({
        ...prev,
        cts: true,
        dsr: true,
        dcd: Math.random() > 0.5,
        ri: false
      }));
    }, 5000);
  };

  const handleDemoSimulatorRx = (bytes) => {
    const text = new TextDecoder().decode(bytes).trim();
    setTimeout(() => {
      if (text.includes('sys.implementation')) {
        ingestIncomingBytes(new TextEncoder().encode("(name='micropython', version=(1, 22, 0), mpy=517)\r\n>>> "));
      } else if (text.includes('gc.mem_free')) {
        ingestIncomingBytes(new TextEncoder().encode("Free RAM: 114288 B | Alloc: 2432 B\r\n>>> "));
      } else if (text.startsWith('AT+GMR')) {
        ingestIncomingBytes(new TextEncoder().encode("AT version:2.2.0.0(s-401)\r\nSDK version:v4.4.4\r\ncompile time(a259c4b):Feb 12 2024\r\nOK\r\n"));
      } else if (text.startsWith('AT')) {
        ingestIncomingBytes(new TextEncoder().encode("OK\r\n"));
      } else if (bytes[0] === 0x03) {
        ingestIncomingBytes(new TextEncoder().encode("\r\nKeyboardInterrupt\r\n>>> "));
      } else if (bytes[0] === 0x04) {
        ingestIncomingBytes(new TextEncoder().encode("\r\nMPY: soft reboot\r\nMicroPython v1.22.0 on 2024-02-12; ESP32 module with ESP32\r\n>>> "));
      } else {
        // Echo
        ingestIncomingBytes(new TextEncoder().encode(`\r\nECHO: ${text}\r\n>>> `));
      }
    }, 80);
  };

  const stopDemoSimulator = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 flex flex-col font-mono selection:bg-amber-400/30 selection:text-amber-300">
      {/* Header HUD Bar */}
      <HeaderHud
        isConnected={isConnected}
        isConnecting={isConnecting}
        portInfo={portInfo}
        baudRate={baudRate}
        onBaudRateChange={(newBaud) => {
          setBaudRate(newBaud);
          addLog(`Configured baud rate: ${newBaud} bps`, 'sys');
        }}
        serialConfig={serialConfig}
        onSerialConfigChange={setSerialConfig}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        hardwareSignals={hardwareSignals}
        onToggleSignal={handleToggleSignal}
        onAssertBreak={handleAssertBreak}
        stats={stats}
        onResetStats={() => {
          setStats({ rxBytes: 0, txBytes: 0, rxCount: 0, txCount: 0 });
          globalOffsetRef.current = 0;
          setHexByteStream([]);
          addLog('Byte telemetry counters reset.', 'sys');
        }}
        rxActivity={rxActivity}
        txActivity={txActivity}
        hasWebSerialSupport={hasWebSerialSupport}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 sm:p-4 flex flex-col gap-3">
        {/* Top Notice Bar with Quick Simulator Access */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-cyber-card border border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-cyber-emerald animate-ping"></span>
            <span>TARGET STATUS:</span>
            <span className={`font-bold ${isConnected ? 'text-cyber-emerald' : 'text-slate-500'}`}>
              {isConnected ? (isDemoMode ? 'VIRTUAL SIMULATOR ACTIVE' : `ONLINE // ${baudRate} 8N1`) : 'OFFLINE // READY'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleDemoSimulator}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-all border ${
                isDemoMode 
                  ? 'bg-amber-500/20 text-cyber-amber border-amber-500 shadow-amber-glow' 
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>{isDemoMode ? 'EXIT SIMULATOR' : 'LAUNCH VIRTUAL SIMULATOR'}</span>
            </button>
          </div>
        </div>

        {/* Top Half: Dual Synchronized Terminal & Hex Inspection Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-[480px] min-h-[400px]">
          {/* Left: ANSI Stream Console */}
          <StreamConsole
            entries={consoleEntries}
            onClear={() => setConsoleEntries([])}
            onSend={handleSendString}
            isConnected={isConnected}
          />

          {/* Right: Synchronized Hex Memory Inspection Grid */}
          <HexInspection
            byteStream={hexByteStream}
            onClear={() => {
              setHexByteStream([]);
              globalOffsetRef.current = 0;
              addLog('Hex memory buffer cleared.', 'sys');
            }}
          />
        </div>

        {/* Bottom Half: Workbench Tools & Modules */}
        <div className="space-y-2">
          {/* Workbench Tabs Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyber-border pb-1">
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setActiveBottomTab('flasher')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  activeBottomTab === 'flasher' 
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>BINARY FLASHER</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('injector')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  activeBottomTab === 'injector' 
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Binary className="w-3.5 h-3.5" />
                <span>HEX INJECTOR</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('diagnostics')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  activeBottomTab === 'diagnostics' 
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radar className="w-3.5 h-3.5" />
                <span>RE DIAGNOSTICS</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('macros')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  activeBottomTab === 'macros' 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 shadow-emerald-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Command className="w-3.5 h-3.5" />
                <span>MACRO DECKS</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500 font-mono hidden md:block">
              STATIC HOSTING ON GITHUB PAGES // RELATIVE ASSET BASE
            </div>
          </div>

          {/* Active Bottom Tab View */}
          <div className="pt-1">
            {activeBottomTab === 'flasher' && (
              <FileFlasher
                isConnected={isConnected}
                onWriteChunk={handleSendRawBytes}
                onLogMessage={addLog}
              />
            )}

            {activeBottomTab === 'injector' && (
              <FrameInjector
                isConnected={isConnected}
                onSendRawBytes={handleSendRawBytes}
                onLogMessage={addLog}
              />
            )}

            {activeBottomTab === 'diagnostics' && (
              <Diagnostics
                isConnected={isConnected}
                currentBaudRate={baudRate}
                onBaudRateChange={(newBaud) => {
                  setBaudRate(newBaud);
                  addLog(`Baud rate switched to ${newBaud} bps`, 'sys');
                }}
                onRunBaudScan={handleRunBaudScan}
                onSendRawByte={handleSendRawBytes}
                onSetSignals={handleSetSignals}
                onLogMessage={addLog}
              />
            )}

            {activeBottomTab === 'macros' && (
              <MacroDecks
                isConnected={isConnected}
                onSendRawByte={handleSendRawBytes}
                onSendString={handleSendString}
                onLogMessage={addLog}
              />
            )}
          </div>
        </div>
      </main>

      {/* Cyberpunk Footer */}
      <footer className="border-t border-cyber-border bg-[#070c18] py-2 px-4 text-center text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 mt-auto">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold">SKON'S WEB FLASHER</span>
          <span>// Client-side Web Serial & Reverse-Engineering Tool</span>
        </div>
        <div className="flex items-center gap-3">
          <span>DTR/RTS Strapping</span>
          <span>•</span>
          <span>Baud Hunter</span>
          <span>•</span>
          <span>Modbus CRC-16</span>
          <span>•</span>
          <span>Intel HEX / UF2</span>
        </div>
      </footer>
    </div>
  );
}
