import React, { useState, useEffect, useRef } from 'react';
import { 
  Usb, 
  Cpu, 
  Zap, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Terminal, 
  ArrowRight, 
  ShieldAlert, 
  Layers, 
  Radio, 
  HelpCircle, 
  Activity, 
  RefreshCw, 
  Play, 
  Square, 
  Eye, 
  BookOpen, 
  Download,
  Copy,
  Trash2,
  Pause,
  ChevronRight,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { identifyUsbChip } from '../utils/usbDatabase';
import {
  endpointKey,
  describeEndpointOption,
  dfuDetach,
  sendHexToEndpoint,
  readFromEndpoint,
  releaseDevice,
  formatUsbVersion,
  buildPayload,
  bytesToHex,
  bytesToAscii,
  formatCaptureLog,
  buildAutopsyReport,
  totalBytes
} from '../utils/usbRecon';

export default function UsbReconDeck({
  isConnected = false,
  onSendRawBytes,
  onSendString,
  onToggleSignal,
  onBaudRateChange,
  currentBaudRate = 115200,
  onLogMessage,
  boards = [],
  activeBoardId = 'board-1',
  onSelectBoard
}) {
  // WebUSB Interrogated Device State
  const [usbDevice, setUsbDevice] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [selectedInterface, setSelectedInterface] = useState(null);
  const [claimedInterfaces, setClaimedInterfaces] = useState({});
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);

  // Raw Endpoint Communication State
  const [outPayload, setOutPayload] = useState('41 54 0D 0A'); // "AT\r\n" in hex
  const [payloadMode, setPayloadMode] = useState('hex'); // 'hex' | 'ascii'
  const [payloadEol, setPayloadEol] = useState('none'); // 'none' | 'cr' | 'lf' | 'crlf'
  const [grantedDevices, setGrantedDevices] = useState([]);
  const [inTransferLog, setInTransferLog] = useState([]);
  const [logPaused, setLogPaused] = useState(false);
  const logPausedRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const listenLoopRef = useRef(false);
  const deviceRef = useRef(null);
  const claimedRef = useRef(new Set());

  // Active Tab: 'interrogate' | 'forcer' | 'guide'
  const [activeTab, setActiveTab] = useState('interrogate');

  // Teardown guide dropdown steps (collapsed by default)
  const [openGuideSteps, setOpenGuideSteps] = useState({
    step1: false,
    step2: false,
    step3: false,
    step4: false
  });

  const toggleGuideStep = (stepKey) => {
    setOpenGuideSteps(prev => ({
      ...prev,
      [stepKey]: !prev[stepKey]
    }));
  };

  // Bootloader forcer running states
  const [forcerStatus, setForcerStatus] = useState('');
  const [isExecutingForcer, setIsExecutingForcer] = useState(false);

  // Stop the listener and release every claimed interface (used on unmount and before a new device).
  const releaseAll = async () => {
    listenLoopRef.current = false;
    const dev = deviceRef.current;
    const claimed = [...claimedRef.current];
    claimedRef.current = new Set();
    deviceRef.current = null;
    if (!dev) return;
    await releaseDevice(dev, claimed);
  };

  useEffect(() => () => { releaseAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentInterface = interfaces.find(i => i.interfaceNumber === selectedInterface);
  const currentEndpoint = currentInterface?.endpoints.find(ep => endpointKey(ep) === selectedEndpoint) || null;

  // Request & Interrogate ANY USB Device (Zero filters)
  const handleInterrogateAnyUsb = async () => {
    if (!navigator.usb) {
      setForcerStatus('WebUSB is not supported in this browser. Use Chrome, Edge, or Opera.');
      onLogMessage?.('[USB ERROR] WebUSB is not supported in this browser.', 'err');
      return;
    }

    try {
      setForcerStatus('Requesting USB device access from user...');
      // Empty filters array allows selecting ANY connected USB device
      const device = await navigator.usb.requestDevice({ filters: [] });
      await openDevice(device);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('USB Interrogation error:', err);
        setForcerStatus(`Interrogation error: ${err.message}`);
        onLogMessage?.(`[USB ERROR] ${err.message}`, 'err');
      }
    }
  };

  // Devices this site already has permission for (no picker needed to re-open them).
  const refreshGranted = async () => {
    try {
      setGrantedDevices(navigator.usb ? await navigator.usb.getDevices() : []);
    } catch {
      setGrantedDevices([]);
    }
  };
  useEffect(() => { refreshGranted(); }, []);

  const handleOpenGranted = async (index) => {
    const device = grantedDevices[Number(index)];
    if (!device) return;
    try {
      await openDevice(device);
    } catch (err) {
      setForcerStatus(`Interrogation error: ${err.message}`);
      onLogMessage?.(`[USB ERROR] ${err.message}`, 'err');
    }
  };

  const openDevice = async (device) => {
    {
      await releaseAll();
      setClaimedInterfaces({});
      setInTransferLog([]);
      setIsListening(false);
      await device.open();
      deviceRef.current = device;
      
      // Try to select configuration 1
      if (device.configuration === null) {
        try {
          await device.selectConfiguration(1);
        } catch {
          // Some devices have only configuration 0 or non-standard configs
        }
      }

      setUsbDevice(device);
      const vid = device.vendorId;
      const pid = device.productId;
      const intel = identifyUsbChip(vid, pid);

      const parsedInterfaces = [];
      if (device.configuration && device.configuration.interfaces) {
        device.configuration.interfaces.forEach((iface) => {
          const alt = iface.alternates[0];
          parsedInterfaces.push({
            interfaceNumber: iface.interfaceNumber,
            interfaceClass: alt?.interfaceClass,
            interfaceSubclass: alt?.interfaceSubclass,
            interfaceProtocol: alt?.interfaceProtocol,
            interfaceName: alt?.interfaceName || `Interface #${iface.interfaceNumber}`,
            endpoints: (alt?.endpoints || []).map((ep) => ({
              endpointNumber: ep.endpointNumber,
              direction: ep.direction, // 'in' or 'out'
              type: ep.type, // 'bulk', 'interrupt', 'isochronous'
              packetSize: ep.packetSize
            }))
          });
        });
      }

      setInterfaces(parsedInterfaces);
      if (parsedInterfaces.length > 0) {
        setSelectedInterface(parsedInterfaces[0].interfaceNumber);
        if (parsedInterfaces[0].endpoints.length > 0) {
          setSelectedEndpoint(endpointKey(parsedInterfaces[0].endpoints[0]));
        } else {
          setSelectedEndpoint(null);
        }
      }

      setDeviceInfo({
        vendorId: vid,
        productId: pid,
        vidHex: `0x${vid.toString(16).padStart(4, '0').toUpperCase()}`,
        pidHex: `0x${pid.toString(16).padStart(4, '0').toUpperCase()}`,
        productName: device.productName || 'Unnamed USB Device',
        manufacturerName: device.manufacturerName || 'Unknown Manufacturer',
        serialNumber: device.serialNumber || 'No Serial Reported',
        usbVersion: formatUsbVersion(device.usbVersionMajor, device.usbVersionMinor, device.usbVersionSubminor),
        deviceClass: device.deviceClass,
        deviceSubclass: device.deviceSubclass,
        deviceProtocol: device.deviceProtocol,
        intel
      });

      setForcerStatus(`Connected to ${device.productName || 'USB Device'} (VID: 0x${vid.toString(16)} PID: 0x${pid.toString(16)})`);
      onLogMessage?.(`[USB RECON] Interrogated: ${device.productName} [${device.vendorId}:${device.productId}]`, 'sys');
      refreshGranted();
    }
  };

  // Claim USB Interface
  const handleClaimInterface = async (ifaceNum) => {
    if (!usbDevice) return;
    try {
      await usbDevice.claimInterface(ifaceNum);
      claimedRef.current.add(ifaceNum);
      setClaimedInterfaces(prev => ({ ...prev, [ifaceNum]: true }));
      onLogMessage?.(`[USB] Claimed interface #${ifaceNum}`, 'sys');
      setForcerStatus(`Interface #${ifaceNum} claimed successfully`);
    } catch (err) {
      onLogMessage?.(`[USB CLAIM ERROR] ${err.message}`, 'err');
      setForcerStatus(`Could not claim interface #${ifaceNum}: ${err.message}. The OS driver or another program might be locking this interface.`);
    }
  };

  // Transfer OUT (Send raw bytes to endpoint)
  const handleTransferOut = async () => {
    if (!usbDevice || !currentEndpoint) return;
    try {
      const data = await sendHexToEndpoint(usbDevice, currentEndpoint, selectedInterface, claimedRef.current, bytesToHex(buildPayload(outPayload, payloadMode, payloadEol)));
      onLogMessage?.(`[USB OUT Ep:${currentEndpoint.endpointNumber}] Sent ${data.length} bytes: ${bytesToHex(data)}`, 'tx');
      setForcerStatus(`Sent ${data.length} bytes to Endpoint ${currentEndpoint.endpointNumber} (OUT)`);
    } catch (err) {
      onLogMessage?.(`[USB TRANSFER ERROR] ${err.message}`, 'err');
      setForcerStatus(err.message);
    }
  };

  // Transfer IN Listener Loop
  const toggleListening = async () => {
    if (isListening) {
      listenLoopRef.current = false;
      setIsListening(false);
      return;
    }

    if (!usbDevice || !currentEndpoint) return;
    const ep = currentEndpoint;
    const ifaceNum = selectedInterface;
    const device = usbDevice;
    listenLoopRef.current = true;
    setIsListening(true);
    setForcerStatus(`Listening on Endpoint ${ep.endpointNumber} (IN)...`);

    while (listenLoopRef.current && deviceRef.current === device) {
      try {
        const bytes = await readFromEndpoint(device, ep, ifaceNum, claimedRef.current);
        if (bytes.length > 0) {
          if (!logPausedRef.current) {
            const hex = bytesToHex(bytes);
            const ascii = bytesToAscii(bytes);
            const time = new Date().toLocaleTimeString();
            setInTransferLog(prev => [
              { id: Date.now() + Math.random(), time, len: bytes.length, hex, ascii },
              ...prev.slice(0, 199)
            ]);
          }
        }
      } catch (err) {
        if (!listenLoopRef.current) break;
        if (/^(Claim interface|Endpoint )/.test(err.message)) {
          // A usage error, not a transient USB error: stop instead of retrying forever.
          listenLoopRef.current = false;
          setIsListening(false);
          setForcerStatus(err.message);
          break;
        }
        console.warn('TransferIn loop paused:', err);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  };

  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setForcerStatus(`Copied ${what} to the clipboard.`);
    } catch {
      setForcerStatus('Clipboard is not available in this context.');
    }
  };
  const downloadText = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const autopsyFileName = () => deviceInfo ? `usb-autopsy-${deviceInfo.vidHex.slice(2).toLowerCase()}-${deviceInfo.pidHex.slice(2).toLowerCase()}.txt` : 'usb-autopsy.txt';

  // BOOTLOADER FORCERS

  // 1. 1200-Baud Magic CDC Knock (Forces RP2040 Pico, Arduino Leonardo/Micro, SAMD into bootloader)
  const handle1200BaudKnock = async () => {
    setIsExecutingForcer(true);
    setForcerStatus('Executing 1200-baud magic CDC knock...');
    onLogMessage?.('[BOOT FORCER] Triggering 1200-Baud Reset-to-BOOTSEL pulse...', 'sys');

    try {
      // Step 1: Switch baud rate to 1200 bps
      onBaudRateChange?.(1200);
      await new Promise(r => setTimeout(r, 100));

      // Step 2: Assert DTR low
      onToggleSignal?.('dtr');
      await new Promise(r => setTimeout(r, 250));

      // Step 3: Deassert DTR & restore baud
      onToggleSignal?.('dtr');
      await new Promise(r => setTimeout(r, 200));
      onBaudRateChange?.(currentBaudRate);

      setForcerStatus('1200-Baud knock completed! RP2040 / SAMD / Arduino board should now be in Bootloader / UF2 mode.');
      onLogMessage?.('[BOOT FORCER] 1200-baud pulse finished. Device rebooting into bootloader.', 'sys');
    } catch (err) {
      setForcerStatus(`Knock error: ${err.message}`);
    } finally {
      setIsExecutingForcer(false);
    }
  };

  // 2. ESP32 Hardware Boot Strapping (EN / GPIO0 transistor flip)
  const handleEsp32BootStrapping = async () => {
    setIsExecutingForcer(true);
    setForcerStatus('Pulsing ESP32 strapping transistors (RTS->EN, DTR->GPIO0)...');
    onLogMessage?.('[BOOT FORCER] Asserting ESP32 Boot Strapping sequence...', 'sys');

    try {
      // Pull RST low (RTS low) and GPIO0 low (DTR low)
      onToggleSignal?.('rts');
      onToggleSignal?.('dtr');
      await new Promise(r => setTimeout(r, 150));

      // Release RST so chip powers up while GPIO0 is held low
      onToggleSignal?.('rts');
      await new Promise(r => setTimeout(r, 100));

      // Release GPIO0
      onToggleSignal?.('dtr');
      setForcerStatus('ESP32 strapping complete! ROM bootloader active waiting for SYNC frames.');
      onLogMessage?.('[BOOT FORCER] ESP32 bootloader strapping completed.', 'sys');
    } catch (err) {
      setForcerStatus(`Strapping error: ${err.message}`);
    } finally {
      setIsExecutingForcer(false);
    }
  };

  // 3. USB DFU Detach Knock (WebUSB Control Transfer, sent to the DFU interface only)
  const handleDfuDetachKnock = async () => {
    if (!usbDevice) {
      setForcerStatus('Interrogate a WebUSB device first using the "INTERROGATE ANY USB DEVICE" button.');
      return;
    }

    setIsExecutingForcer(true);
    setForcerStatus('Sending USB DFU_DETACH control transfer...');
    try {
      const dfu = await dfuDetach(usbDevice);
      setForcerStatus(`DFU_DETACH acknowledged by interface #${dfu.interfaceNumber}. Device should reboot into DFU bootloader.`);
      onLogMessage?.(`[BOOT FORCER] DFU_DETACH acknowledged by interface #${dfu.interfaceNumber}.`, 'sys');
    } catch (err) {
      setForcerStatus(`DFU Detach: ${err.message}`);
      onLogMessage?.(`[BOOT FORCER] DFU error: ${err.message}`, 'err');
    } finally {
      setIsExecutingForcer(false);
    }
  };

  // 4. Reboot Strings Storm
  const handleRebootStringsStorm = () => {
    onLogMessage?.('[BOOT FORCER] Transmitting bootloader reboot strings storm...', 'tx');
    const strings = [
      'reboot bootloader\r\n',
      'reboot edl\r\n',
      'reboot fastboot\r\n',
      'machine.bootloader()\r\n',
      'sys bootloader\r\n',
      'boot\r\n',
      'B\r\n',
      'AT+REBOOT\r\n'
    ];
    strings.forEach((str, i) => {
      setTimeout(() => {
        onSendString?.(str);
      }, i * 80);
    });
    setForcerStatus('Sent storm of 8 standard bootloader drop commands.');
  };

  // 5. U-Boot Autoboot Abort Storm (Stop countdown)
  const handleAutobootAbortStorm = () => {
    onLogMessage?.('[BOOT FORCER] Sending 1-second keystroke storm to abort U-Boot countdown...', 'tx');
    setForcerStatus('Firing Space / Ctrl+C storm. Power-cycle your target now!');
    let count = 0;
    const interval = setInterval(() => {
      onSendString?.(' \x03\r\n');
      count++;
      if (count > 25) {
        clearInterval(interval);
        setForcerStatus('Autoboot abort storm finished.');
      }
    }, 40);
  };

  const tabBtn = (id, label, active) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
        activeTab === id ? active : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );

  const hex2 = (n) => (n == null ? '??' : `0x${n.toString(16).padStart(2, '0').toUpperCase()}`);

  return (
    <div className="text-slate-200 text-xs font-mono space-y-2">
      {/* Tab switcher */}
      <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit max-w-full">
        {tabBtn('interrogate', 'DEVICE AUTOPSY', 'bg-amber-600 text-white')}
        {tabBtn('forcer', 'BOOTLOADER FORCERS', 'bg-cyan-600 text-white')}
        {tabBtn('guide', 'VAPE & PCB TEARDOWN', 'bg-purple-600 text-white')}
      </div>

      {/* Main Tab 1: Device Autopsy & Raw WebUSB Interrogation */}
      {activeTab === 'interrogate' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleInterrogateAnyUsb}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold transition-all"
              title="Opens the browser's USB picker; works on any device, no filters"
            >
              <Search className="w-3.5 h-3.5" />
              <span>INTERROGATE ANY USB DEVICE</span>
            </button>
            {grantedDevices.length > 0 && (
              <label className="flex items-center gap-1 text-[10px] text-slate-400">
                <span>Already allowed:</span>
                <select
                  value=""
                  onChange={e => handleOpenGranted(e.target.value)}
                  aria-label="Re-open a previously allowed USB device"
                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-slate-200 max-w-[14rem]"
                >
                  <option value="">pick a device...</option>
                  {grantedDevices.map((d, i) => (
                    <option key={i} value={i}>
                      {d.productName || 'USB device'} ({d.vendorId.toString(16).padStart(4, '0')}:{d.productId.toString(16).padStart(4, '0')})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {forcerStatus && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-cyan-300 text-[11px] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="min-w-0 break-words">{forcerStatus}</span>
            </div>
          )}

          {deviceInfo ? (
            <div className="grid grid-cols-1 @lg:grid-cols-3 gap-2">
              {/* Silicon Fingerprint */}
              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-amber-400" />
                    SILICON FINGERPRINT
                  </span>
                  <div className="flex items-center gap-1">
                    {deviceInfo.intel?.known === false ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 font-bold">UNKNOWN</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">IDENTIFIED</span>
                    )}
                    <button
                      onClick={() => copyText(buildAutopsyReport(deviceInfo, interfaces), 'the autopsy report')}
                      title="Copy a text report (IDs, chip match, interfaces, endpoints)"
                      aria-label="Copy autopsy report"
                      className="p-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    ><Copy className="w-3 h-3" /></button>
                    <button
                      onClick={() => downloadText(buildAutopsyReport(deviceInfo, interfaces), autopsyFileName())}
                      title="Download the autopsy report as a .txt file"
                      aria-label="Download autopsy report"
                      className="p-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    ><Download className="w-3 h-3" /></button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">PRODUCT</span>
                    <span className="text-xs font-bold text-white break-words">{deviceInfo.productName}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">MANUFACTURER</span>
                    <span className="text-slate-300 break-words">{deviceInfo.manufacturerName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded border border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-500 block">VID</span>
                      <strong className="text-amber-400 text-xs">{deviceInfo.vidHex}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">PID</span>
                      <strong className="text-cyan-400 text-xs">{deviceInfo.pidHex}</strong>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-amber-950/30 border border-amber-900/50 space-y-0.5">
                    <span className="text-[10px] text-amber-400 uppercase font-bold block">CHIP ANALYSIS</span>
                    <p className="text-slate-200 font-bold text-[11px]">{deviceInfo.intel.chip}</p>
                    <p className="text-slate-400 text-[10px] leading-relaxed">{deviceInfo.intel.notes}</p>
                    <p className="text-[10px] text-amber-300/80">Operating logic: {deviceInfo.intel.voltage}</p>
                  </div>
                </div>
              </div>

              {/* Interfaces & endpoint I/O */}
              <div className="@lg:col-span-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-2 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    INTERFACES & ENDPOINT I/O
                  </span>
                  <span className="text-[10px] text-slate-400 break-all">
                    USB v{deviceInfo.usbVersion} | Serial: {deviceInfo.serialNumber}
                  </span>
                </div>

                <div className="grid grid-cols-1 @sm:grid-cols-2 gap-1.5">
                  {interfaces.map(iface => {
                    const isClaimed = !!claimedInterfaces[iface.interfaceNumber];
                    const isSelected = selectedInterface === iface.interfaceNumber;
                    return (
                      <div
                        key={iface.interfaceNumber}
                        onClick={() => {
                          listenLoopRef.current = false;
                          setIsListening(false);
                          setSelectedInterface(iface.interfaceNumber);
                          setSelectedEndpoint(iface.endpoints[0] ? endpointKey(iface.endpoints[0]) : null);
                        }}
                        className={`p-2 rounded-lg border cursor-pointer transition-all ${
                          isSelected ? 'bg-slate-900 border-cyan-500/80' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-200">Interface #{iface.interfaceNumber}</span>
                          {isClaimed ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">CLAIMED</span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleClaimInterface(iface.interfaceNumber); }}
                              className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 font-bold transition-colors"
                            >
                              CLAIM
                            </button>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Class <strong className="text-slate-300">{hex2(iface.interfaceClass)}</strong> | <strong className="text-cyan-400">{iface.endpoints.length}</strong> endpoint(s)
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Raw endpoint transmitter & receiver */}
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-bold text-slate-200 text-[11px] flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-amber-400" />
                      RAW ENDPOINT I/O
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <select
                        value={selectedEndpoint || ''}
                        aria-label="Endpoint"
                        onChange={e => {
                          listenLoopRef.current = false;
                          setIsListening(false);
                          setSelectedEndpoint(e.target.value);
                        }}
                        className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-cyber-cyan font-bold"
                      >
                        {currentInterface?.endpoints.map(ep => (
                          <option key={endpointKey(ep)} value={endpointKey(ep)}>
                            {describeEndpointOption(ep)}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={toggleListening}
                        className={`px-2 py-0.5 rounded font-bold transition-all ${
                          isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isListening ? 'STOP LISTENING' : 'LISTEN'}
                      </button>
                    </div>
                  </div>

                  {/* Send payload */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={payloadMode}
                      onChange={e => setPayloadMode(e.target.value)}
                      aria-label="Payload format"
                      className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-200"
                    >
                      <option value="hex">Hex</option>
                      <option value="ascii">Text</option>
                    </select>
                    <input
                      type="text"
                      aria-label="Payload to send"
                      placeholder={payloadMode === 'hex' ? 'Hex bytes (41 54 0D 0A)' : 'Text, escapes \\n \\r \\xNN allowed'}
                      value={outPayload}
                      onChange={e => setOutPayload(e.target.value)}
                      className="flex-1 min-w-[8rem] bg-slate-900 border border-slate-800 rounded px-2 py-1 text-cyber-cyan font-mono text-xs outline-none focus:border-cyan-500"
                    />
                    <select
                      value={payloadEol}
                      onChange={e => setPayloadEol(e.target.value)}
                      aria-label="Line ending appended to the payload"
                      title="Line ending appended after the payload"
                      className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-200"
                    >
                      <option value="none">no EOL</option>
                      <option value="cr">+CR</option>
                      <option value="lf">+LF</option>
                      <option value="crlf">+CRLF</option>
                    </select>
                    <button
                      onClick={handleTransferOut}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors shrink-0"
                    >
                      SEND
                    </button>
                  </div>

                  {/* Inbound log toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
                    <span>{inTransferLog.length} packet(s), {totalBytes(inTransferLog)} B{logPaused ? ' (log paused)' : ''}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { logPausedRef.current = !logPaused; setLogPaused(!logPaused); }}
                        title={logPaused ? 'Resume logging packets' : 'Keep listening but stop adding packets to the log'}
                        aria-label={logPaused ? 'Resume log' : 'Pause log'}
                        className={`p-1 rounded border ${logPaused ? 'border-amber-600 text-amber-300' : 'border-slate-700 text-slate-300'} hover:bg-slate-800`}
                      >{logPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}</button>
                      <button
                        onClick={() => copyText(formatCaptureLog(inTransferLog, currentEndpoint ? describeEndpointOption(currentEndpoint) : ''), 'the capture')}
                        disabled={!inTransferLog.length}
                        title="Copy the capture as text"
                        aria-label="Copy capture"
                        className="p-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                      ><Copy className="w-3 h-3" /></button>
                      <button
                        onClick={() => downloadText(formatCaptureLog(inTransferLog, currentEndpoint ? describeEndpointOption(currentEndpoint) : ''), 'usb-in-capture.txt')}
                        disabled={!inTransferLog.length}
                        title="Download the capture as a .txt file"
                        aria-label="Download capture"
                        className="p-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                      ><Download className="w-3 h-3" /></button>
                      <button
                        onClick={() => setInTransferLog([])}
                        disabled={!inTransferLog.length}
                        title="Clear the log"
                        aria-label="Clear log"
                        className="p-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                      ><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 rounded border border-slate-800/80 p-1.5 max-h-40 overflow-y-auto text-[10px] space-y-0.5">
                    {inTransferLog.length === 0 ? (
                      <span className="text-slate-600">No packets yet. Claim the interface, pick an IN endpoint and press LISTEN.</span>
                    ) : (
                      inTransferLog.map(pkt => (
                        <div key={pkt.id} className="flex items-start gap-1.5 border-b border-slate-800/40 pb-0.5">
                          <span className="text-slate-500 shrink-0">[{pkt.time}]</span>
                          <span className="text-emerald-400 font-bold shrink-0">{pkt.len}B</span>
                          <span className="text-cyan-300 break-all">{pkt.hex}</span>
                          <span className="text-slate-400 break-all">({pkt.ascii})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-slate-500 bg-slate-900/40 rounded-lg border border-slate-800 space-y-1">
              <Usb className="w-6 h-6 mx-auto opacity-30 text-amber-400" />
              <p className="font-bold text-slate-300">No USB device interrogated yet.</p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Plug in a mystery gadget, dongle or microcontroller and press the button above. WebUSB needs Chrome, Edge or Opera; interfaces the OS driver owns may refuse to be claimed.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 2: The Universal Bootloader Forcer */}
      {activeTab === 'forcer' && (
        <div className="space-y-2">
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-cyan-400" />
              HARDWARE KNOCKS & BOOTLOADER TRIGGER SEQUENCES
            </span>
            <p className="text-[11px] text-slate-400">
              Force whatever hardware you plug in to drop out of application runtime and enter its ROM or USB bootloader.
            </p>
          </div>

          <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-2">
            {/* Forcer 1: 1200-Baud CDC Magic Knock */}
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">1200-Baud CDC Knock</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                    RP2040 / ARDUINO
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Opens port at 1200 baud, toggles DTR low, and closes. Triggers Raspberry Pi Pico (BOOTSEL UF2), Arduino Leonardo, and SAMD21 bootloaders.
                </p>
              </div>

              <button
                onClick={handle1200BaudKnock}
                disabled={!isConnected || isExecutingForcer}
                className={`w-full py-1.5 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 text-slate-950 shadow-cyan-glow'
                }`}
              >
                PULSE 1200-BAUD KNOCK
              </button>
            </div>

            {/* Forcer 2: ESP32 Hardware Strapping */}
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">ESP32 Boot Strapping</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                    ESP32 / ESP8266
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Hardware transistor strapping sequence: pulls RST low + GPIO0 low, then releases RST so chip boots into ROM download mode.
                </p>
              </div>

              <button
                onClick={handleEsp32BootStrapping}
                disabled={!isConnected || isExecutingForcer}
                className={`w-full py-1.5 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 shadow-amber-glow'
                }`}
              >
                EXECUTE ESP32 STRAPPING
              </button>
            </div>

            {/* Forcer 3: DFU Detach Knock */}
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">USB DFU Detach Knock</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                    STM32 / NRF52 DFU
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Sends USB DFU class control transfer (Request 0x00) over raw WebUSB to command the runtime firmware to jump into DFU bootloader mode.
                </p>
              </div>

              <button
                onClick={handleDfuDetachKnock}
                disabled={!usbDevice || isExecutingForcer}
                className={`w-full py-1.5 rounded-lg font-bold text-xs transition-all ${
                  !usbDevice 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 text-white shadow-purple-glow'
                }`}
              >
                SEND DFU_DETACH REQUEST
              </button>
            </div>

            {/* Forcer 4: Autoboot Abort Storm (U-Boot) */}
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Autoboot Abort Storm</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold">
                    U-BOOT / ROUTERS
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Sends a continuous 50Hz barrage of Space / Ctrl+C characters during power-cycling to interrupt the countdown and enter the U-Boot console.
                </p>
              </div>

              <button
                onClick={handleAutobootAbortStorm}
                disabled={!isConnected}
                className={`w-full py-1.5 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-rose-600 hover:bg-rose-500 text-white'
                }`}
              >
                FIRE AUTOBOOT ABORT STORM
              </button>
            </div>

            {/* Forcer 5: Reboot Commands Storm */}
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Reboot Strings Storm</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                    LINUX / FASTBOOT / AT
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Sequentially sends standard bootloader drop strings: <code>reboot bootloader</code>, <code>reboot edl</code>, <code>machine.bootloader()</code>, and <code>AT+REBOOT</code>.
                </p>
              </div>

              <button
                onClick={handleRebootStringsStorm}
                disabled={!isConnected}
                className={`w-full py-1.5 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                TRANSMIT REBOOT STRINGS
              </button>
            </div>
          </div>

          {forcerStatus && (
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-[11px] flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{forcerStatus}</span>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 3: Mystery Hardware & Smart Vape Teardown Guide */}
      {activeTab === 'guide' && (
        <div className="space-y-2">
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-1">
            <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-purple-400" />
              HOW TO TALK TO SMART VAPES & MYSTERY USB HARDWARE
            </span>
            <p className="text-[11px] text-slate-400">
              Modern smart disposable vapes (Geek Bar Pulse, Lost Mary MO20000, Spaceman) contain real 32-bit ARM Cortex-M0+ (Puya PY32) or RISC-V (WCH CH32V) microcontrollers. Click each step below to expand teardown instructions:
            </p>
          </div>

          <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
            {/* Step 1: Power & Battery Safety */}
            <div className={`border rounded-lg transition-all overflow-hidden ${
              openGuideSteps.step1 ? 'bg-slate-900 border-rose-500/50' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}>
              <div 
                onClick={() => toggleGuideStep('step1')}
                className="p-2.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4" />
                  <span>STEP 1: LIPO BATTERY CAUTION</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  <span>{openGuideSteps.step1 ? 'HIDE' : 'CLICK TO EXPAND'}</span>
                  {openGuideSteps.step1 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>
              {openGuideSteps.step1 && (
                <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60">
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Smart vapes contain a 3.7V Lithium-Polymer pouch cell (typically 500mAh - 850mAh). Never puncture or short the cell. 
                    When opening the casing, safely desolder the battery negative wire before probing logic lines to prevent accidental shorts.
                  </p>
                </div>
              )}
            </div>

            {/* Step 2: Locating GND & Power Rails */}
            <div className={`border rounded-lg transition-all overflow-hidden ${
              openGuideSteps.step2 ? 'bg-slate-900 border-amber-500/50' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}>
              <div 
                onClick={() => toggleGuideStep('step2')}
                className="p-2.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                  <Zap className="w-4 h-4" />
                  <span>STEP 2: FINDING GND & 3.3V POWER</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  <span>{openGuideSteps.step2 ? 'HIDE' : 'CLICK TO EXPAND'}</span>
                  {openGuideSteps.step2 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>
              {openGuideSteps.step2 && (
                <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60">
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    <strong>GND:</strong> Put your multimeter in continuity mode. The metal shell of the USB-C port is always connected to PCB GND.
                    <br />
                    <strong>VBUS (5V):</strong> Pin A4/B4 on USB-C goes to a LiPo charging chip (TP4056 or LP4056).
                    <br />
                    <strong>3.3V Rail:</strong> The microcontroller runs on 3.3V. Check the output pin of the 3-pin LDO regulator on the board.
                  </p>
                </div>
              )}
            </div>

            {/* Step 3: Finding UART Serial Pads */}
            <div className={`border rounded-lg transition-all overflow-hidden ${
              openGuideSteps.step3 ? 'bg-slate-900 border-cyan-500/50' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}>
              <div 
                onClick={() => toggleGuideStep('step3')}
                className="p-2.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs">
                  <Terminal className="w-4 h-4" />
                  <span>STEP 3: LOCATING UART TX / RX PADS</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  <span>{openGuideSteps.step3 ? 'HIDE' : 'CLICK TO EXPAND'}</span>
                  {openGuideSteps.step3 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>
              {openGuideSteps.step3 && (
                <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60">
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Most smart vape PCBs have 3 to 5 unpopulated gold circular test pads near the microcontroller:
                    <br />
                    • <strong>TX Pin:</strong> Rests at logic high (+3.3V) when idle.
                    <br />
                    • Connect your USB-to-UART bridge GND to vape GND, and RX to the suspected pad.
                    <br />
                    • Common baud rates: <strong>115200 bps</strong> or <strong>9600 bps</strong>.
                  </p>
                </div>
              )}
            </div>

            {/* Step 4: Finding SWD Debug Pads */}
            <div className={`border rounded-lg transition-all overflow-hidden ${
              openGuideSteps.step4 ? 'bg-slate-900 border-purple-500/50' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}>
              <div 
                onClick={() => toggleGuideStep('step4')}
                className="p-2.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2 text-purple-400 font-bold text-xs">
                  <Cpu className="w-4 h-4" />
                  <span>STEP 4: SWD PROGRAMMING (DOOM ON A VAPE)</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  <span>{openGuideSteps.step4 ? 'HIDE' : 'CLICK TO EXPAND'}</span>
                  {openGuideSteps.step4 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>
              {openGuideSteps.step4 && (
                <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60">
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    To dump the flash memory or upload your own game / custom screen animation:
                    <br />
                    • Look for 2 pads labeled <strong>DIO</strong> (SWDIO) and <strong>CLK</strong> (SWCLK).
                    <br />
                    • Puya PY32 chips can be flashed via ST-LINK or an open-source CMSIS-DAP debugger.
                    <br />
                    • WCH CH32V chips use single-wire SDI (WCH-Link).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
