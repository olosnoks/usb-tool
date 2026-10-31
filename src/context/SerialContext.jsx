import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { parseHexInput } from '../utils/checksums';
import { requestWebUsbSerialPort } from '../utils/webUsbSerial';
import { requestBleSerialPort } from '../utils/bleSerial';
import { identifyUsbChip, shortChipLabel } from '../utils/usbDatabase';
import { claimForTool, releasePort, closeSerialPort, stopReader } from '../utils/portManager';

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
  transportType: 'serial', // 'serial' | 'webusb' | 'ble'
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
  // Console freeze, shared so tools (e.g. Crash Alerts) can pause the view.
  const [consolePaused, setConsolePaused] = useState(false);

  // Device & API Detection
  const hasWebSerialSupport = typeof navigator !== 'undefined' && 'serial' in navigator;
  const hasWebUsbSupport = typeof navigator !== 'undefined' && 'usb' in navigator;
  const hasWebBluetoothSupport = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const isMobileDevice = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isAppleDevice = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Board stream refs to prevent re-creation
  const boardReadersRef = useRef({});
  const boardReadLoopsRef = useRef({});   // boardId -> promise of its read loop
  const boardPortOwnersRef = useRef({});  // boardId -> port-manager owner
  const disconnectRef = useRef(null);     // latest handleDisconnect, for takeovers
  const rxListenersRef = useRef(new Set()); // subscribeRx(): every received chunk, unbatched
  const boardWriteChainsRef = useRef({});  // boardId -> promise of the last queued write
  // Stable identity, so subscribers' effects don't re-run on every render.
  const subscribeRx = useCallback((fn) => { rxListenersRef.current.add(fn); return () => { rxListenersRef.current.delete(fn); }; }, []);
  const boardKeepReadingRef = useRef({});
  const boardPollIntervalsRef = useRef({});
  const boardOffsetsRef = useRef({});
  const boardRxTimersRef = useRef({});
  const boardTxTimersRef = useRef({});
  // Pending request/response collectors keyed by boardId (used by transceive)
  const pendingTransceiveRef = useRef({});

  // Always-fresh mirrors of reactive state so non-memoized async helpers
  // (transceive, reconfigureActivePort) never operate on a stale board.
  const boardsStateRef = useRef(boards);
  const activeBoardIdRef = useRef(activeBoardId);
  useEffect(() => { boardsStateRef.current = boards; }, [boards]);
  useEffect(() => { activeBoardIdRef.current = activeBoardId; }, [activeBoardId]);

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

    // Protocol tools (e.g. the CAN deck) get every chunk directly; the React
    // entries log is capped and batched per render.
    for (const fn of rxListenersRef.current) {
      try { fn(bytes, boardId); } catch (e) { console.error('RX listener failed:', e); }
    }

    // Feed any in-flight transceive() transaction waiting on this board
    const pending = pendingTransceiveRef.current[boardId];
    if (pending) {
      pending.chunks.push(bytes);
      pending.total += bytes.length;
    }

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
      let reader = null;
      try {
        reader = activePort.readable.getReader();
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
        if (reader) { try { reader.releaseLock(); } catch (e) {} }
        if (boardReadersRef.current[boardId] === reader) boardReadersRef.current[boardId] = null;
      }
    }
  };

  // Stop a board's read loop and wait until its reader lock is released.
  const haltReading = async (boardId) => {
    boardKeepReadingRef.current[boardId] = false;
    const reader = boardReadersRef.current[boardId];
    const loop = boardReadLoopsRef.current[boardId];
    await stopReader(reader, loop);
    delete boardReadersRef.current[boardId];
    delete boardReadLoopsRef.current[boardId];
  };

  const ownerForBoard = (boardId) => {
    if (!boardPortOwnersRef.current[boardId]) {
      const n = boardsStateRef.current.findIndex(b => b.id === boardId) + 1;
      boardPortOwnersRef.current[boardId] = {
        name: `Terminal (port ${n || 1})`,
        release: () => (disconnectRef.current ? disconnectRef.current(boardId) : undefined)
      };
    }
    return boardPortOwnersRef.current[boardId];
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
        // One owner per device: asks before taking the port from another tool.
        await claimForTool(selectedPort, ownerForBoard(targetBoardId));
        
        const info = selectedPort.getInfo ? selectedPort.getInfo() : {};
        const chip = identifyUsbChip(info.usbVendorId, info.usbProductId);
        const boardIndex = boards.findIndex(b => b.id === targetBoardId) + 1;
        // identifyUsbChip() has no `name` field: reading chip.name.split() threw for every
        // device with a USB vendor ID, so the Terminal could not connect at all.
        const friendlyName = `PORT ${boardIndex}: ${shortChipLabel(chip)}`;

        addLogToBoard(targetBoardId, `Opening port @ ${currentBoard.baudRate} bps...`, 'sys');
        try {
          await selectedPort.open({
          baudRate: Number(currentBoard.baudRate),
          dataBits: currentBoard.serialConfig.dataBits,
          stopBits: currentBoard.serialConfig.stopBits,
          parity: currentBoard.serialConfig.parity,
          flowControl: currentBoard.serialConfig.flowControl,
          bufferSize: 16384
          });
        } catch (openErr) {
          releasePort(selectedPort, ownerForBoard(targetBoardId));
          throw openErr;
        }

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
        boardReadLoopsRef.current[targetBoardId] = startReading(targetBoardId, selectedPort);
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
        boardReadLoopsRef.current[targetBoardId] = startReading(targetBoardId, webUsbPort);
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

  // Connect a BLE UART peripheral (Nordic UART, HM-10, Microchip, Flipper ...).
  // `existing` is an already-chosen BleSerialPort (from the BLE Explorer); with
  // none, the browser's Bluetooth picker opens.
  const handleConnectBle = async (targetBoardId = activeBoardIdRef.current, existing = null, pickerOptions = {}) => {
    let blePort = existing;
    try {
      updateBoard(targetBoardId, { isConnecting: true });
      // Free the board first if it already holds a port.
      const cur = boardsStateRef.current.find(b => b.id === targetBoardId);
      if (cur?.isConnected) await handleDisconnect(targetBoardId);

      if (!blePort) {
        addLogToBoard(targetBoardId, '[BLE] Choose a Bluetooth serial device...', 'sys');
        blePort = await requestBleSerialPort(pickerOptions);
      }
      addLogToBoard(targetBoardId, `[BLE] Connecting to ${blePort.device.name || 'device'}...`, 'sys');
      await blePort.open();
      // The link can drop (out of range, device reset): tear the board down cleanly.
      blePort.ondisconnect = () => {
        addLogToBoard(targetBoardId, '[BLE] Link lost.', 'sys');
        if (disconnectRef.current) disconnectRef.current(targetBoardId);
      };

      const label = blePort.profile ? blePort.profile.name : 'custom UART';
      boardKeepReadingRef.current[targetBoardId] = true;
      updateBoard(targetBoardId, {
        port: blePort,
        portInfo: blePort.getInfo(),
        isConnected: true,
        isConnecting: false,
        name: `BLE: ${blePort.device.name || 'device'}`,
        transportType: 'ble'
      });
      addLogToBoard(targetBoardId, `[BLE] Connected over ${label}. Writes go out in ${blePort.chunkSize}-byte packets.`, 'sys');
      if (!blePort.tx) addLogToBoard(targetBoardId, '[BLE] This device has no writable characteristic: receive only.', 'sys');
      boardReadLoopsRef.current[targetBoardId] = startReading(targetBoardId, blePort);
    } catch (err) {
      console.error(err);
      if (blePort) { try { await blePort.close(); } catch (e) { /* ignore */ } }
      updateBoard(targetBoardId, { isConnecting: false });
      addLogToBoard(targetBoardId, `BLE connection failed: ${err.message}`, 'sys');
    }
  };

  // Disconnect Port
  const handleDisconnect = async (targetBoardId = activeBoardId) => {
    if (boardPollIntervalsRef.current[targetBoardId]) {
      clearInterval(boardPollIntervalsRef.current[targetBoardId]);
      delete boardPollIntervalsRef.current[targetBoardId];
    }

    await haltReading(targetBoardId);

    // Latest state (this can run from a takeover, long after the click's render).
    const targetBoard = boardsStateRef.current.find(b => b.id === targetBoardId) || boards.find(b => b.id === targetBoardId);
    if (targetBoard?.port) {
      await closeSerialPort(targetBoard.port);
      releasePort(targetBoard.port, boardPortOwnersRef.current[targetBoardId]);
    }

    updateBoard(targetBoardId, {
      port: null,
      isConnected: false,
      isConnecting: false,
      hardwareSignals: { dtr: false, rts: false, cts: false, dsr: false, dcd: false, ri: false }
    });
    addLogToBoard(targetBoardId, 'Port disconnected.', 'sys');
  };
  disconnectRef.current = handleDisconnect;

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
      // One write at a time per board: a second getWriter() while the first
      // write is pending throws "locked", which silently dropped that send.
      const port = currentBoard.port;
      const prev = boardWriteChainsRef.current[targetBoardId] || Promise.resolve();
      const next = prev.then(async () => {
        const writer = port.writable.getWriter();
        try { await writer.write(uint8Array); } finally { writer.releaseLock(); }
      });
      boardWriteChainsRef.current[targetBoardId] = next.catch(() => {});
      await next;
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
    if (!currentBoard.port || currentBoard.transportType === 'ble') return new Uint8Array(0);

    await haltReading(currentBoard.id);
    await closeSerialPort(currentBoard.port);

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

  // Synchronous request/response transaction over the active board's open port.
  // Writes txBytes (with full TX stats/hex bookkeeping), then collects inbound
  // bytes until expectedLength is reached, an inter-frame quiet gap elapses, or
  // the timeout fires. Returns the raw response as a Uint8Array (empty on timeout).
  // This is the primitive protocol drivers (Modbus, etc.) use to talk to real hardware.
  const transceive = async (txBytes, options = {}) => {
    const { timeoutMs = 600, expectedLength = 0, quietMs = 60 } = options;
    const boardId = activeBoardIdRef.current;
    const board = boardsStateRef.current.find(b => b.id === boardId);
    if (!board || !board.isConnected || !board.port) {
      throw new Error('transceive: no connected serial port on the active board');
    }

    const collector = { chunks: [], total: 0 };
    pendingTransceiveRef.current[boardId] = collector;

    try {
      await handleSendRawBytes(boardId, txBytes);

      const deadline = Date.now() + timeoutMs;
      let lastLen = 0;
      let lastChange = Date.now();

      while (Date.now() < deadline) {
        if (expectedLength && collector.total >= expectedLength) break;
        if (collector.total !== lastLen) {
          lastLen = collector.total;
          lastChange = Date.now();
        }
        // No known length: treat an inter-frame quiet gap as end-of-response
        if (!expectedLength && collector.total > 0 && (Date.now() - lastChange) >= quietMs) break;
        await new Promise(r => setTimeout(r, 8));
      }

      const out = new Uint8Array(collector.total);
      let offset = 0;
      for (const chunk of collector.chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    } finally {
      delete pendingTransceiveRef.current[boardId];
    }
  };

  // Lend the active board's open port to a tool that needs its own reader
  // (ESP ROM flasher, memory inspector): pause this board's read loop, run
  // fn(port), then resume the loop. Without this, getReader() on the port
  // throws "locked" because the terminal's loop holds the only reader.
  const borrowActivePort = async (fn) => {
    const boardId = activeBoardIdRef.current;
    const board = boardsStateRef.current.find(b => b.id === boardId);
    if (!board || !board.port) throw new Error('No serial port is connected.');
    await haltReading(boardId);
    try {
      return await fn(board.port);
    } finally {
      if (board.port.readable && !board.port.readable.locked) {
        boardKeepReadingRef.current[boardId] = true;
        boardReadLoopsRef.current[boardId] = startReading(boardId, board.port);
      }
    }
  };

  // Reopen the active board's port with new line settings (baud/parity/etc) without
  // tearing down the session — used by protocol decks that need a specific framing
  // (e.g. Modbus RTU 8-N-1). Keeps the continuous read loop running afterward.
  const reconfigureActivePort = async (config = {}) => {
    const boardId = activeBoardIdRef.current;
    const board = boardsStateRef.current.find(b => b.id === boardId);
    if (!board || !board.port) throw new Error('reconfigureActivePort: no open port');
    if (board.transportType === 'ble') {
      // A BLE link has no line settings; reopening would only drop the connection.
      addLogToBoard(boardId, '[BLE] Baud rate and framing do not apply to a Bluetooth link.', 'sys');
      return;
    }

    await haltReading(boardId);
    await closeSerialPort(board.port);

    const nextBaud = Number(config.baudRate ?? board.baudRate);
    const nextDataBits = config.dataBits ?? board.serialConfig.dataBits;
    const nextStopBits = config.stopBits ?? board.serialConfig.stopBits;
    const nextParity = config.parity ?? board.serialConfig.parity;

    await board.port.open({
      baudRate: nextBaud,
      dataBits: nextDataBits,
      stopBits: nextStopBits,
      parity: nextParity,
      flowControl: board.serialConfig.flowControl,
      bufferSize: 16384
    });

    boardKeepReadingRef.current[boardId] = true;
    updateBoard(boardId, {
      baudRate: nextBaud,
      serialConfig: { ...board.serialConfig, dataBits: nextDataBits, stopBits: nextStopBits, parity: nextParity }
    });
    addLogToBoard(boardId, `[PORT] Line reconfigured to ${nextBaud} bps ${nextDataBits}-${String(nextParity).charAt(0).toUpperCase()}-${nextStopBits}.`, 'sys');
    boardReadLoopsRef.current[boardId] = startReading(boardId, board.port);
    startSignalPolling(boardId, board.port);
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
    connectBle: (blePort = null, pickerOptions = {}) => handleConnectBle(activeBoardId, blePort, pickerOptions),
    sendString: (text, lineEnding) => handleSendString(activeBoardId, text, lineEnding),
    sendRawBytes: (bytes) => handleSendRawBytes(activeBoardId, bytes),
    toggleSignal: handleToggleSignal,
    setSignals: handleSetSignals,
    assertBreak: handleAssertBreak,
    runBaudScan: handleRunBaudScan,
    transceive,
    reconfigureActivePort,
    borrowPort: borrowActivePort,
    subscribeRx,
    consolePaused,
    setConsolePaused,
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
    hasWebBluetoothSupport,
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

/**
 * Console pause shared through SerialContext (so tools like Crash Alerts can
 * freeze the terminal view); falls back to local state outside the provider.
 */
export function useConsolePause() {
  const ctx = useContext(SerialContext);
  const [local, setLocal] = useState(false);
  if (ctx && ctx.setConsolePaused) return [ctx.consolePaused, ctx.setConsolePaused];
  return [local, setLocal];
}
