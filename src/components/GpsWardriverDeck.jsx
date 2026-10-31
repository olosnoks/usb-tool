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
  Cpu,
  Upload
} from 'lucide-react';
import { parseNmeaSentence, parseWardriveLine, parseWigleCsvFile } from '../utils/nmeaParser';
import {
  connectAlfaDevice,
  startMonitorMode,
  retuneChannel,
  unpackRealtekUsbTransfer
} from '../utils/alfaWifiDriver';
import { parse80211Frame } from '../utils/wifiParser';

const WARDRIVE_CHANNELS_DUALBAND = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];
const SIMULATED_PAU09_APS = [
  { bssid: '9C:EF:D5:44:12:01', ssid: 'PandaNet-5G-Uplink', rssi: -52, channel: 36, auth: 'WPA3-SAE', deviceType: 'WIFI' },
  { bssid: '9C:EF:D5:88:3A:10', ssid: 'Tactical-Mesh-Node', rssi: -61, channel: 149, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: '00:C0:CA:A8:19:42', ssid: 'Corp-Guest-WiFi', rssi: -68, channel: 6, auth: 'OPEN', deviceType: 'WIFI' },
  { bssid: '24:5E:BE:11:90:CC', ssid: 'BuildingB-IoT-24', rssi: -64, channel: 1, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: 'F0:9F:C2:71:0B:55', ssid: 'UniFi-Lab-5GHz', rssi: -58, channel: 44, auth: 'WPA2-EAP', deviceType: 'WIFI' },
  { bssid: 'B4:FB:E4:33:E1:09', ssid: 'Field-Sensor-Bridge', rssi: -74, channel: 11, auth: 'WPA2-PSK', deviceType: 'WIFI' }
];
const SIMULATED_WARHOG_CYD_APS = [
  { bssid: 'A0:B7:65:12:9F:01', ssid: 'WARHOG-CYD-Target01', rssi: -49, channel: 6, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: 'C8:C9:A3:44:08:7B', ssid: 'Starbucks_Free_WiFi', rssi: -63, channel: 11, auth: 'OPEN', deviceType: 'WIFI' },
  { bssid: 'E4:5F:01:88:31:D2', ssid: 'Flipper-BLE-Beacon', rssi: -57, channel: 37, auth: 'BLE-ADV', deviceType: 'BLE' },
  { bssid: '70:4D:7B:91:CC:14', ssid: 'Porkchop-WPA-SEC-Lab', rssi: -54, channel: 1, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: 'D8:3A:DD:19:50:4E', ssid: 'Skydio-Telemetry-24', rssi: -71, channel: 6, auth: 'WPA2-PSK', deviceType: 'WIFI' }
];
const SIMULATED_PIGLET_APS = [
  { bssid: '30:3A:10:C5:55:01', ssid: 'Piglet-C5-5GHz-Backhaul', rssi: -48, channel: 36, auth: 'WPA3-SAE', deviceType: 'WIFI' },
  { bssid: '30:3A:10:C5:88:19', ssid: 'ATGM336H-Field-Mesh', rssi: -59, channel: 149, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: '64:6E:97:0A:41:2B', ssid: 'MidwestGadgets-AP', rssi: -62, channel: 6, auth: 'WPA2-PSK', deviceType: 'WIFI' },
  { bssid: '8C:AA:B5:77:12:E0', ssid: 'Municipal-Free-5G', rssi: -66, channel: 48, auth: 'OPEN', deviceType: 'WIFI' },
  { bssid: '58:BF:25:3D:90:11', ssid: 'ESP32C5-DualBand-Node', rssi: -55, channel: 157, auth: 'WPA2-PSK', deviceType: 'WIFI' }
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

  // Wardriver Wi-Fi Hardware Source Toggle ('pau09' | 'alfa' | 'warhog-cyd' | 'piglet' | 'serial')
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
  const [isSerialRigConnected, setIsSerialRigConnected] = useState(false);
  const [isBrowserGps, setIsBrowserGps] = useState(false);
  const [isSimulatingWardrive, setIsSimulatingWardrive] = useState(false);
  const [scanChannel, setScanChannel] = useState(6);
  const [statusNotice, setStatusNotice] = useState(null);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastProcessedTextRef = useRef('');
  const isScanningRef = useRef(false);
  const usbDeviceRef = useRef(null);
  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);

  const processIncomingTextLines = useCallback((rawText) => {
    if (!rawText) return;
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;

      // Check NMEA ($GPGGA, $GNGGA, $GPRMC, $GNRMC)
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

      // Check WiFi / BLE Wardriving lines (Warhog CYD, Piglet, WiGLE CSV v1.6/v1.4, Marauder)
      const parsedAp = parseWardriveLine(line);
      if (parsedAp) {
        setCapturedAps(prev => {
          const map = new Map(prev.map(ap => [ap.bssid, ap]));
          map.set(parsedAp.bssid, parsedAp);
          return Array.from(map.values()).slice(-200);
        });
        // If Warhog CYD or Piglet line includes embedded GPS coordinates, update GPS & radar trail
        if (parsedAp.lat && parsedAp.lon) {
          setGpsData(prev => ({
            ...prev,
            lat: parsedAp.lat,
            lon: parsedAp.lon,
            altitude: parsedAp.altitude ?? prev.altitude,
            fixLabel: parsedAp.sourceDevice === 'warhog-cyd'
              ? 'Warhog CYD GPS Lock'
              : parsedAp.sourceDevice === 'piglet'
              ? 'Piglet ATGM336H Lock'
              : 'Wardriver GPS Lock',
            valid: true,
            time: new Date().toISOString().slice(11, 19) + ' UTC'
          }));
          setTrackHistory(track => {
            const last = track[track.length - 1];
            if (!last || Math.abs(last.lat - parsedAp.lat) > 0.00005 || Math.abs(last.lon - parsedAp.lon) > 0.00005) {
              return [...track.slice(-200), { lat: parsedAp.lat, lon: parsedAp.lon }];
            }
            return track;
          });
        }
      }
    }
  }, []);

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
        : source === 'warhog-cyd'
        ? 'Warhog CYD (Porkchop SGT WARHOG / ESP32-2432S028R)'
        : source === 'piglet'
        ? 'Piglet Wardriver (Seeed XIAO ESP32-C5 / S3 Dual-Band + ATGM336H)'
        : 'Serial UART NMEA / ESP32 Stream';
    setStatusNotice(`Active Wardriver Source: ${label}`);
    onLogMessage?.(`[Wardriver] Switched adapter mode to ${label}`);
  }, [onLogMessage]);

  const handleConnectSerialRig = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.serial) {
        setStatusNotice('WebSerial API unavailable in this browser. Use Chrome or Edge.');
        return;
      }
      const filters =
        wardriveSource === 'piglet'
          ? [
              { usbVendorId: 0x303a, usbProductId: 0x1001 }, // Seeed XIAO ESP32-C5 / S3 / C6 Native USB JTAG/Serial
              { usbVendorId: 0x303a },
              { usbVendorId: 0x1a86, usbProductId: 0x7523 },
              { usbVendorId: 0x10c4, usbProductId: 0xea60 }
            ]
          : [
              { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // ESP32-2432S028R CYD CH340C
              { usbVendorId: 0x1a86, usbProductId: 0x55d4 }, // CH9102F
              { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP2102
              { usbVendorId: 0x303a }
            ];
      const port = await navigator.serial.requestPort({ filters });
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      setIsSerialRigConnected(true);
      const rigName = wardriveSource === 'warhog-cyd' ? 'Warhog CYD (SGT WARHOG)' : 'Piglet (ESP32-C5)';
      setStatusNotice(`Connected ${rigName} over WebSerial @ 115200 baud`);
      onLogMessage?.(`[Wardriver] Connected ${rigName} @ 115200 baud`);

      const decoder = new TextDecoder();
      let lineBuffer = '';
      const reader = port.readable.getReader();
      serialReaderRef.current = reader;
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              lineBuffer += decoder.decode(value, { stream: true });
              const newlineIdx = lineBuffer.lastIndexOf('\n');
              if (newlineIdx !== -1) {
                const completeChunk = lineBuffer.slice(0, newlineIdx + 1);
                lineBuffer = lineBuffer.slice(newlineIdx + 1);
                processIncomingTextLines(completeChunk);
              }
            }
          }
        } catch {
          // Port closed or disconnected
        }
      })();
    } catch (err) {
      setStatusNotice(`Serial connection cancelled or failed: ${err?.message || 'Port not selected'}`);
    }
  };

  const handleDisconnectSerialRig = async () => {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
        serialReaderRef.current.releaseLock();
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
      }
    } catch {}
    serialReaderRef.current = null;
    serialPortRef.current = null;
    setIsSerialRigConnected(false);
    setStatusNotice('Disconnected Serial Wardriver rig');
  };

  const handleImportWigleCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { metadata, aps, track } = parseWigleCsvFile(text);
      if (aps.length > 0) {
        setCapturedAps(prev => {
          const map = new Map(prev.map(ap => [ap.bssid, ap]));
          for (const ap of aps) map.set(ap.bssid, ap);
          return Array.from(map.values()).slice(-500);
        });
      }
      if (track.length > 0) {
        const lastPt = track[track.length - 1];
        setTrackHistory(prev => [...prev, ...track].slice(-300));
        setGpsData(prev => ({
          ...prev,
          lat: lastPt.lat,
          lon: lastPt.lon,
          fixLabel: `${metadata.device || 'SD Card'} Log (${aps.length} APs)`,
          valid: true
        }));
      }
      setStatusNotice(
        `Imported ${aps.length} networks & ${track.length} GPS track points from ${file.name} (${metadata.format})`
      );
      onLogMessage?.(`[Wardriver] Imported ${aps.length} APs from ${file.name}`);
    } catch (err) {
      setStatusNotice(`Failed to import CSV: ${err?.message || 'Invalid file'}`);
    } finally {
      e.target.value = '';
    }
  };

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

  // Simulated Panda PAU09 / Alfa / Warhog CYD / Piglet Wardrive Stream
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
          fixLabel:
            wardriveSource === 'warhog-cyd'
              ? 'SGT WARHOG CYD Lock'
              : wardriveSource === 'piglet'
              ? 'Piglet ATGM336H Lock'
              : wardriveSource === 'pau09'
              ? 'PAU09 + Sim GPS Fix'
              : 'Sim GPS Fix (3D)',
          valid: true,
          time: new Date().toISOString().slice(11, 19) + ' UTC'
        };
      });

      const pool =
        wardriveSource === 'warhog-cyd'
          ? SIMULATED_WARHOG_CYD_APS
          : wardriveSource === 'piglet'
          ? SIMULATED_PIGLET_APS
          : SIMULATED_PAU09_APS;
      const template = pool[tick % pool.length];
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
    processIncomingTextLines(latestTextStream);
  }, [latestTextStream, processIncomingTextLines]);

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
    const deviceTag =
      wardriveSource === 'warhog-cyd'
        ? 'Porkchop-Warhog-CYD'
        : wardriveSource === 'piglet'
        ? 'Piglet-ESP32C5'
        : wardriveSource === 'pau09'
        ? 'Panda-PAU09-RT5572'
        : 'Skons-Wardriver';
    const preHeader = `WigleWifi-1.6,appRelease=1.0,model=ESP32,release=1.0,device=${deviceTag},display=TFT,board=ESP32,brand=Skons\n`;
    const header = 'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type\n';
    const rows = capturedAps.map(ap => {
      const ch = Number(ap.channel) || 6;
      const freq = ap.frequency || (ch > 14 ? 5000 + ch * 5 : 2407 + ch * 5);
      const lat = ap.lat ?? gpsData.lat ?? 0;
      const lon = ap.lon ?? gpsData.lon ?? 0;
      const alt = ap.altitude ?? gpsData.altitude ?? 0;
      const type = ap.deviceType || 'WIFI';
      return `${ap.bssid},"${ap.ssid}",${ap.auth},${new Date().toISOString()},${ch},${freq},${ap.rssi},${lat},${lon},${alt},4.5,,,${type}`;
    }).join('\n');

    const csv = preHeader + header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${deviceTag.toLowerCase()}-${Date.now()}.wigle.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const wardriveStats = useMemo(() => {
    let wifi24 = 0;
    let wifi5 = 0;
    let ble = 0;
    for (const ap of capturedAps) {
      if (ap.deviceType === 'BLE') ble += 1;
      else if (Number(ap.channel) > 14) wifi5 += 1;
      else wifi24 += 1;
    }
    return { wifi24, wifi5, ble };
  }, [capturedAps]);

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
              : wardriveSource === 'warhog-cyd'
              ? 'Warhog CYD (SGT WARHOG)'
              : wardriveSource === 'piglet'
              ? 'Piglet (ESP32-C5/S3)'
              : 'Serial UART'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.wigle.csv,.txt"
            onChange={handleImportWigleCsv}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-amber-300 px-2.5 py-1 rounded-lg border border-amber-500/30"
            title="Import .wigle.csv or .csv SD card logs from Warhog CYD (/m5porkchop/wardriving/) or Piglet"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import SD .wigle.csv</span>
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
            onClick={() => handleSelectWardriveSource('warhog-cyd')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition flex items-center gap-1.5 ${
              wardriveSource === 'warhog-cyd'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Use Warhog CYD (Porkchop SGT WARHOG on ESP32-2432S028R Cheap Yellow Display) via WebSerial / SD WiGLE v1.6"
          >
            <span>Warhog CYD</span>
            <span className="text-[9px] px-1 rounded bg-amber-950 text-amber-400 border border-amber-500/30">
              SGT WARHOG
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectWardriveSource('piglet')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition flex items-center gap-1.5 ${
              wardriveSource === 'piglet'
                ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Use Piglet Wardriver (Seeed XIAO ESP32-C5 / S3 Dual-Band 2.4/5GHz + ATGM336H GPS) via WebSerial / SD CSV"
          >
            <span>Piglet</span>
            <span className="text-[9px] px-1 rounded bg-pink-950 text-pink-400 border border-pink-500/30">
              ESP32-C5
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectWardriveSource('serial')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
              wardriveSource === 'serial'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
            title="Parse NMEA + Wi-Fi lines from generic Serial UART stream (ESP32 / Marauder / Flipper)"
          >
            Serial UART
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(wardriveSource === 'pau09' || wardriveSource === 'alfa') && (
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

          {(wardriveSource === 'warhog-cyd' || wardriveSource === 'piglet') && (
            <>
              {!isSerialRigConnected ? (
                <button
                  type="button"
                  onClick={handleConnectSerialRig}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-[11px] border transition ${
                    wardriveSource === 'warhog-cyd'
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                      : 'bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 border-pink-500/40'
                  }`}
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>
                    {wardriveSource === 'warhog-cyd'
                      ? 'Connect Warhog CYD (Serial)'
                      : 'Connect Piglet (Serial)'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDisconnectSerialRig}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-bold"
                >
                  Disconnect {wardriveSource === 'warhog-cyd' ? 'Warhog CYD' : 'Piglet'}
                </button>
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
            title="Lock GPS coordinates using Browser Geolocation API while wardriving"
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
            title="Simulate wardriving stream with Warhog CYD, Piglet, or Panda PAU09 beacons"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isSimulatingWardrive ? `Simulating (CH ${scanChannel})` : 'Simulate Wardrive Stream'}</span>
          </button>
        </div>
      </div>

      {/* Warhog CYD & Piglet Hardware Rig Profile Strip */}
      {(wardriveSource === 'warhog-cyd' || wardriveSource === 'piglet') && (
        <div
          className={`rounded-lg px-3 py-2 border flex flex-wrap items-center justify-between gap-2 text-[11px] ${
            wardriveSource === 'warhog-cyd'
              ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
              : 'bg-pink-950/20 border-pink-500/30 text-pink-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wider">
              {wardriveSource === 'warhog-cyd'
                ? '🐗 SGT WARHOG (Porkchop-CYD ESP32-2432S028R)'
                : '🐷 Piglet Wardriver (Seeed XIAO ESP32-C5 / S3 + ATGM336H)'}
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-300">
              {wardriveSource === 'warhog-cyd'
                ? '115200 UART (CH340/CP2102) • 2.4GHz + BLE Sweep • /m5porkchop/wardriving/*.wigle.csv'
                : '115200 USB-JTAG (303a:1001) • Dual-Band 2.4/5GHz • WiGLE CSV v1.6 + ATGM336H NMEA'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold">
            <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-cyan-300">
              2.4GHz: {wardriveStats.wifi24}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-emerald-300">
              5GHz: {wardriveStats.wifi5}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-purple-300">
              BLE: {wardriveStats.ble}
            </span>
          </div>
        </div>
      )}

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
