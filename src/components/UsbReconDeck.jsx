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
  ChevronRight
} from 'lucide-react';
import { identifyUsbChip } from '../utils/usbDatabase';

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
  const [inTransferLog, setInTransferLog] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const listenLoopRef = useRef(false);

  // Active Tab: 'interrogate' | 'forcer' | 'guide'
  const [activeTab, setActiveTab] = useState('interrogate');

  // Bootloader forcer running states
  const [forcerStatus, setForcerStatus] = useState('');
  const [isExecutingForcer, setIsExecutingForcer] = useState(false);

  // Request & Interrogate ANY USB Device (Zero filters)
  const handleInterrogateAnyUsb = async () => {
    if (!navigator.usb) {
      alert('WebUSB API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera.');
      return;
    }

    try {
      setForcerStatus('Requesting USB device access from user...');
      // Empty filters array allows selecting ANY connected USB device
      const device = await navigator.usb.requestDevice({ filters: [] });
      await device.open();
      
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
          setSelectedEndpoint(parsedInterfaces[0].endpoints[0].endpointNumber);
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
        usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
        deviceClass: device.deviceClass,
        deviceSubclass: device.deviceSubclass,
        deviceProtocol: device.deviceProtocol,
        intel
      });

      setForcerStatus(`Connected to ${device.productName || 'USB Device'} (VID: 0x${vid.toString(16)} PID: 0x${pid.toString(16)})`);
      onLogMessage?.(`[USB RECON] Interrogated: ${device.productName} [${device.vendorId}:${device.productId}]`, 'sys');
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('USB Interrogation error:', err);
        setForcerStatus(`Interrogation error: ${err.message}`);
        onLogMessage?.(`[USB ERROR] ${err.message}`, 'err');
      }
    }
  };

  // Claim USB Interface
  const handleClaimInterface = async (ifaceNum) => {
    if (!usbDevice) return;
    try {
      await usbDevice.claimInterface(ifaceNum);
      setClaimedInterfaces(prev => ({ ...prev, [ifaceNum]: true }));
      onLogMessage?.(`[USB] Claimed interface #${ifaceNum}`, 'sys');
      setForcerStatus(`Interface #${ifaceNum} claimed successfully`);
    } catch (err) {
      onLogMessage?.(`[USB CLAIM ERROR] ${err.message}`, 'err');
      alert(`Could not claim interface #${ifaceNum}: ${err.message}\nNote: The OS driver or another program might be locking this interface.`);
    }
  };

  // Transfer OUT (Send raw bytes to endpoint)
  const handleTransferOut = async () => {
    if (!usbDevice || selectedEndpoint === null) return;
    try {
      // Parse hex payload string: "41 54 0D 0A" -> Uint8Array
      const hexBytes = outPayload.replace(/[^0-9a-fA-F]/g, '');
      const byteArray = [];
      for (let i = 0; i < hexBytes.length; i += 2) {
        byteArray.push(parseInt(hexBytes.substr(i, 2), 16));
      }
      const data = new Uint8Array(byteArray);

      await usbDevice.transferOut(selectedEndpoint, data);
      onLogMessage?.(`[USB OUT Ep:${selectedEndpoint}] Sent ${data.length} bytes: ${outPayload}`, 'tx');
      setForcerStatus(`Sent ${data.length} bytes to Endpoint ${selectedEndpoint}`);
    } catch (err) {
      onLogMessage?.(`[USB TRANSFER ERROR] ${err.message}`, 'err');
    }
  };

  // Transfer IN Listener Loop
  const toggleListening = async () => {
    if (isListening) {
      listenLoopRef.current = false;
      setIsListening(false);
      return;
    }

    if (!usbDevice || selectedEndpoint === null) return;
    listenLoopRef.current = true;
    setIsListening(true);
    setForcerStatus(`Listening on Endpoint ${selectedEndpoint}...`);

    while (listenLoopRef.current) {
      try {
        const result = await usbDevice.transferIn(selectedEndpoint, 64);
        if (result.data && result.data.byteLength > 0) {
          const bytes = new Uint8Array(result.data.buffer);
          const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          const ascii = new TextDecoder().decode(bytes);
          const time = new Date().toLocaleTimeString();

          setInTransferLog(prev => [
            { id: Date.now() + Math.random(), time, len: bytes.length, hex, ascii },
            ...prev.slice(0, 49)
          ]);
        }
      } catch (err) {
        if (listenLoopRef.current) {
          console.warn('TransferIn loop paused:', err);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
  };

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
      onBaudRateChange?.(115200);

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

  // 3. USB DFU Detach Knock (WebUSB Control Transfer)
  const handleDfuDetachKnock = async () => {
    if (!usbDevice) {
      alert('Please interrogate a WebUSB device first using the "INTERROGATE ANY USB DEVICE" button.');
      return;
    }

    setIsExecutingForcer(true);
    setForcerStatus('Sending USB DFU_DETACH control transfer...');
    onLogMessage?.('[BOOT FORCER] Sending DFU_DETACH request...', 'sys');

    try {
      // DFU_DETACH: bmRequestType: 0x21 (Class, Interface, Host-to-Device), bRequest: 0x00, wValue: 1000ms
      await usbDevice.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x00, // DFU_DETACH
        value: 1000,   // Timeout before returning
        index: selectedInterface || 0
      });
      setForcerStatus('DFU_DETACH request acknowledged! Device should reboot into DFU bootloader.');
      onLogMessage?.('[BOOT FORCER] DFU_DETACH acknowledged by target.', 'sys');
    } catch (err) {
      setForcerStatus(`DFU Detach error: ${err.message}`);
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

  return (
    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-200 text-xs font-mono space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Usb className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="font-bold text-sm text-slate-100 uppercase tracking-wider flex items-center gap-2">
              UNIVERSAL USB RECON // DEVICE AUTOPSY & BOOT FORCER
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                RAW WEBUSB INTERROGATOR
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Interrogate, fingerprint, and talk to any mystery USB device (smart vapes, unknown dongles, toys) or force target chips into bootloader mode.
            </p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('interrogate')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'interrogate' ? 'bg-amber-600 text-white shadow-amber-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DEVICE AUTOPSY
          </button>
          <button
            onClick={() => setActiveTab('forcer')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'forcer' ? 'bg-cyan-600 text-white shadow-cyan-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            BOOTLOADER FORCERS
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'guide' ? 'bg-purple-600 text-white shadow-purple-glow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            VAPE & PCB TEARDOWN
          </button>
        </div>
      </div>

      {/* Main Tab 1: Device Autopsy & Raw WebUSB Interrogation */}
      {activeTab === 'interrogate' && (
        <div className="space-y-4">
          {/* Action Trigger Banner */}
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-bold text-slate-100 text-xs block">
                CONNECT & PROBE ANY PLUGGED-IN USB HARDWARE
              </span>
              <p className="text-[11px] text-slate-400">
                Pypasses COM port restrictions. Works on mystery gadgets, smart vapes, DFU devices, and raw USB controllers.
              </p>
            </div>

            <button
              onClick={handleInterrogateAnyUsb}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold shadow-amber-glow transition-all"
            >
              <Search className="w-4 h-4" />
              <span>INTERROGATE ANY USB DEVICE</span>
            </button>
          </div>

          {deviceInfo ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left Column: Silicon Fingerprint & Descriptors */}
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-amber-400" />
                    SILICON FINGERPRINT
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                    IDENTIFIED
                  </span>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">PRODUCT:</span>
                    <span className="text-sm font-bold text-white font-mono">{deviceInfo.productName}</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">MANUFACTURER:</span>
                    <span className="text-slate-300 font-mono">{deviceInfo.manufacturerName}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-500 block">VENDOR ID (VID)</span>
                      <strong className="text-amber-400 text-xs font-mono">{deviceInfo.vidHex}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">PRODUCT ID (PID)</span>
                      <strong className="text-cyan-400 text-xs font-mono">{deviceInfo.pidHex}</strong>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-900/50 space-y-1">
                    <span className="text-[10px] text-amber-400 uppercase font-bold block">
                      CHIP ANALYSIS:
                    </span>
                    <p className="text-slate-200 font-bold text-[11px]">{deviceInfo.intel.chip}</p>
                    <p className="text-slate-400 text-[10px] leading-relaxed">{deviceInfo.intel.notes}</p>
                    <p className="text-[10px] text-amber-300/80 pt-1">⚡ Operating Logic: {deviceInfo.intel.voltage}</p>
                  </div>
                </div>
              </div>

              {/* Center & Right Column: USB Interfaces & Endpoint Interrogator */}
              <div className="lg:col-span-2 bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    USB INTERFACES & ENDPOINT COMMUNICATOR
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    USB v{deviceInfo.usbVersion} | Serial: {deviceInfo.serialNumber}
                  </span>
                </div>

                {/* Interfaces Table */}
                <div className="space-y-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Enumerated Interfaces:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {interfaces.map(iface => {
                      const isClaimed = !!claimedInterfaces[iface.interfaceNumber];
                      const isSelected = selectedInterface === iface.interfaceNumber;
                      return (
                        <div
                          key={iface.interfaceNumber}
                          onClick={() => setSelectedInterface(iface.interfaceNumber)}
                          className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-slate-900 border-cyan-500/80 shadow-cyan-glow/20' 
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-bold text-slate-200">
                              Interface #{iface.interfaceNumber}
                            </span>
                            {isClaimed ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                                CLAIMED
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleClaimInterface(iface.interfaceNumber);
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 font-bold transition-colors"
                              >
                                CLAIM
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 space-y-0.5">
                            <div>Class: <strong className="text-slate-300">0x{iface.interfaceClass?.toString(16).padStart(2, '0').toUpperCase()}</strong></div>
                            <div>Endpoints: <strong className="text-cyan-400">{iface.endpoints.length} active</strong></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Raw Endpoint Transmitter & Receiver */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <span className="font-bold text-slate-200 text-[11px] flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-amber-400" />
                      RAW ENDPOINT I/O STREAM
                    </span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span>ENDPOINT:</span>
                      <select
                        value={selectedEndpoint || ''}
                        onChange={e => setSelectedEndpoint(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-cyber-cyan font-bold"
                      >
                        {interfaces
                          .find(i => i.interfaceNumber === selectedInterface)
                          ?.endpoints.map(ep => (
                            <option key={ep.endpointNumber} value={ep.endpointNumber}>
                              Ep {ep.endpointNumber} ({ep.direction.toUpperCase()} - {ep.type})
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={toggleListening}
                        className={`px-2.5 py-0.5 rounded font-bold transition-all ${
                          isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isListening ? 'STOP LISTENING' : 'LISTEN'}
                      </button>
                    </div>
                  </div>

                  {/* Send Payload Input */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Hex bytes (e.g. 41 54 0D 0A or 55 AA 01)"
                      value={outPayload}
                      onChange={e => setOutPayload(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-cyber-cyan font-mono text-xs outline-none"
                    />
                    <button
                      onClick={handleTransferOut}
                      className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors shrink-0"
                    >
                      SEND BYTES
                    </button>
                  </div>

                  {/* Inbound packets log */}
                  <div className="bg-slate-900/60 rounded border border-slate-800/80 p-2 max-h-32 overflow-y-auto font-mono text-[10px] space-y-1">
                    {inTransferLog.length === 0 ? (
                      <span className="text-slate-600">No raw packets received yet. Click LISTEN above to read endpoint.</span>
                    ) : (
                      inTransferLog.map(pkt => (
                        <div key={pkt.id} className="flex items-start gap-2 border-b border-slate-800/40 pb-0.5">
                          <span className="text-slate-500">[{pkt.time}]</span>
                          <span className="text-emerald-400 font-bold">{pkt.len}B:</span>
                          <span className="text-cyan-300 truncate">{pkt.hex}</span>
                          <span className="text-slate-400 truncate">({pkt.ascii})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800 space-y-2">
              <Usb className="w-8 h-8 mx-auto opacity-30 text-amber-400 mb-1" />
              <p className="font-bold text-slate-300">No raw USB device interrogated yet.</p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Plug in any USB cable, disposable vape, unknown microcontroller, or peripheral, then click "INTERROGATE ANY USB DEVICE" to inspect its inner silicon.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 2: The Universal Bootloader Forcer */}
      {activeTab === 'forcer' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-cyan-400" />
              HARDWARE KNOCKS & BOOTLOADER TRIGGER SEQUENCES
            </span>
            <p className="text-[11px] text-slate-400">
              Force whatever hardware you plug in to drop out of application runtime and enter its ROM or USB bootloader.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Forcer 1: 1200-Baud CDC Magic Knock */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-3">
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
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 text-slate-950 shadow-cyan-glow'
                }`}
              >
                PULSE 1200-BAUD KNOCK
              </button>
            </div>

            {/* Forcer 2: ESP32 Hardware Strapping */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-3">
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
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-slate-950 shadow-amber-glow'
                }`}
              >
                EXECUTE ESP32 STRAPPING
              </button>
            </div>

            {/* Forcer 3: DFU Detach Knock */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-3">
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
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all ${
                  !usbDevice 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 text-white shadow-purple-glow'
                }`}
              >
                SEND DFU_DETACH REQUEST
              </button>
            </div>

            {/* Forcer 4: Autoboot Abort Storm (U-Boot) */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-3">
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
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all ${
                  !isConnected 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : 'bg-rose-600 hover:bg-rose-500 text-white'
                }`}
              >
                FIRE AUTOBOOT ABORT STORM
              </button>
            </div>

            {/* Forcer 5: Reboot Commands Storm */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between space-y-3">
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
                className={`w-full py-2 rounded-lg font-bold text-xs transition-all ${
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
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-[11px] flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{forcerStatus}</span>
            </div>
          )}
        </div>
      )}

      {/* Main Tab 3: Mystery Hardware & Smart Vape Teardown Guide */}
      {activeTab === 'guide' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-purple-400" />
              HOW TO TALK TO SMART VAPES & MYSTERY USB HARDWARE
            </span>
            <p className="text-[11px] text-slate-400">
              Modern smart disposable vapes (Geek Bar Pulse, Lost Mary MO20000, Spaceman) contain real 32-bit ARM Cortex-M0+ (Puya PY32) or RISC-V (WCH CH32V) microcontrollers. Here is how to reverse engineer and communicate with them:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 1: Power & Battery Safety */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-rose-400 font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>STEP 1: LIPO BATTERY CAUTION</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                Smart vapes contain a 3.7V Lithium-Polymer pouch cell (typically 500mAh - 850mAh). Never puncture or short the cell. 
                When opening the casing, safely desolder the battery negative wire before probing logic lines to prevent accidental shorts.
              </p>
            </div>

            {/* Step 2: Locating GND & Power Rails */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <Zap className="w-4 h-4" />
                <span>STEP 2: FINDING GND & 3.3V POWER</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                <strong>GND:</strong> Put your multimeter in continuity mode. The metal shell of the USB-C port is always connected to PCB GND.
                <br />
                <strong>VBUS (5V):</strong> Pin A4/B4 on USB-C goes to a LiPo charging chip (TP4056 or LP4056).
                <br />
                <strong>3.3V Rail:</strong> The microcontroller runs on 3.3V. Check the output pin of the 3-pin LDO regulator on the board.
              </p>
            </div>

            {/* Step 3: Finding UART Serial Pads */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <Terminal className="w-4 h-4" />
                <span>STEP 3: LOCATING UART TX / RX PADS</span>
              </div>
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

            {/* Step 4: Finding SWD Debug Pads */}
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-purple-400 font-bold">
                <Cpu className="w-4 h-4" />
                <span>STEP 4: SWD PROGRAMMING (DOOM ON A VAPE)</span>
              </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
