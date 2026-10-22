import React, { useState, useEffect, useRef, useCallback } from 'react';
import HeaderHud from './components/HeaderHud';
import StreamConsole from './components/StreamConsole';
import HexInspection from './components/HexInspection';
import FileFlasher from './components/FileFlasher';
import Diagnostics from './components/Diagnostics';
import FrameInjector from './components/FrameInjector';
import MacroDecks from './components/MacroDecks';
import SerialPlotter from './components/SerialPlotter';
import UBootTriage from './components/UBootTriage';
import GpsWardriverDeck from './components/GpsWardriverDeck';
import MultiBoardWorkbench from './components/MultiBoardWorkbench';
import EspMemoryInspector from './components/EspMemoryInspector';
import SerialBridgeDeck from './components/SerialBridgeDeck';
import PacketFramer from './components/PacketFramer';
import UbxConfigDeck from './components/UbxConfigDeck';
import ScriptRunner from './components/ScriptRunner';
import CrashAlertDeck from './components/CrashAlertDeck';
import MicroPythonFileManager from './components/MicroPythonFileManager';
import { parseHexInput } from './utils/checksums';
import { requestWebUsbSerialPort } from './utils/webUsbSerial';
import { identifyUsbChip } from './utils/usbDatabase';
import { 
  Terminal, 
  Binary, 
  HardDrive, 
  Radar, 
  Command, 
  Zap, 
  Sliders, 
  Activity,
  ShieldAlert,
  Compass,
  Cpu,
  Layers,
  Radio,
  ArrowLeftRight,
  Navigation,
  FileCode,
  Bot
} from 'lucide-react';

const INITIAL_BOARD = {
  id: 'board-1',
  name: 'BOARD 1 // MAIN',
  port: null,
  isConnected: false,
  isConnecting: false,
  portInfo: null, // { usbVendorId, usbProductId }
  baudRate: 115200,
  serialConfig: {
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none'
  },
  transportType: 'serial', // 'serial' | 'webusb'
  hardwareSignals: {
    dtr: false,
    rts: false,
    cts: false,
    dsr: false,
    dcd: false,
    ri: false
  },
  stats: {
    rxBytes: 0,
    txBytes: 0,
    rxCount: 0,
    txCount: 0
  },
  rxActivity: false,
  txActivity: false,
  entries: [],
  hexByteStream: [],
  latestRxText: '',
  isMinimized: false,
  isMaximized: false,
  pos: { x: 20, y: 20 }
};

