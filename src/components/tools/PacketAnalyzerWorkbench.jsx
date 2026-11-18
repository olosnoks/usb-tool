import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Activity, 
  Layers, 
  Search, 
  Upload, 
  Download, 
  Trash2, 
  Radio, 
  AlertTriangle,
  Sparkles,
  Copy
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { readPcapFile } from '../../utils/pcapReader';
import { tryCompileFilter, FILTER_FIELDS, protocolStats, accessPoints, findHandshakes, hexDump } from '../../utils/packetAnalysis';
import { recordToFrame, serialToFrame, framesToCsv, framesToPcap } from '../../utils/packetFrames';

const MAX_ROWS = 1000;
const LIVE_WINDOW_MS = 5000;

// Built-in SAMPLE frames (not captured from anything). Only shown after the user clicks "Load demo frames".
const SAMPLE_FRAMES = [
  {
    id: 1,
    time: '00:00:01.120',
    protocol: '802.11 Beacon',
    source: 'E0:E1:A9:44:B2:10',
    dest: 'FF:FF:FF:FF:FF:FF',
    bssid: 'E0:E1:A9:44:B2:10',
    channel: 6,
    rssi: -52,
    ssid: 'Home_IoT_Secure',
    type: 'Management',
    subtype: 'Beacon',
    length: 128,
    hex: '80 00 00 00 ff ff ff ff ff ff e0 e1 a9 44 b2 10 e0 e1 a9 44 b2 10 30 14 00 00 00 00 64 00 11 04 00 0f 48 6f 6d 65 5f 49 6f 54 5f 53 65 63 75 72 65 01 08 82 84 8b 96 0c 12 18 24 03 01 06'
  },
  {
    id: 2,
    time: '00:00:01.340',
    protocol: '802.11 Probe Req',
    source: '1A:B2:3C:D4:E5:F6',
    dest: 'FF:FF:FF:FF:FF:FF',
    bssid: 'FF:FF:FF:FF:FF:FF',
    channel: 6,
    rssi: -68,
    ssid: 'Broadcast (Wildcard)',
    type: 'Management',
    subtype: 'Probe Request',
    length: 56,
    hex: '40 00 00 00 ff ff ff ff ff ff 1a b2 3c d4 e5 f6 ff ff ff ff ff ff 40 22 00 00 01 08 82 84 8b 96 24 30 48 6c 32 04 0c 12 18 60'
  },
  {
    id: 3,
    time: '00:00:01.890',
    protocol: 'EAPOL 4-Way #1',
    source: 'E0:E1:A9:44:B2:10',
    dest: '3C:71:BF:88:99:AA',
    bssid: 'E0:E1:A9:44:B2:10',
    channel: 6,
    rssi: -54,
    ssid: 'Home_IoT_Secure',
    type: 'Data',
    subtype: 'EAPOL Key',
    length: 121,
    hex: '08 02 00 00 3c 71 bf 88 99 aa e0 e1 a9 44 b2 10 e0 e1 a9 44 b2 10 70 33 aa aa 03 00 00 00 88 8e 01 03 00 5f 02 00 8a 00 10 00 00 00 00 00 00 00 01'
  },
  {
    id: 4,
    time: '00:00:02.150',
    protocol: 'NMEA 0183 (GPS)',
    source: 'u-blox NEO-M8N',
    dest: 'Serial Host',
    bssid: 'N/A',
    channel: 0,
    rssi: 0,
    ssid: '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230324,003.1,W*6A',
    type: 'Serial NMEA',
    subtype: 'Recommended Min',
    length: 68,
    hex: '24 47 50 52 4d 43 2c 31 32 33 35 31 39 2c 41 2c 34 38 30 37 2e 30 33 38 2c 4e 2c 30 31 31 33 31 2e 30 30 30 2c 45 2c 30 32 32 2e 34 2c 30 38 34 2e 34 2c 32 33 30 33 32 34 2c 30 30 33 2e 31 2c 57 2a 36 41 0d 0a'
  },
  {
    id: 5,
    time: '00:00:02.410',
    protocol: 'Modbus RTU',
    source: 'Slave #1',
    dest: 'Master Host',
    bssid: 'N/A',
    channel: 0,
    rssi: 0,
    ssid: 'Read Holding Registers (0x03)',
    type: 'Industrial PDU',
    subtype: 'Response',
    length: 7,
    hex: '01 03 02 00 64 b8 45'
  }
];

