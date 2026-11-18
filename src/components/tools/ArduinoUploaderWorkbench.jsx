import React, { useMemo, useRef, useState } from 'react';
import { Cpu, CheckCircle2, AlertTriangle, Usb, Upload, Download, Square, Zap } from 'lucide-react';
import { SerialLink } from '../../utils/serialLink';
import { loadFirmwareFile } from '../../utils/firmwareParser';
import {
  ARDUINO_BOARDS,
  ARDUINO_BOARD_IDS,
  PROTOCOL_AVR109,
  buildFlashPages,
  programBoard,
  readBoardFlash,
  touchForBootloader,
  toIntelHex
} from '../../utils/arduinoUploader';
import { confirmAction } from '../../utils/sessionLog';

const OWNER = { name: 'Arduino Bootloader Uploader', release: () => {} };
const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
const hexSig = (n) => `0x${n.toString(16).toUpperCase().padStart(6, '0')}`;

function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(name) {
  return (name || 'flash').replace(/\.[^.]+$/, '');
}

const PHASE_LABEL = { write: 'Writing', verify: 'Verifying', read: 'Reading' };

export default function ArduinoUploaderWorkbench({ onLogMessage }) {
  const [boardId, setBoardId] = useState('uno');
  const board = ARDUINO_BOARDS[boardId];
  const isAvr109 = board.protocol === PROTOCOL_AVR109;
  const [action, setAction] = useState('program'); // 'program' | 'read'
  const [image, setImage] = useState(null); // { name, type, data, startAddress }
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingBootPort, setAwaitingBootPort] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, done, total }
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'err' | 'info', text }
  const [readResult, setReadResult] = useState(null); // { name, data }
  const [logLines, setLogLines] = useState([]);
  const abortRef = useRef(false);

  const hasSerial = typeof navigator !== 'undefined' && !!navigator.serial;

  // The file must fit this board's sketch area; checked before any port is opened.
  const planError = useMemo(() => {
    if (!image) return '';
    try {
      buildFlashPages(board, image);
      return '';
    } catch (e) {
      return e.message;
    }
  }, [board, image]);

  const pushLog = (text, level = 'info') => {
    const stamp = new Date().toLocaleTimeString();
    setLogLines((prev) => [...prev.slice(-199), `${stamp}  ${text}`]);
    if (onLogMessage) onLogMessage(text, level);
  };

  const fail = (e) => {
    const text = e && e.name === 'NotFoundError' ? 'No port was chosen.' : e && e.message ? e.message : String(e);
    setStatus({ kind: 'err', text });
    pushLog(text, 'error');
  };

  const onBoardChange = (id) => {
    setBoardId(id);
    setAwaitingBootPort(false);
    setProgress(null);
    setStatus(null);
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setFileError('');
    try {
      const loaded = await loadFirmwareFile(file);
      setImage({ name: file.name, type: loaded.type, data: loaded.data, startAddress: loaded.startAddress });
      setStatus(null);
      pushLog(`Loaded ${file.name}: ${loaded.data.length} bytes (${loaded.type}).`);
    } catch (err) {
      setImage(null);
      setFileError(err.message || 'Could not read that file.');
    }
  };

  // Opens the picked port at the board's baud rate, runs `fn`, then always closes it.
  async function withBoardPort(fn) {
    abortRef.current = false;
    setBusy(true);
    setProgress(null);
    let link = null;
    try {
      link = await SerialLink.request(OWNER, { baudRate: board.baud });
      return await fn(link);
    } finally {
      if (link) await link.close().catch(() => {});
      setBusy(false);
    }
  }

  const runAction = (link) => {
    const onProgress = (p) => setProgress(p);
    const log = (s) => pushLog(s);
    const shouldAbort = () => abortRef.current;
    if (action === 'program') {
      return programBoard(link, board, image, { onProgress, log, shouldAbort }).then((r) => {
        setStatus({
          kind: 'ok',
          text: `Verified: ${r.bytes} bytes written to ${board.name} and read back identical. The bootloader started the sketch.`
        });
        setAwaitingBootPort(false);
        pushLog(`Verified ${r.bytes} bytes.`, 'success');
      });
    }
    return readBoardFlash(link, board, { onProgress, log, shouldAbort }).then((data) => {
      setReadResult({ name: image ? baseName(image.name) : `${board.id}-flash`, data });
      setStatus({
        kind: 'ok',
        text: `Read ${data.length} bytes of flash from the board. This is what the bootloader returned; nothing was compared against a reference.`
      });
      pushLog(`Read ${data.length} bytes.`, 'success');
    });
  }

  const confirmWrite = () => {
    const bytes = planError ? 0 : buildPageBytes();
    return confirmAction(
      `Write ${image.name} to ${board.name} and verify it?\n\nOnly the pages the sketch needs are rewritten (${bytes} bytes). The bootloader, fuses and EEPROM are not touched.`
    );
  };

  function buildPageBytes() {
    try {
      return buildFlashPages(board, image).length * board.pageSize;
    } catch (e) {
      return 0;
    }
  }

  // STK500v1 boards: one click. Choose the port, reset, sync, do the work.
  const runStk = async () => {
    if (action === 'program' && !confirmWrite()) return;
    setStatus({ kind: 'info', text: 'Choose the board\'s serial port in the browser picker.' });
    try {
      await withBoardPort(runAction);
    } catch (e) {
      fail(e);
    } finally {
      setProgress(null);
    }
  };

  // AVR109 (Caterina): step 1 touches the port at 1200 baud; the board re-enumerates.
  const touchAvr = async () => {
    setBusy(true);
    setStatus({ kind: 'info', text: 'Choose the Arduino\'s normal serial port in the picker, to start the bootloader.' });
    try {
      const port = await navigator.serial.requestPort();
      pushLog(`Opening ${board.name} at 1200 baud and closing again to start the bootloader.`);
      await touchForBootloader(port);
      setAwaitingBootPort(true);
      setStatus({
        kind: 'info',
        text: 'Bootloader requested. The board now shows up as a NEW serial port. Click step 2 and choose that port in the picker.'
      });
      pushLog('1200-baud touch sent. Waiting for the bootloader port.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runAvrStep2 = async () => {
    if (action === 'program' && !confirmWrite()) return;
    setStatus({ kind: 'info', text: 'Choose the BOOTLOADER port (the new entry, not the one from step 1).' });
    try {
      await withBoardPort(async (link) => {
        await runAction(link);
        setAwaitingBootPort(false);
      });
    } catch (e) {
      fail(e);
    }
  };

  const stopRun = () => {
    abortRef.current = true;
    pushLog('Stop requested. The run ends at the next page.');
  };

  const canRun = !busy && (action === 'read' || (!!image && !planError));
  const bytesHint = image && !planError ? `${image.data.length} bytes, ${buildPageBytes()} bytes of pages to write` : '';

  const endAddress = image ? (image.startAddress || 0) + image.data.length : 0;

  return (
    <div className="flex flex-col gap-4 p-4 text-slate-200 text-xs font-mono bg-slate-950 h-full overflow-auto">
      <div className="flex items-start gap-3">
        <Cpu className="w-6 h-6 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-slate-100">Arduino Bootloader Uploader</div>
          <div className="text-slate-400 leading-relaxed">
            Writes a sketch through the bootloader already on the board, over its own serial port. No programmer, no ISP wiring,
            no chip erase. Write, read back and compare, then start the sketch.
          </div>
        </div>
      </div>

      {!hasSerial && (
        <div className="flex gap-2 border border-amber-700/60 bg-amber-950/40 text-amber-200 p-3 rounded">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Web Serial is not available here. Use Chrome or Edge on desktop, from https:// or localhost.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="border border-slate-800 rounded p-3 bg-slate-900/40 flex flex-col gap-2">
          <div className="text-slate-400 uppercase tracking-wider">1. Board</div>
          <select
            aria-label="Board preset"
            value={boardId}
            onChange={(e) => onBoardChange(e.target.value)}
            disabled={busy}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
          >
            {ARDUINO_BOARD_IDS.map((id) => (
              <option key={id} value={id}>{ARDUINO_BOARDS[id].name}</option>
            ))}
          </select>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-300">
            <dt className="text-slate-500">Protocol</dt>
            <dd>{isAvr109 ? 'AVR109 (Caterina)' : 'STK500v1 (Optiboot / ATmegaBOOT)'}</dd>
            <dt className="text-slate-500">Bootloader</dt>
            <dd>{board.bootloader}</dd>
            <dt className="text-slate-500">Baud</dt>
            <dd>{isAvr109 ? `${board.baud} (ignored by USB; 1200 for the touch)` : board.baud}</dd>
            <dt className="text-slate-500">Signature</dt>
            <dd>{isAvr109 ? `${hexSig(board.signature)} (datasheet; AVR109 cannot read it)` : hexSig(board.signature)}</dd>
            <dt className="text-slate-500">Flash</dt>
            <dd>{board.flashSize} bytes, page {board.pageSize} bytes</dd>
            <dt className="text-slate-500">Sketch area</dt>
            <dd>0x0000 to {hex(board.appLimit)} (bootloader above)</dd>
          </dl>
          {isAvr109 && (
            <div className="text-slate-400 leading-relaxed">
              Caterina boards need two picks. The 1200-baud touch restarts the board as a new serial port, so the browser
              will ask again: choose the bootloader port in step 2.
            </div>
          )}
        </section>

        <section className="border border-slate-800 rounded p-3 bg-slate-900/40 flex flex-col gap-2">
          <div className="text-slate-400 uppercase tracking-wider">2. Firmware</div>
          <label className="flex items-center gap-2 cursor-pointer text-cyan-300 hover:text-cyan-200">
            <Upload className="w-4 h-4" />
            <span>Load .hex or .bin</span>
            <input type="file" accept=".hex,.bin" className="hidden" onChange={onFile} disabled={busy} />
          </label>
          {fileError && <div className="text-rose-300">{fileError}</div>}
          {image && (
            <div className="text-slate-300 leading-relaxed">
              <div>{image.name} ({image.type})</div>
              <div>{image.data.length} bytes, 0x{(image.startAddress || 0).toString(16).toUpperCase().padStart(4, '0')} to {hex(endAddress)}</div>
              {bytesHint && <div className="text-slate-500">{bytesHint}</div>}
              {planError && <div className="text-rose-300 mt-1">{planError}</div>}
            </div>
          )}
          {!image && (
            <div className="text-slate-500">No file loaded. Intel HEX (.hex) is the usual Arduino IDE export; raw .bin is written from address 0.</div>
          )}
          <div className="text-slate-500 leading-relaxed mt-1">
            UF2 files are parsed by the shared loader but are not checked against this board's family here, so pick .hex or .bin for these boards.
          </div>
        </section>
      </div>

      <section className="border border-slate-800 rounded p-3 bg-slate-900/40 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 uppercase tracking-wider mr-2">3. Action</span>
          <button
            type="button"
            onClick={() => setAction('program')}
            disabled={busy}
            className={`px-3 py-1.5 rounded border ${action === 'program' ? 'border-cyan-500 bg-cyan-950/60 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          >
            Write and verify sketch
          </button>
          <button
            type="button"
            onClick={() => setAction('read')}
            disabled={busy}
            className={`px-3 py-1.5 rounded border ${action === 'read' ? 'border-cyan-500 bg-cyan-950/60 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          >
            Read flash back
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isAvr109 && (
            <button
              type="button"
              onClick={runStk}
              disabled={!canRun || !hasSerial}
              className="flex items-center gap-2 px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold"
            >
              <Zap className="w-4 h-4" />
              {action === 'program' ? 'Program board' : 'Read flash'}
            </button>
          )}

          {isAvr109 && !awaitingBootPort && (
            <button
              type="button"
              onClick={touchAvr}
              disabled={busy || !hasSerial}
              className="flex items-center gap-2 px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold"
            >
              <Usb className="w-4 h-4" />
              Step 1: start bootloader (1200-baud touch)
            </button>
          )}

          {isAvr109 && awaitingBootPort && (
            <>
              <button
                type="button"
                onClick={runAvrStep2}
                disabled={!canRun || !hasSerial}
                className="flex items-center gap-2 px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold"
              >
                <Zap className="w-4 h-4" />
                {action === 'program' ? 'Step 2: choose bootloader port and program' : 'Step 2: choose bootloader port and read'}
              </button>
              <button
                type="button"
                onClick={() => setAwaitingBootPort(false)}
                disabled={busy}
                className="px-3 py-2 rounded border border-slate-700 text-slate-300 hover:border-slate-500"
              >
                Cancel
              </button>
            </>
          )}

          {busy && (
            <button
              type="button"
              onClick={stopRun}
              className="flex items-center gap-2 px-3 py-2 rounded border border-rose-700 text-rose-300 hover:bg-rose-950/40"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          )}
        </div>

        {progress && (
          <div className="flex flex-col gap-1">
            <div className="text-slate-400">
              {PHASE_LABEL[progress.phase] || 'Working'} page {progress.done} of {progress.total}
            </div>
            <div className="h-2 w-full bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {status && (
          <div
            role="status"
            className={`flex gap-2 items-start p-2 rounded border ${
              status.kind === 'ok'
                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
                : status.kind === 'err'
                  ? 'border-rose-700/60 bg-rose-950/40 text-rose-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
            }`}
          >
            {status.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : status.kind === 'err' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : null}
            <span className="leading-relaxed">{status.text}</span>
          </div>
        )}

        {readResult && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">Read-back: {readResult.data.length} bytes</span>
            <button
              type="button"
              onClick={() => download(`${readResult.name}-readback.bin`, readResult.data)}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-700 hover:border-cyan-600 text-slate-200"
            >
              <Download className="w-3.5 h-3.5" /> .bin
            </button>
            <button
              type="button"
              onClick={() => download(`${readResult.name}-readback.hex`, toIntelHex(readResult.data, 0), 'text/plain')}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-700 hover:border-cyan-600 text-slate-200"
            >
              <Download className="w-3.5 h-3.5" /> .hex
            </button>
          </div>
        )}
      </section>

      <section className="border border-slate-800 rounded p-3 bg-slate-900/40 flex flex-col gap-2">
        <div className="text-slate-400 uppercase tracking-wider">Log</div>
        <pre className="bg-slate-950 border border-slate-800 rounded p-2 h-40 overflow-auto text-slate-300 whitespace-pre-wrap">
          {logLines.length ? logLines.join('\n') : 'No activity yet.'}
        </pre>
      </section>

      <section className="text-slate-500 leading-relaxed">
        Not done here: ISP programming, fuses, EEPROM, bootloader updates and Caterina signature checks (AVR109 has no signature
        command). Verification compares every written page with a read-back; nothing is reported as verified unless that pass matched.
      </section>
    </div>
  );
}
