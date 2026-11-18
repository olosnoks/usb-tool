import React, { useState, useRef, useCallback } from 'react';
import {
  Usb,
  Package,
  Copy,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  FileCode,
  Zap,
  Power,
  Info,
  Loader2,
  Trash2,
  Upload
} from 'lucide-react';
import {
  DfuDevice,
  discoverDfuInterface,
  parseDfuSuffix,
  parseDfuSeImage
} from '../../utils/dfuDriver';
import {
  buildDfuSeFile,
  inspectCortexMImage,
  summarizeErasePlan,
  buildDfuUtilCommand
} from '../../utils/dfuExtras';
import { parseIntelHex } from '../../utils/firmwareParser';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, record } from '../../utils/sessionLog';
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
  const [altIndex, setAltIndex] = useState(0); // index into ifaceInfo.alternates
  const [massErase, setMassErase] = useState(false);
  const [verifyAfter, setVerifyAfter] = useState(true);
  const [leaveAfter, setLeaveAfter] = useState(true);
  const [readLength, setReadLength] = useState('65536');
  const [readAddress, setReadAddress] = useState('0x08000000'); // separate from the flash target address
  const [isReading, setIsReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [log, setLog] = useState([]);

  const fileInputRef = useRef(null);

  const addLog = useCallback((msg, kind = 'info') => {
    record('DFU', kind, msg);
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
      const alts = (info.alternates || []).filter((a) => a.interfaceNumber === info.interfaceNumber);
      const firstAlt = Math.max(0, alts.findIndex((a) => a.alternate === info.alternate));
      info.alternates = alts;
      setAltIndex(firstAlt);
      if (info.alternate) {
        try {
          await dev.selectAlternateInterface(info.interfaceNumber, info.alternate);
        } catch {
          /* some devices reject SET_INTERFACE on single-alt descriptors */
        }
      }

      const driver = new DfuDevice(dev, info.interfaceNumber, {
        transferSize: info.transferSize,
        dfuse: Boolean(alts[firstAlt]?.region),
        log: (m) => addLog(m, 'info')
      });
      if (alts[firstAlt]?.region) {
        setTargetAddress('0x' + alts[firstAlt].region.start.toString(16));
        setReadAddress('0x' + alts[firstAlt].region.start.toString(16));
        setReadLength(String(alts[firstAlt].region.end - alts[firstAlt].region.start));
      }

      setDevice(dev);
      setDfu(driver);
      setIfaceInfo(info);
      const vid = dev.vendorId?.toString(16).padStart(4, '0');
      const pid = dev.productId?.toString(16).padStart(4, '0');
      if (info.runtimeOnly) {
        setStatus('warning');
        setStatusMsg(
          `This device (${vid}:${pid}) is in runtime mode (DFU protocol 1) and cannot be flashed. ` +
            'Use "Detach to DFU mode" below, or reboot it into its bootloader (boot button / BOOT0), then select it again.'
        );
        addLog('Device exposes only a DFU runtime interface (protocol 1); download is not possible.', 'err');
        return;
      }
      setStatus('online');
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
    setAltIndex(0);
    setStatus('offline');
    setStatusMsg('No DFU device connected');
    setProgress(0);
  };

  const selectedAlt = ifaceInfo?.alternates?.[altIndex] || null;
  const region = selectedAlt?.region || null;

  const handleAltChange = async (e) => {
    const idx = Number(e.target.value);
    const alt = ifaceInfo?.alternates?.[idx];
    if (!alt || !device) return;
    try {
      await device.selectAlternateInterface(alt.interfaceNumber, alt.alternate);
      setAltIndex(idx);
      if (dfu) dfu.dfuse = Boolean(alt.region);
      if (alt.region) {
        setTargetAddress('0x' + alt.region.start.toString(16));
        setReadAddress('0x' + alt.region.start.toString(16));
        setReadLength(String(alt.region.end - alt.region.start));
      }
      addLog(`Selected alt ${alt.alternate}: ${alt.name || '(unnamed)'}`, 'info');
      if (alt.layoutError) addLog(`Layout not parsed: ${alt.layoutError}`, 'err');
    } catch (err) {
      addLog(`Could not select alt ${alt.alternate}: ${err.message}`, 'err');
    }
  };

  const handleDetach = async () => {
    if (!dfu) return;
    try {
      await dfu.detach(1000);
      addLog('DFU_DETACH sent. The device should re-enumerate in DFU mode; select it again.', 'ok');
    } catch (err) {
      addLog(`Detach failed: ${err.message}`, 'err');
    }
    await handleDisconnect();
    setStatus('warning');
    setStatusMsg('Detach sent. Wait for the device to re-enumerate, then click Select DFU Device again.');
  };

  // --- Read device (DFU_UPLOAD) --------------------------------------------
  const handleRead = async () => {
    if (!dfu) return;
    const length = parseInt(readLength, 10);
    if (!(length > 0)) {
      addLog('Enter a read length in bytes.', 'err');
      return;
    }
    const addr = parseInt(readAddress, 16);
    setIsReading(true);
    setProgress(0);
    try {
      addLog(`Reading ${length} bytes${dfu.dfuse ? ` from 0x${addr.toString(16)}` : ''}…`, 'info');
      const data = await dfu.upload(
        length,
        ({ read, total }) => setProgress(Math.round((read / total) * 100)),
        { address: addr }
      );
      const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dfu-read-${dfu.dfuse ? addr.toString(16) + '-' : ''}${data.length}.bin`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('online');
      setStatusMsg(`Read ${data.length} bytes${data.length < length ? ` (device ended early, asked for ${length})` : ''}.`);
      addLog(`✓ Read ${data.length} bytes.`, 'ok');
    } catch (err) {
      setStatus('warning');
      setStatusMsg(`Read failed: ${err.message}`);
      addLog(`✗ Read failed: ${err.message}`, 'err');
    } finally {
      setIsReading(false);
    }
  };

  // --- Firmware file ------------------------------------------------------
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.hex$/i.test(file.name)) {
      try {
        const parsed = parseIntelHex(await file.text());
        if (!parsed.size) throw new Error('no data records found');
        setFirmware({
          name: file.name,
          size: parsed.size,
          payload: parsed.data,
          suffix: { present: false, valid: false },
          dfuse: { isDfuSe: false, targets: [] },
          hexAddress: parsed.startAddress
        });
        setTargetAddress('0x' + parsed.startAddress.toString(16));
        addLog(`Loaded ${file.name}: Intel HEX, ${parsed.size} bytes at 0x${parsed.startAddress.toString(16)}`, 'ok');
      } catch (err) {
        addLog(`Could not parse ${file.name}: ${err.message}`, 'err');
      }
      return;
    }
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
        const ok = confirmAction(
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
      const useDfuse = firmware.dfuse.isDfuSe || dfu.dfuse || Boolean(region) || isDfuSeManifestSelected();
      if (useDfuse) {
        dfu.dfuse = true;
        const erased = new Set();
        const elements = [];
        if (firmware.dfuse.isDfuSe) {
          for (const target of firmware.dfuse.targets) {
            const alt = ifaceInfo?.alternates?.find((x) => x.alternate === target.alternate) || selectedAlt;
            if (alt && alt.alternate !== selectedAlt?.alternate) {
              await device.selectAlternateInterface(alt.interfaceNumber, alt.alternate);
              addLog(`Switched to alt ${alt.alternate} for DfuSe target`, 'info');
            }
            for (const el of target.elements) elements.push({ ...el, alt });
          }
        } else {
          const addr = parseInt(targetAddress, 16);
          if (!Number.isFinite(addr)) throw new Error('Enter a valid target address (hex).');
          elements.push({ address: addr, data: firmware.payload, alt: selectedAlt });
        }

        const pageSize = parseInt(erasePageSize, 10) || 0;
        // only ask when a mass erase will actually happen (no sector layout reported for any element)
        if (massErase && elements.some((el) => !el.alt?.region)) {
          const ok = confirmAction(
            'MASS ERASE wipes the ENTIRE flash of the device, including any stored settings.\n\nContinue?',
            'DFU'
          );
          if (!ok) {
            addLog('Flash aborted by user (mass erase declined).', 'err');
            return;
          }
        }
        addLog('Starting DfuSe download…', 'info');
        let first = true;
        for (const el of elements) {
          const layout = el.alt?.region?.sectors;
          addLog(
            `DfuSe element @ 0x${el.address.toString(16)} (${el.data.length} bytes), erase: ${
              massErase && first && !layout ? 'mass' : layout ? 'per sector (layout)' : pageSize ? `${pageSize} B pages` : 'none possible'
            }`,
            'info'
          );
          await dfu.dfuseDownloadElement(
            el.address,
            el.data,
            {
              layout,
              erasePageSize: layout ? 0 : pageSize,
              massErase: massErase && first && !layout,
              erased,
              leave: false
            },
            onProgress
          );
          first = false;
        }
        if (verifyAfter) {
          for (const el of elements) {
            addLog(`Verifying @ 0x${el.address.toString(16)}…`, 'info');
            const v = await dfu.verify(el.data, { address: el.address });
            if (!v.ok) {
              throw new Error(
                `Verify failed at 0x${(el.address + v.mismatchOffset).toString(16)} (offset ${v.mismatchOffset})`
              );
            }
          }
          addLog('✓ Verify OK (read back matches).', 'ok');
        }
        if (leaveAfter) {
          await dfu.dfuseLeave(elements[0].address);
        } else {
          addLog('Staying in DFU mode (leave not requested).', 'info');
        }
      } else {
        addLog('Starting plain DFU 1.1 download…', 'info');
        await dfu.download(firmware.payload, onProgress);
      }

      setProgress(100);
      setStatus('online');
      setStatusMsg(leaveAfter || !dfu.dfuse ? 'Flash complete — device entering new firmware.' : 'Flash complete — device left in DFU mode.');
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
  const needsAddress = firmware && !firmware.dfuse.isDfuSe && (stLikely || Boolean(region));

  // --- Extras: image list, inspection, verify-only, .dfu export, CLI command ---
  const parsedTarget = parseInt(targetAddress, 16);
  const currentElements = () => {
    if (!firmware) return [];
    if (firmware.dfuse.isDfuSe) return firmware.dfuse.targets.flatMap((t) => t.elements);
    return Number.isFinite(parsedTarget) ? [{ address: parsedTarget, data: firmware.payload }] : [];
  };

  const inspection =
    firmware && !firmware.dfuse.isDfuSe && Number.isFinite(parsedTarget)
      ? inspectCortexMImage(firmware.payload, parsedTarget, region)
      : null;
  const erasePlan =
    firmware && region && !firmware.dfuse.isDfuSe && Number.isFinite(parsedTarget)
      ? summarizeErasePlan(region.sectors, parsedTarget, firmware.payload.length)
      : null;

  const download = (bytes, name) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportDfu = () => {
    try {
      const els = currentElements();
      if (!els.length) throw new Error('Enter a valid target address (hex) first.');
      const bytes = buildDfuSeFile(els, {
        alternate: selectedAlt?.alternate ?? 0,
        vid: device?.vendorId,
        pid: device?.productId
      });
      const base = (firmware.name || 'firmware').replace(/\.[^.]+$/, '');
      download(bytes, `${base}.dfu`);
      addLog(
        `Exported ${base}.dfu (${bytes.length} bytes, ${els.length} element(s)${device ? ', suffix targets the connected device' : ', wildcard VID/PID'}).`,
        'ok'
      );
    } catch (err) {
      addLog(`Export failed: ${err.message}`, 'err');
    }
  };

  const handleVerifyOnly = async () => {
    if (!dfu || !firmware) return;
    const els = currentElements();
    if (!els.length) {
      addLog('Enter a valid target address (hex) first.', 'err');
      return;
    }
    setIsReading(true);
    setProgress(0);
    try {
      for (const el of els) {
        addLog(`Comparing device with file @ 0x${el.address.toString(16)} (${el.data.length} bytes)…`, 'info');
        const v = await dfu.verify(el.data, { address: el.address });
        if (!v.ok) {
          throw new Error(`Differs at 0x${(el.address + v.mismatchOffset).toString(16)} (offset ${v.mismatchOffset})`);
        }
      }
      setProgress(100);
      setStatus('online');
      setStatusMsg('Device contents match the loaded file.');
      addLog('✓ Device contents match the loaded file.', 'ok');
    } catch (err) {
      setStatus('warning');
      setStatusMsg(`Compare: ${err.message}`);
      addLog(`✗ Compare: ${err.message}`, 'err');
    } finally {
      setIsReading(false);
    }
  };

  const cliText = (upload) =>
    buildDfuUtilCommand({
      vid: device?.vendorId,
      pid: device?.productId,
      alt: selectedAlt?.alternate ?? 0,
      address: upload ? parseInt(readAddress, 16) : parsedTarget,
      fileName: upload ? 'read.bin' : firmware?.name,
      leave: leaveAfter,
      dfuse: Boolean(dfu?.dfuse || region || stLikely) && !(firmware?.dfuse?.isDfuSe && !upload),
      upload,
      length: parseInt(readLength, 10)
    });
  const copyCli = async (upload) => {
    const text = cliText(upload);
    try {
      await navigator.clipboard.writeText(text);
      addLog(`Copied (for the dfu-util CLI, not run here): ${text}`, 'ok');
    } catch {
      addLog(`dfu-util equivalent: ${text}`, 'info');
    }
  };

  const busy = isFlashing || isReading;
  const inputCls =
    'w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500';
  const btnCls =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600/50 text-slate-200 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-2 text-slate-200">
      {/* Status bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-slate-400 flex-1 min-w-0 break-words">{statusMsg}</p>
        <StatusBadge
          status={status}
          label={status === 'online' ? 'DFU' : status === 'connecting' ? 'LINK' : 'IDLE'}
          value={status === 'online' ? 'Ready' : 'Offline'}
          pulse={status === 'connecting'}
        />
      </div>

      {!webUsbAvailable && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            WebUSB isn&apos;t available here. Use a Chromium browser (Chrome, Edge, Opera) served over
            HTTPS or localhost.
          </span>
        </div>
      )}

      {/* Device */}
      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Usb className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300">Device</span>
          <div className="flex gap-2 ml-auto flex-wrap">
            {!device ? (
              <button
                onClick={handleConnect}
                disabled={!webUsbAvailable || status === 'connecting'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-600/80 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold transition"
              >
                {status === 'connecting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />}
                Select DFU Device
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-rose-900/60 hover:bg-rose-800 border border-rose-500/30 text-rose-200 text-xs font-semibold transition disabled:opacity-40"
              >
                <Power className="w-3.5 h-3.5" />
                Disconnect
              </button>
            )}
            {ifaceInfo?.runtimeOnly && (
              <button
                onClick={handleDetach}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-700/70 hover:bg-amber-600 text-white text-xs font-semibold transition"
              >
                <Power className="w-3.5 h-3.5" />
                Detach to DFU mode
              </button>
            )}
          </div>
        </div>

        {ifaceInfo && !ifaceInfo.runtimeOnly && ifaceInfo.alternates?.length > 0 && (
          <label className="block text-[11px] text-slate-400 space-y-1">
            <span>Memory / alt-setting</span>
            <select
              value={altIndex}
              onChange={handleAltChange}
              disabled={busy}
              className={inputCls}
            >
              {ifaceInfo.alternates.map((a, i) => (
                <option key={i} value={i}>
                  alt {a.alternate}: {a.name || '(unnamed)'}
                </option>
              ))}
            </select>
            {selectedAlt?.layoutError && (
              <span className="block text-rose-400">Layout not understood: {selectedAlt.layoutError}</span>
            )}
            {region && (
              <span className="block text-slate-500">
                {region.sectors.length} sector(s), 0x{region.start.toString(16)}–0x{(region.end - 1).toString(16)}
              </span>
            )}
          </label>
        )}

        {ifaceInfo && (
          <div className="grid grid-cols-2 @md:grid-cols-5 gap-1.5 text-[11px]">
            <InfoCell label="VID:PID" value={`${device?.vendorId?.toString(16).padStart(4, '0')}:${device?.productId?.toString(16).padStart(4, '0')}`} />
            <InfoCell label="Interface" value={`#${ifaceInfo.interfaceNumber}`} />
            <InfoCell label="Transfer" value={`${ifaceInfo.transferSize} B`} />
            <InfoCell label="DFU ver" value={ifaceInfo.bcdDFU ? `0x${ifaceInfo.bcdDFU.toString(16)}` : '1.1'} />
            <InfoCell label="Mode" value={stLikely || region ? 'DfuSe (ST)' : 'DFU 1.1'} />
          </div>
        )}
      </div>

      {/* Firmware */}
      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FileCode className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-slate-300">Firmware</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bin,.dfu,.dfuse,.hex"
            onChange={handleFile}
            className="hidden"
            aria-label="Firmware file"
          />
          <div className="flex gap-1.5 ml-auto flex-wrap">
            <button onClick={() => fileInputRef.current?.click()} className={btnCls}>
              <FileCode className="w-3.5 h-3.5" />
              Load .bin / .dfu / .hex
            </button>
            {firmware && !firmware.dfuse.isDfuSe && (
              <button
                onClick={handleExportDfu}
                className={btnCls}
                title="Pack the loaded image into a DfuSe .dfu file (with DFU suffix) and download it"
              >
                <Package className="w-3.5 h-3.5" />
                Save as .dfu
              </button>
            )}
            {firmware && (
              <button
                onClick={() => {
                  setFirmware(null);
                  setProgress(0);
                }}
                className={`${btnCls} !text-slate-400`}
                title="Unload the firmware file"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {firmware && (
          <div className="text-[11px] text-slate-300 space-y-0.5">
            <div>
              <span className="text-slate-500">File:</span> {firmware.name}{' '}
              <span className="text-slate-500">({firmware.payload.length} bytes payload)</span>
            </div>
            {firmware.suffix.present && (
              <div className={firmware.suffix.valid ? 'text-emerald-400' : 'text-rose-400'}>
                DFU suffix {firmware.suffix.valid ? 'CRC OK' : 'CRC MISMATCH'} • targets{' '}
                {firmware.suffix.idVendor.toString(16).padStart(4, '0')}:
                {firmware.suffix.idProduct.toString(16).padStart(4, '0')}
              </div>
            )}
            {firmware.dfuse.isDfuSe && (
              <div className="text-cyan-400">
                DfuSe container • {firmware.dfuse.targets.length} target(s),{' '}
                {firmware.dfuse.targets.reduce((a, t) => a + t.elements.length, 0)} element(s) — addresses embedded in file
              </div>
            )}
            {inspection?.findings.map((f, i) => (
              <div key={i} className={f.level === 'warn' ? 'text-amber-400' : 'text-slate-500'}>
                {f.level === 'warn' ? '⚠ ' : ''}
                {f.msg}
              </div>
            ))}
            {erasePlan && (
              <div className={erasePlan.error ? 'text-rose-400' : 'text-slate-400'}>
                {erasePlan.error
                  ? `Erase plan: ${erasePlan.error}`
                  : `Erase plan: ${erasePlan.sectors} sector(s), ${erasePlan.bytes} bytes will be erased.`}
              </div>
            )}
          </div>
        )}

        {/* Address controls for raw .bin on ST DfuSe bootloaders */}
        {needsAddress && (
          <div className="grid @md:grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Target flash address</span>
              <input
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                className={inputCls}
                placeholder="0x08000000"
              />
            </label>
            {!region && (
              <label className="text-[11px] text-slate-400 space-y-1">
                <span>Erase page size (bytes; only if the device reports no layout)</span>
                <input
                  value={erasePageSize}
                  onChange={(e) => setErasePageSize(e.target.value)}
                  className={inputCls}
                  placeholder="2048"
                />
              </label>
            )}
            <div className="@md:col-span-2 flex items-start gap-1.5 text-[11px] text-slate-500">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {region
                ? 'Erase uses the device-reported sector layout: only sectors overlapping the image are erased.'
                : 'No sector layout reported by this device. Set the page size for your part, or tick mass erase below.'}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700/50 space-y-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={verifyAfter} onChange={(e) => setVerifyAfter(e.target.checked)} className="accent-cyan-500" />
            Verify after write
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={leaveAfter} onChange={(e) => setLeaveAfter(e.target.checked)} className="accent-cyan-500" />
            Jump to application after flash
          </label>
          {/* with a reported sector layout the flasher erases exactly the sectors the image covers,
              so mass erase does not apply (the driver only mass-erases when no layout is known) */}
          <label
            className={`flex items-center gap-1.5 ${region ? 'text-slate-500' : 'text-rose-300'}`}
            title={region ? 'Not used: this device reports its sector layout, so only the sectors the image covers are erased.' : undefined}
          >
            <input type="checkbox" checked={massErase && !region} disabled={!!region} onChange={(e) => setMassErase(e.target.checked)} className="accent-rose-500" />
            {region ? 'Mass erase (not needed: per-sector erase)' : 'Mass erase (wipes whole flash; asks to confirm)'}
          </label>
        </div>

        <button
          onClick={handleFlash}
          disabled={!dfu || !firmware || busy || ifaceInfo?.runtimeOnly}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-amber-600/90 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition"
        >
          {isFlashing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {isFlashing ? `Flashing… ${progress}%` : 'Flash Firmware'}
        </button>

        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>

        <div className="flex flex-wrap items-end gap-2 text-[11px] text-slate-400">
          <label className="space-y-1">
            <span>Read length (bytes)</span>
            <input value={readLength} onChange={(e) => setReadLength(e.target.value)} className={`${inputCls} w-28 block`} />
          </label>
          {(region || dfu?.dfuse) && (
            <label className="space-y-1">
              <span>From address</span>
              <input value={readAddress} onChange={(e) => setReadAddress(e.target.value)} className={`${inputCls} w-28 block`} />
            </label>
          )}
          <button
            onClick={handleRead}
            disabled={!dfu || ifaceInfo?.runtimeOnly || busy}
            className={btnCls}
          >
            {isReading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Read device to .bin
          </button>
          <button
            onClick={handleVerifyOnly}
            disabled={!dfu || !firmware || ifaceInfo?.runtimeOnly || busy || !(dfu?.dfuse || region)}
            className={btnCls}
            title="Read the device back and compare with the loaded file, without writing anything (DfuSe only)"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Compare with file
          </button>
        </div>

        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">dfu-util equivalent</summary>
          <div className="mt-1.5 space-y-1.5">
            <p className="text-slate-500">
              Text for the dfu-util command-line tool. This app does not run it; copy it to a terminal if you want the CLI to repeat the operation.
            </p>
            <code className="block p-1.5 rounded bg-slate-950 border border-slate-800 font-mono text-cyan-300 break-all">{cliText(false)}</code>
            <code className="block p-1.5 rounded bg-slate-950 border border-slate-800 font-mono text-cyan-300 break-all">{cliText(true)}</code>
            <div className="flex gap-1.5">
              <button onClick={() => copyCli(false)} className={btnCls} title="Copy the download command">
                <Copy className="w-3.5 h-3.5" /> Copy flash
              </button>
              <button onClick={() => copyCli(true)} className={btnCls} title="Copy the read command">
                <Copy className="w-3.5 h-3.5" /> Copy read
              </button>
            </div>
          </div>
        </details>

        <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
          DFU writes directly to flash. A wrong address, page size, or firmware image can brick the device. Verify your target before flashing.
        </div>
      </div>

      {/* Log */}
      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-300">Session Log</span>
        </div>
        <div className="font-mono text-[11px] space-y-0.5 max-h-48 overflow-y-auto">
          {log.length === 0 && <div className="text-slate-600">No activity yet.</div>}
          {log.map((entry, i) => (
            <div
              key={i}
              className={entry.kind === 'err' ? 'text-rose-400' : entry.kind === 'ok' ? 'text-emerald-400' : 'text-slate-400'}
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
    <div className="px-2 py-1 rounded bg-slate-950/60 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-cyan-300 font-mono">{value}</div>
    </div>
  );
}
