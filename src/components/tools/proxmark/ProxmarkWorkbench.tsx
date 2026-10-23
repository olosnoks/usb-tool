import React, { useState, useEffect, useRef } from 'react';
import {
  ProxmarkDevice,
  DeviceFirmwareIdentity,
  ProxmarkState
} from '../../../devices/proxmark';
import {
  WebFlashService,
  FlashManifest,
  BUILTIN_FLASH_MANIFESTS,
  FlashTarget,
  NotImplementedError
} from '../../../flasher';
import CommandTreeForm from '../../../ui/components/proxmark/CommandTreeForm';
import {
  Radio,
  Usb,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Flame,
  Terminal,
  Layers,
  Cpu,
  RefreshCw,
  Lock,
  Unlock,
  CheckCircle2,
  HardDrive,
  FileCheck,
  Zap,
  Info
} from 'lucide-react';

export default function ProxmarkWorkbench() {
  const [device] = useState(() => new ProxmarkDevice());
  const [deviceState, setDeviceState] = useState<ProxmarkState>('disconnected');
  const [identity, setIdentity] = useState<DeviceFirmwareIdentity | null>(null);
  const [allowOverrides, setAllowOverrides] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'commands' | 'flasher' | 'logs'>('commands');

  // Logs & packet tracing
  const [frameLogs, setFrameLogs] = useState<
    Array<{ type: 'tx' | 'rx' | 'debug' | 'error'; text: string; time: string }>
  >([]);
  const [isExecuting, setIsExecuting] = useState(false);

  // WebFlash state
  const [selectedTarget, setSelectedTarget] = useState<FlashTarget>('PM3RDV4');
  const [flashArtifacts, setFlashArtifacts] = useState<Record<string, { file: File | null; hash: string | null; valid: boolean | null }>>({});
  const [flashStatus, setFlashStatus] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to device events
    const unsubState = device.on('stateChanged', ({ to }) => {
      setDeviceState(to);
      setIdentity(device.identity);
    });

    const unsubDebug = device.on('debugPrint', ({ message }) => {
      addLog('debug', `[PM3 DEBUG] ${message}`);
    });

    const unsubTx = device.on('packetSent', ({ packet }) => {
      addLog(
        'tx',
        `TX -> CMD: 0x${packet.cmd.toString(16).padStart(4, '0')} | LEN: ${packet.length} | ARG0: 0x${packet.arg0.toString(16)} | ARG1: 0x${packet.arg1.toString(16)}`
      );
    });

    const unsubRx = device.on('packetReceived', ({ packet }) => {
      if (packet.cmd !== 0x0105) {
        addLog(
          'rx',
          `RX <- CMD: 0x${packet.cmd.toString(16).padStart(4, '0')} | LEN: ${packet.length} | ARG0: 0x${packet.arg0.toString(16)} | ARG1: 0x${packet.arg1.toString(16)}`
        );
      }
    });

    const unsubError = device.on('error', ({ error }) => {
      addLog('error', `ERROR: ${error.message}`);
    });

    return () => {
      unsubState();
      unsubDebug();
      unsubTx();
      unsubRx();
      unsubError();
      device.disconnect();
    };
  }, [device]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [frameLogs]);

  const addLog = (type: 'tx' | 'rx' | 'debug' | 'error', text: string) => {
    const time = new Date().toLocaleTimeString();
    setFrameLogs((prev) => [...prev.slice(-150), { type, text, time }]);
  };

  const handleConnect = async () => {
    try {
      setFlashError(null);
      addLog('debug', 'Requesting Web Serial port (CDC ACM 0x9ac4:0x4b8f)...');
      await device.connect();
      addLog('debug', 'Handshake completed. Firmware identity interrogated.');
    } catch (err: any) {
      addLog('error', `Connection failed: ${err.message}`);
    }
  };

  const handleDisconnect = async () => {
    await device.disconnect('User manual disconnect');
    addLog('debug', 'Device disconnected.');
  };

  const handleToggleOverride = (e: React.ChangeEvent<HTMLInputElement>) => {
    const allow = e.target.checked;
    setAllowOverrides(allow);
    device.allowRiskOverrides = allow;
    addLog(
      'debug',
      allow
        ? 'WARNING: Command risk override enabled. High-risk write/magic frames authorized.'
        : 'Command risk override disabled.'
    );
  };

  const handleExecuteCommand = async (commandPayload: any) => {
    setIsExecuting(true);
    try {
      const res = await device.executeCommand(commandPayload);
      addLog(
        'rx',
        `Command ${commandPayload.actionName} successful! Response Arg0: 0x${res.arg0.toString(16)}, Length: ${res.length} bytes`
      );
    } catch (err: any) {
      addLog('error', `Command failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // WebFlash file selection & SHA-256 verification
  const handleFileSelect = async (artifactName: string, file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const calculatedHash = await WebFlashService.calculateSha256(buffer);

      const manifest = BUILTIN_FLASH_MANIFESTS[selectedTarget];
      const expectedArtifact = manifest.artifacts.find((a) => a.name === artifactName);
      const isValid = expectedArtifact
        ? expectedArtifact.expectedSha256.toLowerCase() === calculatedHash.toLowerCase()
        : false;

      setFlashArtifacts((prev) => ({
        ...prev,
        [artifactName]: { file, hash: calculatedHash, valid: isValid }
      }));
    } catch (err: any) {
      setFlashError(`Failed to process artifact ${artifactName}: ${err.message}`);
    }
  };

  const handlePrepareFlash = async () => {
    setFlashError(null);
    setFlashStatus('Validating firmware blobs against manifest...');
    try {
      const manifest = BUILTIN_FLASH_MANIFESTS[selectedTarget];
      const artifactBlobs: Record<string, Uint8Array> = {};

      for (const expected of manifest.artifacts) {
        const item = flashArtifacts[expected.name];
        if (!item || !item.file) {
          throw new Error(`Artifact "${expected.name}" is missing`);
        }
        const buf = await item.file.arrayBuffer();
        artifactBlobs[expected.name] = new Uint8Array(buf);
      }

      const session = await WebFlashService.prepareFlashSession({
        target: selectedTarget,
        artifactBlobs
      });

      setFlashStatus('Firmware integrity verified. Ready for flash session.');

      // Test execution (triggers fail-closed safety guard)
      await WebFlashService.executeFlashSession(session);
    } catch (err: any) {
      if (err instanceof NotImplementedError) {
        setFlashStatus(null);
        setFlashError(
          `[FAIL-CLOSED SAFETY GUARD ACTIVATED]: ${err.message}`
        );
      } else {
        setFlashStatus(null);
        setFlashError(err.message);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#020617] text-slate-200 overflow-y-auto p-4 md:p-6 space-y-5">
      {/* 1. Header & Hardware Connection Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-950/50">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>Proxmark3 / Proxmark5 Workbench</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                Web Serial CDC ACM
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Low-frequency & high-frequency RFID/NFC security toolkit with Little-Endian NG protocol framing
            </p>
          </div>
        </div>

        {/* Connection Action & State Badge */}
        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border ${
              deviceState === 'readyMatched'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : deviceState === 'readyCompatible'
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                : deviceState === 'lockedUnsupported'
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                : deviceState === 'connecting' || deviceState === 'interrogating'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/50'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                deviceState === 'readyMatched'
                  ? 'bg-emerald-400 animate-pulse'
                  : deviceState === 'readyCompatible'
                  ? 'bg-cyan-400'
                  : deviceState === 'lockedUnsupported'
                  ? 'bg-rose-400'
                  : deviceState === 'connecting' || deviceState === 'interrogating'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-slate-600'
              }`}
            />
            <span className="capitalize">{deviceState.replace(/([A-Z])/g, ' $1')}</span>
          </div>

          {!device.isConnected ? (
            <button
              onClick={handleConnect}
              disabled={deviceState === 'connecting' || deviceState === 'interrogating'}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition shadow-lg shadow-cyan-600/20"
            >
              <Usb className="w-4 h-4" />
              <span>Connect Proxmark</span>
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-800/50 border border-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition"
            >
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Tri-State Guard Banners */}
      {deviceState === 'lockedUnsupported' && (
        <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-rose-200 shadow-lg">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-rose-400 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-rose-300">
                Firmware Unsupported — Command Execution Locked
              </h4>
              <p className="text-xs text-rose-400 mt-0.5">
                The connected hardware target or firmware layout does not match the client protocol specifications.
                All operational commands are locked to prevent EEPROM corruption. Align your firmware using WebFlash.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('flasher')}
            className="flex-shrink-0 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition shadow-md"
          >
            Align Firmware via WebFlash
          </button>
        </div>
      )}

      {deviceState === 'readyCompatible' && (
        <div className="bg-cyan-950/40 border border-cyan-800/60 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-cyan-200 shadow-lg">
          <div className="flex items-center gap-3">
            <Info className="w-6 h-6 text-cyan-400 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-cyan-300">
                Compatible Firmware Detected (Restricted Mode)
              </h4>
              <p className="text-xs text-cyan-400 mt-0.5">
                Recognized Proxmark target, but commit hash differs from reference build. Read-only and diagnostic
                commands are allowed. Write, magic, and raw transmissions require an explicit override.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer bg-slate-900/80 px-3 py-1.5 rounded-lg border border-cyan-800/50">
              <input
                type="checkbox"
                checked={allowOverrides}
                onChange={handleToggleOverride}
                className="w-4 h-4 text-cyan-500 rounded bg-slate-950 border-slate-700"
              />
              <span className="text-xs font-mono text-cyan-300">Allow Risk Override</span>
            </label>
            <button
              onClick={() => setActiveTab('flasher')}
              className="text-xs text-cyan-400 underline hover:text-cyan-300"
            >
              Align Firmware
            </button>
          </div>
        </div>
      )}

      {/* 3. Device Identity Card */}
      {identity && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">
              Hardware Target
            </span>
            <span className="text-slate-200 font-bold">{identity.hardwareTarget}</span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">
              Git Commit Hash
            </span>
            <span className="text-cyan-400 font-semibold">{identity.gitHash.substring(0, 10)}</span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">
              Cleanliness
            </span>
            <span className={identity.isClean ? 'text-emerald-400' : 'text-amber-400'}>
              {identity.isClean ? 'Clean Release' : 'Suspect / Dirty'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">
              Build Date
            </span>
            <span className="text-slate-300">{identity.buildDate || 'N/A'}</span>
          </div>
        </div>
      )}

      {/* 4. Tab Navigation */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm">
        <button
          onClick={() => setActiveTab('commands')}
          className={`pb-3 font-semibold transition border-b-2 ${
            activeTab === 'commands'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Cascading Commands
        </button>
        <button
          onClick={() => setActiveTab('flasher')}
          className={`pb-3 font-semibold transition border-b-2 flex items-center gap-1.5 ${
            activeTab === 'flasher'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>WebFlash Alignment</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`pb-3 font-semibold transition border-b-2 flex items-center gap-1.5 ${
            activeTab === 'logs'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Frame Inspector & Debug</span>
          {frameLogs.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
              {frameLogs.length}
            </span>
          )}
        </button>
      </div>

      {/* 5. Active Tab Contents */}
      {activeTab === 'commands' && (
        <CommandTreeForm
          device={device}
          onExecute={handleExecuteCommand}
          isExecuting={isExecuting}
        />
      )}

      {activeTab === 'flasher' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5 shadow-xl">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-cyan-400" />
              <span>Safe WebFlash Scaffold</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Target detection, in-browser cryptographic SHA-256 verification, and fail-closed bootloader flashing
            </p>
          </div>

          {/* Flash Target Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase">
                Flash Hardware Target
              </label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value as FlashTarget)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
              >
                <option value="PM3RDV4">Proxmark3 RDV4</option>
                <option value="PM3GENERIC">Proxmark3 Generic (AT91SAM7S512)</option>
                <option value="PM3ICOPYX">Proxmark3 iCopy-X</option>
                <option value="PM5">Proxmark5 (Cortex-M7 DFU)</option>
              </select>
            </div>
            <div className="md:col-span-2 p-3 bg-slate-950/60 border border-slate-800 rounded-lg text-xs">
              <span className="text-slate-400 font-medium block mb-1">Target Manifest Info:</span>
              <p className="text-slate-300">
                {BUILTIN_FLASH_MANIFESTS[selectedTarget]?.notes || 'No notes available'}
              </p>
              <div className="flex gap-4 mt-2 font-mono text-[11px] text-cyan-400">
                <span>Version: {BUILTIN_FLASH_MANIFESTS[selectedTarget]?.version}</span>
                <span>Transport: {BUILTIN_FLASH_MANIFESTS[selectedTarget]?.requiredTransport}</span>
              </div>
            </div>
          </div>

          {/* Artifact Upload & Hash Verification */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-slate-300 uppercase tracking-wider">
              Required Firmware Blobs
            </h4>

            {BUILTIN_FLASH_MANIFESTS[selectedTarget]?.artifacts.map((art) => {
              const uploaded = flashArtifacts[art.name];
              return (
                <div
                  key={art.name}
                  className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{art.name}</span>
                      <span className="text-slate-500 font-mono">
                        ({(art.byteSize / 1024).toFixed(1)} KB)
                      </span>
                      {art.targetAddress !== undefined && (
                        <span className="text-slate-500 font-mono">
                          @ 0x{art.targetAddress.toString(16)}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-slate-500 truncate max-w-md">
                      Expected SHA-256: {art.expectedSha256}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {uploaded?.valid === true && (
                      <span className="flex items-center gap-1 text-emerald-400 font-mono">
                        <CheckCircle2 className="w-4 h-4" /> Hash Verified
                      </span>
                    )}
                    {uploaded?.valid === false && (
                      <span className="flex items-center gap-1 text-rose-400 font-mono">
                        <AlertTriangle className="w-4 h-4" /> Hash Mismatch
                      </span>
                    )}

                    <input
                      type="file"
                      id={`file-${art.name}`}
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileSelect(art.name, e.target.files[0]);
                        }
                      }}
                    />
                    <label
                      htmlFor={`file-${art.name}`}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer transition"
                    >
                      {uploaded?.file ? 'Replace File' : 'Select Binary'}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Flash Feedback & Fail-Closed Alerts */}
          {flashStatus && (
            <div className="p-3 bg-cyan-950/40 border border-cyan-800 text-cyan-300 text-xs rounded-lg flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>{flashStatus}</span>
            </div>
          )}

          {flashError && (
            <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{flashError}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handlePrepareFlash}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-semibold transition shadow-lg shadow-amber-600/20"
            >
              <Zap className="w-4 h-4" />
              <span>Verify & Flash Firmware</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col h-96 shadow-xl font-mono text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <span className="text-slate-400 font-semibold">Live Traffic & Isolated Debug Messages</span>
            <button
              onClick={() => setFrameLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition"
            >
              Clear Logs
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-2">
            {frameLogs.length === 0 ? (
              <p className="text-slate-600 italic">No frames exchanged yet. Connect device or run commands.</p>
            ) : (
              frameLogs.map((log, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${
                    log.type === 'tx'
                      ? 'text-cyan-400'
                      : log.type === 'rx'
                      ? 'text-emerald-400'
                      : log.type === 'debug'
                      ? 'text-purple-400'
                      : 'text-rose-400'
                  }`}
                >
                  <span className="text-slate-600">[{log.time}]</span>
                  <span>{log.text}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
