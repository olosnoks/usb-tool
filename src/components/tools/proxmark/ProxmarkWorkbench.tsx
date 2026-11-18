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
  Info,
  Calculator,
  Download,
  Copy
} from 'lucide-react';
import OfflineDecoders from './OfflineDecoders';
import { describeOpcode, filterLogs, formatLogsText } from '../../../protocols/pm3';

export default function ProxmarkWorkbench() {
  const [device] = useState(() => new ProxmarkDevice());
  const [deviceState, setDeviceState] = useState<ProxmarkState>('disconnected');
  const [identity, setIdentity] = useState<DeviceFirmwareIdentity | null>(null);
  const [allowOverrides, setAllowOverrides] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'commands' | 'offline' | 'flasher' | 'logs'>('commands');

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

  const [logTypes, setLogTypes] = useState<Set<string>>(() => new Set(['tx', 'rx', 'debug', 'error']));
  const [logQuery, setLogQuery] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const visibleLogs = filterLogs(frameLogs, logTypes, logQuery);

  const exportLogs = () => {
    const blob = new Blob([formatLogsText(visibleLogs) + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxmark-frames-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        `TX -> CMD: 0x${(packet.cmd ?? 0).toString(16).padStart(4, '0')} (${describeOpcode(packet.cmd ?? 0)}) | LEN: ${packet.length ?? 0} | ARG0: 0x${(packet.arg0 ?? 0).toString(16)} | ARG1: 0x${(packet.arg1 ?? 0).toString(16)}`
      );
    });

    const unsubRx = device.on('packetReceived', ({ packet }) => {
      if (packet.cmd !== 0x0105) {
        addLog(
          'rx',
          `RX <- CMD: 0x${(packet.cmd ?? 0).toString(16).padStart(4, '0')} (${describeOpcode(packet.cmd ?? 0)}) | LEN: ${packet.length ?? 0} | ARG0: 0x${(packet.arg0 ?? 0).toString(16)} | ARG1: 0x${(packet.arg1 ?? 0).toString(16)}`
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
        `Command ${commandPayload.actionName} successful! Response Arg0: 0x${(res?.arg0 ?? 0).toString(16)}, Length: ${res?.length ?? 0} bytes`
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
      const isValid = expectedArtifact && expectedArtifact.expectedSha256
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

  const stateBadge =
    deviceState === 'readyMatched'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      : deviceState === 'readyCompatible'
      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
      : deviceState === 'lockedUnsupported'
      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
      : deviceState === 'connecting' || deviceState === 'interrogating'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : 'bg-slate-800/60 text-slate-400 border-slate-700/50';

  const tabBtn = (id: typeof activeTab, label: string, icon?: React.ReactNode, count?: number) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      className={`pb-1.5 font-semibold transition border-b-2 flex items-center gap-1 whitespace-nowrap focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 ${
        activeTab === id
          ? 'border-cyan-500 text-cyan-400'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count ? (
        <span className="px-1.5 rounded-full bg-slate-800 text-[10px] text-slate-300">{count}</span>
      ) : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 text-xs text-slate-200">
      {/* Connection bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span className="text-[11px] text-slate-400 font-mono truncate">Web Serial CDC ACM, NG framing</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 border ${stateBadge}`}>
            <div
              className={`w-1.5 h-1.5 rounded-full ${
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
              className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[11px] font-semibold transition disabled:opacity-50"
            >
              <Usb className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="px-2.5 py-1 bg-slate-800 hover:bg-rose-950/40 hover:text-rose-400 border border-slate-700 text-slate-300 rounded text-[11px] font-semibold transition"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {deviceState === 'lockedUnsupported' && (
        <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2 flex flex-wrap items-center justify-between gap-2 text-rose-200">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-300">
              <b>Firmware unsupported, commands locked.</b> The hardware target or firmware layout does not match the
              client protocol, so all commands are blocked to prevent EEPROM corruption.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('flasher')}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold rounded transition"
          >
            Align firmware
          </button>
        </div>
      )}

      {deviceState === 'readyCompatible' && (
        <div className="bg-cyan-950/40 border border-cyan-800/60 rounded-lg p-2 flex flex-wrap items-center justify-between gap-2 text-cyan-200">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-cyan-400">
              <b className="text-cyan-300">Compatible firmware (restricted mode).</b> Commit hash differs from the
              reference build. Read-only and diagnostic commands are allowed; write, magic and raw transmissions
              need an explicit override.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer bg-slate-900/80 px-2 py-1 rounded border border-cyan-800/50">
              <input
                type="checkbox"
                checked={allowOverrides}
                onChange={handleToggleOverride}
                className="w-3.5 h-3.5 rounded bg-slate-950 border-slate-700"
              />
              <span className="text-[11px] font-mono text-cyan-300">Allow Risk Override</span>
            </label>
            <button onClick={() => setActiveTab('flasher')} className="text-[11px] text-cyan-400 underline hover:text-cyan-300">
              Align firmware
            </button>
          </div>
        </div>
      )}

      {identity && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 grid grid-cols-2 @lg:grid-cols-4 gap-2 text-[11px] font-mono">
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">Hardware Target</span>
            <span className="text-slate-200 font-bold">{identity.hardwareTarget}</span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">Git Commit Hash</span>
            <span className="text-cyan-400 font-semibold">{identity.gitHash.substring(0, 10)}</span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">Cleanliness</span>
            <span className={identity.isClean ? 'text-emerald-400' : 'text-amber-400'}>
              {identity.isClean ? 'Clean Release' : 'Suspect / Dirty'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider text-[10px]">Build Date</span>
            <span className="text-slate-300">{identity.buildDate || 'N/A'}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-4 text-xs overflow-x-auto">
        {tabBtn('commands', 'Commands')}
        {tabBtn('offline', 'Offline decoders', <Calculator className="w-3.5 h-3.5" />)}
        {tabBtn('flasher', 'WebFlash', <HardDrive className="w-3.5 h-3.5" />)}
        {tabBtn('logs', 'Frame log', <Terminal className="w-3.5 h-3.5" />, frameLogs.length)}
      </div>

      {activeTab === 'commands' && (
        <CommandTreeForm device={device} onExecute={handleExecuteCommand} isExecuting={isExecuting} />
      )}

      {activeTab === 'offline' && <OfflineDecoders />}

      {activeTab === 'flasher' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-cyan-400" /><span>WebFlash: target detection, SHA-256 check, fail-closed flashing</span></h3>
          </div>

          {/* Flash Target Selection */}
          <div className="grid grid-cols-1 @lg:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase">
                Flash Hardware Target
              </label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value as FlashTarget)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
              >
                <option value="PM3RDV4">Proxmark3 RDV4</option>
                <option value="PM3GENERIC">Proxmark3 Generic (AT91SAM7S512)</option>
                <option value="PM3ICOPYX">Proxmark3 iCopy-X</option>
                <option value="PM5">Proxmark5 (Cortex-M7 DFU)</option>
              </select>
            </div>
            <div className="@lg:col-span-2 p-2 bg-slate-950/60 border border-slate-800 rounded-lg text-xs">
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
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-slate-300 uppercase tracking-wider">
              Required Firmware Blobs
            </h4>

            {BUILTIN_FLASH_MANIFESTS[selectedTarget]?.artifacts.map((art) => {
              const uploaded = flashArtifacts[art.name];
              return (
                <div
                  key={art.name}
                  className="p-2 bg-slate-950 border border-slate-800 rounded-lg flex flex-col @lg:flex-row @lg:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{art.name}</span>
                      <span className="text-slate-500 font-mono">
                        ({(art.byteSize / 1024).toFixed(1)} KB)
                      </span>
                      {art.targetAddress !== undefined && art.targetAddress !== null && (
                        <span className="text-slate-500 font-mono">
                          @ 0x{(art.targetAddress ?? 0).toString(16)}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-slate-500 truncate max-w-md">
                      Expected SHA-256: {art.expectedSha256 || 'none published yet (flashing disabled)'}
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
            <div className="p-2 bg-cyan-950/40 border border-cyan-800 text-cyan-300 text-xs rounded-lg flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>{flashStatus}</span>
            </div>
          )}

          {flashError && (
            <div className="p-2 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{flashError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handlePrepareFlash}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold transition"
            >
              <Zap className="w-4 h-4" />
              <span>Verify & Flash Firmware</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2 flex flex-col h-80 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-800 mb-2">
            {(['tx', 'rx', 'debug', 'error'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1 cursor-pointer text-slate-400">
                <input
                  type="checkbox"
                  checked={logTypes.has(t)}
                  onChange={() =>
                    setLogTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                  className="w-3 h-3"
                />
                <span className="uppercase">{t}</span>
              </label>
            ))}
            <input
              value={logQuery}
              onChange={(e) => setLogQuery(e.target.value)}
              placeholder="Filter text"
              aria-label="Filter frame log"
              className="flex-1 min-w-[6rem] bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-slate-200 outline-none focus:border-cyan-600"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(formatLogsText(visibleLogs))}
              title="Copy visible log lines"
              aria-label="Copy visible log lines"
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={exportLogs}
              disabled={visibleLogs.length === 0}
              title="Download visible log lines as a .txt file"
              aria-label="Download log"
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setFrameLogs([])} className="text-slate-500 hover:text-slate-300 transition">
              Clear
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {visibleLogs.length === 0 ? (
              <p className="text-slate-600 italic">
                {frameLogs.length === 0
                  ? 'No frames exchanged yet. Connect a device or run commands.'
                  : 'No lines match the filter.'}
              </p>
            ) : (
              visibleLogs.map((log, i) => (
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
                  <span className="text-slate-600 flex-shrink-0">[{log.time}]</span>
                  <span className="break-all">{log.text}</span>
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
