import React, { useState, useMemo } from 'react';
import { 
  Activity, 
  Layers, 
  Search, 
  Upload, 
  Download, 
  Play, 
  Square, 
  Filter, 
  Trash2, 
  Radio, 
  Wifi, 
  Compass, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle,
  Info,
  Sparkles
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';

// Sample captured 802.11 & Serial frames for demonstration & offline analysis
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

export default function PacketAnalyzerWorkbench() {
  const { isConnected, hexByteStream } = useSerial();
  const [frames, setFrames] = useState(SAMPLE_FRAMES);
  const [selectedFrame, setSelectedFrame] = useState(SAMPLE_FRAMES[0]);
  const [filterType, setFilterType] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSniffing, setIsSniffing] = useState(true);

  const filteredFrames = useMemo(() => {
    return frames.filter(f => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || 
        f.protocol.toLowerCase().includes(q) ||
        f.source.toLowerCase().includes(q) ||
        f.dest.toLowerCase().includes(q) ||
        f.ssid.toLowerCase().includes(q);

      const matchesType = filterType === 'ALL' || f.type.toLowerCase().includes(filterType.toLowerCase());
      return matchesSearch && matchesType;
    });
  }, [frames, searchQuery, filterType]);

  const clearFrames = () => {
    setFrames([]);
    setSelectedFrame(null);
  };

  const loadSamples = () => {
    setFrames(SAMPLE_FRAMES);
    setSelectedFrame(SAMPLE_FRAMES[0]);
  };

  const exportPcapJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(frames, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "skons_packet_capture.json");
    dlAnchor.click();
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Top Header Card */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>HARDWARE & WIRELESS PACKET ANALYZER</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">Wi-Fi & Serial PCAP</span>
            </h2>
            <p className="text-xs text-slate-400">
              Inspect 802.11 management frames, EAPOL handshakes, NMEA sentences, and binary serial packets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearFrames}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Clear</span>
          </button>
          <button
            onClick={loadSamples}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs transition flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Samples</span>
          </button>
          <button
            onClick={exportPcapJson}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs transition flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Capture</span>
          </button>
        </div>
      </div>

      {/* Filter and Metrics Bar */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter by MAC, SSID, protocol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-400 font-mono transition"
            />
          </div>

          <div className="flex items-center gap-1">
            {['ALL', 'Management', 'Data', 'Serial'].map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2.5 py-1 rounded-lg text-xs transition ${
                  filterType === type 
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold' 
                    : 'bg-[#1e212b] text-slate-400 hover:text-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span>Frames: <strong className="text-purple-300">{filteredFrames.length}</strong></span>
          <span>Status: <strong className="text-emerald-400">{isConnected ? 'LIVE MONITORING' : 'IDLE'}</strong></span>
        </div>
      </div>

      {/* Main Grid: Packet Stream List (Top) & Packet Hex/Detail Inspector (Bottom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Packet Stream Table (7 cols) */}
        <div className="lg:col-span-7 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[600px] overflow-hidden">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>PACKET CAPTURE STREAM</span>
          </span>

          <div className="overflow-x-auto overflow-y-auto flex-1 scrollbar-none border border-[#232733] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#12141a] text-slate-400 text-[10px] uppercase font-bold sticky top-0 z-10 border-b border-[#232733]">
                <tr>
                  <th className="py-2 px-2.5">Time</th>
                  <th className="py-2 px-2.5">Protocol</th>
                  <th className="py-2 px-2.5">Source</th>
                  <th className="py-2 px-2.5">Destination / SSID</th>
                  <th className="py-2 px-2.5 text-right">RSSI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e212b]">
                {filteredFrames.map(f => {
                  const isSelected = selectedFrame?.id === f.id;
                  return (
                    <tr
                      key={f.id}
                      onClick={() => setSelectedFrame(f)}
                      className={`cursor-pointer transition ${
                        isSelected 
                          ? 'bg-purple-500/20 text-purple-200 font-bold' 
                          : 'hover:bg-[#1e212b] text-slate-300'
                      }`}
                    >
                      <td className="py-2 px-2.5 text-slate-400 font-mono text-[11px] whitespace-nowrap">{f.time}</td>
                      <td className="py-2 px-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          f.protocol.includes('Beacon') ? 'bg-cyan-500/20 text-cyan-300' :
                          f.protocol.includes('EAPOL') ? 'bg-amber-500/20 text-amber-300' :
                          f.protocol.includes('NMEA') ? 'bg-emerald-500/20 text-emerald-300' :
                          'bg-purple-500/20 text-purple-300'
                        }`}>
                          {f.protocol}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 font-mono text-[11px] truncate max-w-[130px]">{f.source}</td>
                      <td className="py-2 px-2.5 font-mono text-[11px] truncate max-w-[150px]">{f.ssid || f.dest}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-[11px]">
                        {f.rssi !== 0 ? `${f.rssi} dBm` : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Packet Inspector (5 cols) */}
        <div className="lg:col-span-5 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[600px] overflow-hidden">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-purple-400" />
            <span>FRAME DETAILS & HEX INSPECTOR</span>
          </span>

          {selectedFrame ? (
            <div className="space-y-3 overflow-y-auto pr-1 scrollbar-none flex-1">
              {/* Metadata Badges */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-[#12141a] rounded-xl border border-[#232733] space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">FRAME TYPE</span>
                  <div className="text-purple-300 font-bold truncate">{selectedFrame.protocol}</div>
                </div>
                <div className="p-2.5 bg-[#12141a] rounded-xl border border-[#232733] space-y-0.5">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">CHANNEL / FREQ</span>
                  <div className="text-slate-200 font-bold">
                    {selectedFrame.channel ? `Ch ${selectedFrame.channel} (2.4 GHz)` : 'Serial UART'}
                  </div>
                </div>
              </div>

              {/* Protocol breakdown fields */}
              <div className="p-3 bg-[#12141a] rounded-xl border border-[#232733] space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Source Address:</span>
                  <span className="text-slate-200 font-bold">{selectedFrame.source}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Destination:</span>
                  <span className="text-slate-200 font-bold">{selectedFrame.dest}</span>
                </div>
                {selectedFrame.bssid !== 'N/A' && (
                  <div className="flex justify-between text-slate-400">
                    <span>BSSID:</span>
                    <span className="text-slate-200 font-bold">{selectedFrame.bssid}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-400">
                  <span>Payload Length:</span>
                  <span className="text-amber-400 font-bold">{selectedFrame.length} bytes</span>
                </div>
              </div>

              {/* Hex Dump */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">RAW FRAME HEX DUMP:</span>
                <div className="p-3 bg-[#0d0f14] rounded-xl border border-[#232733] text-[11px] text-purple-300 leading-relaxed font-mono break-all select-all">
                  {selectedFrame.hex}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-slate-500 text-xs">
              Select a packet from the stream to inspect headers and bytes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
