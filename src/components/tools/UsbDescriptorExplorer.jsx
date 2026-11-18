import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Copy,
  Check,
  ShieldAlert,
  Cpu,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  RefreshCw
} from 'lucide-react';
import {
  describeDevice,
  toTextReport,
  requestAnyUsbDevice,
  listGrantedUsbDevices,
  fetchRawDescriptors,
  toLsusbText,
  hexDump,
  toHex
} from '../../utils/usbDescriptors';
import StatusBadge from '../common/StatusBadge';

import { useSessionError } from '../../utils/sessionLog';

// usb.ids is optional: names appear when the lazy chunk loads, and are simply
// absent if it does not.
async function lookupNames(vid, pid) {
  try {
    const { lookupProduct } = await import('../../utils/usbIds');
    const r = await lookupProduct(vid, pid);
    return r ? { vendor: r.vendor, product: r.product } : null;
  } catch (e) {
    return null;
  }
}

const hex = (n, w = 2) => `0x${Number(n).toString(16).padStart(w, '0')}`;

export default function UsbDescriptorExplorer() {
  const [info, setInfo] = useState(null);
  const [raw, setRaw] = useState(null);
  const [names, setNames] = useState(null);
  const [granted, setGranted] = useState([]);
  const [error, setError] = useSessionError('USB Descriptors');
  const [copied, setCopied] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const deviceRef = useRef(null);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const refreshGranted = useCallback(async () => {
    setGranted(await listGrantedUsbDevices());
  }, []);

  useEffect(() => { refreshGranted(); }, [refreshGranted]);

  // Hotplug: keep the "previously allowed" list fresh and notice when the
  // inspected device is unplugged (its descriptors on screen stay readable).
  useEffect(() => {
    if (!webUsbAvailable) return undefined;
    const onConnect = () => { refreshGranted(); };
    const onDisconnect = (e) => {
      refreshGranted();
      if (deviceRef.current && e.device === deviceRef.current) setConnected(false);
    };
    navigator.usb.addEventListener('connect', onConnect);
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => {
      navigator.usb.removeEventListener('connect', onConnect);
      navigator.usb.removeEventListener('disconnect', onDisconnect);
    };
  }, [webUsbAvailable, refreshGranted]);

  const inspect = async (device) => {
    setError('');
    setRaw(null);
    setNames(null);
    deviceRef.current = device;
    try {
      setInfo(describeDevice(device));
      setConnected(true);
      setLoading(true);
      lookupNames(device.vendorId, device.productId).then((n) => {
        if (deviceRef.current === device) setNames(n);
      });
      // Read-only: standard GET_DESCRIPTOR control reads. Opens the device if
      // needed so string descriptors can be read, then closes it again.
      const r = await fetchRawDescriptors(device);
      if (deviceRef.current === device) setRaw(r);
      // After open() Chrome refreshes the cached strings; describe again.
      if (deviceRef.current === device) setInfo(describeDevice(device));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pickDevice = async () => {
    setError('');
    try {
      const device = await requestAnyUsbDevice();
      await refreshGranted();
      await inspect(device);
    } catch (err) {
      if (!/No device selected|cancel/i.test(err.message)) setError(err.message);
    }
  };

  const flash = (what) => { setCopied(what); setTimeout(() => setCopied(''), 1500); };

  const copyReport = async () => {
    try {
      const text = raw && raw.device && raw.device.vendorId != null
        ? toLsusbText(raw, names || {})
        : toTextReport(info);
      await navigator.clipboard.writeText(text);
      flash('report');
    } catch (e) { /* clipboard may be blocked */ }
  };

  const exportJson = () => {
    const blob = {
      tool: 'skons-usb-tool descriptor explorer',
      exportedAt: new Date().toISOString(),
      names,
      summary: info,
      raw: raw && {
        deviceHex: raw.deviceBytes ? toHex(raw.deviceBytes) : null,
        device: raw.device,
        qualifier: raw.qualifier && { hex: toHex(raw.qualifier.bytes), parsed: raw.qualifier.parsed },
        configurations: raw.configs.map((c) => ({ index: c.index, hex: toHex(c.bytes), parsed: c.parsed })),
        bos: raw.bos && { hex: toHex(raw.bos.bytes), parsed: raw.bos.parsed },
        strings: raw.strings,
        notes: raw.notes
      }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `usb-descriptors-${info ? `${info.vendorIdHex}-${info.productIdHex}` : 'device'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const strOf = (idx) => {
    if (!idx || !raw) return null;
    for (const m of Object.values(raw.strings)) if (m[idx] != null) return m[idx];
    return null;
  };

  const rawConfigFor = (value) => raw?.configs.find((c) => c.parsed.configurationValue === value);

  const badge = info
    ? (connected ? { status: 'online', value: 'Inspected' } : { status: 'warning', value: 'Disconnected' })
    : { status: 'offline', value: 'Idle' };

  return (
    <div className="space-y-2 font-mono text-xs">

      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div>
            <details className="text-[11px] text-slate-400 max-w-3xl">
              <summary className="cursor-pointer hover:text-slate-200">WebUSB "lsusb -v" (read-only)</summary>
              <p className="mt-1">
                Pick any USB device and read its raw device, configuration, BOS and string descriptors, with
                class / subclass / protocol codes and class-specific descriptors decoded. It only issues standard
                GET_DESCRIPTOR reads and never writes to the device.
              </p>
            </details>
          </div>
          <StatusBadge status={badge.status} label="USB" value={badge.value} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {info && !connected && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> This device was unplugged. The descriptors below are what was read before it disconnected.
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          <button onClick={pickDevice} disabled={!webUsbAvailable} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold disabled:opacity-40">
            <Search className="w-3.5 h-3.5" /> INSPECT A USB DEVICE
          </button>
          {info && connected && (
            <button onClick={() => inspect(deviceRef.current)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-read
            </button>
          )}
        </div>

        {granted.length > 0 && (
          <div className="pt-3">
            <span className="text-[11px] text-slate-500">Previously allowed devices:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {granted.map((d, i) => (
                <button key={i} onClick={() => inspect(d)} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:border-cyan-500/40">
                  {d.productName || `${d.vendorId?.toString(16).padStart(4, '0')}:${d.productId?.toString(16).padStart(4, '0')}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {info && (
        <>
          <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" /> {info.vendorIdHex}:{info.productIdHex}
                {names && <span className="text-slate-500 font-normal">{[names.vendor, names.product].filter(Boolean).join(' / ')} (usb.ids)</span>}
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={copyReport} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  {copied === 'report' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {copied === 'report' ? 'Copied' : 'Copy as lsusb -v'}
                </button>
                <button onClick={exportJson} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  <Download className="w-3.5 h-3.5" /> JSON
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 @sm:grid-cols-4 gap-3">
              <Field label="Manufacturer" value={info.manufacturerName} />
              <Field label="Product" value={info.productName} />
              <Field label="Serial" value={info.serialNumber} />
              <Field label="USB version" value={info.usbVersion} />
              <Field label="Device class" value={`${info.className}`} />
              <Field label="Device version" value={info.deviceVersion} />
              <Field label="Configurations" value={String(info.configurationCount)} />
              <Field label="Endpoints" value={String(info.highlights.endpointCount)} />
            </div>
            {info.highlights.interfaceClasses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {info.highlights.interfaceClasses.map((c) => (
                  <span key={c} className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">{c}</span>
                ))}
              </div>
            )}
            {loading && <div className="text-[11px] text-slate-500">Reading raw descriptors...</div>}
            {raw && raw.notes.length > 0 && (
              <ul className="text-[11px] text-amber-300/90 space-y-0.5 list-disc pl-4">
                {raw.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>

          {raw?.deviceBytes && (
            <Section title="Device descriptor (raw)">
              <HexBlock bytes={raw.deviceBytes} />
              {raw.qualifier && (
                <>
                  <div className="text-slate-400 pt-1">Device qualifier: USB {raw.qualifier.parsed.usbVersion}, class {raw.qualifier.parsed.class}, {raw.qualifier.parsed.numConfigurations} other-speed configuration(s)</div>
                  <HexBlock bytes={raw.qualifier.bytes} />
                </>
              )}
            </Section>
          )}

          {info.configurations.map((cfg) => {
            const rc = rawConfigFor(cfg.value);
            const p = rc?.parsed;
            return (
              <div key={cfg.value} className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 shadow-xl space-y-2">
                <span className="font-bold text-slate-200">Configuration {cfg.value}{cfg.name ? ` — ${cfg.name}` : ''}</span>
                {p && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <Chip>{p.maxPowerMa} mA max</Chip>
                    <Chip>{p.selfPowered ? 'Self powered' : 'Bus powered'}</Chip>
                    {p.remoteWakeup && <Chip>Remote wakeup</Chip>}
                    <Chip>wTotalLength {p.totalLength}</Chip>
                    {strOf(p.iConfiguration) && <Chip>"{strOf(p.iConfiguration)}"</Chip>}
                  </div>
                )}
                {p && p.iads.map((ia) => (
                  <div key={ia.offset} className="text-[11px] text-violet-300">
                    Interface association: interfaces {ia.firstInterface}..{ia.firstInterface + ia.interfaceCount - 1} - {ia.detail}{strOf(ia.iFunction) ? ` "${strOf(ia.iFunction)}"` : ''}
                  </div>
                ))}
                {cfg.interfaces.map((iface) => (
                  <div key={iface.number} className="pl-2 border-l-2 border-slate-800 space-y-1">
                    {iface.alternates.map((alt) => {
                      const rawAlt = p?.interfaces.find((i) => i.number === iface.number)?.alternates.find((a) => a.setting === alt.setting);
                      return (
                        <div key={alt.setting} className="space-y-1">
                          <div className="flex items-center gap-2 text-slate-300">
                            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                            <span className="font-bold">Interface {iface.number}{alt.setting ? `.${alt.setting}` : ''}</span>
                            <span className="text-cyan-300">{alt.detail}</span>
                            {alt.name && <span className="text-slate-500">"{alt.name}"</span>}
                            <span className="text-[10px] text-slate-600">[{alt.class}/{alt.subclass}/{alt.protocol}]</span>
                          </div>
                          <div className="pl-6 flex flex-wrap gap-2">
                            {alt.endpoints.length === 0 && <span className="text-slate-600 text-[11px]">No endpoints (control only)</span>}
                            {alt.endpoints.map((ep) => (
                              <span key={ep.address} className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
                                {ep.direction === 'IN' ? <ArrowUpFromLine className="w-3 h-3 text-emerald-400" /> : <ArrowDownToLine className="w-3 h-3 text-amber-400" />}
                                {ep.address} {ep.type} {ep.packetSize}B
                              </span>
                            ))}
                          </div>
                          {rawAlt && rawAlt.classSpecific.length > 0 && (
                            <div className="pl-6 space-y-0.5">
                              {rawAlt.classSpecific.map((cs) => (
                                <div key={cs.offset} className="text-[11px] text-slate-400">
                                  <span className="text-amber-300">{cs.name}</span>{' '}
                                  <span className="text-slate-500">{csSummary(cs)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {rawAlt && rawAlt.endpoints.some((e) => e.companion) && (
                            <div className="pl-6 text-[11px] text-slate-500">
                              {rawAlt.endpoints.filter((e) => e.companion).map((e) => `${e.address}: SS companion burst ${e.companion.maxBurst}`).join('; ')}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {p && p.notes.length > 0 && (
                  <ul className="text-[11px] text-amber-300/90 space-y-0.5 list-disc pl-4">
                    {p.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                {rc && <HexBlock bytes={rc.bytes} label={`Raw configuration ${cfg.value} (${rc.bytes.length} bytes)`} />}
              </div>
            );
          })}

          {raw?.bos && (
            <Section title={`BOS descriptor (${raw.bos.parsed.capabilities.length} capabilities)`}>
              {raw.bos.parsed.capabilities.map((cap) => (
                <div key={cap.offset} className="text-[11px] text-slate-300">
                  <span className="font-bold text-cyan-300">{cap.name}</span>{' '}
                  <span className="text-slate-500">{capSummary(cap)}</span>
                </div>
              ))}
              {raw.bos.parsed.notes.length > 0 && (
                <ul className="text-[11px] text-amber-300/90 list-disc pl-4">
                  {raw.bos.parsed.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
              <HexBlock bytes={raw.bos.bytes} />
            </Section>
          )}

          {raw && Object.keys(raw.strings).length > 0 && (
            <Section title="String descriptors">
              {Object.entries(raw.strings).map(([lang, map]) => (
                <div key={lang} className="text-[11px] text-slate-300">
                  <span className="text-slate-500">LANGID {hex(lang, 4)}:</span>{' '}
                  {Object.entries(map).map(([idx, s]) => <span key={idx} className="mr-3">[{idx}] "{s}"</span>)}
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function csSummary(cs) {
  const bits = [];
  if (cs.reportDescriptorLength != null) bits.push(`report descriptor ${cs.reportDescriptorLength} bytes`);
  if (cs.bcdHID) bits.push(`HID ${cs.bcdHID}`);
  if (cs.bcdCDC) bits.push(`CDC ${cs.bcdCDC}`);
  if (cs.dataInterface != null) bits.push(`data interface ${cs.dataInterface}`);
  if (cs.controlInterface != null) bits.push(`control ${cs.controlInterface} -> [${cs.subordinateInterfaces.join(', ')}]`);
  if (cs.kind === 'cdc' && cs.subtype === 2) bits.push(`${cs.lineCoding ? 'line coding' : ''}${cs.sendBreak ? ' send-break' : ''}`.trim());
  if (cs.kind === 'dfu') bits.push(`${cs.canDownload ? 'download ' : ''}${cs.canUpload ? 'upload ' : ''}${cs.willDetach ? 'will-detach ' : ''}xfer ${cs.transferSize}`.trim());
  if (cs.bcdUVC) bits.push(`UVC ${cs.bcdUVC}`);
  if (cs.bcdADC) bits.push(`ADC ${cs.bcdADC}`);
  if (cs.kind === 'hub') bits.push(`${cs.numPorts} ports`);
  return bits.filter(Boolean).join(', ');
}

function capSummary(cap) {
  if (cap.platform === 'WebUSB') return `v${cap.version}, vendor code ${hex(cap.vendorCode)}, landing page index ${cap.landingPageIndex}${cap.landingPageIndex === 0 ? ' (none)' : ''} (URL needs a vendor request, not read)`;
  if (cap.platform === 'Microsoft OS 2.0') return `Windows ${hex(cap.windowsVersion, 8)}, descriptor set ${cap.descriptorSetTotalLength} bytes, vendor code ${hex(cap.vendorCode)} (set not read)`;
  if (cap.speeds) return `speeds ${cap.speeds.join('/')}, U1 ${cap.u1ExitLatency}us, U2 ${cap.u2ExitLatency}us`;
  if (cap.lpm != null) return cap.lpm ? 'LPM supported' : 'LPM not supported';
  if (cap.containerId) return cap.containerId;
  if (cap.uuid) return `platform ${cap.uuid}`;
  return '';
}

function Section({ title, children }) {
  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 shadow-xl space-y-2">
      <span className="font-bold text-slate-200">{title}</span>
      {children}
    </div>
  );
}

function Chip({ children }) {
  return <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{children}</span>;
}

function HexBlock({ bytes, label }) {
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-300">{label || `Hex dump (${bytes.length} bytes)`}</summary>
      <pre className="mt-1 p-2 rounded bg-slate-950 border border-slate-800 text-slate-300 overflow-x-auto whitespace-pre">{hexDump(bytes)}</pre>
    </details>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-slate-200 font-semibold break-all">{value ?? '—'}</span>
    </div>
  );
}