const DEMO_FRAMES = SAMPLE_FRAMES.map((f) => ({ ...f, origin: 'demo', demo: true }));

function downloadBlob(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PacketAnalyzerWorkbench() {
  const { isConnected, hexByteStream } = useSerial();
  const [frames, setFrames] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [followSerial, setFollowSerial] = useState(false);
  const [lastRxAt, setLastRxAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const nextOffset = useRef(0);
  const pending = useRef([]);
  const nextId = useRef(1);
  const serialT0 = useRef(0);
  const streamRef = useRef(hexByteStream);
  streamRef.current = hexByteStream;

  const isDemo = frames.some((f) => f.demo);
  const isLive = followSerial && isConnected && lastRxAt > 0 && now - lastRxAt < LIVE_WINDOW_MS;

  const filter = useMemo(() => tryCompileFilter(searchQuery), [searchQuery]);
  const filteredFrames = useMemo(
    () => frames.filter((f) => filter.test(f) && (filterType === 'ALL' || f.type.toLowerCase().includes(filterType.toLowerCase()))),
    [frames, filter, filterType]
  );
  const stats = useMemo(() => protocolStats(filteredFrames), [filteredFrames]);
  const aps = useMemo(() => accessPoints(frames), [frames]);
  const handshakes = useMemo(() => findHandshakes(frames), [frames]);
  const visibleFrames = filteredFrames.slice(0, MAX_ROWS);

  // Re-evaluate the LIVE window while following.
  useEffect(() => {
    if (!followSerial) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [followSerial]);

  // Ingest serial bytes only while "Follow serial stream" is on; split into lines.
  useEffect(() => {
    if (!followSerial || !isConnected) return;
    const fresh = hexByteStream.filter((h) => h.offset >= nextOffset.current);
    if (!fresh.length) return;
    nextOffset.current = fresh[fresh.length - 1].offset + 1;
    const t = Date.now();
    const lines = [];
    for (const h of fresh) {
      pending.current.push(h.byte);
      if (h.byte === 0x0a || pending.current.length >= 512) {
        lines.push(Uint8Array.from(pending.current));
        pending.current = [];
      }
    }
    setLastRxAt(t);
    setNow(t);
    if (lines.length) {
      if (!serialT0.current) serialT0.current = t;
      setFrames((prev) => [...prev, ...lines.map((l) => serialToFrame(l, nextId.current++, t, serialT0.current))]);
    }
  }, [hexByteStream, followSerial, isConnected]);

  const dropDemo = (list) => list.filter((f) => !f.demo);

  const toggleFollow = (on) => {
    if (on) {
      const s = streamRef.current;
      nextOffset.current = s.length ? s[s.length - 1].offset + 1 : 0; // do not ingest the backlog
      pending.current = [];
      serialT0.current = 0;
      setLastRxAt(0);
      setFrames(dropDemo);
    }
    setFollowSerial(on);
  };

  const clearFrames = () => {
    setFrames([]);
    setSelectedFrame(null);
    setError(null);
  };

  const loadSamples = () => {
    setFrames(DEMO_FRAMES);
    setSelectedFrame(DEMO_FRAMES[0]);
    setError(null);
  };

  const handleOpen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { packetRecords } = await readPcapFile(file);
      const t0 = packetRecords[0]?.timestamp.timeMs ?? 0;
      const list = packetRecords.map((r, i) => recordToFrame(r, i + 1, t0));
      nextId.current = list.length + 1;
      serialT0.current = 0;
      setFrames(list);
      setSelectedFrame(null);
      setError(null);
    } catch (err) {
      setError(`Could not open ${file.name}: ${err.message}`);
    }
  };

  const exportCsv = () => downloadBlob('skons_packet_capture.csv', framesToCsv(filteredFrames), 'text/csv');
  const exportPcap = () => {
    const { bytes, count } = framesToPcap(filteredFrames);
    if (count) downloadBlob('skons_packet_capture.pcap', bytes, 'application/vnd.tcpdump.pcap');
  };
  const pcapCount = filteredFrames.filter((f) => f.origin === 'pcap').length;
  const copyHexDump = async () => {
    if (!selectedFrame) return;
    try {
      await navigator.clipboard.writeText(hexDump(selectedFrame.hex));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard is not available in this browser context.');
    }
  };

  const btn = 'px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-lg text-[11px] transition flex items-center gap-1 disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2 font-mono">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className={`${btn} cursor-pointer`} title="Open a radiotap .pcap or .cap file">
          <Upload className="w-3.5 h-3.5" />
          <span>Open capture</span>
          <input type="file" accept=".pcap,.cap" onChange={handleOpen} className="hidden" aria-label="Open capture" />
        </label>
        <button onClick={clearFrames} className={btn} title="Clear all frames">
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Clear</span>
        </button>
        <button onClick={loadSamples} className={btn} title="Load built-in sample frames (not a real capture)">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Load demo frames</span>
        </button>
        <button onClick={exportCsv} disabled={!filteredFrames.length} className={btn} title="Export the frames matching the filter as CSV">
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
        <button onClick={exportPcap} disabled={!pcapCount} className={btn} title="Export the captured frames matching the filter as .pcap">
          <Download className="w-3.5 h-3.5" />
          <span>Export .pcap</span>
        </button>
        <label className="flex items-center gap-1 cursor-pointer text-[11px] text-slate-300 ml-auto">
          <input type="checkbox" checked={followSerial} onChange={(e) => toggleFollow(e.target.checked)} />
          <span>Follow serial stream</span>
        </label>
      </div>
      {error && <p role="alert" className="text-[11px] text-rose-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {/* Filter and metrics bar */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 flex flex-wrap items-center gap-2 text-[11px]">
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            aria-label="Display filter"
            aria-invalid={!!filter.error}
            title={`Display filter. Free text, or field op value joined by && and ||. Fields: ${FILTER_FIELDS.join(', ')}. Ops: == != ~ < > <= >=`}
            placeholder="Filter: text, or type==Data && rssi>-70 || ssid~cafe"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full bg-[#12141a] border rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-400 font-mono transition ${filter.error ? 'border-rose-500/60' : 'border-[#282d3a]'}`}
          />
        </div>
        <div className="flex items-center gap-1">
          {['ALL', 'Management', 'Data', 'Serial'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2 py-0.5 rounded-md text-[11px] transition ${
                filterType === type
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold'
                  : 'bg-[#1e212b] text-slate-400 hover:text-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span>Frames: <strong className="text-purple-300">{filteredFrames.length}</strong></span>
          {isDemo && <strong className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">DEMO DATA</strong>}
          <span>Status: <strong className={isLive ? 'text-emerald-400' : 'text-slate-500'}>{isLive ? 'LIVE' : 'IDLE'}</strong></span>
        </div>
      </div>
      {filter.error && <p role="alert" className="text-[11px] text-rose-400">Filter: {filter.error}</p>}

      {/* Capture summary: protocol breakdown, access points, EAPOL handshakes */}
      {frames.length > 0 && (
        <details className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 text-[11px]">
          <summary className="cursor-pointer text-slate-300 font-bold select-none">
            Capture summary
            <span className="font-normal text-slate-500">
              {' '}({stats.total} frames, {stats.bytes} bytes{stats.durationMs ? `, ${(stats.durationMs / 1000).toFixed(2)} s` : ''}
              {aps.length ? `, ${aps.length} AP${aps.length === 1 ? '' : 's'}` : ''}
              {handshakes.length ? `, ${handshakes.length} handshake${handshakes.length === 1 ? '' : 's'}` : ''})
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 @lg:grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Protocols (filtered)</div>
              <table className="w-full text-left">
                <tbody>
                  {stats.rows.slice(0, 8).map((r) => (
                    <tr key={r.protocol} className="text-slate-300">
                      <td className="pr-2 truncate max-w-[9rem]">{r.protocol}</td>
                      <td className="pr-2 text-right">{r.count}</td>
                      <td className="text-right text-slate-500">{r.pct.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Access points (beacons / probe responses)</div>
              {aps.length === 0 ? <div className="text-slate-500">None in this capture.</div> : (
                <table className="w-full text-left">
                  <tbody>
                    {aps.slice(0, 8).map((a) => (
                      <tr key={a.bssid} className="text-slate-300">
                        <td className="pr-2 truncate max-w-[7rem]" title={a.ssid}>{a.ssid || '(hidden)'}</td>
                        <td className="pr-2">{a.bssid}</td>
                        <td className="pr-2 text-right">ch {a.channel || '?'}</td>
                        <td className="text-right text-slate-500">{a.bestRssi ? `${a.bestRssi} dBm` : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">EAPOL 4-way handshakes</div>
              {handshakes.length === 0 ? <div className="text-slate-500">None seen.</div> : (
                <ul className="space-y-1">
                  {handshakes.map((h) => (
                    <li key={`${h.bssid}${h.station}`} className="text-slate-300">
                      <button
                        className="text-left hover:text-purple-300"
                        title="Select the first message of this handshake"
                        onClick={() => setSelectedFrame(frames.find((f) => f.id === h.frameIds[0]) || null)}
                      >
                        {h.ssid || h.bssid} / {h.station}
                      </button>
                      <span className={h.complete ? 'text-emerald-400' : h.pairable ? 'text-amber-300' : 'text-slate-500'}>
                        {' '}M{h.messages.join(',M')} {h.complete ? 'complete' : h.pairable ? 'partial (2 consecutive)' : 'incomplete'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </details>
      )}

      {/* Main grid: packet list and inspector */}
      <div className="grid grid-cols-1 @lg:grid-cols-12 gap-2">
        <div className="@lg:col-span-7 bg-[#171920] border border-[#2b303c] rounded-xl p-2 flex flex-col gap-1.5 max-h-[420px] overflow-hidden">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Packet capture stream</span>
          </span>
          <div className="overflow-x-auto overflow-y-auto flex-1 scrollbar-none border border-[#232733] rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#12141a] text-slate-400 text-[10px] uppercase font-bold sticky top-0 z-10 border-b border-[#232733]">
                <tr>
                  <th className="py-1 px-2">Time</th>
                  <th className="py-1 px-2">Protocol</th>
                  <th className="py-1 px-2">Source</th>
                  <th className="py-1 px-2">Destination / SSID</th>
                  <th className="py-1 px-2 text-right">RSSI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e212b]">
                {visibleFrames.map((f) => {
                  const isSelected = selectedFrame?.id === f.id;
                  return (
                    <tr
                      key={f.id}
                      onClick={() => setSelectedFrame(f)}
                      className={`cursor-pointer transition ${isSelected ? 'bg-purple-500/20 text-purple-200 font-bold' : 'hover:bg-[#1e212b] text-slate-300'}`}
                    >
                      <td className="py-1 px-2 text-slate-400 font-mono text-[11px] whitespace-nowrap">{f.time}</td>
                      <td className="py-1 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${
                          f.protocol.includes('Beacon') ? 'bg-cyan-500/20 text-cyan-300' :
                          f.protocol.includes('EAPOL') ? 'bg-amber-500/20 text-amber-300' :
                          f.protocol.includes('NMEA') ? 'bg-emerald-500/20 text-emerald-300' :
                          'bg-purple-500/20 text-purple-300'
                        }`}>
                          {f.protocol}
                        </span>
                      </td>
                      <td className="py-1 px-2 font-mono text-[11px] truncate max-w-[130px]">{f.source}</td>
                      <td className="py-1 px-2 font-mono text-[11px] truncate max-w-[150px]">{f.ssid || f.dest}</td>
                      <td className="py-1 px-2 text-right font-mono text-[11px]">{f.rssi !== 0 ? `${f.rssi} dBm` : '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {frames.length === 0 && (
              <div className="py-8 text-center text-slate-500 text-xs px-2">
                No frames loaded. Open a radiotap .pcap, follow a serial stream, or load demo frames.
              </div>
            )}
            {frames.length > 0 && filteredFrames.length === 0 && (
              <div className="py-6 text-center text-slate-500 text-xs">No frames match the filter.</div>
            )}
            {filteredFrames.length > MAX_ROWS && (
              <div className="py-1.5 text-center text-amber-400 text-[11px]">Showing first {MAX_ROWS} of {filteredFrames.length} frames. Use the filter to narrow down.</div>
            )}
          </div>
        </div>

        <div className="@lg:col-span-5 bg-[#171920] border border-[#2b303c] rounded-xl p-2 flex flex-col gap-1.5 max-h-[420px] overflow-hidden">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-purple-400" />
            <span>Frame details & hex inspector</span>
          </span>

          {selectedFrame ? (
            <div className="space-y-2 overflow-y-auto pr-1 scrollbar-none flex-1">
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="p-2 bg-[#12141a] rounded-lg border border-[#232733]">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Frame type</span>
                  <div className="text-purple-300 font-bold truncate">{selectedFrame.protocol}</div>
                </div>
                <div className="p-2 bg-[#12141a] rounded-lg border border-[#232733]">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Channel / freq</span>
                  <div className="text-slate-200 font-bold">
                    {selectedFrame.channel ? `Ch ${selectedFrame.channel} (${selectedFrame.channel > 14 ? '5' : '2.4'} GHz)` : selectedFrame.type === 'Serial' ? 'Serial UART' : 'n/a'}
                  </div>
                </div>
              </div>

              <div className="p-2 bg-[#12141a] rounded-lg border border-[#232733] space-y-1 text-[11px] font-mono">
                {[
                  ['Source Address:', selectedFrame.source],
                  ['Destination:', selectedFrame.dest],
                  ['Type / Subtype:', `${selectedFrame.type} / ${selectedFrame.subtype}`],
                  ...(selectedFrame.addr1 ? [['Addr1 (RA/DA):', selectedFrame.addr1], ['Addr2 (TA/SA):', selectedFrame.addr2], ['Addr3:', selectedFrame.addr3]] : []),
                  ...(selectedFrame.ssid && selectedFrame.type !== 'Serial' ? [['SSID / Info:', selectedFrame.ssid]] : []),
                  ...(selectedFrame.bssid !== 'N/A' ? [['BSSID:', selectedFrame.bssid]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 text-slate-400">
                    <span>{k}</span>
                    <span className="text-slate-200 font-bold text-right break-all">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between text-slate-400">
                  <span>Payload Length:</span>
                  <span className="text-amber-400 font-bold">{selectedFrame.length} bytes</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Raw frame hex dump</span>
                  <button onClick={copyHexDump} className={btn} title="Copy as offset / hex / ASCII dump">
                    <Copy className="w-3 h-3" />
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-2 bg-[#0d0f14] rounded-lg border border-[#232733] text-[10.5px] text-purple-300 leading-snug font-mono overflow-x-auto select-all">
                  {hexDump(selectedFrame.hex)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-slate-500 text-xs">
              Select a packet from the stream to inspect headers and bytes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
