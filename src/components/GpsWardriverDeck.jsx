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
  Search,
  Usb,
  Play,
  Square,
  Cpu
} from 'lucide-react';
import { parseNmeaSentence, parseWardriveLine } from '../utils/nmeaParser';
import {
  connectAlfaDevice,
  startMonitorMode,
  retuneChannel,
  unpackRealtekUsbTransfer
} from '../utils/alfaWifiDriver';
import { parse80211Frame } from '../utils/wifiParser';

const WARDRIVE_CHANNELS_DUALBAND = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];
const SIMULATED_PAU09_APS = [
  { bssid: '9C:EF:D5:44:12:01', ssid: 'PandaNet-5G-Uplink', rssi: -52, channel: 36, auth: 'WPA3-SAE' },
  { bssid: '9C:EF:D5:88:3A:10', ssid: 'Tactical-Mesh-Node', rssi: -61, channel: 149, auth: 'WPA2-PSK' },
  { bssid: '00:C0:CA:A8:19:42', ssid: 'Corp-Guest-WiFi', rssi: -68, channel: 6, auth: 'OPEN' },
  { bssid: '24:5E:BE:11:90:CC', ssid: 'BuildingB-IoT-24', rssi: -64, channel: 1, auth: 'WPA2-PSK' },
  { bssid: 'F0:9F:C2:71:0B:55', ssid: 'UniFi-Lab-5GHz', rssi: -58, channel: 44, auth: 'WPA2-EAP' },
  { bssid: 'B4:FB:E4:33:E1:09', ssid: 'Field-Sensor-Bridge', rssi: -74, channel: 11, auth: 'WPA2-PSK' }
];

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

  // Wardriver Wi-Fi Hardware Source Toggle ('pau09' | 'alfa' | 'serial')
  const [wardriveSource, setWardriveSource] = useState(() => {
    try {
      return localStorage.getItem('wardriver_hardware_source') || 'pau09';
    } catch {
      return 'pau09';
    }
  });
  const [usbAdapter, setUsbAdapter] = useState(null);
  const [isUsbConnected, setIsUsbConnected] = useState(false);
  const [isUsbScanning, setIsUsbScanning] = useState(false);
  const [isBrowserGps, setIsBrowserGps] = useState(false);
  const [isSimulatingWardrive, setIsSimulatingWardrive] = useState(false);
  const [scanChannel, setScanChannel] = useState(6);
  const [statusNotice, setStatusNotice] = useState(null);

  const canvasRef = useRef(null);
  const lastProcessedTextRef = useRef('');
  const isScanningRef = useRef(false);
  const usbDeviceRef = useRef(null);

  const handleSelectWardriveSource = useCallback((source) => {
    setWardriveSource(source);
    try {
      localStorage.setItem('wardriver_hardware_source', source);
    } catch {}
    const label =
      source === 'pau09'
        ? 'Panda Wireless PAU09 (RT5572 Dual-Band WebUSB)'
        : source === 'alfa'
        ? 'Alfa AWUS036ACH (RTL8812AU WebUSB)'
        : 'Serial UART NMEA / ESP32 Stream';
    setStatusNotice(`Active Wardriver Source: ${label}`);
    onLogMessage?.(`[Wardriver] Switched adapter mode to ${label}`);
  }, [onLogMessage]);

  const handleConnectUsbAdapter = async () => {
    try {
      const filters =
        wardriveSource === 'pau09'
          ? [{ vendorId: 0x148f, productId: 0x5572 }, { vendorId: 0x148f }]
          : [{ vendorId: 0x0bda }];
      const conn = await connectAlfaDevice(filters);
      usbDeviceRef.current = conn.device;
      setUsbAdapter(conn);
      setIsUsbConnected(true);
      await startMonitorMode(conn.device, scanChannel, { channelWidth: 20 });
      setStatusNotice(`Connected ${conn.modelName} (${conn.chipset}) in 802.11 Monitor Mode`);
      onLogMessage?.(`[Wardriver] WebUSB connected: ${conn.modelName} (${conn.vidPid})`);
    } catch (err) {
      setStatusNotice(`WebUSB connection failed: ${err?.message || 'Device not selected'}`);
    }
  };

  const handleDisconnectUsbAdapter = async () => {
    isScanningRef.current = false;
    setIsUsbScanning(false);
    try {
      if (usbDeviceRef.current?.opened) {
        await usbDeviceRef.current.close();
      }
    } catch {}
    usbDeviceRef.current = null;
    setUsbAdapter(null);
    setIsUsbConnected(false);
    setStatusNotice('Disconnected WebUSB Wi-Fi adapter');
  };

  // WebUSB 802.11 Monitor Mode Channel Hopping + Beacon Reader Loop
  useEffect(() => {
    if (!isUsbScanning || !isUsbConnected || !usbDeviceRef.current) return;
    let active = true;
    isScanningRef.current = true;
    let hopIdx = 0;

    const hopTimer = setInterval(async () => {
      if (!active || !usbDeviceRef.current) return;
      hopIdx = (hopIdx + 1) % WARDRIVE_CHANNELS_DUALBAND.length;
      const nextCh = WARDRIVE_CHANNELS_DUALBAND[hopIdx];
      setScanChannel(nextCh);
      try {
        await retuneChannel(usbDeviceRef.current, nextCh, { channelWidth: 20 });
      } catch {}
    }, 650);

    const readLoop = async () => {
      const endpointNumber = usbAdapter?.bulkInEndpoint || 1;
      while (active && isScanningRef.current && usbDeviceRef.current?.opened) {
        try {
          const result = await usbDeviceRef.current.transferIn(endpointNumber, 4096);
          if (result?.status === 'ok' && result?.data?.byteLength > 0) {
            const rawBytes = new Uint8Array(
              result.data.buffer,
              result.data.byteOffset,
              result.data.byteLength
            );
            const frames = unpackRealtekUsbTransfer(rawBytes, {
              usbVid: usbDeviceRef.current.vendorId,
              usbPid: usbDeviceRef.current.productId
            });
            for (const f of frames) {
              const parsed = parse80211Frame(f.frame);
              if (parsed && (parsed.subtypeName === 'Beacon' || parsed.subtypeName === 'Probe Response')) {
                const bssid = parsed.bssid || parsed.addr2;
                if (bssid) {
                  const apEntry = {
                    bssid,
                    ssid: parsed.ssid || '<Hidden SSID>',
                    rssi: f.rssi ?? parsed.signalDbm ?? -65,
                    channel: f.channel || parsed.channel || scanChannel,
                    auth: parsed.security || 'WPA2',
                    seenTime: new Date().toLocaleTimeString()
                  };
                  setCapturedAps(prev => {
                    const map = new Map(prev.map(ap => [ap.bssid, ap]));
                    map.set(apEntry.bssid, apEntry);
                    return Array.from(map.values()).slice(-200);
                  });
                }
              }
            }
          }
        } catch {
          await new Promise(r => setTimeout(r, 150));
        }
      }
    };

    readLoop();
    return () => {
      active = false;
      isScanningRef.current = false;
      clearInterval(hopTimer);
    };
  }, [isUsbScanning, isUsbConnected, usbAdapter, scanChannel]);

  // Browser Geolocation API GPS Lock
  useEffect(() => {
    if (!isBrowserGps || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, speed, heading } = pos.coords;
        const speedKmh = speed != null ? Number((speed * 3.6).toFixed(1)) : 0;
        const speedMph = speed != null ? Number((speed * 2.23694).toFixed(1)) : 0;
        setGpsData(prev => ({
          ...prev,
          lat: latitude,
          lon: longitude,
          altitude: altitude != null ? Number(altitude.toFixed(1)) : prev.altitude,
          speedKmh,
          speedMph,
          heading: heading != null && !Number.isNaN(heading) ? Math.round(heading) : prev.heading,
          fixLabel: 'Browser Geolocation Lock',
          valid: true,
          time: new Date().toISOString().slice(11, 19) + ' UTC'
        }));
        setTrackHistory(track => [...track.slice(-200), { lat: latitude, lon: longitude }]);
      },
      () => {
        setStatusNotice('Browser GPS permission denied or unavailable.');
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isBrowserGps]);

  // Simulated Panda PAU09 / Alfa Dual-Band Wardrive Stream
  useEffect(() => {
    if (!isSimulatingWardrive) return;
    let tick = 0;
    const interval = setInterval(() => {
      tick += 1;
      const ch = WARDRIVE_CHANNELS_DUALBAND[tick % WARDRIVE_CHANNELS_DUALBAND.length];
      setScanChannel(ch);

      setGpsData(prev => {
        const nextLat = prev.lat + (Math.cos(tick * 0.25) * 0.00014);
        const nextLon = prev.lon + (Math.sin(tick * 0.25) * 0.00014);
        const nextHeading = (prev.heading + 12) % 360;
        setTrackHistory(track => [...track.slice(-200), { lat: nextLat, lon: nextLon }]);
        return {
          ...prev,
          lat: nextLat,
          lon: nextLon,
          speedKmh: 28.4,
          speedMph: 17.6,
          heading: nextHeading,
          fixLabel: wardriveSource === 'pau09' ? 'PAU09 + Sim GPS Fix' : 'Sim GPS Fix (3D)',
          valid: true,
          time: new Date().toISOString().slice(11, 19) + ' UTC'
        };
      });

      const template = SIMULATED_PAU09_APS[tick % SIMULATED_PAU09_APS.length];
      const jitterRssi = Math.max(-92, Math.min(-38, template.rssi + Math.round((Math.random() - 0.5) * 8)));
      const apEntry = {
        ...template,
        rssi: jitterRssi,
        seenTime: new Date().toLocaleTimeString()
      };
      setCapturedAps(prev => {
        const map = new Map(prev.map(ap => [ap.bssid, ap]));
        map.set(apEntry.bssid, apEntry);
        return Array.from(map.values()).slice(-200);
      });
    }, 900);

    return () => clearInterval(interval);
  }, [isSimulatingWardrive, wardriveSource]);

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
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            {wardriveSource === 'pau09'
              ? 'Panda PAU09 (RT5572)'
              : wardriveSource === 'alfa'
              ? 'Alfa (RTL8812AU)'
              : 'Serial UART'}
          </span>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Wardriver Wi-Fi Adapter Toggle & WebUSB / GPS Control Bar */}
      <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1"
          role="group"
          aria-label="Wardriver Wi-Fi Adapter Source Toggle"
        >
          <span className="text-[10px] uppercase font-bold text-slate-400 px-2 flex items-center gap-1">
            <Usb className="w-3 h-3 text-cyber-emerald" />
            Radio Adapter:
          </span>
          <button
            type="button"
            onClick={() => handleSelectWardriveSource('pau09')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition flex items-center gap-1.5 ${
              wardriveSource === 'pau09'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Use Panda Wireless PAU09 (Ralink RT5572 148f:5572 Dual-Band 2.4GHz/5GHz) via WebUSB"
          >
            <span>Panda PAU09</span>
            <span className="text-[9px] px-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30">
              RT5572
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectWardriveSource('alfa')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
              wardriveSource === 'alfa'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Use Alfa AWUS036ACH (Realtek RTL8812AU) via WebUSB"
          >
            Alfa RTL8812AU
          </button>
          <button
            type="button"
            onClick={() => handleSelectWardriveSource('serial')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
              wardriveSource === 'serial'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Parse NMEA + Wi-Fi lines from Serial UART stream (ESP32 / Marauder / Flipper)"
          >
            Serial UART
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {wardriveSource !== 'serial' && (
            <>
              {!isUsbConnected ? (
                <button
                  type="button"
                  onClick={handleConnectUsbAdapter}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold text-[11px] transition"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span>
                    {wardriveSource === 'pau09' ? 'Connect PAU09 (WebUSB)' : 'Connect Alfa (WebUSB)'}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsUsbScanning(s => !s)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-[11px] border transition ${
                      isUsbScanning
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    }`}
                  >
                    {isUsbScanning ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{isUsbScanning ? `Hopping CH ${scanChannel}` : 'Start Monitor Hop'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectUsbAdapter}
                    className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px]"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </>
          )}

          {/* Browser Geolocation GPS Lock Toggle */}
          <button
            type="button"
            onClick={() => setIsBrowserGps(g => !g)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition ${
              isBrowserGps
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title="Lock GPS coordinates using Browser Geolocation API while wardriving with USB Wi-Fi adapter"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{isBrowserGps ? 'Browser GPS Active' : 'Browser GPS Lock'}</span>
          </button>

          {/* Simulate Wardrive Stream Toggle */}
          <button
            type="button"
            onClick={() => setIsSimulatingWardrive(s => !s)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition ${
              isSimulatingWardrive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
            title="Simulate dual-band 2.4/5GHz wardriving stream with Panda PAU09 / Alfa beacons"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isSimulatingWardrive ? `Simulating (CH ${scanChannel})` : 'Simulate Wardrive Stream'}</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-300">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-500 hover:text-slate-300 text-[10px]"
          >
            Dismiss
          </button>
        </div>
      )}

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
