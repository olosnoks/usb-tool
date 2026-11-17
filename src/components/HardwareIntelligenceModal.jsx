import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  ExternalLink, 
  ShieldCheck, 
  Zap, 
  Sliders, 
  X,
  Layers,
  Info,
  Copy,
  Check
} from 'lucide-react';
import { USB_CHIP_DATABASE, identifyUsbChip, identifyUsbDevice } from '../utils/usbDatabase';
import { parseVidPid, formatVidPid, searchIds, lookupClass, usbIdsVersion } from '../utils/usbIds';

const hex4 = (n) => Number(n).toString(16).padStart(4, '0');
const CLASS_QUERY = /^class\s+([0-9a-f]{2})(?:[:\s/]+([0-9a-f]{2}))?(?:[:\s/]+([0-9a-f]{2}))?$/i;

/** udev rule that gives the logged-in user access to a device (lsusb-style ids). */
export function udevRule(vid, pid) {
  return `SUBSYSTEM=="usb", ATTRS{idVendor}=="${hex4(vid)}", ATTRS{idProduct}=="${hex4(pid)}", MODE="0660", TAG+="uaccess"`;
}

/** Windows hardware id, as shown in Device Manager. */
export function hardwareId(vid, pid) {
  return `USB\\VID_${hex4(vid).toUpperCase()}&PID_${hex4(pid).toUpperCase()}`;
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch (e) { /* clipboard blocked */ }
      }}
      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:border-cyan-500/40 text-[10px]"
    >
      {done ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />} {done ? 'Copied' : label}
    </button>
  );
}