export default function App() {
  // Multi-Board Session State
  const [boards, setBoards] = useState([INITIAL_BOARD]);
  const [activeBoardId, setActiveBoardId] = useState('board-1');
  const [showHexInspection, setShowHexInspection] = useState(true);

  // Active Bottom Workbench Tab
  const [activeBottomTab, setActiveBottomTab] = useState('flasher');

  // MitM Hardware Serial Bridge State
  const [bridgeConfig, setBridgeConfig] = useState({
    active: false,
    boardAId: 'board-1',
    boardBId: ''
  });
  const [bridgeLog, setBridgeLog] = useState([]);
  const lastBridgePacketTimeRef = useRef(Date.now());
  const forwardBridgeBytesRef = useRef(null);

  // Mobile & API Detection
  const hasWebSerialSupport = typeof navigator !== 'undefined' && 'serial' in navigator;
  const hasWebUsbSupport = typeof navigator !== 'undefined' && 'usb' in navigator;
  const isMobileDevice = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isAppleDevice = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Board Stream & Async Handles Map
  const boardReadersRef = useRef({});
  const boardKeepReadingRef = useRef({});
  const boardPollIntervalsRef = useRef({});
  const boardOffsetsRef = useRef({});
  const boardRxTimersRef = useRef({});
  const boardTxTimersRef = useRef({});

  // Active Board Getter
  const activeBoard = boards.find(b => b.id === activeBoardId) || boards[0] || INITIAL_BOARD;

  // Board Mutator Helper
  const updateBoard = useCallback((boardId, updatesOrFn) => {
    setBoards(prev => prev.map(b => {
      if (b.id !== boardId) return b;
      const updates = typeof updatesOrFn === 'function' ? updatesOrFn(b) : updatesOrFn;
      return { ...b, ...updates };
    }));
  }, []);

  // System Log Helper for a Board
  const addLogToBoard = useCallback((boardId, text, type = 'sys', rawBytes = null) => {
    const timestamp = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    updateBoard(boardId, b => ({
      entries: [
        ...b.entries.slice(-999),
        {
          id: Math.random().toString(36).substring(2, 9),
          type,
          text,
          timestamp,
          rawBytes
        }
      ]
    }));
  }, [updateBoard]);

  // Global Log Helper for Active Board
  const addLog = useCallback((text, type = 'sys', rawBytes = null) => {
    addLogToBoard(activeBoardId, text, type, rawBytes);
  }, [activeBoardId, addLogToBoard]);

  // Ingest incoming bytes for a specific board
  const ingestIncomingBytes = useCallback((boardId, bytes) => {
    if (!bytes || bytes.length === 0) return;

    // Pulse RX activity LED
    updateBoard(boardId, b => ({
      rxActivity: true,
      stats: {
        ...b.stats,
        rxBytes: b.stats.rxBytes + bytes.length,
        rxCount: b.stats.rxCount + 1
      }
    }));

    if (boardRxTimersRef.current[boardId]) clearTimeout(boardRxTimersRef.current[boardId]);
    boardRxTimersRef.current[boardId] = setTimeout(() => {
      updateBoard(boardId, { rxActivity: false });
    }, 90);

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(bytes);
    addLogToBoard(boardId, text, 'rx', bytes);

    const startOffset = boardOffsetsRef.current[boardId] || 0;
    const newHexItems = [];
    for (let i = 0; i < bytes.length; i++) {
      newHexItems.push({
        offset: startOffset + i,
        byte: bytes[i],
        type: 'rx'
      });
    }
    boardOffsetsRef.current[boardId] = startOffset + bytes.length;

    updateBoard(boardId, b => ({
      latestRxText: text,
      hexByteStream: [...b.hexByteStream.slice(-4096), ...newHexItems]
    }));

    // Forward to MitM serial bridge if active
    forwardBridgeBytesRef.current?.(boardId, bytes);
  }, [addLogToBoard, updateBoard]);

  // Continuous Serial Read Loop per Board
  const startReading = async (boardId, activePort) => {
    while (activePort && activePort.readable && boardKeepReadingRef.current[boardId]) {
      try {
        const reader = activePort.readable.getReader();
        boardReadersRef.current[boardId] = reader;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) ingestIncomingBytes(boardId, value);
        }
      } catch (err) {
        if (boardKeepReadingRef.current[boardId]) {
          console.error(`Read error on board ${boardId}:`, err);
          addLogToBoard(boardId, `Serial Read Error: ${err.message}`, 'sys');
        }
        break;
      } finally {
        if (boardReadersRef.current[boardId]) {
          try { boardReadersRef.current[boardId].releaseLock(); } catch (e) {}
          boardReadersRef.current[boardId] = null;
        }
      }
    }
  };

  // Poll Hardware Signals per Board
  const startSignalPolling = (boardId, activePort) => {
    if (boardPollIntervalsRef.current[boardId]) clearInterval(boardPollIntervalsRef.current[boardId]);

    boardPollIntervalsRef.current[boardId] = setInterval(async () => {
      if (!activePort || !activePort.getSignals) return;
      try {
        const signals = await activePort.getSignals();
        updateBoard(boardId, b => ({
          hardwareSignals: {
            ...b.hardwareSignals,
            cts: !!signals.clearToSend,
            dsr: !!signals.dataSetReady,
            dcd: !!signals.dataCarrierDetect,
            ri: !!signals.ringIndicator
          }
        }));
      } catch (e) {}
    }, 250);
  };

  // Connect Port (Native Web Serial OR WebUSB OTG Fallback)
  const handleConnect = async (targetBoardId = activeBoardId) => {
    const currentBoard = boards.find(b => b.id === targetBoardId) || activeBoard;
    try {
      updateBoard(targetBoardId, { isConnecting: true });

      if (hasWebSerialSupport) {
        addLogToBoard(targetBoardId, 'Requesting USB / Serial port...', 'sys');
        const selectedPort = await navigator.serial.requestPort();
        
        const info = selectedPort.getInfo ? selectedPort.getInfo() : {};
        const chip = identifyUsbChip(info.usbVendorId, info.usbProductId);
        const boardIndex = boards.findIndex(b => b.id === targetBoardId) + 1;
        const friendlyName = `BOARD ${boardIndex}: ${chip.name !== 'Generic / Unknown UART Bridge' ? chip.name.split(' ')[0] : 'USB'}`;

        addLogToBoard(targetBoardId, `Opening port @ ${currentBoard.baudRate} bps...`, 'sys');
        await selectedPort.open({
          baudRate: Number(currentBoard.baudRate),
          dataBits: currentBoard.serialConfig.dataBits,
          stopBits: currentBoard.serialConfig.stopBits,
          parity: currentBoard.serialConfig.parity,
          flowControl: currentBoard.serialConfig.flowControl,
          bufferSize: 16384
        });

        boardKeepReadingRef.current[targetBoardId] = true;
        updateBoard(targetBoardId, {
          port: selectedPort,
          portInfo: { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId },
          isConnected: true,
          isConnecting: false,
          name: friendlyName,
          transportType: 'serial'
        });

        addLogToBoard(targetBoardId, `Connected via Web Serial API!`, 'sys');
        startReading(targetBoardId, selectedPort);
        startSignalPolling(targetBoardId, selectedPort);

      } else if (hasWebUsbSupport) {
        addLogToBoard(targetBoardId, '[WEBUSB OTG] Requesting USB-OTG device via WebUSB...', 'sys');
        const webUsbPort = await requestWebUsbSerialPort();
        const info = webUsbPort.getInfo();
        const boardIndex = boards.findIndex(b => b.id === targetBoardId) + 1;

        await webUsbPort.open({
          baudRate: Number(currentBoard.baudRate),
          dataBits: currentBoard.serialConfig.dataBits,
          stopBits: currentBoard.serialConfig.stopBits,
          parity: currentBoard.serialConfig.parity
        });

        boardKeepReadingRef.current[targetBoardId] = true;
        updateBoard(targetBoardId, {
          port: webUsbPort,
          portInfo: info,
          isConnected: true,
          isConnecting: false,
          name: `BOARD ${boardIndex}: OTG`,
          transportType: 'webusb'
        });

        addLogToBoard(targetBoardId, `Connected via Android WebUSB OTG!`, 'sys');
        startReading(targetBoardId, webUsbPort);
        startSignalPolling(targetBoardId, webUsbPort);

      } else {
        alert('Neither Web Serial nor WebUSB is supported on this browser.');
        updateBoard(targetBoardId, { isConnecting: false });
      }

    } catch (err) {
      console.error(err);
      updateBoard(targetBoardId, { isConnecting: false });
      addLogToBoard(targetBoardId, `Connection Failed: ${err.message}`, 'sys');
    }
  };

  // Disconnect Port
  const handleDisconnect = async (targetBoardId = activeBoardId) => {
    if (boardPollIntervalsRef.current[targetBoardId]) {
      clearInterval(boardPollIntervalsRef.current[targetBoardId]);
      delete boardPollIntervalsRef.current[targetBoardId];
    }

    boardKeepReadingRef.current[targetBoardId] = false;
    if (boardReadersRef.current[targetBoardId]) {
      try { await boardReadersRef.current[targetBoardId].cancel(); } catch (e) {}
      delete boardReadersRef.current[targetBoardId];
    }

    const targetBoard = boards.find(b => b.id === targetBoardId);
    if (targetBoard?.port) {
      try { await targetBoard.port.close(); } catch (e) {}
    }

    updateBoard(targetBoardId, {
      port: null,
      isConnected: false,
      isConnecting: false,
      hardwareSignals: { dtr: false, rts: false, cts: false, dsr: false, dcd: false, ri: false }
    });
    addLogToBoard(targetBoardId, 'Port disconnected.', 'sys');
  };

  // Add & Connect a New USB Board
  const handleAddNewBoard = () => {
    const newId = `board-${Date.now()}`;
    const newNum = boards.length + 1;
    const newBoard = {
      ...INITIAL_BOARD,
      id: newId,
      name: `BOARD ${newNum} // USB`,
      pos: { x: 25 * newNum, y: 25 * newNum }
    };

    setBoards(prev => [...prev, newBoard]);
    setActiveBoardId(newId);
    setTimeout(() => handleConnect(newId), 50);
  };

  // Close and remove board session
  const handleCloseBoard = async (boardId) => {
    await handleDisconnect(boardId);
    setBoards(prev => {
      const remaining = prev.filter(b => b.id !== boardId);
      if (activeBoardId === boardId && remaining.length > 0) {
        setActiveBoardId(remaining[0].id);
      }
      return remaining.length > 0 ? remaining : [INITIAL_BOARD];
    });
  };

  // Transmit Raw Bytes
  const handleSendRawBytes = async (targetBoardId, uint8Array) => {
    if (!uint8Array || uint8Array.length === 0) return;
    const currentBoard = boards.find(b => b.id === targetBoardId) || activeBoard;
    if (!currentBoard.isConnected) return;

    // Pulse TX
    updateBoard(targetBoardId, b => ({
      txActivity: true,
      stats: {
        ...b.stats,
        txBytes: b.stats.txBytes + uint8Array.length,
        txCount: b.stats.txCount + 1
      }
    }));

    if (boardTxTimersRef.current[targetBoardId]) clearTimeout(boardTxTimersRef.current[targetBoardId]);
    boardTxTimersRef.current[targetBoardId] = setTimeout(() => {
      updateBoard(targetBoardId, { txActivity: false });
    }, 90);

    const startOffset = boardOffsetsRef.current[targetBoardId] || 0;
    const newHexItems = [];
    for (let i = 0; i < uint8Array.length; i++) {
      newHexItems.push({
        offset: startOffset + i,
        byte: uint8Array[i],
        type: 'tx'
      });
    }
    boardOffsetsRef.current[targetBoardId] = startOffset + uint8Array.length;

    updateBoard(targetBoardId, b => ({
      hexByteStream: [...b.hexByteStream.slice(-4096), ...newHexItems]
    }));

    if (currentBoard.port && currentBoard.port.writable) {
      const writer = currentBoard.port.writable.getWriter();
      try {
        await writer.write(uint8Array);
      } finally {
        writer.releaseLock();
      }
    }
  };

  // Connect bridge forwarding ref to handleSendRawBytes
  useEffect(() => {
    forwardBridgeBytesRef.current = (sourceBoardId, bytes) => {
      if (!bridgeConfig.active || !bridgeConfig.boardAId || !bridgeConfig.boardBId) return;
      if (sourceBoardId !== bridgeConfig.boardAId && sourceBoardId !== bridgeConfig.boardBId) return;

      const isA = sourceBoardId === bridgeConfig.boardAId;
      const targetBoardId = isA ? bridgeConfig.boardBId : bridgeConfig.boardAId;
      if (!targetBoardId) return;

      const dir = isA ? 'A ➔ B' : 'B ➔ A';
      const now = Date.now();
      const deltaMs = now - lastBridgePacketTimeRef.current;
      lastBridgePacketTimeRef.current = now;

      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

      setBridgeLog(prev => [
        ...prev.slice(-300),
        {
          id: Math.random().toString(36).substring(2, 9),
          time: new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0'),
          dir,
          text,
          hex,
          deltaMs
        }
      ]);

      handleSendRawBytes(targetBoardId, bytes);
    };
  }, [bridgeConfig, boards]);

  const handleToggleBridge = (boardAId, boardBId, active) => {
    setBridgeConfig({
      active,
      boardAId,
      boardBId
    });
    if (active) {
      addLogToBoard(boardAId, `[BRIDGE] MitM Sniffer Active ➔ Forwarding to ${boardBId}`, 'sys');
      addLogToBoard(boardBId, `[BRIDGE] MitM Sniffer Active ➔ Forwarding to ${boardAId}`, 'sys');
    } else {
      addLogToBoard(boardAId, `[BRIDGE] MitM Sniffer stopped.`, 'sys');
      addLogToBoard(boardBId, `[BRIDGE] MitM Sniffer stopped.`, 'sys');
    }
  };

  // Transmit Text String
  const handleSendString = async (targetBoardId, text, lineEnding = '\r\n') => {
    if (lineEnding === 'hex') {
      try {
        const parsed = parseHexInput(text);
        addLogToBoard(targetBoardId, `[HEX TX] ${text}`, 'tx', parsed);
        await handleSendRawBytes(targetBoardId, parsed);
      } catch (err) {
        addLogToBoard(targetBoardId, `Hex Parse Error: ${err.message}`, 'sys');
      }
      return;
    }

    const fullStr = text + lineEnding;
    const bytes = new TextEncoder().encode(fullStr);
    addLogToBoard(targetBoardId, fullStr, 'tx', bytes);
    await handleSendRawBytes(targetBoardId, bytes);
  };

  // Broadcast to ALL Connected Boards
  const handleBroadcast = (text) => {
    boards.forEach(b => {
      if (b.isConnected) {
        handleSendString(b.id, text, '');
      }
    });
  };

  // Toggle Output Signal on Active Board
  const handleToggleSignal = async (signalName) => {
    const currentBoard = activeBoard;
    const nextVal = !currentBoard.hardwareSignals[signalName];
    updateBoard(currentBoard.id, b => ({
      hardwareSignals: { ...b.hardwareSignals, [signalName]: nextVal }
    }));

    if (currentBoard.port && currentBoard.port.setSignals) {
      try {
        const payload = signalName === 'dtr' ? { dataTerminalReady: nextVal } : { requestToSend: nextVal };
        await currentBoard.port.setSignals(payload);
        addLogToBoard(currentBoard.id, `[SIGNAL] Set ${signalName.toUpperCase()} = ${nextVal ? 'HIGH' : 'LOW'}`, 'sys');
      } catch (err) {
        addLogToBoard(currentBoard.id, `Signal control error: ${err.message}`, 'sys');
      }
    }
  };

  // Assert Hardware UART Break on Active Board
  const handleAssertBreak = async (durationMs = 250) => {
    const currentBoard = activeBoard;
    if (currentBoard.port && currentBoard.port.setSignals) {
      try {
        addLogToBoard(currentBoard.id, `[BREAK] Asserting UART Break for ${durationMs}ms...`, 'sys');
        await currentBoard.port.setSignals({ break: true });
        await new Promise(r => setTimeout(r, durationMs));
        await currentBoard.port.setSignals({ break: false });
        addLogToBoard(currentBoard.id, `[BREAK] UART Break released.`, 'sys');
      } catch (err) {
        addLogToBoard(currentBoard.id, `Break assertion error: ${err.message}`, 'sys');
      }
    }
  };

  const handleSetSignals = async (signalsObj) => {
    const currentBoard = activeBoard;
    updateBoard(currentBoard.id, b => ({
      hardwareSignals: {
        ...b.hardwareSignals,
        dtr: signalsObj.dataTerminalReady !== undefined ? signalsObj.dataTerminalReady : b.hardwareSignals.dtr,
        rts: signalsObj.requestToSend !== undefined ? signalsObj.requestToSend : b.hardwareSignals.rts
      }
    }));
    if (currentBoard.port && currentBoard.port.setSignals) {
      await currentBoard.port.setSignals(signalsObj);
    }
  };

  // Baud Hunter Helper
  const handleRunBaudScan = async (testBaud, sendProbe = true) => {
    const currentBoard = activeBoard;
    if (!currentBoard.port) return new Uint8Array(0);

    boardKeepReadingRef.current[currentBoard.id] = false;
    if (boardReadersRef.current[currentBoard.id]) {
      try { await boardReadersRef.current[currentBoard.id].cancel(); } catch (e) {}
    }
    try { await currentBoard.port.close(); } catch (e) {}

    await currentBoard.port.open({
      baudRate: testBaud,
      dataBits: currentBoard.serialConfig.dataBits,
      stopBits: currentBoard.serialConfig.stopBits,
      parity: currentBoard.serialConfig.parity,
      flowControl: currentBoard.serialConfig.flowControl,
      bufferSize: 4096
    });

    if (sendProbe && currentBoard.port.writable) {
      const writer = currentBoard.port.writable.getWriter();
      try { await writer.write(new TextEncoder().encode('\r\n')); } catch (e) {}
      finally { writer.releaseLock(); }
    }

    const sampleChunks = [];
    const reader = currentBoard.port.readable.getReader();
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
    } catch (e) {}
    finally {
      try { reader.releaseLock(); } catch (e) {}
    }

    return sampleChunks.length > 0 
      ? new Uint8Array(sampleChunks.flatMap(c => Array.from(c))) 
      : new Uint8Array(0);
  };

  // Reorder boards left or right
  const handleMoveBoard = (boardId, direction) => {
    setBoards(prev => {
      const idx = prev.findIndex(b => b.id === boardId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  // Update window properties (pos, isMinimized, isMaximized)
  const handleUpdateBoardWindow = (boardId, updates) => {
    updateBoard(boardId, updates);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 flex flex-col font-mono selection:bg-amber-400/30 selection:text-amber-300">
      {/* Header HUD Bar (Follows Active Board) */}
      <HeaderHud
        isConnected={activeBoard.isConnected}
        isConnecting={activeBoard.isConnecting}
        portInfo={activeBoard.portInfo}
        baudRate={activeBoard.baudRate}
        onBaudRateChange={(newBaud) => {
          updateBoard(activeBoard.id, { baudRate: newBaud });
          addLogToBoard(activeBoard.id, `Configured baud rate: ${newBaud} bps`, 'sys');
        }}
        serialConfig={activeBoard.serialConfig}
        onSerialConfigChange={(cfg) => updateBoard(activeBoard.id, { serialConfig: cfg })}
        onConnect={() => handleConnect(activeBoard.id)}
        onDisconnect={() => handleDisconnect(activeBoard.id)}
        hardwareSignals={activeBoard.hardwareSignals}
        onToggleSignal={handleToggleSignal}
        onAssertBreak={handleAssertBreak}
        stats={activeBoard.stats}
        onResetStats={() => {
          updateBoard(activeBoard.id, {
            stats: { rxBytes: 0, txBytes: 0, rxCount: 0, txCount: 0 },
            hexByteStream: []
          });
          boardOffsetsRef.current[activeBoard.id] = 0;
          addLogToBoard(activeBoard.id, 'Byte telemetry counters reset.', 'sys');
        }}
        rxActivity={activeBoard.rxActivity}
        txActivity={activeBoard.txActivity}
        hasWebSerialSupport={hasWebSerialSupport}
        hasWebUsbSupport={hasWebUsbSupport}
        isMobileDevice={isMobileDevice}
        isAppleDevice={isAppleDevice}
        transportType={activeBoard.transportType}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-2.5 sm:p-4 flex flex-col gap-3">
        {/* Target Status & Multi-Board Counter */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-cyber-card border border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-cyber-emerald animate-ping"></span>
            <span>ACTIVE TARGET:</span>
            <span className={`font-bold ${activeBoard.isConnected ? 'text-cyber-emerald' : 'text-slate-500'}`}>
              {activeBoard.name} // {activeBoard.isConnected ? `${activeBoard.transportType.toUpperCase()} ONLINE (${activeBoard.baudRate} 8N1)` : 'OFFLINE'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-[11px] text-slate-400 font-mono">
              ACTIVE SESSIONS: <strong className="text-cyber-cyan">{boards.filter(b => b.isConnected).length}</strong> / {boards.length}
            </span>
          </div>
        </div>

        {/* Multi-Board Terminal Deck & Movable Windows */}
        <MultiBoardWorkbench
          boards={boards}
          activeBoardId={activeBoardId}
          onSelectActiveBoard={setActiveBoardId}
          onConnectBoard={handleConnect}
          onDisconnectBoard={handleDisconnect}
          onAddNewBoard={handleAddNewBoard}
          onCloseBoard={handleCloseBoard}
          onSendToBoard={(boardId, text) => handleSendString(boardId, text)}
          onBroadcast={handleBroadcast}
          onClearBoardLog={(boardId) => updateBoard(boardId, { entries: [] })}
          onMoveBoard={handleMoveBoard}
          onUpdateBoardWindow={handleUpdateBoardWindow}
          onBaudRateChange={(boardId, baud) => updateBoard(boardId, { baudRate: baud })}
          showHexInspection={showHexInspection}
          onToggleHexInspection={() => setShowHexInspection(!showHexInspection)}
          activeHexByteStream={activeBoard.hexByteStream}
          onClearHexStream={() => {
            updateBoard(activeBoard.id, { hexByteStream: [] });
            boardOffsetsRef.current[activeBoard.id] = 0;
            addLogToBoard(activeBoard.id, 'Hex memory buffer cleared.', 'sys');
          }}
          isMobileDevice={isMobileDevice}
        />

        {/* Bottom Half: Workbench Tools & Modules (Follows Active Board) */}
        <div className="space-y-2 pt-1">
          {/* Navigation Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyber-border pb-1">
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto max-w-full scrollbar-thin scrollbar-thumb-slate-800">
              <button
                onClick={() => setActiveBottomTab('flasher')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'flasher' 
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>ESP32 FLASHER</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('esp-dump')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'esp-dump' 
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>SILICON & DUMP</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('bridge')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'bridge' 
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>MitM BRIDGE</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('packets')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'packets' 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 shadow-emerald-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>PACKET FRAMER</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('ubx')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'ubx' 
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>UBX GPS</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('micropython')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'micropython' 
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-amber-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>MICROPYTHON FILES</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('scripting')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'scripting' 
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>TEST RUNNER</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('alerts')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'alerts' 
                    ? 'bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-rose-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>CRASH ALERTS</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('plotter')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'plotter' 
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>OSCILLOSCOPE</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('uboot')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'uboot' 
                    ? 'bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-rose-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>U-BOOT TRIAGE</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('injector')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'injector' 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 shadow-emerald-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Binary className="w-3.5 h-3.5" />
                <span>HEX INJECTOR</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('diagnostics')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'diagnostics' 
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radar className="w-3.5 h-3.5" />
                <span>RE DIAGNOSTICS</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('wardrive')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'wardrive' 
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-emerald-glow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>WARDRIVE / GPS</span>
              </button>

              <button
                onClick={() => setActiveBottomTab('macros')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                  activeBottomTab === 'macros' 
                    ? 'bg-slate-800 text-cyber-amber font-bold' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Command className="w-3.5 h-3.5" />
                <span>MACROS</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500 font-mono hidden xl:block">
              HARDWARE HACKER WORKBENCH // 14 PROTOCOL & DIAGNOSTIC MODULES
            </div>
          </div>

          {/* Active Bottom Tab View (Targeting Active Board) */}
          <div className="pt-1">
            {activeBottomTab === 'flasher' && (
              <FileFlasher
                isConnected={activeBoard.isConnected}
                port={activeBoard.port}
                onWriteChunk={(chunk) => handleSendRawBytes(activeBoard.id, chunk)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'esp-dump' && (
              <EspMemoryInspector
                isConnected={activeBoard.isConnected}
                port={activeBoard.port}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'bridge' && (
              <SerialBridgeDeck
                boards={boards}
                bridgeConfig={bridgeConfig}
                onToggleBridge={handleToggleBridge}
                bridgeLog={bridgeLog}
                onClearBridgeLog={() => setBridgeLog([])}
                onSendRawBytes={(raw) => handleSendRawBytes(activeBoard.id, raw)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'packets' && (
              <PacketFramer
                activeHexByteStream={activeBoard.hexByteStream}
                isConnected={activeBoard.isConnected}
              />
            )}

            {activeBottomTab === 'ubx' && (
              <UbxConfigDeck
                isConnected={activeBoard.isConnected}
                onSendRawBytes={(raw) => handleSendRawBytes(activeBoard.id, raw)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'micropython' && (
              <MicroPythonFileManager
                isConnected={activeBoard.isConnected}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                latestRxText={activeBoard.latestRxText}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'scripting' && (
              <ScriptRunner
                isConnected={activeBoard.isConnected}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                latestRxText={activeBoard.latestRxText}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'alerts' && (
              <CrashAlertDeck
                latestTextStream={activeBoard.latestRxText}
                onPauseTerminal={() => {}}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'plotter' && (
              <SerialPlotter
                latestTextStream={activeBoard.latestRxText}
                isConnected={activeBoard.isConnected}
              />
            )}

            {activeBottomTab === 'uboot' && (
              <UBootTriage
                isConnected={activeBoard.isConnected}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                latestRxText={activeBoard.latestRxText}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'injector' && (
              <FrameInjector
                isConnected={activeBoard.isConnected}
                onSendRawBytes={(raw) => handleSendRawBytes(activeBoard.id, raw)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'diagnostics' && (
              <Diagnostics
                isConnected={activeBoard.isConnected}
                currentBaudRate={activeBoard.baudRate}
                onBaudRateChange={(newBaud) => {
                  updateBoard(activeBoard.id, { baudRate: newBaud });
                  addLogToBoard(activeBoard.id, `Baud rate switched to ${newBaud} bps`, 'sys');
                }}
                onRunBaudScan={handleRunBaudScan}
                onSendRawByte={(b) => handleSendRawBytes(activeBoard.id, b)}
                onSetSignals={handleSetSignals}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'wardrive' && (
              <GpsWardriverDeck
                latestTextStream={activeBoard.latestRxText}
                isConnected={activeBoard.isConnected}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}

            {activeBottomTab === 'macros' && (
              <MacroDecks
                isConnected={activeBoard.isConnected}
                onSendRawByte={(b) => handleSendRawBytes(activeBoard.id, b)}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
              />
            )}
          </div>
        </div>
      </main>

      {/* Cyberpunk Footer */}
      <footer className="border-t border-cyber-border bg-[#070c18] py-2 px-4 text-center text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 mt-auto">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold">SKON'S WEB FLASHER v1.5</span>
          <span>// Multi-Board Concurrent Serial Workbench</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Multi-Board Grid & Movable Windows</span>
          <span>•</span>
          <span>Broadcast TX</span>
          <span>•</span>
          <span>Android USB-OTG</span>
          <span>•</span>
          <span>PWA Offline</span>
        </div>
      </footer>
    </div>
  );
}
