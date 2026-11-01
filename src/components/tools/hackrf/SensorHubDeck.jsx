import React, { useState, useEffect } from 'react';
import { DemoBanner } from '../../common/DemoNotice';
import { 
  Cpu, 
  CloudRain, 
  Gauge, 
  MessageSquare, 
  Plane, 
  Bluetooth, 
  Zap, 
  Filter, 
  Download, 
  RefreshCw, 
  Search, 
  CheckCircle2, 
  Clock, 
  Sliders,
  Radio
} from 'lucide-react';

export default function SensorHubDeck({ centerFreq, onTuneFreq }) {
  const [activeCategory, setActiveCategory] = useState('subghz'); // 'subghz' | 'weather' | 'tpms' | 'pagers' | 'acars' | 'ble'
  const [searchQuery, setSearchQuery] = useState('');
  
  // Decoded sensor packets. Only the demo has any: the PortaPack doesn't stream
  // rtl_433 decodes over USB, so on real hardware this stays empty.
  const [packets, setPackets] = useState([]);

  // Demo mode only: invented packets on a timer.
  // No synthetic sensor packets: rtl_433-style decoding is not implemented over USB.

  const filteredPackets = packets.filter(p => {
    if (activeCategory !== 'all' && p.cat !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (p.protocol && p.protocol.toLowerCase().includes(q)) ||
        (p.idHex && p.idHex.toLowerCase().includes(q)) ||
        (p.msg && p.msg.toLowerCase().includes(q)) ||
        (p.flight && p.flight.toLowerCase().includes(q)) ||
        (p.mac && p.mac.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(packets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rtl433_sensor_packets.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      <DemoBanner demoOnly>Sub-GHz / weather / TPMS / pager / ACARS / BLE decoding is not implemented over USB yet, so nothing is listed here. The frequency buttons do retune your HackRF.</DemoBanner>
      {/* Top Banner & Protocol Stats */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-300">
            <Cpu className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-slate-200 flex items-center gap-2">
              <span>rtl_433 & MULTI-PROTOCOL SENSOR HUB</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-normal">SAMPLE DATA · live rtl_433 decode pending</span>
              <span className="text-[10px] px-2 py-0.5 bg-purple-950/80 border border-purple-500/30 text-purple-300 rounded font-normal">
                RocketGod 370+ Protocol Engine
              </span>
            </div>
            <span className="text-[10px] text-slate-400">
              OOK, FSK, ASK Demodulator • Sub-GHz, Weather, TPMS, Pagers, ACARS & BLE
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJson}
            className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded text-xs transition flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export JSON
          </button>
        </div>
      </div>

      {/* Protocol Category Filter Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800">
        {[
          { id: 'subghz', name: 'Sub-GHz Remotes (433/315M)', icon: Radio },
          { id: 'weather', name: 'Weather Stations', icon: CloudRain },
          { id: 'tpms', name: 'TPMS Tyre Sensors', icon: Gauge },
          { id: 'pagers', name: 'FLEX & POCSAG Pagers', icon: MessageSquare },
          { id: 'acars', name: 'ACARS Aircraft VHF', icon: Plane },
          { id: 'ble', name: 'BLE 2.4 GHz Beacons', icon: Bluetooth },
          { id: 'all', name: 'Show All Protocols', icon: Filter }
        ].map(cat => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap text-xs ${
                isActive
                  ? 'bg-purple-600/30 border border-purple-500/50 text-purple-200 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* Search Input */}
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
        <Search className="w-3.5 h-3.5 text-slate-500" />
        <input
          type="text"
          placeholder="Filter packets by ID, protocol name, payload text..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none flex-1 font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-slate-500 hover:text-slate-300">✕</button>
        )}
      </div>

      {/* Live Packets Feed */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-slate-400 text-[10px] pb-1 border-b border-slate-800">
          <span>TIME / RSSI</span>
          <span>PROTOCOL & FREQUENCY</span>
          <span>DEVICE ID / SERIAL</span>
          <span>DECODED TELEMETRY PAYLOAD</span>
          <span className="text-right">ACTION</span>
        </div>

        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {filteredPackets.map(pkt => (
            <div
              key={pkt.id}
              className="p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-purple-500/30 transition flex flex-col @md:flex-row @md:items-center justify-between gap-2 text-xs"
            >
              {/* Column 1: Time & RSSI */}
              <div className="flex items-center gap-2 w-32 flex-shrink-0">
                <span className="text-slate-400 text-[10px]">{pkt.time}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 rounded font-bold">
                  {pkt.rssi} dBm
                </span>
              </div>

              {/* Column 2: Protocol & Freq */}
              <div className="w-48 flex-shrink-0">
                <div className="font-bold text-purple-300 truncate">{pkt.protocol}</div>
                <div className="text-[10px] text-cyan-400">{pkt.freq}</div>
              </div>

              {/* Column 3: Device ID */}
              <div className="w-32 flex-shrink-0 font-mono text-[11px] text-emerald-400 font-semibold truncate">
                {pkt.idHex || pkt.flight || pkt.mac || pkt.capCode}
              </div>

              {/* Column 4: Decoded Telemetry */}
              <div className="flex-1 text-[11px] text-slate-200 truncate">
                {pkt.cat === 'subghz' && (
                  <span>
                    Button: <strong className="text-white">{pkt.btn}</strong> • Counter: {pkt.counter}
                  </span>
                )}
                {pkt.cat === 'weather' && (
                  <span>
                    Temp: <strong className="text-amber-300">{pkt.temp}</strong> • Humidity: {pkt.humidity} • Wind: {pkt.wind}
                  </span>
                )}
                {pkt.cat === 'tpms' && (
                  <span>
                    Wheel: <strong className="text-cyan-300">{pkt.wheel}</strong> • Pressure: <strong className="text-emerald-400">{pkt.pressure}</strong> • Temp: {pkt.temp}
                  </span>
                )}
                {pkt.cat === 'pagers' && (
                  <span className="text-amber-200">
                    "{pkt.msg}"
                  </span>
                )}
                {pkt.cat === 'acars' && (
                  <span>
                    Tail: <strong className="text-cyan-300">{pkt.tail}</strong> • Label: {pkt.label} • {pkt.text}
                  </span>
                )}
                {pkt.cat === 'ble' && (
                  <span>
                    Type: <strong className="text-purple-300">{pkt.type}</strong> • UUID: {pkt.uuid}
                  </span>
                )}
              </div>

              {/* Column 5: Tune Action */}
              <div className="text-right flex-shrink-0">
                <button
                  onClick={() => {
                    const mhz = parseFloat(pkt.freq);
                    if (!isNaN(mhz)) onTuneFreq(Math.round(mhz * 1e6));
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-purple-900/40 text-purple-300 border border-slate-700 hover:border-purple-500/40 rounded text-[10px] transition"
                  title="Tune HackRF to this sensor frequency"
                >
                  Tune Freq
                </button>
              </div>
            </div>
          ))}

          {filteredPackets.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-xs">
              No decoded packets matching your current filter. Listening on RF frontend...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
