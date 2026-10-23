import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { parseHexInput } from '../utils/checksums';
import { requestWebUsbSerialPort } from '../utils/webUsbSerial';
import { identifyUsbChip } from '../utils/usbDatabase';

const SerialContext = createContext(null);

export const INITIAL_BOARD = {
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

export function SerialProvider({ children }) {
  const [boards, setBoards] = useState([INITIAL_BOARD]);
  const [activeBoardId, setActiveBoardId] = useState('board-1');

  // Device & API Detection
  const hasWebSerialSupport = typeof navigator !== 'undefined' && 'serial' in navigator;
  const hasWebUsbSupport = typeof navigator !== 'undefined' && 'usb' in navigator;
  const isMobileDevice = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isAppleDevice = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Board stream refs to prevent re-creation
  const boardReadersRef = useRef({});
  const boardKeepReadingRef = useRef({});
  const boardPollIntervalsRef = useRef({});
  const boardOffsetsRef = useRef({});
  const boardRxTimersRef = useRef({});
  const boardTxTimersRef = useRef({});

  // Active board object
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
        ...b.entries.slice(-1499),
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

    // Pulse RX activity LED & increment counters
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

  // Poll Hardware Signals per Board (CTS, DSR, DCD, RI)
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
        const friendlyName = `PORT ${boardIndex}: ${chip.name !== 'Generic / Unknown UART Bridge' ? chip.name.split(' ')[0] : 'USB'}`;

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
          name: `PORT ${boardIndex}: OTG`,
          transportType: 'webusb'
        });

        addLogToBoard(targetBoardId, `Connected via Android WebUSB OTG!`, 'sys');
        startReading(targetBoardId, webUsbPort);
        startSignalPolling(targetBoardId, webUsbPort);

      } else {
        alert('Neither Web Serial nor WebUSB is supported on this browser. Please use Chrome, Edge, or Opera.');
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

  // Transmit Raw Bytes
  const handleSendRawBytes = async (targetBoardId, uint8Array) => {
    if (!uint8Array || uint8Array.length === 0) return;
    const currentBoard = boards.find(b => b.id === targetBoardId) || activeBoard;
    if (!currentBoard.isConnected) return;

    // Pulse TX Activity
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

  // Toggle Signal (DTR or RTS)
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

  // Set Signals Object
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

  // Assert Hardware UART Break
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

  // Automated Baud Scan Helper
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

  // Add a new secondary board
  const handleAddNewBoard = () => {
    const newId = `board-${Date.now()}`;
    const newNum = boards.length + 1;
    const newBoard = {
      ...INITIAL_BOARD,
      id: newId,
      name: `PORT ${newNum} // USB`,
      pos: { x: 25 * newNum, y: 25 * newNum }
    };
    setBoards(prev => [...prev, newBoard]);
    setActiveBoardId(newId);
    setTimeout(() => handleConnect(newId), 50);
  };

  // Close a board
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

  const contextValue = {
    // Current Active Board shortcuts
    port: activeBoard.port,
    isConnected: activeBoard.isConnected,
    isConnecting: activeBoard.isConnecting,
    portInfo: activeBoard.portInfo,
    baudRate: activeBoard.baudRate,
    serialConfig: activeBoard.serialConfig,
    transportType: activeBoard.transportType,
    hardwareSignals: activeBoard.hardwareSignals,
    stats: activeBoard.stats,
    rxActivity: activeBoard.rxActivity,
    txActivity: activeBoard.txActivity,
    entries: activeBoard.entries,
    hexByteStream: activeBoard.hexByteStream,
    latestRxText: activeBoard.latestRxText,

    // Active Board Actions
    connect: () => handleConnect(activeBoardId),
    disconnect: () => handleDisconnect(activeBoardId),
    sendString: (text, lineEnding) => handleSendString(activeBoardId, text, lineEnding),
    sendRawBytes: (bytes) => handleSendRawBytes(activeBoardId, bytes),
    toggleSignal: handleToggleSignal,
    setSignals: handleSetSignals,
    assertBreak: handleAssertBreak,
    runBaudScan: handleRunBaudScan,
    addLog,
    clearLogs: () => updateBoard(activeBoardId, { entries: [] }),
    clearHexStream: () => {
      updateBoard(activeBoardId, { hexByteStream: [] });
      boardOffsetsRef.current[activeBoardId] = 0;
      addLog('Hex memory buffer cleared.', 'sys');
    },
    resetStats: () => {
      updateBoard(activeBoardId, {
        stats: { rxBytes: 0, txBytes: 0, rxCount: 0, txCount: 0 },
        hexByteStream: []
      });
      boardOffsetsRef.current[activeBoardId] = 0;
      addLog('Byte telemetry counters reset.', 'sys');
    },
    setBaudRate: (newBaud) => {
      updateBoard(activeBoardId, { baudRate: Number(newBaud) });
      addLog(`Configured baud rate: ${newBaud} bps`, 'sys');
    },
    setSerialConfig: (cfg) => updateBoard(activeBoardId, { serialConfig: cfg }),

    // Multi-Board Collection
    boards,
    activeBoardId,
    activeBoard,
    setActiveBoardId,
    updateBoard,
    addNewBoard: handleAddNewBoard,
    closeBoard: handleCloseBoard,
    connectBoard: handleConnect,
    disconnectBoard: handleDisconnect,
    sendToBoard: handleSendString,
    sendRawToBoard: handleSendRawBytes,
    addLogToBoard,

    // Environment info
    hasWebSerialSupport,
    hasWebUsbSupport,
    isMobileDevice,
    isAppleDevice
  };

  return (
    <SerialContext.Provider value={contextValue}>
      {children}
    </SerialContext.Provider>
  );
}

export function useSerial() {
  const context = useContext(SerialContext);
  if (!context) {
    throw new Error('useSerial must be used within a SerialProvider');
  }
  return context;
}
