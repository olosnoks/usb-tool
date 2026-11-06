import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  MapPin, 
  Sparkles, 
  Play, 
  Download, 
  Copy, 
  Check, 
  RefreshCw, 
  Sliders, 
  Layers, 
  ExternalLink, 
  Info, 
  FileCode, 
  Table, 
  Crosshair, 
  Compass, 
  Share2, 
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
  Eye,
  Clock,
  Radio,
  FileText,
  Gauge,
  Maximize2,
  Hash,
  Move
} from 'lucide-react';
import { 
  generateDemoAps, 
  generateWigleCsv, 
  generateTestCsv, 
  exportPythonScriptSource,
  VECTOR_FONTS,
  AUTH_MODES,
  CHANNELS
} from '../../utils/wardriveDemoGenerator';

const LOCATION_PRESETS = [
  { name: 'Jackson, MS (Default)', lat: 32.25, lon: -90.13, zoom: 11 },
  { name: 'DEF CON / Las Vegas, NV', lat: 36.1147, lon: -115.1728, zoom: 11 },
  { name: 'San Francisco, CA', lat: 37.7749, lon: -122.4194, zoom: 11 },
  { name: 'New York City, NY', lat: 40.7128, lon: -74.0060, zoom: 11 },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278, zoom: 11 },
  { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, zoom: 11 },
  { name: 'Austin, TX', lat: 30.2672, lon: -97.7431, zoom: 11 },
  { name: 'Seattle, WA', lat: 47.6062, lon: -122.3321, zoom: 11 }
];

const TILE_PROVIDERS = {
  dark: {
    name: 'Tactical Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri'
  },
  standard: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  },
  satellite: {
    name: 'World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  }
};

const SPEED_PRESETS = [
  { label: 'Walk (5 km/h)', speed: 5 },
  { label: 'Bike (15 km/h)', speed: 15 },
  { label: 'City (45 km/h)', speed: 45 },
  { label: 'Hwy (90 km/h)', speed: 90 },
  { label: 'Air (250 km/h)', speed: 250 }
];

const SCALE_PRESETS = [
  { label: '0.25x (~1km)', scale: 0.25 },
  { label: '0.5x (~3km)', scale: 0.5 },
  { label: '1.0x (~6km)', scale: 1.0 },
  { label: '1.5x (~10km)', scale: 1.5 },
  { label: '2.5x (~16km)', scale: 2.5 }
];

const AP_COUNT_PRESETS = [
  { label: '100', count: 100 },
  { label: '250', count: 250 },
  { label: '500', count: 500 },
  { label: '1k', count: 1000 },
  { label: '2.5k', count: 2500 }
];

