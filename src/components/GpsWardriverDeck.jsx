import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Compass, 
  MapPin, 
  Wifi, 
  Navigation, 
  Radio, 
  Download, 
  Trash2, 
  Copy, 
  Check, 
  Sparkles, 
  Crosshair, 
  Lock, 
  Activity,
  Layers,
  Search
} from 'lucide-react';
import { parseNmeaSentence, parseWardriveLine } from '../utils/nmeaParser';

export default function GpsWardriverDeck({
  latestTextStream = '',
  isConnected,
  onLogMessage
}) {
  // GPS Telemetry State
  const [gpsData, setGpsData] = useState({
    lat: 37.774929,
    lon: -122.419416,
    altitude: 16.4,
    speedKmh: 0,
    speedMph: 0,
    heading: 45,
    satellites: 8,
    fixLabel: 'GPS Fix (SPS)',
    valid: false,
    time: ''
  });

  const [trackHistory, setTrackHistory] = useState([]); // Array of { lat, lon }
  const [capturedAps, setCapturedAps] = useState([]); // Array of { bssid, ssid, rssi, channel, auth, seenTime }
  const [apSearch, setApSearch] = useState('');
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [radarZoom, setRadarZoom] = useState(1);

  const canvasRef = useRef(null);
  const lastProcessedTextRef = useRef('');

  // Process incoming text stream for NMEA or WiFi lines
  useEffect(() => {
    if (!latestTextStream) return;
    if (latestTextStream === lastProcessedTextRef.current) return;
    lastProcessedTextRef.current = latestTextStream;

    const lines = latestTextStream.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;

      // Check NMEA
      if (line.includes('$GP') || line.includes('$GN')) {
        const parsedGps = parseNmeaSentence(line);
        if (parsedGps) {
          setGpsData(prev => {
            const next = { ...prev, ...parsedGps };
            if (parsedGps.lat && parsedGps.lon) {
              setTrackHistory(track => {
                const last = track[track.length - 1];
                if (!last || Math.abs(last.lat - parsedGps.lat) > 0.00005 || Math.abs(last.lon - parsedGps.lon) > 0.00005) {
                  return [...track.slice(-200), { lat: parsedGps.lat, lon: parsedGps.lon }];
                }
                return track;
              });
            }
            return next;
          });
        }
      }

      // Check WiFi Wardriving lines
      const parsedAp = parseWardriveLine(line);
      if (parsedAp) {
        setCapturedAps(prev => {
          const map = new Map(prev.map(ap => [ap.bssid, ap]));
          map.set(parsedAp.bssid, parsedAp);
          return Array.from(map.values()).slice(-200);
        });
      }
    }
  }, [latestTextStream]);

  // Radar / Track Canvas Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Dark cyber radar background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // Radar Concentric Circles
    ctx.strokeStyle = '#0e1d33';
    ctx.lineWidth = 1;
    const maxR = Math.min(width, height) * 0.45;
    [0.25, 0.5, 0.75, 1.0].forEach(factor => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxR * factor, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Cardinal Directions
    ctx.fillStyle = '#475569';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', centerX, 16);
    ctx.fillText('S', centerX, height - 8);
    ctx.fillText('W', 14, centerY + 3);
    ctx.fillText('E', width - 14, centerY + 3);

    // Draw GPS Track Trail
    if (trackHistory.length > 1) {
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#0284c7';
      ctx.shadowBlur = 6;
      ctx.beginPath();

      const baseLat = gpsData.lat || 37.7749;
      const baseLon = gpsData.lon || -122.4194;
      const scale = 25000 * radarZoom;

      trackHistory.forEach((pt, i) => {
        const dx = (pt.lon - baseLon) * scale;
        const dy = -(pt.lat - baseLat) * scale;
        const px = centerX + dx;
        const py = centerY + dy;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Draw Current Position Target
    ctx.fillStyle = '#34d399';
    ctx.shadowColor = '#34d399';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Radar ping ring animation
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const pingR = 12 + ((Date.now() / 30) % 20);
    ctx.arc(centerX, centerY, pingR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Heading Arrow
    if (gpsData.heading !== undefined) {
      const rad = (gpsData.heading - 90) * (Math.PI / 180);
      const arrowX = centerX + Math.cos(rad) * 24;
      const arrowY = centerY + Math.sin(rad) * 24;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(arrowX, arrowY);
      ctx.stroke();
    }

  }, [gpsData, trackHistory, radarZoom]);

  const copyCoordinates = () => {
    if (!gpsData.lat || !gpsData.lon) return;
    const str = `${gpsData.lat.toFixed(6)}, ${gpsData.lon.toFixed(6)}`;
    navigator.clipboard.writeText(str);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const handleExportWigleCsv = () => {
    if (capturedAps.length === 0) return;
    const header = 'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type\n';
    const rows = capturedAps.map(ap => {
      return `${ap.bssid},"${ap.ssid}",${ap.auth},${new Date().toISOString()},${ap.channel},${ap.rssi},${gpsData.lat || 0},${gpsData.lon || 0},${gpsData.altitude || 0},5,WIFI`;
    }).join('\n');

    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wardrive-wigle-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Simulate Wardriving Stream for Testing
  const simulateWardriveStream = () => {
    const baseLat = 37.7749;
    const baseLon = -122.4194;
    const mockAps = [
      { bssid: 'F4:92:BF:88:12:4A', ssid: 'Starbucks_Guest', rssi: -58, channel: 6, auth: 'OPEN' },
      { bssid: '00:1A:2B:99:44:EE', ssid: 'FBI_Surveillance_Van', rssi: -67, channel: 1, auth: 'WPA2-PSK' },
      { bssid: '24:0A:C4:DE:FA:01', ssid: 'Piglet_Wardrive_Mesh', rssi: -42, channel: 11, auth: 'WPA3-SAE' },
      { bssid: 'D8:EC:5E:11:33:77', ssid: 'NETGEAR-5G-EXT', rssi: -82, channel: 36, auth: 'WPA2' },
      { bssid: 'A0:B1:C2:33:44:55', ssid: 'Tesla_Guest_WiFi', rssi: -64, channel: 3, auth: 'WPA2-ENTERPRISE' }
    ];

    setGpsData({
      lat: baseLat + (Math.random() - 0.5) * 0.002,
      lon: baseLon + (Math.random() - 0.5) * 0.002,
      altitude: 24.8,
      speedKmh: 38.5,
      speedMph: 23.9,
      heading: 125,
      satellites: 12,
      fixLabel: '3D DGPS Fix (RTK)',
      valid: true,
      time: new Date().toUTCString().slice(17, 25) + ' UTC'
    });

    setCapturedAps(mockAps.map(a => ({ ...a, seenTime: new Date().toLocaleTimeString() })));
    setTrackHistory([
      { lat: baseLat - 0.001, lon: baseLon - 0.001 },
      { lat: baseLat - 0.0005, lon: baseLon - 0.0006 },
      { lat: baseLat, lon: baseLon }
    ]);
  };

  const filteredAps = useMemo(() => {
    if (!apSearch.trim()) return capturedAps;
    return capturedAps.filter(ap => 
      ap.ssid.toLowerCase().includes(apSearch.toLowerCase()) || 
      ap.bssid.toLowerCase().includes(apSearch.toLowerCase())
    );
  }, [capturedAps, apSearch]);

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-cyber-emerald" />
          <h2 className="font-bold text-slate-100 tracking-wider">LIVE GPS & WARDRIVER TELEMETRY DECK</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={simulateWardriveStream}
            className="flex items-center gap-1.5 text-[11px] bg-slate-900 hover:bg-slate-800 text-cyber-emerald px-2.5 py-1 rounded-lg border border-slate-800"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Simulate Wardrive Stream</span>
          </button>

          <button
            onClick={handleExportWigleCsv}
            disabled={capturedAps.length === 0}
            className="flex items-center gap-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-800 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Wigle CSV</span>
          </button>

          <button
            onClick={() => setCapturedAps([])}
            className="p-1 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
            title="Clear APs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top Grid: Live GPS Telemetry Dashboard & Radar Canvas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* GPS Sensor Meters */}
        <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {/* Coordinates Card */}
          <div className="col-span-2 bg-[#030712] border border-slate-800 rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-cyber-emerald" />
                GPS Position Coordinates
              </span>
              <button
                onClick={copyCoordinates}
                className="flex items-center gap-1 text-[10px] text-cyber-cyan hover:underline"
              >
                {copiedCoords ? <Check className="w-3 h-3 text-cyber-emerald" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCoords ? 'Copied!' : 'Copy lat,lon'}</span>
              </button>
            </div>

            <div className="my-1.5 font-bold text-sm sm:text-base text-slate-100 flex items-center gap-2">
              <span className="text-cyber-emerald">{gpsData.lat ? gpsData.lat.toFixed(6) : '37.774929'}° N</span>
              <span className="text-slate-600">/</span>
              <span className="text-cyber-cyan">{gpsData.lon ? gpsData.lon.toFixed(6) : '-122.419416'}° W</span>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-900">
              <span>Fix: <strong className="text-cyber-emerald">{gpsData.fixLabel}</strong></span>
              <span>Time: <strong className="text-slate-300">{gpsData.time || '12:00:00 UTC'}</strong></span>
            </div>
          </div>

          {/* Speed Card */}
          <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-cyber-amber" />
              Ground Speed
            </span>
            <div className="text-lg font-bold text-cyber-amber my-1">
              {gpsData.speedKmh} <span className="text-xs text-slate-400 font-normal">km/h</span>
            </div>
            <span className="text-[10px] text-slate-500">{gpsData.speedMph} mph</span>
          </div>

          {/* Altitude Card */}
          <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-slate-500 text-[10px] uppercase font-bold">Altitude (MSL)</span>
            <div className="text-base font-bold text-slate-100 my-1">
              {gpsData.altitude} <span className="text-xs text-slate-400 font-normal">meters</span>
            </div>
            <span className="text-[10px] text-slate-500">{(gpsData.altitude * 3.28084).toFixed(1)} feet</span>
          </div>

          {/* Satellites Card */}
          <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
              <Radio className="w-3.5 h-3.5 text-cyber-cyan" />
              Constellation
            </span>
            <div className="text-base font-bold text-cyber-cyan my-1">
              {gpsData.satellites} <span className="text-xs text-slate-400 font-normal">Sats</span>
            </div>
            <span className="text-[10px] text-emerald-400">Lock Strong</span>
          </div>

          {/* Heading / Compass */}
          <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-slate-500 text-[10px] uppercase font-bold flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5 text-purple-400" />
              Track Heading
            </span>
            <div className="text-base font-bold text-purple-300 my-1">
              {gpsData.heading}°
            </div>
            <span className="text-[10px] text-slate-500">Course Over Ground</span>
          </div>
        </div>

        {/* Live GPS Radar & Track Viewport */}
        <div className="relative bg-[#030712] border border-slate-800 rounded-lg overflow-hidden h-44 flex items-center justify-center">
          <canvas ref={canvasRef} className="w-full h-full block" />
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800 text-[10px]">
            <button onClick={() => setRadarZoom(z => Math.max(0.2, z - 0.2))} className="px-1 text-slate-300 hover:text-white">-</button>
            <span className="text-slate-400">{radarZoom.toFixed(1)}x</span>
            <button onClick={() => setRadarZoom(z => Math.min(3, z + 0.2))} className="px-1 text-slate-300 hover:text-white">+</button>
          </div>
        </div>
      </div>

      {/* Captured WiFi Access Points Table */}
      <div className="border border-slate-800 rounded-lg p-2.5 space-y-2 bg-[#030712]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-cyber-cyan" />
            <span className="font-bold text-slate-200">
              SNIFFED ACCESS POINTS ({capturedAps.length})
            </span>
          </div>

          <div className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="Search SSID or BSSID..."
              value={apSearch}
              onChange={(e) => setApSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded pl-6 pr-2 py-0.5 text-[11px] text-slate-200 outline-none w-44"
            />
          </div>
        </div>

        <div className="max-h-48 overflow-y-auto border border-slate-800 rounded">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-900 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="py-1 px-2.5">Signal</th>
                <th className="py-1 px-2.5">SSID</th>
                <th className="py-1 px-2.5">BSSID (MAC)</th>
                <th className="py-1 px-2.5">Channel</th>
                <th className="py-1 px-2.5">Security</th>
                <th className="py-1 px-2.5 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredAps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-600">
                    No WiFi beacons captured yet. Connect your wardriver or click "Simulate Wardrive Stream" above.
                  </td>
                </tr>
              ) : (
                filteredAps.map((ap, i) => {
                  const rssiColor = ap.rssi >= -65 ? 'text-cyber-emerald' : ap.rssi >= -78 ? 'text-cyber-amber' : 'text-rose-400';
                  return (
                    <tr key={i} className="hover:bg-slate-900/50 font-mono">
                      <td className={`py-1 px-2.5 font-bold ${rssiColor}`}>
                        {ap.rssi} dBm
                      </td>
                      <td className="py-1 px-2.5 text-slate-100 font-semibold">
                        {ap.ssid}
                      </td>
                      <td className="py-1 px-2.5 text-slate-400 font-mono">
                        {ap.bssid}
                      </td>
                      <td className="py-1 px-2.5 text-cyber-cyan">
                        CH {ap.channel}
                      </td>
                      <td className="py-1 px-2.5">
                        <span className={`px-1 rounded text-[10px] font-bold ${
                          ap.auth.includes('OPEN') ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {ap.auth}
                        </span>
                      </td>
                      <td className="py-1 px-2.5 text-slate-500 text-right">
                        {ap.seenTime}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