export default function HardwareIntelligenceModal({
  isOpen,
  onClose,
  portInfo
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChipKey, setSelectedChipKey] = useState(null);
  const [idsInfo, setIdsInfo] = useState(null);      // usb.ids version, once the chunk has loaded
  const [idsError, setIdsError] = useState('');
  const [typed, setTyped] = useState(null);          // merged result for a typed VID:PID
  const [classResult, setClassResult] = useState(null);
  const [idsHits, setIdsHits] = useState([]);        // usb.ids name-search hits
  const [activeMerged, setActiveMerged] = useState(null);

  const vendorId = portInfo?.usbVendorId;
  const productId = portInfo?.usbProductId;

  // The usb.ids chunk is only fetched once the modal is first opened.
  useEffect(() => {
    if (!isOpen) return undefined;
    let live = true;
    usbIdsVersion().then((v) => { if (live) setIdsInfo(v); }).catch((e) => { if (live) setIdsError(e.message || 'usb.ids failed to load'); });
    return () => { live = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || vendorId == null) { setActiveMerged(null); return undefined; }
    let live = true;
    identifyUsbDevice(vendorId, productId).then((r) => { if (live) setActiveMerged(r); });
    return () => { live = false; };
  }, [isOpen, vendorId, productId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let live = true;
    const q = searchQuery.trim();
    setTyped(null); setClassResult(null);
    if (!q) { setIdsHits([]); return undefined; }
    (async () => {
      try {
        const cm = CLASS_QUERY.exec(q);
        if (cm) {
          const parts = [cm[1], cm[2], cm[3]].filter(Boolean).map((x) => parseInt(x, 16));
          const r = await lookupClass(parts[0], parts[1] ?? null, parts[2] ?? null);
          if (live) { setClassResult({ parts, r }); setIdsHits([]); }
          return;
        }
        const id = parseVidPid(q);
        if (id && id.pid != null) {
          const r = await identifyUsbDevice(id.vid, id.pid);
          if (live) setTyped({ vid: id.vid, pid: id.pid, r });
        }
        const hits = await searchIds(q, 40);
        if (live) setIdsHits(hits);
      } catch (e) { if (live) setIdsError(e.message || 'usb.ids lookup failed'); }
    })();
    return () => { live = false; };
  }, [isOpen, searchQuery]);

  if (!isOpen) return null;

  // Active connected board's chip (curated + usb.ids once merged). A PID of 0x0000 is valid.
  const activeChip = activeMerged || identifyUsbChip(vendorId, productId);
  const activeVidPid = vendorId != null && productId != null
    ? `${hex4(vendorId)}:${hex4(productId)}`
    : null;

  // Search across all database entries
  const allEntries = Object.entries(USB_CHIP_DATABASE).map(([vidPid, data]) => ({
    vidPid,
    ...data
  }));

  const filteredEntries = searchQuery.trim()
    ? allEntries.filter(e => 
        e.vidPid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.chip.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.manufacturer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.notes.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEntries;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono">
      <div 
        className="bg-[#030712] border border-cyan-500/40 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-cyber-cyan" />
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-wider">
                HARDWARE INTELLIGENCE // USB CHIP & VID:PID SPECIFICATIONS
              </h2>
              <span className="text-[11px] text-slate-500">
                Operating voltages, DTR/RTS strapping behaviors, driver latency quirks & pinout specs
              </span>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Active Connected Chip Banner */}
          {activeVidPid && (
            <div className="bg-[#090e1a] border border-cyan-500/50 rounded-xl p-4 shadow-cyan-glow flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-cyber-cyan font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyber-emerald animate-ping" />
                  CURRENTLY CONNECTED USB HARDWARE [VID:PID {activeVidPid.toUpperCase()}]
                </span>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyber-cyan text-[10px] font-bold border border-cyan-500/40">
                  {activeChip.manufacturer}
                </span>
              </div>

              <div className="text-sm font-bold text-slate-100">
                {activeChip.chip}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                    Operating Logic Voltage
                  </span>
                  <span className="text-cyber-amber font-semibold text-xs">
                    {activeChip.voltage}
                  </span>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                    Auto-Reset / Strapping
                  </span>
                  <span className="text-cyber-emerald font-semibold text-xs">
                    {activeChip.autoReset}
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                  Hardware Engineer Notes & Driver Quirks
                </span>
                {activeChip.notes}
              </div>
            </div>
          )}

          {/* Search Chip Catalog */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-cyber-cyan" />
                USB UART CHIP DATABASE ({allEntries.length} Supported ICs)
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="VID:PID (1d6b:0002, 0x10C4, ID 10c4:ea60), chip or vendor name (CP2102, ftdi, ch340), or class 02:02:01..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Typed VID:PID result (curated + usb.ids) */}
          {typed && <TypedResult vid={typed.vid} pid={typed.pid} r={typed.r} />}

          {classResult && (
            <div className="bg-[#090e1a] border border-cyan-500/40 rounded-xl p-3 text-xs text-slate-300">
              <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                USB class {classResult.parts.map((c) => c.toString(16).padStart(2, '0')).join(':')}
              </span>
              {classResult.r
                ? [classResult.r.class, classResult.r.subclass, classResult.r.protocol].filter(Boolean).join(' / ')
                : 'Not in usb.ids.'}
            </div>
          )}

          {idsError && <div className="text-[11px] text-rose-300">usb.ids: {idsError}</div>}

          {idsHits.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold">usb.ids matches ({idsHits.length}{idsHits.length >= 40 ? '+' : ''})</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {idsHits.map((h) => (
                  <button
                    key={`${h.vid}:${h.pid ?? 'v'}`}
                    onClick={() => setSearchQuery(h.pid != null ? formatVidPid(h.vid, h.pid) : formatVidPid(h.vid))}
                    className="text-left bg-slate-950 border border-slate-800 hover:border-cyan-500/40 rounded-lg px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="text-cyber-cyan font-bold">{formatVidPid(h.vid, h.pid).toUpperCase()}</span>{' '}
                    <span className="text-slate-300">{h.kind === 'product' ? `${h.vendor} ${h.name}` : `${h.vendor} (vendor)`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Catalog Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {filteredEntries.map(entry => (
              <div 
                key={entry.vidPid}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col justify-between gap-2 transition-colors text-xs"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono text-cyber-cyan font-bold">
                      VID:PID {entry.vidPid.toUpperCase()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {entry.manufacturer}
                    </span>
                  </div>
                  <div className="font-bold text-slate-200 text-xs mb-1">
                    {entry.chip}
                  </div>
                  <div className="text-[11px] text-cyber-amber mb-1">
                    ⚡ {entry.voltage}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    {entry.notes}
                  </p>
                </div>

                <div className="pt-1 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Auto-Reset: {entry.autoReset}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950 text-xs">
          <div className="flex items-center gap-2 text-slate-500 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-cyber-emerald" />
            <span>
              Always check VCCIO voltage jumper before wiring 3.3V microcontrollers to prevent silicon damage.
              {idsInfo && <> Names: usb.ids {idsInfo.version} (BSD-3-Clause).</>}
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

function TypedResult({ vid, pid, r }) {
  const id = formatVidPid(vid, pid).toUpperCase();
  const vendorHex = hex4(vid).toUpperCase();
  const pidHex = hex4(pid).toUpperCase();
  return (
    <div className="bg-[#090e1a] border border-cyan-500/50 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] text-cyber-cyan font-bold uppercase tracking-wider">LOOKUP [VID:PID {id}]</span>
        <span className="text-[10px] text-slate-500">{r.curated ? 'curated entry + usb.ids' : r.vendorName ? 'usb.ids only' : 'not found'}</span>
      </div>
      <div className="text-sm font-bold text-slate-100">
        {r.vendorName ? `${r.vendorName}${r.productName ? ` / ${r.productName}` : ' / (product not listed)'}` : 'Unknown vendor'}
      </div>
      {r.curated && <div className="text-xs text-slate-300">{r.chip}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">Operating Logic Voltage</span>
          <span className="text-cyber-amber font-semibold">{r.voltage}</span>
        </div>
        <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">Auto-Reset / Strapping</span>
          <span className="text-cyber-emerald font-semibold">{r.autoReset}</span>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 leading-tight">{r.notes}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <CopyBtn text={formatVidPid(vid, pid)} label="Copy VID:PID" />
        <CopyBtn text={hardwareId(vid, pid)} label="Copy hardware ID" />
        <CopyBtn text={udevRule(vid, pid)} label="Copy udev rule" />
        <a href={`https://devicehunt.com/view/type/usb/vendor/${vendorHex}/device/${pidHex}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-cyan-300 hover:underline">
          <ExternalLink className="w-3 h-3" /> Device Hunt
        </a>
        <a href={`https://www.the-sz.com/products/usbid/index.php?v=${vendorHex}&p=${pidHex}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-cyan-300 hover:underline">
          <ExternalLink className="w-3 h-3" /> the-sz.com
        </a>
      </div>
    </div>
  );
}
