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
import CommandPalette from './components/CommandPalette';
import HardwareIntelligenceModal from './components/HardwareIntelligenceModal';
import PinoutModal from './components/PinoutModal';
import AutoResponderDeck from './components/AutoResponderDeck';
import TelemetryDashboard from './components/TelemetryDashboard';
import ImprovWifiDeck from './components/ImprovWifiDeck';
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
  Bot,
  Maximize2,
  Minimize2,
  Save,
  Upload,
  BookOpen,
  FolderTree,
  Search,
  Wifi,
  Gauge,
  Bell
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

  // Active Bottom Workbench Tab & Workspace Mode
  const [activeBottomTab, setActiveBottomTab] = useState('flasher');
  const [workspaceCategory, setWorkspaceCategory] = useState('all');
  const [isWorkbenchMaximized, setIsWorkbenchMaximized] = useState(false);

  // Modals & Command Palette
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHardwareIntelOpen, setIsHardwareIntelOpen] = useState(false);
  const [isPinoutModalOpen, setIsPinoutModalOpen] = useState(false);
  const sessionFileInputRef = useRef(null);

  // MitM Hardware Serial Bridge State
  const [bridgeConfig, setBridgeConfig] = useState({
    active: false,
    boardAId: 'board-1',
    boardBId: ''
  });
  const [bridgeLog, setBridgeLog] = useState([]);
  const lastBridgePacketTimeRef = useRef(Date.now());
  const forwardBridgeBytesRef = useRef(null);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExportWorkspaceSession = () => {
    const sessionData = {
      app: "Skon's USB Tool // Serial Workbench",
      version: '1.5',
      savedAt: new Date().toISOString(),
      activeBoardId,
      activeBottomTab,
      workspaceCategory,
      boards: boards.map(b => ({
        id: b.id,
        name: b.name,
        baudRate: b.baudRate,
        serialConfig: b.serialConfig,
        pos: b.pos
      }))
    };

    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skon-session-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addLogToBoard(activeBoardId, 'Exported workspace session configuration file.', 'sys');
  };

  const handleImportWorkspaceSession = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.boards && Array.isArray(data.boards)) {
          setBoards(prev => data.boards.map(sb => {
            const existing = prev.find(p => p.id === sb.id);
            return {
              ...INITIAL_BOARD,
              ...existing,
              id: sb.id,
              name: sb.name,
              baudRate: sb.baudRate || 115200,
              serialConfig: sb.serialConfig || INITIAL_BOARD.serialConfig,
              pos: sb.pos || { x: 20, y: 20 }
            };
          }));
        }
        if (data.activeBoardId) setActiveBoardId(data.activeBoardId);
        if (data.activeBottomTab) setActiveBottomTab(data.activeBottomTab);
        if (data.workspaceCategory) setWorkspaceCategory(data.workspaceCategory);
        addLogToBoard(activeBoardId, `Successfully imported session config from "${file.name}"!`, 'sys');
      } catch (err) {
        alert(`Invalid session file: ${err.message}`);
      } finally {
        if (sessionFileInputRef.current) sessionFileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

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
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
      />

      {/* Hidden Session Import Input */}
      <input
        type="file"
        ref={sessionFileInputRef}
        onChange={handleImportWorkspaceSession}
        accept=".json"
        className="hidden"
      />

      {/* Command Palette Modal */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={(tab) => {
          setActiveBottomTab(tab);
          const catMap = {
            flasher: 'firmware', 'esp-dump': 'firmware', micropython: 'firmware',
            bridge: 'protocols', packets: 'protocols', ubx: 'protocols',
            plotter: 'debug', alerts: 'debug', injector: 'debug', uboot: 'debug',
            scripting: 'automation', diagnostics: 'automation', wardrive: 'automation', macros: 'automation'
          };
          if (catMap[tab]) setWorkspaceCategory(catMap[tab]);
        }}
        onConnect={() => handleConnect(activeBoardId)}
        onDisconnect={() => handleDisconnect(activeBoardId)}
        onClearLogs={() => updateBoard(activeBoardId, { entries: [] })}
        onSetBaud={(baud) => updateBoard(activeBoardId, { baudRate: baud })}
        onOpenHardwareIntel={() => setIsHardwareIntelOpen(true)}
        onOpenPinouts={() => setIsPinoutModalOpen(true)}
        onExportSession={handleExportWorkspaceSession}
        isConnected={activeBoard.isConnected}
      />

      {/* Hardware Intelligence Modal */}
      <HardwareIntelligenceModal
        isOpen={isHardwareIntelOpen}
        onClose={() => setIsHardwareIntelOpen(false)}
        portInfo={activeBoard.portInfo}
      />

      {/* Pinouts Reference Modal */}
      <PinoutModal
        isOpen={isPinoutModalOpen}
        onClose={() => setIsPinoutModalOpen(false)}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-2.5 sm:p-4 flex flex-col gap-3">
        {/* Target Status & Multi-Board Counter */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-cyber-card border border-slate-800 text-xs font-mono">
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

        {/* Multi-Board Terminal Deck or Collapsed Status Bar */}
        {!isWorkbenchMaximized ? (
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
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-cyber-card border border-cyan-500/30 text-xs font-mono shadow-lg">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold text-cyber-cyan">
                FULL-SCREEN TOOL VIEW // TERMINAL DECK COLLAPSED
              </span>
              <div className="flex items-center gap-1.5">
                {boards.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setActiveBoardId(b.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                      b.id === activeBoardId
                        ? 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {b.name} ({b.baudRate})
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setIsWorkbenchMaximized(false)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyber-amber border border-amber-500/40 text-xs font-bold"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>RESTORE SPLIT VIEW</span>
            </button>
          </div>
        )}

        {/* Bottom Half: Workbench Tools & Modules */}
        <div className="space-y-2 pt-1">
          {/* Workspace Categories Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090e1a] p-1.5 rounded-xl border border-cyber-border font-mono">
            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto text-xs scrollbar-thin">
              {[
                { id: 'all', name: 'ALL MODULES', icon: Layers, count: 17 },
                { id: 'firmware', name: 'FIRMWARE & FLASH', icon: HardDrive, count: 4 },
                { id: 'protocols', name: 'PROTOCOLS & BUS', icon: ArrowLeftRight, count: 3 },
                { id: 'debug', name: 'DEBUG & SIGNALS', icon: Activity, count: 5 },
                { id: 'automation', name: 'AUTOMATION & RE', icon: Bot, count: 5 }
              ].map(cat => {
                const Icon = cat.icon;
                const isActive = workspaceCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setWorkspaceCategory(cat.id);
                      const catModules = {
                        firmware: ['flasher', 'esp-dump', 'micropython', 'improv'],
                        protocols: ['bridge', 'packets', 'ubx'],
                        debug: ['plotter', 'telemetry', 'alerts', 'injector', 'uboot'],
                        automation: ['responder', 'scripting', 'diagnostics', 'wardrive', 'macros']
                      };
                      if (cat.id !== 'all' && catModules[cat.id] && !catModules[cat.id].includes(activeBottomTab)) {
                        setActiveBottomTab(catModules[cat.id][0]);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                      isActive 
                        ? 'bg-slate-800 text-cyan-300 border border-cyan-500/50 shadow-cyan-glow' 
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{cat.name}</span>
                    <span className="text-[10px] px-1 py-0.2 rounded bg-slate-900 text-slate-500">
                      {cat.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quick Workbench Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                title="Open Command Palette (Ctrl+K)"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-cyan-500/40 text-xs"
              >
                <Search className="w-3.5 h-3.5 text-cyber-cyan" />
                <span className="hidden sm:inline">Ctrl+K</span>
              </button>

              <button
                onClick={handleExportWorkspaceSession}
                title="Save entire multi-board session and test suites to file"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs"
              >
                <Save className="w-3.5 h-3.5 text-cyber-amber" />
                <span className="hidden md:inline">SAVE SESSION</span>
              </button>

              <button
                onClick={() => sessionFileInputRef.current?.click()}
                title="Restore workspace session from .json file"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs"
              >
                <Upload className="w-3.5 h-3.5 text-cyber-emerald" />
                <span className="hidden md:inline">RESTORE</span>
              </button>

              <button
                onClick={() => setIsHardwareIntelOpen(true)}
                title="Open Hardware Intelligence & Chip Lookup"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyber-cyan border border-slate-800 text-xs"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">CHIP INTEL</span>
              </button>

              <button
                onClick={() => setIsWorkbenchMaximized(!isWorkbenchMaximized)}
                title={isWorkbenchMaximized ? "Restore Terminal Split View" : "Maximize Tool to Full Height"}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all ${
                  isWorkbenchMaximized 
                    ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 shadow-amber-glow' 
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                }`}
              >
                {isWorkbenchMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{isWorkbenchMaximized ? 'RESTORE' : 'EXPAND'}</span>
              </button>
            </div>
          </div>

          {/* Sub-Tool Tabs Filtered by Category */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyber-border pb-1">
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto max-w-full scrollbar-thin scrollbar-thumb-slate-800">
              {[
                { id: 'flasher', name: 'ESP32 FLASHER', category: 'firmware', icon: HardDrive, color: 'from-amber-500 to-amber-600', textGlow: 'shadow-amber-glow' },
                { id: 'esp-dump', name: 'SILICON & DUMP', category: 'firmware', icon: Cpu, color: 'from-amber-500 to-amber-600', textGlow: 'shadow-amber-glow' },
                { id: 'micropython', name: 'MICROPYTHON FILES', category: 'firmware', icon: FileCode, color: 'from-amber-500 to-amber-600', textGlow: 'shadow-amber-glow' },
                { id: 'improv', name: 'IMPROV WI-FI', category: 'firmware', icon: Wifi, color: 'from-emerald-500 to-teal-600', textGlow: 'shadow-emerald-glow' },

                { id: 'bridge', name: 'MitM BRIDGE', category: 'protocols', icon: ArrowLeftRight, color: 'from-cyan-500 to-cyan-600', textGlow: 'shadow-cyan-glow' },
                { id: 'packets', name: 'PACKET FRAMER', category: 'protocols', icon: Layers, color: 'from-emerald-500 to-emerald-600', textGlow: 'shadow-emerald-glow' },
                { id: 'ubx', name: 'UBX GPS', category: 'protocols', icon: Navigation, color: 'from-cyan-500 to-cyan-600', textGlow: 'shadow-cyan-glow' },

                { id: 'plotter', name: 'OSCILLOSCOPE', category: 'debug', icon: Activity, color: 'from-cyan-500 to-cyan-600', textGlow: 'shadow-cyan-glow' },
                { id: 'telemetry', name: 'TELEMETRY GAUGES', category: 'debug', icon: Gauge, color: 'from-cyan-500 to-blue-600', textGlow: 'shadow-cyan-glow' },
                { id: 'alerts', name: 'CRASH ALERTS', category: 'debug', icon: ShieldAlert, color: 'from-rose-600 to-rose-700', textGlow: 'shadow-rose-glow' },
                { id: 'injector', name: 'HEX INJECTOR', category: 'debug', icon: Binary, color: 'from-emerald-500 to-emerald-600', textGlow: 'shadow-emerald-glow' },
                { id: 'uboot', name: 'U-BOOT TRIAGE', category: 'debug', icon: ShieldAlert, color: 'from-rose-600 to-rose-700', textGlow: 'shadow-rose-glow' },

                { id: 'responder', name: 'AUTO-RESPONDER', category: 'automation', icon: Bot, color: 'from-purple-500 to-pink-600', textGlow: 'shadow-purple-glow' },
                { id: 'scripting', name: 'TEST RUNNER', category: 'automation', icon: Bot, color: 'from-purple-500 to-purple-600', textGlow: 'shadow-purple-glow' },
                { id: 'diagnostics', name: 'RE DIAGNOSTICS', category: 'automation', icon: Radar, color: 'from-purple-500 to-purple-600', textGlow: 'shadow-purple-glow' },
                { id: 'wardrive', name: 'WARDRIVE / GPS', category: 'automation', icon: Compass, color: 'from-emerald-500 to-teal-600', textGlow: 'shadow-emerald-glow' },
                { id: 'macros', name: 'MACROS', category: 'automation', icon: Command, color: 'from-amber-500 to-amber-600', textGlow: 'shadow-amber-glow' }
              ]
                .filter(m => workspaceCategory === 'all' || m.category === workspaceCategory)
                .map(m => {
                  const Icon = m.icon;
                  const isActive = activeBottomTab === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setActiveBottomTab(m.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold shrink-0 transition-all ${
                        isActive 
                          ? `bg-gradient-to-r ${m.color} text-slate-950 font-extrabold ${m.textGlow}` 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{m.name}</span>
                    </button>
                  );
                })}
            </div>

            {/* Target Board Selector for bottom tool */}
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-[11px] text-slate-500 uppercase font-bold hidden sm:inline">TOOL TARGET:</span>
              <select
                value={activeBoardId}
                onChange={(e) => setActiveBoardId(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-cyber-cyan font-bold outline-none cursor-pointer"
              >
                {boards.map(b => (
                  <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
                ))}
              </select>
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
                boards={boards}
                activeBoardId={activeBoardId}
                onSelectBoard={setActiveBoardId}
              />
            )}

            {activeBottomTab === 'improv' && (
              <ImprovWifiDeck
                isConnected={activeBoard.isConnected}
                onSendRawBytes={(raw) => handleSendRawBytes(activeBoard.id, raw)}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                latestRxText={activeBoard.latestRxText}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
                boards={boards}
                activeBoardId={activeBoardId}
                onSelectBoard={setActiveBoardId}
              />
            )}

            {activeBottomTab === 'telemetry' && (
              <TelemetryDashboard
                latestTextStream={activeBoard.latestRxText}
                isConnected={activeBoard.isConnected}
                boards={boards}
                activeBoardId={activeBoardId}
                onSelectBoard={setActiveBoardId}
              />
            )}

            {activeBottomTab === 'responder' && (
              <AutoResponderDeck
                isConnected={activeBoard.isConnected}
                latestRxText={activeBoard.latestRxText}
                onSendString={(str) => handleSendString(activeBoard.id, str)}
                onLogMessage={(msg, type) => addLogToBoard(activeBoard.id, msg, type)}
                boards={boards}
                activeBoardId={activeBoardId}
                onSelectBoard={setActiveBoardId}
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
