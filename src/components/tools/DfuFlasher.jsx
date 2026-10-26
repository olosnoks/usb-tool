import React, { useState, useRef, useCallback } from 'react';
import {
  Usb,
  Download,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  FileCode,
  Zap,
  Power,
  Info,
  Loader2,
  Trash2
} from 'lucide-react';
import {
  DfuDevice,
  discoverDfuInterface,
  parseDfuSuffix,
  parseDfuSeImage
} from '../../utils/dfuDriver';
import StatusBadge from '../common/StatusBadge';

// Common STM32 flash base — the default target for raw .bin files.
const DEFAULT_TARGET_ADDRESS = 0x08000000;

export default function DfuFlasher() {
  const [device, setDevice] = useState(null); // raw USBDevice
  const [dfu, setDfu] = useState(null); // DfuDevice driver instance
  const [ifaceInfo, setIfaceInfo] = useState(null);
  const [status, setStatus] = useState('offline'); // StatusBadge status
  const [statusMsg, setStatusMsg] = useState('No DFU device connected');

  const [firmware, setFirmware] = useState(null); // { name, payload, suffix, dfuse }
  const [targetAddress, setTargetAddress] = useState('0x08000000');
  const [erasePageSize, setErasePageSize] = useState('2048');
  const [progress, setProgress] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [log, setLog] = useState([]);

  const fileInputRef = useRef(null);

  const addLog = useCallback((msg, kind = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-199), { ts, msg, kind }]);
  }, []);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  // --- Connect ------------------------------------------------------------
  const handleConnect = async () => {
    if (!webUsbAvailable) {
      setStatusMsg('WebUSB is unavailable in this browser (use Chrome/Edge over HTTPS).');
      setStatus('warning');
      return;
    }
    try {
      setStatus('connecting');
      setStatusMsg('Requesting USB device…');
      // Filter to the DFU interface class so the chooser pre-selects DFU devices,
      // but leave it permissive so composite devices still appear.
      const dev = await navigator.usb.requestDevice({
        filters: [{ classCode: 0xfe, subclassCode: 0x01 }]
      });

      await dev.open();
      if (!dev.configuration) {
        await dev.selectConfiguration(1);
      }

      const info = await discoverDfuInterface(dev);
      if (!info) {
        setStatus('warning');
        setStatusMsg('Device opened but exposes no DFU interface. Is it in bootloader/DFU mode?');
        addLog('No DFU (class 0xFE / subclass 0x01) interface found on this device.', 'err');
        await dev.close();
        return;
      }

      await dev.claimInterface(info.interfaceNumber);
      if (info.alternate) {
        try {
          await dev.selectAlternateInterface(info.interfaceNumber, info.alternate);
        } catch {
          /* some devices reject SET_INTERFACE on single-alt descriptors */
        }
      }

      const driver = new DfuDevice(dev, info.interfaceNumber, {
        transferSize: info.transferSize,
        log: (m) => addLog(m, 'info')
      });

      setDevice(dev);
      setDfu(driver);
      setIfaceInfo(info);
      setStatus('online');
      const vid = dev.vendorId?.toString(16).padStart(4, '0');
      const pid = dev.productId?.toString(16).padStart(4, '0');
      setStatusMsg(
        `DFU device ${vid}:${pid} • iface ${info.interfaceNumber} • transferSize ${info.transferSize}B`
      );
      addLog(
        `Connected: ${dev.productName || 'Unknown'} (${vid}:${pid}), ` +
          `DFU ${info.bcdDFU ? '0x' + info.bcdDFU.toString(16) : '1.1'}, ` +
          `${info.attributes.willDetach ? 'bitWillDetach ' : ''}` +
          `transferSize=${info.transferSize}`,
        'ok'
      );
    } catch (err) {
      setStatus('warning');
      setStatusMsg(err.message || 'Connection cancelled');
      addLog(`Connect failed: ${err.message}`, 'err');
    }
  };

  const handleDisconnect = async () => {
    try {
      if (device) await device.close();
    } catch {
      /* ignore */
    }
    setDevice(null);
    setDfu(null);
    setIfaceInfo(null);
    setStatus('offline');
    setStatusMsg('No DFU device connected');
    setProgress(0);
  };

  // --- Firmware file ------------------------------------------------------
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());

    const suffix = parseDfuSuffix(buf);
    const payload = suffix.present ? suffix.payload : buf;
    const dfuse = parseDfuSeImage(payload);

    setFirmware({ name: file.name, size: buf.length, payload, suffix, dfuse });

    addLog(`Loaded ${file.name} (${buf.length} bytes)`, 'ok');
    if (suffix.present) {
      addLog(
        `DFU suffix: VID ${suffix.idVendor.toString(16)} PID ${suffix.idProduct
          .toString(16)} • CRC ${suffix.valid ? 'OK' : 'MISMATCH'}`,
        suffix.valid ? 'info' : 'err'
      );
    }
    if (dfuse.isDfuSe) {
      const n = dfuse.targets.reduce((a, t) => a + t.elements.length, 0);
      addLog(`DfuSe container detected: ${dfuse.targets.length} target(s), ${n} element(s)`, 'info');
    }
  };

  // --- Flash --------------------------------------------------------------
  const handleFlash = async () => {
    if (!dfu || !firmware) return;

    // Cross-check VID/PID from the file suffix against the live device.
    const sfx = firmware.suffix;
    if (sfx?.present && device) {
      const mismatch =
        (sfx.idVendor !== 0xffff && sfx.idVendor !== device.vendorId) ||
        (sfx.idProduct !== 0xffff && sfx.idProduct !== device.productId);
      if (mismatch) {
        const ok = window.confirm(
          `Firmware suffix targets ${sfx.idVendor.toString(16)}:${sfx.idProduct.toString(16)} ` +
            `but the connected device is ${device.vendorId.toString(16)}:${device.productId
              .toString(16)}.\n\nFlashing mismatched firmware can brick the device. Continue anyway?`
        );
        if (!ok) {
          addLog('Flash aborted by user (VID/PID mismatch).', 'err');
          return;
        }
      }
    }

    setIsFlashing(true);
    setProgress(0);
    const onProgress = ({ written, total }) =>
      setProgress(total ? Math.round((written / total) * 100) : 0);

    try {
      if (firmware.dfuse.isDfuSe) {
        addLog('Starting DfuSe download…', 'info');
        const pageSize = parseInt(erasePageSize, 10) || 0;
        for (const target of firmware.dfuse.targets) {
          for (const el of target.elements) {
            addLog(
              `DfuSe element @ 0x${el.address.toString(16)} (${el.data.length} bytes)`,
              'info'
            );
            await dfu.dfuseDownloadElement(
              el.address,
              el.data,
              { erasePageSize: pageSize },
              onProgress
            );
          }
        }
      } else if (dfu.dfuse || ifaceInfo?.attributes?.bcdDFU === 0x011a || isDfuSeManifestSelected()) {
        // Raw .bin to an ST DfuSe bootloader at an explicit address.
        const addr = parseInt(targetAddress, 16);
        const pageSize = parseInt(erasePageSize, 10) || 0;
        dfu.dfuse = true;
        addLog(`DfuSe raw download to 0x${addr.toString(16)} (erase page ${pageSize}B)`, 'info');
        await dfu.dfuseDownloadElement(addr, firmware.payload, { erasePageSize: pageSize }, onProgress);
      } else {
        addLog('Starting plain DFU 1.1 download…', 'info');
        await dfu.download(firmware.payload, onProgress);
      }

      setProgress(100);
      setStatus('online');
      setStatusMsg('Flash complete — device entering new firmware.');
      addLog('✓ Download + manifest complete.', 'ok');
    } catch (err) {
      setStatus('warning');
      setStatusMsg(`Flash failed: ${err.message}`);
      addLog(`✗ Flash failed: ${err.message}`, 'err');
    } finally {
      setIsFlashing(false);
    }
  };

  // Heuristic: ST's DfuSe bootloaders report bcdDFU 0x011a. When the user loads
  // a raw .bin we offer the DfuSe address path if the device looks like ST.
  const isDfuSeManifestSelected = () =>
    ifaceInfo?.bcdDFU === 0x011a && !firmware?.dfuse?.isDfuSe;

  const stLikely = ifaceInfo?.bcdDFU === 0x011a;
  const needsAddress = firmware && !firmware.dfuse.isDfuSe && stLikely;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-4 text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-500/30">
            <Download className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-cyan-300">WebUSB DFU Flasher</h2>
            <p className="text-xs text-slate-400">
              USB DFU 1.1 &amp; ST DfuSe firmware download — STM32, nRF, and any DFU-class device
            </p>
          </div>
        </div>
        <StatusBadge
          status={status}
          label={status === 'online' ? 'DFU' : status === 'connecting' ? 'LINK' : 'IDLE'}
          value={status === 'online' ? 'Ready' : 'Offline'}
          pulse={status === 'connecting'}
        />
      </div>

      {!webUsbAvailable && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>
            WebUSB isn&apos;t available here. Use a Chromium browser (Chrome, Edge, Opera) served over
            HTTPS or localhost.
          </span>
        </div>
      )}

      {/* Connection panel */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <div className="flex items-center gap-2">
          <Usb className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-300">Device</span>
        </div>
        <p className="text-xs text-slate-400">{statusMsg}</p>
        <div className="flex gap-2">
          {status !== 'online' ? (
            <button
              onClick={handleConnect}
              disabled={!webUsbAvailable || status === 'connecting'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-semibold transition"
            >
              {status === 'connecting' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Usb className="w-4 h-4" />
              )}
              Select DFU Device
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-500/30 text-rose-200 text-sm font-semibold transition"
            >
              <Power className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>

        {ifaceInfo && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2">
            <InfoCell label="Interface" value={`#${ifaceInfo.interfaceNumber}`} />
            <InfoCell label="Transfer" value={`${ifaceInfo.transferSize} B`} />
            <InfoCell
              label="DFU ver"
              value={ifaceInfo.bcdDFU ? `0x${ifaceInfo.bcdDFU.toString(16)}` : '1.1'}
            />
            <InfoCell label="Mode" value={stLikely ? 'DfuSe (ST)' : 'DFU 1.1'} />
          </div>
        )}
      </div>

      {/* Firmware panel */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-slate-300">Firmware</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".bin,.dfu,.dfuse"
          onChange={handleFile}
          className="hidden"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/50 text-slate-200 text-sm font-semibold transition"
          >
            <FileCode className="w-4 h-4" />
            Load .bin / .dfu
          </button>
          {firmware && (
            <button
              onClick={() => {
                setFirmware(null);
                setProgress(0);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-700 border border-slate-600/40 text-slate-400 text-xs transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>

        {firmware && (
          <div className="text-xs text-slate-300 space-y-1">
            <div>
              <span className="text-slate-500">File:</span> {firmware.name}{' '}
              <span className="text-slate-500">({firmware.payload.length} bytes payload)</span>
            </div>
            {firmware.suffix.present && (
              <div
                className={firmware.suffix.valid ? 'text-emerald-400' : 'text-rose-400'}
              >
                DFU suffix {firmware.suffix.valid ? 'CRC OK' : 'CRC MISMATCH'} • targets{' '}
                {firmware.suffix.idVendor.toString(16).padStart(4, '0')}:
                {firmware.suffix.idProduct.toString(16).padStart(4, '0')}
              </div>
            )}
            {firmware.dfuse.isDfuSe && (
              <div className="text-cyan-400">
                DfuSe container • {firmware.dfuse.targets.length} target(s),{' '}
                {firmware.dfuse.targets.reduce((a, t) => a + t.elements.length, 0)} element(s) —
                addresses embedded in file
              </div>
            )}
          </div>
        )}

        {/* Address controls for raw .bin on ST DfuSe bootloaders */}
        {needsAddress && (
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <label className="text-xs text-slate-400 space-y-1">
              <span>Target flash address</span>
              <input
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-sm"
                placeholder="0x08000000"
              />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span>Erase page size (bytes, 0 = mass erase)</span>
              <input
                value={erasePageSize}
                onChange={(e) => setErasePageSize(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-sm"
                placeholder="2048"
              />
            </label>
            <div className="sm:col-span-2 flex items-start gap-2 text-[11px] text-slate-500">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Raw .bin has no address — defaulting to the STM32 flash base. Set the page size for
              your part (STM32F1 = 1024/2048; F4 uses variable sectors — prefer a .dfu there).
            </div>
          </div>
        )}
      </div>

      {/* Flash action + progress */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <button
          onClick={handleFlash}
          disabled={!dfu || !firmware || isFlashing}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-amber-600/90 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition"
        >
          {isFlashing ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Zap className="w-5 h-5" />
          )}
          {isFlashing ? `Flashing… ${progress}%` : 'Flash Firmware'}
        </button>

        <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
          DFU writes directly to flash. A wrong address, page size, or firmware image can brick the
          device. Verify your target before flashing.
        </div>
      </div>

      {/* Log */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-300">Session Log</span>
        </div>
        <div className="font-mono text-xs space-y-0.5 max-h-56 overflow-y-auto">
          {log.length === 0 && <div className="text-slate-600">No activity yet.</div>}
          {log.map((entry, i) => (
            <div
              key={i}
              className={
                entry.kind === 'err'
                  ? 'text-rose-400'
                  : entry.kind === 'ok'
                    ? 'text-emerald-400'
                    : 'text-slate-400'
              }
            >
              <span className="text-slate-600">{entry.ts}</span> {entry.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value }) {
  return (
    <div className="px-2 py-1.5 rounded bg-slate-950/60 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-cyan-300 font-mono">{value}</div>
    </div>
  );
}