export default function WardriveGeneratorWorkbench({ onLogMessage = () => {} }) {
  // Input parameters
  const [text, setText] = useState('KEPLER');
  const [latCenter, setLatCenter] = useState(32.25);
  const [lonCenter, setLonCenter] = useState(-90.13);

  // 1. Amount of APs Controls
  const [densityMode, setDensityMode] = useState('target'); // 'target' | 'auto'
  const [targetApCount, setTargetApCount] = useState(500);

  // 2. Letter Size & Scale Controls
  const [letterScale, setLetterScale] = useState(1.0);
  const [letterW, setLetterW] = useState(0.04);
  const [letterH, setLetterH] = useState(0.06);
  const [gap, setGap] = useState(0.02);

  // 3. Wardrive Simulation Speed Controls
  const [speedKmh, setSpeedKmh] = useState(50.0);
  const [stepIntervalSeconds, setStepIntervalSeconds] = useState(3);

  // Advanced & Simulation flags
  const [includePreheader, setIncludePreheader] = useState(true);
  const [useFixedSeed, setUseFixedSeed] = useState(true);
  const [seed, setSeed] = useState(42);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Map state
  const [mapType, setMapType] = useState('dark');
  const [activeTab, setActiveTab] = useState('map'); // 'map' | 'table' | 'python' | 'guide'

  // Generation output state
  const [generatedResult, setGeneratedResult] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedType, setCopiedType] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedAp, setSelectedAp] = useState(null);

  // Refs for Leaflet
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const originMarkerRef = useRef(null);
  const pathLayerRef = useRef(null);
  const apMarkersLayerRef = useRef(null);
  const previewBoxLayerRef = useRef(null);

  const isLeafletAvailable = typeof window !== 'undefined' && L && typeof L.map === 'function';

  // Physical Size Calculation
  const physicalMetrics = useMemo(() => {
    const scale = Number(letterScale) || 1.0;
    const effW = (Number(letterW) || 0.04) * scale;
    const effH = (Number(letterH) || 0.06) * scale;
    const effGap = (Number(gap) || 0.02) * scale;
    const clean = String(text || '').trim();
    const count = Math.max(1, clean.length);

    const latRad = (Number(latCenter) * Math.PI) / 180;
    const kmPerLonDeg = 111.0 * Math.cos(latRad);
    const kmPerLatDeg = 111.0;

    const totalWidthDeg = count * (effW + effGap);
    const totalHeightDeg = effH;

    const widthKm = (totalWidthDeg * kmPerLonDeg).toFixed(2);
    const heightKm = (totalHeightDeg * kmPerLatDeg).toFixed(2);

    return {
      effW,
      effH,
      effGap,
      widthKm,
      heightKm
    };
  }, [text, latCenter, letterW, letterH, letterScale, gap]);

  // 1. Initial Leaflet Map Setup
  useEffect(() => {
    if (!isLeafletAvailable || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    try {
      const map = L.map(mapContainerRef.current, {
        center: [latCenter, lonCenter],
        zoom: 11,
        zoomControl: true,
        attributionControl: false
      });

      const provider = TILE_PROVIDERS[mapType] || TILE_PROVIDERS.dark;
      tileLayerRef.current = L.tileLayer(provider.url, {
        maxZoom: provider.maxZoom
      }).addTo(map);

      // Layer groups for dynamic elements
      pathLayerRef.current = L.layerGroup().addTo(map);
      apMarkersLayerRef.current = L.layerGroup().addTo(map);
      previewBoxLayerRef.current = L.layerGroup().addTo(map);

      // Create Custom Draggable Origin Crosshair Marker
      const originIcon = L.divIcon({
        className: 'custom-origin-crosshair',
        html: `
          <div style="position: relative; width: 34px; height: 34px; transform: translate(-17px, -17px); cursor: crosshair;">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px rgba(16,185,129,0.9));">
              <circle cx="12" cy="12" r="10" stroke="#10b981" stroke-width="1.8" fill="rgba(16,185,129,0.18)"/>
              <line x1="22" y1="12" x2="17" y2="12"/>
              <line x1="7" y1="12" x2="2" y2="12"/>
              <line x1="12" y1="7" x2="12" y2="2"/>
              <line x1="12" y1="22" x2="12" y2="17"/>
              <circle cx="12" cy="12" r="2.8" fill="#10b981"/>
            </svg>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      const marker = L.marker([latCenter, lonCenter], {
        icon: originIcon,
        draggable: true,
        title: 'Starting Point (Drag or click anywhere on the map to move)'
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 11px; color: #0f172a;">
          <strong style="color: #047857;">Origin Anchor Point</strong><br/>
          Lat: ${latCenter.toFixed(6)}<br/>
          Lon: ${lonCenter.toFixed(6)}<br/>
          <span style="color: #64748b; font-size: 10px;">Drag or click map to reposition</span>
        </div>
      `);

      marker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng();
        const nLat = Number(lat.toFixed(6));
        const nLon = Number(lng.toFixed(6));
        setLatCenter(nLat);
        setLonCenter(nLon);
      });

      originMarkerRef.current = marker;

      // Click on map to place origin
      map.on('click', (e) => {
        const nLat = Number(e.latlng.lat.toFixed(6));
        const nLon = Number(e.latlng.lng.toFixed(6));
        setLatCenter(nLat);
        setLonCenter(nLon);
        if (originMarkerRef.current) {
          originMarkerRef.current.setLatLng([nLat, nLon]);
          originMarkerRef.current.getPopup()?.setContent(`
            <div style="font-family: sans-serif; font-size: 11px; color: #0f172a;">
              <strong style="color: #047857;">Origin Anchor Point</strong><br/>
              Lat: ${nLat.toFixed(6)}<br/>
              Lon: ${nLon.toFixed(6)}<br/>
              <span style="color: #64748b; font-size: 10px;">Drag or click map to reposition</span>
            </div>
          `);
        }
      });

      mapInstanceRef.current = map;
    } catch (err) {
      console.warn('Map initialization warning:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Update Map Tile Layer on mapType change
  useEffect(() => {
    if (!mapInstanceRef.current || !isLeafletAvailable) return;
    try {
      if (tileLayerRef.current) {
        mapInstanceRef.current.removeLayer(tileLayerRef.current);
      }
      const provider = TILE_PROVIDERS[mapType] || TILE_PROVIDERS.dark;
      tileLayerRef.current = L.tileLayer(provider.url, {
        maxZoom: provider.maxZoom
      }).addTo(mapInstanceRef.current);
    } catch (err) {
      console.warn('Tile change warning:', err);
    }
  }, [mapType, isLeafletAvailable]);

  // 3. Update Origin Marker position when latCenter/lonCenter change via inputs
  useEffect(() => {
    if (!originMarkerRef.current || !mapInstanceRef.current) return;
    const current = originMarkerRef.current.getLatLng();
    if (Math.abs(current.lat - latCenter) > 0.000001 || Math.abs(current.lng - lonCenter) > 0.000001) {
      originMarkerRef.current.setLatLng([latCenter, lonCenter]);
    }
  }, [latCenter, lonCenter]);

  // 4. Update Ghost Bounding Box Preview on map
  useEffect(() => {
    if (!mapInstanceRef.current || !previewBoxLayerRef.current || !isLeafletAvailable) return;
    previewBoxLayerRef.current.clearLayers();

    const clean = String(text || '').trim();
    if (!clean) return;

    const scale = Number(letterScale) || 1.0;
    const effW = (Number(letterW) || 0.04) * scale;
    const effH = (Number(letterH) || 0.06) * scale;
    const effGap = (Number(gap) || 0.02) * scale;

    const totalWidth = clean.length * (effW + effGap);
    const totalHeight = effH;

    const corner1 = [latCenter - totalHeight, lonCenter];
    const corner2 = [latCenter, lonCenter + totalWidth];

    try {
      const box = L.rectangle([corner1, corner2], {
        color: '#10b981',
        weight: 1.5,
        dashArray: '4, 6',
        fillColor: '#10b981',
        fillOpacity: 0.07
      });
      previewBoxLayerRef.current.addLayer(box);
    } catch (e) {
      // Ignored in headless/test environments
    }
  }, [text, latCenter, lonCenter, letterW, letterH, letterScale, gap, isLeafletAvailable]);

  // 5. Run Generation Algorithm
  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    try {
      const result = generateDemoAps({
        text,
        latCenter: Number(latCenter),
        lonCenter: Number(lonCenter),
        letterW: Number(letterW),
        letterH: Number(letterH),
        letterScale: Number(letterScale),
        gap: Number(gap),
        speedKmh: Number(speedKmh),
        stepIntervalSeconds: Number(stepIntervalSeconds),
        targetApCount: densityMode === 'target' ? Number(targetApCount) : null,
        seed: useFixedSeed ? Number(seed) : Math.floor(Math.random() * 100000)
      });

      setGeneratedResult(result);
      onLogMessage(`[DEMO WARDRIVE] Generated ${result.aps.length} synthetic APs for text "${text}" at (${latCenter}, ${lonCenter})`);

      // Plot onto map
      if (mapInstanceRef.current && isLeafletAvailable) {
        if (pathLayerRef.current) pathLayerRef.current.clearLayers();
        if (apMarkersLayerRef.current) apMarkersLayerRef.current.clearLayers();

        // 1. Draw Flight / Master Vector Path
        if (result.masterPath.length > 1) {
          const latLngs = result.masterPath.map(pt => [pt[1], pt[0]]);
          const polyline = L.polyline(latLngs, {
            color: '#38bdf8',
            weight: 2,
            opacity: 0.5,
            dashArray: '3, 4'
          });
          pathLayerRef.current.addLayer(polyline);
        }

        // 2. Draw AP Points
        const markerGroup = L.featureGroup();
        result.aps.forEach((ap) => {
          let markerColor = '#10b981'; // Strong
          if (ap.rssi < -75) markerColor = '#f59e0b'; // Moderate
          if (ap.rssi < -85) markerColor = '#f43f5e'; // Weak

          const circle = L.circleMarker([ap.lat, ap.lon], {
            radius: 3.5,
            color: '#ffffff',
            weight: 0.8,
            fillColor: markerColor,
            fillOpacity: 0.85
          });

          circle.bindPopup(`
            <div style="font-family: sans-serif; font-size: 11px; min-width: 170px; color: #0f172a;">
              <div style="font-weight: bold; font-size: 13px; color: #0284c7; margin-bottom: 2px;">
                ${ap.ssid}
              </div>
              <div style="font-family: monospace; font-size: 11px; color: #475569; margin-bottom: 6px;">
                ${ap.mac}
              </div>
              <div><strong>Signal:</strong> <span style="color: ${markerColor}; font-weight: bold;">${ap.rssi} dBm</span></div>
              <div><strong>Channel:</strong> ${ap.channel}</div>
              <div><strong>Security:</strong> ${ap.auth}</div>
              <div><strong>Timestamp:</strong> ${ap.first_seen}</div>
              <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #cbd5e1; font-size: 10px; color: #64748b;">
                Coords: ${ap.lat.toFixed(6)}, ${ap.lon.toFixed(6)}
              </div>
            </div>
          `);

          circle.on('click', () => setSelectedAp(ap));
          markerGroup.addLayer(circle);
        });

        apMarkersLayerRef.current.addLayer(markerGroup);

        // Zoom map to fit generated points
        if (result.bounds) {
          const corner1 = [result.bounds.minLat, result.bounds.minLon];
          const corner2 = [result.bounds.maxLat, result.bounds.maxLon];
          mapInstanceRef.current.fitBounds([corner1, corner2], { padding: [40, 40], maxZoom: 14 });
        }
      }
    } catch (err) {
      console.error('Generation failed:', err);
      onLogMessage(`[ERROR] Wardrive demo generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [text, latCenter, lonCenter, letterW, letterH, letterScale, gap, speedKmh, stepIntervalSeconds, densityMode, targetApCount, useFixedSeed, seed, isLeafletAvailable, onLogMessage]);

  // Auto-generate on mount
  useEffect(() => {
    if (!generatedResult) {
      handleGenerate();
    }
  }, []);

  // Quick preset selector
  const handleSelectPreset = (preset) => {
    setLatCenter(preset.lat);
    setLonCenter(preset.lon);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([preset.lat, preset.lon], preset.zoom);
    }
    if (originMarkerRef.current) {
      originMarkerRef.current.setLatLng([preset.lat, preset.lon]);
    }
  };

  // Browser Geolocation
  const handleUseMyLocation = () => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lon = Number(pos.coords.longitude.toFixed(6));
          setLatCenter(lat);
          setLonCenter(lon);
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([lat, lon], 12);
          }
          if (originMarkerRef.current) {
            originMarkerRef.current.setLatLng([lat, lon]);
          }
          onLogMessage(`[GPS] Centered origin on device location: ${lat}, ${lon}`);
        },
        (err) => {
          alert(`Unable to retrieve GPS coordinates: ${err.message}`);
        },
        { timeout: 8000 }
      );
    }
  };

  // Export File Helpers
  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onLogMessage(`[EXPORT] Downloaded ${filename}`);
  };

  const getCleanBaseFilename = () => {
    return (text || 'demo').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  };

  const handleDownloadWigle = () => {
    if (!generatedResult?.aps?.length) return;
    const csv = generateWigleCsv(generatedResult.aps, includePreheader);
    downloadFile(`${getCleanBaseFilename()}_wigle.csv`, csv, 'text/csv');
  };

  const handleDownloadKepler = () => {
    if (!generatedResult?.aps?.length) return;
    const csv = generateTestCsv(generatedResult.aps);
    downloadFile(`${getCleanBaseFilename()}_test.csv`, csv, 'text/csv');
  };

  const handleDownloadPython = () => {
    const py = exportPythonScriptSource({
      text,
      latCenter,
      lonCenter,
      letterW,
      letterH,
      letterScale,
      gap,
      speedKmh,
      stepIntervalSeconds,
      targetApCount: densityMode === 'target' ? targetApCount : null,
      includePreheader
    });
    downloadFile(`${getCleanBaseFilename()}_generator.py`, py, 'text/x-python');
  };

  const handleCopyClipboard = (type) => {
    if (!generatedResult?.aps?.length) return;
    let content = '';
    if (type === 'wigle') {
      content = generateWigleCsv(generatedResult.aps, includePreheader);
    } else if (type === 'kepler') {
      content = generateTestCsv(generatedResult.aps);
    } else if (type === 'python') {
      content = exportPythonScriptSource({
        text,
        latCenter,
        lonCenter,
        letterW,
        letterH,
        letterScale,
        gap,
        speedKmh,
        stepIntervalSeconds,
        targetApCount: densityMode === 'target' ? targetApCount : null,
        includePreheader
      });
    }

    navigator.clipboard.writeText(content).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    });
  };

  // Filtered Table Records
  const filteredAps = useMemo(() => {
    if (!generatedResult?.aps) return [];
    if (!tableSearch) return generatedResult.aps;
    const q = tableSearch.toLowerCase();
    return generatedResult.aps.filter(
      ap => ap.ssid.toLowerCase().includes(q) || 
            ap.mac.toLowerCase().includes(q) || 
            ap.auth.toLowerCase().includes(q)
    );
  }, [generatedResult, tableSearch]);

  return (
    <div className="w-full space-y-4">
      {/* Top Banner / Tool Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              DEMO WARDRIVE VECTOR GENERATOR
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Kepler.gl & WiGLE Map Art
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Pick coordinates on the map, customize AP count, letter size & vehicle speed, and synthesize Wi-Fi wardriving trails
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('map')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === 'map'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Interactive Map</span>
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === 'table'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>AP Table ({generatedResult?.aps?.length || 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('python')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === 'python'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Python Script</span>
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === 'guide'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>Kepler Guide</span>
          </button>
        </div>
      </div>

      {/* Main Control Card */}
      <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-4">
        {/* Row 1: Word & Coordinates */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Word / Text Input */}
          <div className="md:col-span-5 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>Text / Phrase to Map</span>
              <span className="text-[10px] text-slate-500 font-mono">A-Z, 0-9, space</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value.toUpperCase())}
                placeholder="Enter word (e.g. KEPLER)"
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm font-mono text-emerald-400 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 tracking-wider"
              />
              <span className="absolute right-2.5 top-2.5 text-[10px] font-mono text-slate-500">
                {text.length} chars
              </span>
            </div>
          </div>

          {/* Latitude Input */}
          <div className="md:col-span-2 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300">
              <span>Latitude (Y)</span>
            </label>
            <input
              type="number"
              step="0.0001"
              value={latCenter}
              onChange={(e) => setLatCenter(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Longitude Input */}
          <div className="md:col-span-2 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300">
              <span>Longitude (X)</span>
            </label>
            <input
              type="number"
              step="0.0001"
              value={lonCenter}
              onChange={(e) => setLonCenter(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Action Button: Run Generator */}
          <div className="md:col-span-3 flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-emerald-950/40"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Generate APs</span>
                </>
              )}
            </button>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              title="Advanced Vector & Geometry Settings"
              className={`p-2 rounded-lg border text-xs transition ${
                showAdvanced 
                  ? 'bg-slate-800 border-slate-600 text-slate-200' 
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: 3 Interactive Sliders & Presets (Amount of APs, Letter Size, Speed) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
          {/* Parameter 1: Amount of APs */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-cyan-400" />
                <span>Amount of APs</span>
              </label>
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  onClick={() => setDensityMode('target')}
                  className={`px-1.5 py-0.5 rounded ${
                    densityMode === 'target' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Fixed Count
                </button>
                <button
                  onClick={() => setDensityMode('auto')}
                  className={`px-1.5 py-0.5 rounded ${
                    densityMode === 'auto' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  From Speed
                </button>
              </div>
            </div>

            {densityMode === 'target' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 text-[10px]">Density Slider</span>
                  <span className="text-cyan-400 font-bold">{targetApCount.toLocaleString()} APs</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="3000"
                  step="50"
                  value={targetApCount}
                  onChange={(e) => setTargetApCount(parseInt(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
                <div className="flex items-center justify-between gap-1 pt-1">
                  {AP_COUNT_PRESETS.map((p) => (
                    <button
                      key={p.count}
                      onClick={() => setTargetApCount(p.count)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition border ${
                        targetApCount === p.count
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 py-2 space-y-1">
                <div>AP density determined automatically by vehicle speed ({speedKmh} km/h) and sighting interval ({stepIntervalSeconds}s).</div>
                <div className="text-cyan-400 font-mono text-[10px]">Natural drive trail sampling</div>
              </div>
            )}
          </div>

          {/* Parameter 2: Letter Size & Scale */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Letter Size & Scale</span>
              </label>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                {letterScale.toFixed(2)}x
              </span>
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 text-[10px]">Real Footprint</span>
              <span className="text-slate-300 text-[10px] font-mono">
                ~{physicalMetrics.widthKm} km × ~{physicalMetrics.heightKm} km
              </span>
            </div>

            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.05"
              value={letterScale}
              onChange={(e) => setLetterScale(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />

            <div className="flex items-center justify-between gap-1 pt-1">
              {SCALE_PRESETS.map((p) => (
                <button
                  key={p.scale}
                  onClick={() => setLetterScale(p.scale)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition border ${
                    Math.abs(letterScale - p.scale) < 0.01
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Parameter 3: Wardrive Vehicle Speed */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-amber-400" />
                <span>Wardrive Speed</span>
              </label>
              <span className="text-[10px] font-mono text-amber-400 font-bold">
                {speedKmh} km/h ({(speedKmh * 0.621371).toFixed(0)} mph)
              </span>
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 text-[10px]">Vehicle Velocity</span>
              <span className="text-slate-400 text-[10px]">Step: {stepIntervalSeconds}s</span>
            </div>

            <input
              type="range"
              min="5"
              max="250"
              step="5"
              value={speedKmh}
              onChange={(e) => setSpeedKmh(parseFloat(e.target.value))}
              className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />

            <div className="flex items-center justify-between gap-1 pt-1">
              {SPEED_PRESETS.map((p) => (
                <button
                  key={p.speed}
                  onClick={() => setSpeedKmh(p.speed)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition border ${
                    speedKmh === p.speed
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Location Presets & Coordinate Helpers */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
              <Crosshair className="w-3 h-3 text-emerald-400" />
              Locations:
            </span>
            {LOCATION_PRESETS.slice(0, 5).map((p) => (
              <button
                key={p.name}
                onClick={() => handleSelectPreset(p)}
                className="px-2 py-0.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-[11px] text-slate-300 font-mono transition"
              >
                {p.name.split(' ')[0]}
              </button>
            ))}
            <button
              onClick={handleUseMyLocation}
              className="px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded text-[11px] text-emerald-400 font-medium transition flex items-center gap-1"
            >
              <Crosshair className="w-2.5 h-2.5" />
              <span>Current GPS</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400">
            Click map or drag the green crosshair to reposition starting point.
          </div>
        </div>

        {/* Collapsible Advanced Settings */}
        {showAdvanced && (
          <div className="mt-3 p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-3 animate-fadeIn">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Base Font Geometry & Simulation PRNG</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Base Width (°)</label>
                <input
                  type="number"
                  step="0.005"
                  value={letterW}
                  onChange={(e) => setLetterW(parseFloat(e.target.value) || 0.04)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Base Height (°)</label>
                <input
                  type="number"
                  step="0.005"
                  value={letterH}
                  onChange={(e) => setLetterH(parseFloat(e.target.value) || 0.06)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Letter Gap (°)</label>
                <input
                  type="number"
                  step="0.005"
                  value={gap}
                  onChange={(e) => setGap(parseFloat(e.target.value) || 0.02)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Sighting Interval (s)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={stepIntervalSeconds}
                  onChange={(e) => setStepIntervalSeconds(parseInt(e.target.value) || 3)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Random Seed</label>
                <input
                  type="number"
                  value={seed}
                  disabled={!useFixedSeed}
                  onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200 disabled:opacity-40"
                />
              </div>

              <div className="space-y-1 flex flex-col justify-end">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={includePreheader}
                    onChange={(e) => setIncludePreheader(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>WiGLE Header</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300 mt-1">
                  <input
                    type="checkbox"
                    checked={useFixedSeed}
                    onChange={(e) => setUseFixedSeed(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Fixed Seed (42)</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats Summary Bar & One-Click Exports */}
      {generatedResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Synthesized APs</div>
              <div className="text-xl font-bold font-mono text-emerald-400">
                {generatedResult.aps.length.toLocaleString()}
              </div>
            </div>
            <Radio className="w-5 h-5 text-emerald-500/50" />
          </div>

          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Simulated Drive</div>
              <div className="text-xl font-bold font-mono text-cyan-400">
                {Math.round(generatedResult.durationSeconds / 60)} min
              </div>
            </div>
            <Clock className="w-5 h-5 text-cyan-500/50" />
          </div>

          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Letter Span</div>
              <div className="text-sm font-bold font-mono text-purple-400">
                {physicalMetrics.widthKm} × {physicalMetrics.heightKm} km
              </div>
            </div>
            <Maximize2 className="w-5 h-5 text-purple-500/50" />
          </div>

          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Simulated Velocity</div>
              <div className="text-sm font-bold font-mono text-amber-400">
                {speedKmh} km/h
              </div>
            </div>
            <Gauge className="w-5 h-5 text-amber-500/50" />
          </div>
        </div>
      )}

      {/* Main View Area */}
      {activeTab === 'map' && (
        <div className="space-y-3">
          {/* Map Chrome Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-semibold flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                Tile Style:
              </span>
              <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[11px]">
                {Object.keys(TILE_PROVIDERS).map((k) => (
                  <button
                    key={k}
                    onClick={() => setMapType(k)}
                    className={`px-2 py-0.5 rounded transition ${
                      mapType === k ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {TILE_PROVIDERS[k].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Export Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadWigle}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded text-xs font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>WiGLE CSV</span>
              </button>

              <button
                onClick={handleDownloadKepler}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 rounded text-xs font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Kepler CSV</span>
              </button>

              <a
                href="https://kepler.gl/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 rounded text-xs font-semibold transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Kepler.gl</span>
              </a>
            </div>
          </div>

          {/* Map Container */}
          <div className="relative w-full h-[540px] rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950">
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            {/* Floating Map Legend & Overlay */}
            <div className="absolute top-3 right-3 z-[1000] bg-slate-950/90 border border-slate-800 p-2.5 rounded-lg backdrop-blur shadow-xl text-[11px] space-y-1.5 pointer-events-auto">
              <div className="font-bold text-slate-200 flex items-center justify-between gap-4">
                <span>Signal Strength (RSSI)</span>
                <span className="text-[10px] text-slate-400 font-mono">{generatedResult?.aps?.length || 0} APs</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                  &gt; -75 dBm
                </span>
                <span className="flex items-center gap-1 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                  -75 to -85
                </span>
                <span className="flex items-center gap-1 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                  &lt; -85 dBm
                </span>
              </div>
            </div>

            {/* Selected AP Details Floating Drawer */}
            {selectedAp && (
              <div className="absolute bottom-3 left-3 z-[1000] bg-slate-950/95 border border-slate-700 p-3 rounded-lg backdrop-blur-md shadow-2xl text-xs max-w-sm pointer-events-auto space-y-1">
                <div className="flex items-center justify-between text-slate-200 font-bold border-b border-slate-800 pb-1">
                  <span className="text-cyan-400 font-mono">{selectedAp.ssid}</span>
                  <button onClick={() => setSelectedAp(null)} className="text-slate-400 hover:text-slate-200">✕</button>
                </div>
                <div className="font-mono text-[11px] text-slate-400">BSSID: <span className="text-slate-200">{selectedAp.mac}</span></div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                  <div>Signal: <span className="text-emerald-400 font-bold">{selectedAp.rssi} dBm</span></div>
                  <div>Channel: <span className="text-slate-200">{selectedAp.channel}</span></div>
                  <div>Auth: <span className="text-slate-300">{selectedAp.auth}</span></div>
                  <div>Time: <span className="text-slate-400">{selectedAp.first_seen}</span></div>
                </div>
                <div className="text-[10px] font-mono text-slate-500 pt-1">
                  Coords: {selectedAp.lat.toFixed(6)}, {selectedAp.lon.toFixed(6)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AP Data Table View */}
      {activeTab === 'table' && (
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search SSID, MAC, or Auth..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopyClipboard('wigle')}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition"
              >
                {copiedType === 'wigle' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy WiGLE CSV</span>
              </button>

              <button
                onClick={() => handleCopyClipboard('kepler')}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition"
              >
                {copiedType === 'kepler' ? <Check className="w-3.5 h-3.5 text-cyan-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy Kepler CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] border border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">SSID</th>
                  <th className="py-2 px-3">BSSID / MAC</th>
                  <th className="py-2 px-3">AuthMode</th>
                  <th className="py-2 px-3">CH</th>
                  <th className="py-2 px-3">RSSI</th>
                  <th className="py-2 px-3">Latitude</th>
                  <th className="py-2 px-3">Longitude</th>
                  <th className="py-2 px-3">First Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/30 text-slate-300">
                {filteredAps.map((ap, idx) => (
                  <tr key={ap.mac + idx} className="hover:bg-slate-800/40 transition">
                    <td className="py-1.5 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1.5 px-3 text-cyan-400 font-semibold">{ap.ssid}</td>
                    <td className="py-1.5 px-3 text-slate-300">{ap.mac}</td>
                    <td className="py-1.5 px-3 text-slate-400 text-[11px]">{ap.auth}</td>
                    <td className="py-1.5 px-3 text-amber-400">{ap.channel}</td>
                    <td className={`py-1.5 px-3 font-semibold ${
                      ap.rssi >= -65 ? 'text-emerald-400' : ap.rssi >= -80 ? 'text-cyan-400' : 'text-rose-400'
                    }`}>
                      {ap.rssi} dBm
                    </td>
                    <td className="py-1.5 px-3 text-slate-300">{ap.lat.toFixed(6)}</td>
                    <td className="py-1.5 px-3 text-slate-300">{ap.lon.toFixed(6)}</td>
                    <td className="py-1.5 px-3 text-slate-500 text-[11px]">{ap.first_seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Standalone Python Script Source View */}
      {activeTab === 'python' && (
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                Standalone Python Script Source
              </h3>
              <p className="text-[11px] text-slate-400">
                Self-contained Python script with your configured AP count, letter size, speed, and coordinates
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopyClipboard('python')}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 transition"
              >
                {copiedType === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy Python Code</span>
              </button>

              <button
                onClick={handleDownloadPython}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded-lg text-xs font-semibold text-amber-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .py</span>
              </button>
            </div>
          </div>

          <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-emerald-400/90 overflow-x-auto max-h-[500px] leading-relaxed">
            {exportPythonScriptSource({
              text,
              latCenter,
              lonCenter,
              letterW,
              letterH,
              letterScale,
              gap,
              speedKmh,
              stepIntervalSeconds,
              targetApCount: densityMode === 'target' ? targetApCount : null,
              includePreheader
            })}
          </pre>
        </div>
      )}

      {/* Kepler.gl Visualizer Guide */}
      {activeTab === 'guide' && (
        <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Visualizing in Kepler.gl in 3 Steps</h3>
              <p className="text-xs text-slate-400">How to turn your generated AP points into glowing map art</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
              <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center border border-emerald-500/30">
                1
              </div>
              <h4 className="text-xs font-bold text-slate-200">Download the Kepler CSV</h4>
              <p className="text-xs text-slate-400">
                Click the <strong>Kepler CSV</strong> download button above to get the clean tabular file with <code className="text-cyan-400 font-mono">lat</code>, <code className="text-cyan-400 font-mono">lon</code>, and <code className="text-cyan-400 font-mono">first_seen</code>.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center border border-cyan-500/30">
                2
              </div>
              <h4 className="text-xs font-bold text-slate-200">Open Kepler.gl Demo</h4>
              <p className="text-xs text-slate-400">
                Visit <a href="https://kepler.gl/demo" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline font-semibold">kepler.gl/demo</a> and drag & drop the downloaded CSV file into the browser window.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold flex items-center justify-center border border-purple-500/30">
                3
              </div>
              <h4 className="text-xs font-bold text-slate-200">Customize Layers & Play</h4>
              <p className="text-xs text-slate-400">
                Kepler automatically auto-detects the points. Enable the <strong>Point</strong> layer, set color to Cyan or Emerald, and watch your vector word appear across the landscape!
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <a
              href="https://kepler.gl/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-purple-950/40"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Launch Kepler.gl Demo Site</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
