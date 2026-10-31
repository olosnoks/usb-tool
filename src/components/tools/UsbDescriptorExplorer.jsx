import React, { useState, useEffect, useCallback } from 'react';
import {
  Usb,
  Search,
  Copy,
  Check,
  ShieldAlert,
  Cpu,
  Sparkles,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine
} from 'lucide-react';
import {
  describeDevice,
  toTextReport,
  requestAnyUsbDevice,
  listGrantedUsbDevices
} from '../../utils/usbDescriptors';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

// An illustrative device (a composite CDC + MSC dongle) for exploring the view
// without hardware. Clearly labeled as an example, not a live read.
const EXAMPLE_DEVICE = {
  vendorId: 0x0483, productId: 0x5740,
  deviceClass: 0xef, deviceSubclass: 0x02, deviceProtocol: 0x01,
  usbVersionMajor: 2, usbVersionMinor: 0, usbVersionSubminor: 0,
  deviceVersionMajor: 2, deviceVersionMinor: 0, deviceVersionSubminor: 0,
  manufacturerName: 'STMicroelectronics', productName: 'Composite Demo', serialNumber: '00EXAMPLE',
  configurations: [{
    configurationValue: 1, configurationName: 'Composite',
    interfaces: [
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x02, interfaceSubclass: 0x02, interfaceProtocol: 0x01, interfaceName: 'CDC Control', endpoints: [{ endpointNumber: 3, direction: 'in', type: 'interrupt', packetSize: 8 }] }] },
      { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 0x0a, interfaceSubclass: 0, interfaceProtocol: 0, interfaceName: 'CDC Data', endpoints: [
        { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 64 }
      ] }] },
      { interfaceNumber: 2, alternates: [{ alternateSetting: 0, interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50, interfaceName: 'Mass Storage', endpoints: [
        { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }
      ] }] }
    ]
  }]
};

export default function UsbDescriptorExplorer() {
  const [info, setInfo] = useState(null);
  const [isExample, setIsExample] = useState(false);
  const [granted, setGranted] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const refreshGranted = useCallback(async () => {
    setGranted(await listGrantedUsbDevices());
  }, []);

  useEffect(() => { refreshGranted(); }, [refreshGranted]);

  const inspect = async (device) => {
    setError('');
    try {
      setInfo(describeDevice(device));
      setIsExample(false);
    } catch (err) {
      setError(err.message);
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

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(toTextReport(info));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* clipboard may be blocked */ }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {isExample && <DemoBanner>Example device: this is an illustrative descriptor set, not a device read from your machine.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Usb className="w-4 h-4 text-cyan-400" />
              <span>USB DESCRIPTOR EXPLORER</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              A WebUSB "lsusb -v": pick any USB device and read its configurations, interfaces, endpoints and
              string descriptors, with class / subclass / protocol codes decoded. Read-only — it never sends data to the device.
            </p>
          </div>
          <StatusBadge status={info && !isExample ? 'online' : 'offline'} label="USB" value={info && !isExample ? 'Inspected' : 'Idle'} />
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

        <div className="pt-3 flex flex-wrap items-center gap-2">
          <button onClick={pickDevice} disabled={!webUsbAvailable} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold disabled:opacity-40">
            <Search className="w-3.5 h-3.5" /> INSPECT A USB DEVICE
          </button>
          <button onClick={() => { setInfo(describeDevice(EXAMPLE_DEVICE)); setIsExample(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" /> EXAMPLE
          </button>
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
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-400" /> {info.vendorIdHex}:{info.productIdHex}</span>
              <button onClick={copyReport} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy report'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          </div>

          {info.configurations.map((cfg) => (
            <div key={cfg.value} className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
              <span className="font-bold text-slate-200">Configuration {cfg.value}{cfg.name ? ` — ${cfg.name}` : ''}</span>
              {cfg.interfaces.map((iface) => (
                <div key={iface.number} className="pl-2 border-l-2 border-slate-800 space-y-1">
                  {iface.alternates.map((alt) => (
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
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
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
