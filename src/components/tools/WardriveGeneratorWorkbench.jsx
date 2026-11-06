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
  Ruler,
  Upload,
  Image,
  Type,
  Calendar,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical
} from 'lucide-react';
import { 
  generateDemoAps, 
  generateWigleCsv, 
  generateTestCsv, 
  exportPythonScriptSource,
  parseSvgToNormalizedStrokes,
  dateToLocalDatetimeString,
  SVG_PRESETS,
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
  { label: '0.5x (~3km)', scale: 0.5 },
  { label: '1.0x (~6km)', scale: 1.0 },
  { label: '5.0x (~30km)', scale: 5.0 },
  { label: '10.0x (~60km)', scale: 10.0 },
  { label: '25.0x (~160km)', scale: 25.0 },
  { label: '50.0x (~330km)', scale: 50.0 },
  { label: '100.0x (~660km)', scale: 100.0 }
];

const DENSITY_PRESETS = [
  { label: '10', value: 10 },
  { label: '50', value: 50 },
  { label: '200', value: 200 },
  { label: '500', value: 500 },
  { label: '1,000', value: 1000 },
  { label: '5,000 (~500k)', value: 5000 }
];

export default function WardriveGeneratorWorkbench({ onLogMessage = () => {} }) {
  // Input parameters & mode
  const [artMode, setArtMode] = useState('text'); // 'text' | 'svg'
  const [text, setText] = useState('KEPLER');
  const [latCenter, setLatCenter] = useState(32.25);
  const [lonCenter, setLonCenter] = useState(-90.13);

  // SVG mode state
  const [selectedSvgPreset, setSelectedSvgPreset] = useState('wifi');
  const [customSvgCode, setCustomSvgCode] = useState('');
  const [showSvgPasteModal, setShowSvgPasteModal] = useState(false);
  const [svgFileName, setSvgFileName] = useState(null);
  const [parsedSvgStrokes, setParsedSvgStrokes] = useState(() => {
    const p = SVG_PRESETS.find(item => item.id === 'wifi') || SVG_PRESETS[0];
    return parseSvgToNormalizedStrokes(p.svg).strokes;
  });
  const fileInputRef = useRef(null);

  // SVG Transformations: Rotation & Scaling
  const [rotationDeg, setRotationDeg] = useState(0);
  const [svgScale, setSvgScale] = useState(1.0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const handleRotateBy = (deg) => {
    setRotationDeg((prev) => (prev + deg + 360) % 360);
  };

  // 1. Density Control: APs per KM or Mile (allows scaling to 500k+)
  const [densityUnit, setDensityUnit] = useState('km'); // 'km' | 'mile'
  const [apsPerUnit, setApsPerUnit] = useState(100);

  // 2. Letter Size & Scale Controls (expandable to 100x+ for giant footprints)
  const [letterScale, setLetterScale] = useState(1.0);
  const [letterW, setLetterW] = useState(0.04);
  const [letterH, setLetterH] = useState(0.06);
  const [gap, setGap] = useState(0.02);

  // 3. Wardrive Simulation Speed Controls
  const [speedKmh, setSpeedKmh] = useState(50.0);

  // 4. Wardrive Start Clock & Date
  const [startTimeLocal, setStartTimeLocal] = useState(() => {
    const d = new Date(Date.now() - 24 * 3600 * 1000);
    return dateToLocalDatetimeString(d);
  });

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

    let widthKmNum, heightKmNum;
    if (artMode === 'svg') {
      const effSvgScale = Number(svgScale) > 0 ? Number(svgScale) : 1.0;
      widthKmNum = effW * 6.0 * effSvgScale * kmPerLonDeg;
      heightKmNum = effH * 4.0 * effSvgScale * kmPerLatDeg;
    } else {
      const totalWidthDeg = count * (effW + effGap);
      const totalHeightDeg = effH;
      widthKmNum = totalWidthDeg * kmPerLonDeg;
      heightKmNum = totalHeightDeg * kmPerLatDeg;
    }

    const widthKm = widthKmNum.toFixed(1);
    const heightKm = heightKmNum.toFixed(1);
    const widthMi = (widthKmNum * 0.621371).toFixed(1);
    const heightMi = (heightKmNum * 0.621371).toFixed(1);

    const unitFactor = densityUnit === 'mile' ? 1.609344 : 1.0;
    const effApsPerKm = (Number(apsPerUnit) || 100) / unitFactor;
    const spacingMeters = (1000.0 / Math.max(0.001, effApsPerKm)).toFixed(1);

    return {
      effW,
      effH,
      effGap,
      widthKm,
      heightKm,
      widthMi,
      heightMi,
      spacingMeters
    };
  }, [text, latCenter, letterW, letterH, letterScale, gap, densityUnit, apsPerUnit, artMode, svgScale]);

  // Clock / Start Date Quick Action Handlers
  const handleSetClockNow = () => {
    const str = dateToLocalDatetimeString(new Date());
    setStartTimeLocal(str);
    onLogMessage(`[CLOCK] Set wardrive start time to NOW (${str.replace('T', ' ')})`);
  };

  const handleSetClockMinus1Hour = () => {
    const str = dateToLocalDatetimeString(new Date(Date.now() - 3600 * 1000));
    setStartTimeLocal(str);
    onLogMessage(`[CLOCK] Set wardrive start time to 1 hour ago (${str.replace('T', ' ')})`);
  };

  const handleSetClockYesterday = () => {
    const str = dateToLocalDatetimeString(new Date(Date.now() - 24 * 3600 * 1000));
    setStartTimeLocal(str);
    onLogMessage(`[CLOCK] Set wardrive start time to yesterday (${str.replace('T', ' ')})`);
  };

  const handleSetClockMinus7Days = () => {
    const str = dateToLocalDatetimeString(new Date(Date.now() - 7 * 24 * 3600 * 1000));
    setStartTimeLocal(str);
    onLogMessage(`[CLOCK] Set wardrive start time to 7 days ago (${str.replace('T', ' ')})`);
  };

  // SVG Preset and Upload Handlers
  const handleSelectSvgPreset = (preset) => {
    setSelectedSvgPreset(preset.id);
    setSvgFileName(null);
    setCustomSvgCode(preset.svg);
    const res = parseSvgToNormalizedStrokes(preset.svg);
    setParsedSvgStrokes(res.strokes);
    if (!text || text === 'KEPLER' || text.startsWith('SVG_')) {
      setText(preset.name.replace(/\s+/g, '_').toUpperCase());
    }
    onLogMessage(`[SVG] Loaded preset "${preset.name}" (${res.strokes.length} paths)`);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const svgText = evt.target.result;
      setCustomSvgCode(svgText);
      setSvgFileName(file.name);
      setSelectedSvgPreset('custom');
      const res = parseSvgToNormalizedStrokes(svgText);
      if (res.strokes.length === 0) {
        alert('Could not find any readable vector strokes (<path>, <polyline>, <polygon>, <circle>, <line>) in the uploaded SVG.');
        return;
      }
      setParsedSvgStrokes(res.strokes);
      const cleanName = file.name.replace(/\.svg$/i, '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
      setText(cleanName);
      onLogMessage(`[SVG] Imported "${file.name}" with ${res.strokes.length} vector strokes`);
    };
    reader.readAsText(file);
  };

  const handleApplyCustomSvgPaste = () => {
    if (!customSvgCode.trim()) return;
    const res = parseSvgToNormalizedStrokes(customSvgCode);
    if (res.strokes.length === 0) {
      alert('Could not parse any vector paths from the provided SVG markup.');
      return;
    }
    setParsedSvgStrokes(res.strokes);
    setSelectedSvgPreset('custom');
    setSvgFileName('custom_pasted.svg');
    setShowSvgPasteModal(false);
    onLogMessage(`[SVG] Applied custom SVG markup with ${res.strokes.length} paths`);
  };

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
    if (artMode === 'text' && !clean) return;

    const scale = Number(letterScale) || 1.0;
    const effW = (Number(letterW) || 0.04) * scale;
    const effH = (Number(letterH) || 0.06) * scale;
    const effGap = (Number(gap) || 0.02) * scale;

    try {
      if (artMode === 'svg') {
        const effectiveSvgScale = scale * (Number(svgScale) > 0 ? Number(svgScale) : 1.0);
        const svgSpanLon = (Number(letterW) || 0.04) * 6.0 * effectiveSvgScale;
        const svgSpanLat = (Number(letterH) || 0.06) * 4.0 * effectiveSvgScale;
        const rad = ((Number(rotationDeg) || 0) * Math.PI) / 180.0;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);

        const transformCorner = (px, py) => {
          let x = px;
          let y = py;
          if (flipH) x = 1.0 - x;
          if (flipV) y = 1.0 - y;
          const dx = x - 0.5;
          const dy = y - 0.5;
          const rx = dx * cosR - dy * sinR;
          const ry = dx * sinR + dy * cosR;
          const lon = lonCenter + (rx + 0.5) * svgSpanLon;
          const lat = latCenter - (ry + 0.5) * svgSpanLat;
          return [lat, lon];
        };

        const corners = [
          transformCorner(0, 0),
          transformCorner(1, 0),
          transformCorner(1, 1),
          transformCorner(0, 1)
        ];

        const polygon = L.polygon(corners, {
          color: '#06b6d4',
          weight: 1.5,
          dashArray: '4, 6',
          fillColor: '#06b6d4',
          fillOpacity: 0.07
        });
        previewBoxLayerRef.current.addLayer(polygon);
      } else {
        const totalWidth = clean.length * (effW + effGap);
        const totalHeight = effH;
        const corner1 = [latCenter - totalHeight, lonCenter];
        const corner2 = [latCenter, lonCenter + totalWidth];

        const box = L.rectangle([corner1, corner2], {
          color: '#10b981',
          weight: 1.5,
          dashArray: '4, 6',
          fillColor: '#10b981',
          fillOpacity: 0.07
        });
        previewBoxLayerRef.current.addLayer(box);
      }
    } catch (e) {
      // Ignored in headless/test environments
    }
  }, [text, latCenter, lonCenter, letterW, letterH, letterScale, gap, artMode, svgScale, rotationDeg, flipH, flipV, isLeafletAvailable]);

  // 5. Run Generation Algorithm
  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    try {
      const parsedStart = startTimeLocal ? new Date(startTimeLocal) : new Date(Date.now() - 24 * 3600 * 1000);
      const result = generateDemoAps({
        text,
        mode: artMode,
        svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
        latCenter: Number(latCenter),
        lonCenter: Number(lonCenter),
        letterW: Number(letterW),
        letterH: Number(letterH),
        letterScale: Number(letterScale),
        gap: Number(gap),
        densityUnit,
        apsPerUnit: Number(apsPerUnit) || 100,
        speedKmh: Number(speedKmh),
        startTime: parsedStart,
        rotationDeg: Number(rotationDeg) || 0,
        svgScale: Number(svgScale) || 1.0,
        flipH,
        flipV,
        seed: useFixedSeed ? Number(seed) : Math.floor(Math.random() * 100000)
      });

      setGeneratedResult(result);
      const modeDesc = artMode === 'svg' ? `SVG art (${parsedSvgStrokes.length} paths)` : `text "${text}"`;
      onLogMessage(`[DEMO WARDRIVE] Generated ${result.aps.length.toLocaleString()} synthetic APs (${apsPerUnit}/${densityUnit}) for ${modeDesc}`);

      // Plot onto map with sampling protection for 500k+ points
      if (mapInstanceRef.current && isLeafletAvailable) {
        if (pathLayerRef.current) pathLayerRef.current.clearLayers();
        if (apMarkersLayerRef.current) apMarkersLayerRef.current.clearLayers();

        // 1. Draw Full Flight / Master Vector Path (always complete)
        if (result.masterPath.length > 1) {
          const latLngs = result.masterPath.map(pt => [pt[1], pt[0]]);
          const polyline = L.polyline(latLngs, {
            color: '#38bdf8',
            weight: 2,
            opacity: 0.6,
            dashArray: '3, 4'
          });
          pathLayerRef.current.addLayer(polyline);
        }

        // 2. Draw Sampled AP Markers (renders up to 1,500 points to keep map at 60 FPS)
        const maxMarkers = 1500;
        const stride = Math.max(1, Math.floor(result.aps.length / maxMarkers));

        const markerGroup = L.featureGroup();
        for (let i = 0; i < result.aps.length; i += stride) {
          const ap = result.aps[i];
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
        }

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
  }, [text, artMode, parsedSvgStrokes, startTimeLocal, latCenter, lonCenter, letterW, letterH, letterScale, gap, densityUnit, apsPerUnit, speedKmh, rotationDeg, svgScale, flipH, flipV, useFixedSeed, seed, isLeafletAvailable, onLogMessage]);

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
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
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
      mode: artMode,
      svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
      latCenter,
      lonCenter,
      letterW,
      letterH,
      letterScale,
      gap,
      densityUnit,
      apsPerUnit,
      speedKmh,
      startTime: startTimeLocal,
      rotationDeg,
      svgScale,
      flipH,
      flipV,
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
        mode: artMode,
        svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
        latCenter,
        lonCenter,
        letterW,
        letterH,
        letterScale,
        gap,
        densityUnit,
        apsPerUnit,
        speedKmh,
        startTime: startTimeLocal,
        rotationDeg,
        svgScale,
        flipH,
        flipV,
        includePreheader
      });
    }

    navigator.clipboard.writeText(content).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    });
  };

  // Filtered Table Records (shows first 500 for high performance)
  const filteredAps = useMemo(() => {
    if (!generatedResult?.aps) return [];
    if (!tableSearch) return generatedResult.aps.slice(0, 500);
    const q = tableSearch.toLowerCase();
    const matched = [];
    for (let i = 0; i < generatedResult.aps.length; i++) {
      const ap = generatedResult.aps[i];
      if (ap.ssid.toLowerCase().includes(q) || ap.mac.toLowerCase().includes(q) || ap.auth.toLowerCase().includes(q)) {
        matched.push(ap);
        if (matched.length >= 500) break;
      }
    }
    return matched;
  }, [generatedResult, tableSearch]);

  return (
    <div className="w-full space-y-2.5">
      {/* Top Banner / Tool Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Demo Wardrive Vector Generator
              </h2>
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Kepler.gl & WiGLE
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                Inspired by OSINTIAL
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Synthetic wardriving vector art, AP density (up to 500k+), customizable scale & start timestamp
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('map')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
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
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
              activeTab === 'table'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>AP Table ({generatedResult?.aps?.length ? (generatedResult.aps.length > 999 ? `${(generatedResult.aps.length/1000).toFixed(0)}k` : generatedResult.aps.length) : 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('python')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
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
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
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
      <div className="bg-slate-900/60 p-2.5 sm:p-3 rounded-xl border border-slate-800 space-y-2.5">
        {/* Mode Switcher Header: Text vs SVG Image */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setArtMode('text')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition ${
                artMode === 'text'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Text / Phrase</span>
            </button>
            <button
              onClick={() => setArtMode('svg')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition ${
                artMode === 'svg'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Image className="w-3.5 h-3.5" />
              <span>SVG Vector Art</span>
            </button>
          </div>

          {artMode === 'svg' && (
            <div className="flex items-center gap-1.5">
              <input
                type="file"
                ref={fileInputRef}
                accept=".svg,image/svg+xml"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 rounded text-xs font-semibold transition"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{svgFileName ? `Replace SVG (${svgFileName.slice(0, 12)}...)` : 'Upload .SVG'}</span>
              </button>
              <button
                onClick={() => setShowSvgPasteModal(!showSvgPasteModal)}
                className="flex items-center gap-1 px-2 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-xs transition"
              >
                <FileCode className="w-3.5 h-3.5 text-amber-400" />
                <span>Paste XML</span>
              </button>
            </div>
          )}
        </div>

        {/* SVG Preset Selection Strip (when in SVG mode) */}
        {artMode === 'svg' && (
          <div className="p-2 bg-slate-950/70 border border-slate-800/90 rounded-lg space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span>Vector Presets:</span>
              </span>
              <span className="text-[10px] font-mono text-cyan-400">
                {parsedSvgStrokes.length} vector {parsedSvgStrokes.length === 1 ? 'stroke' : 'strokes'} ready
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {SVG_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectSvgPreset(p)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition border ${
                    selectedSvgPreset === p.id && !svgFileName
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Paste SVG XML Box */}
            {showSvgPasteModal && (
              <div className="mt-2 p-2 bg-slate-900 border border-slate-700 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span>Paste Raw SVG XML Markup</span>
                  <button onClick={() => setShowSvgPasteModal(false)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                <textarea
                  rows={3}
                  value={customSvgCode}
                  onChange={(e) => setCustomSvgCode(e.target.value)}
                  placeholder="<svg ...><path d='M...' /></svg>"
                  className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs font-mono text-cyan-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => setShowSvgPasteModal(false)}
                    className="px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApplyCustomSvgPaste}
                    className="px-2.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-bold transition"
                  >
                    Parse & Apply
                  </button>
                </div>
              </div>
            )}

            {/* SVG Transformation Controls: Rotation, Scale & Flip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2 bg-slate-900/90 border border-slate-800 rounded-lg">
              {/* 1. Rotation */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <RotateCw className="w-3 h-3 text-cyan-400" />
                    <span>Rotation</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={rotationDeg}
                      onChange={(e) => setRotationDeg((parseInt(e.target.value) || 0) % 360)}
                      className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-cyan-300 text-right font-bold"
                    />
                    <span className="text-[11px] font-mono text-cyan-400 font-bold">°</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  value={rotationDeg}
                  onChange={(e) => setRotationDeg(parseInt(e.target.value) || 0)}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />

                <div className="flex items-center justify-between gap-1 pt-0.5">
                  <button
                    onClick={() => handleRotateBy(-90)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono transition border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    -90°
                  </button>
                  <button
                    onClick={() => handleRotateBy(90)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono transition border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    +90°
                  </button>
                  <button
                    onClick={() => handleRotateBy(180)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono transition border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    180°
                  </button>
                  <button
                    onClick={() => setRotationDeg(0)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono transition border bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    0°
                  </button>
                </div>
              </div>

              {/* 2. SVG Scale Multiplier */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <Maximize2 className="w-3 h-3 text-cyan-400" />
                    <span>SVG Scale</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="50"
                      value={svgScale}
                      onChange={(e) => setSvgScale(Math.max(0.05, parseFloat(e.target.value) || 1.0))}
                      className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-cyan-300 text-right font-bold"
                    />
                    <span className="text-[11px] font-mono text-cyan-400 font-bold">x</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={Math.min(10, svgScale)}
                  onChange={(e) => setSvgScale(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />

                <div className="flex items-center justify-between gap-1 pt-0.5">
                  {[0.5, 1.0, 2.0, 5.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSvgScale(s)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition border ${
                        Math.abs(svgScale - s) < 0.01
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Orientation & Mirror Flip */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <FlipHorizontal className="w-3 h-3 text-cyan-400" />
                    <span>Flip / Mirror</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {flipH ? 'H' : ''}{flipV ? 'V' : ''}{!flipH && !flipV ? 'NORM' : ''}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    onClick={() => setFlipH((prev) => !prev)}
                    className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-semibold transition border ${
                      flipH
                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FlipHorizontal className="w-3 h-3" />
                    <span>Horiz</span>
                  </button>
                  <button
                    onClick={() => setFlipV((prev) => !prev)}
                    className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-semibold transition border ${
                      flipV
                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FlipVertical className="w-3 h-3" />
                    <span>Vert</span>
                  </button>
                </div>

                <div className="text-[9px] text-slate-500 text-center pt-0.5 font-mono">
                  Pivot centered
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Row 1: Target Word / Prefix & Origin Coordinates */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          {/* Word / SSID Prefix Input */}
          <div className="md:col-span-5 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>{artMode === 'svg' ? 'SSID Prefix / Identifier' : 'Text / Phrase to Map'}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {artMode === 'svg' ? 'Prefix for AP SSIDs' : 'A-Z, 0-9, space'}
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value.toUpperCase())}
                placeholder={artMode === 'svg' ? 'e.g. WIFI_MAP' : 'Enter word (e.g. KEPLER)'}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-400 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 tracking-wider"
              />
              <span className="absolute right-2 top-2 text-[10px] font-mono text-slate-500">
                {text.length} ch
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
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Action Buttons: Set Clock Now & Start Wardrive */}
          <div className="md:col-span-3 flex items-center gap-1.5">
            <button
              onClick={handleSetClockNow}
              title="Set Wardrive Start Clock to Current Time"
              className="px-2 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 hover:border-purple-500/50 rounded-lg text-purple-400 text-xs font-mono flex items-center gap-1 transition"
            >
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Now</span>
            </button>

            <button
              onClick={handleGenerate}
              disabled={isGenerating || (artMode === 'text' && !text.trim())}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-md shadow-emerald-950/40"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Wardrive</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              title="Advanced Vector & Geometry Settings"
              className={`p-1.5 rounded-lg border text-xs transition ${
                showAdvanced 
                  ? 'bg-slate-800 border-slate-600 text-slate-200' 
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2: 4 Interactive Tuning Cards (AP Density, Vector Scale/Size, Speed, Start Clock/Date) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
          {/* Card 1: AP Density per KM / Mile (Scale to 500k+) */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Ruler className="w-3 h-3 text-cyan-400" />
                <span>AP Density</span>
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 text-[9px]">
                <button
                  onClick={() => setDensityUnit('km')}
                  className={`px-1.5 py-0.5 rounded transition ${
                    densityUnit === 'km' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  /km
                </button>
                <button
                  onClick={() => setDensityUnit('mile')}
                  className={`px-1.5 py-0.5 rounded transition ${
                    densityUnit === 'mile' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  /mi
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-500 text-[10px]">~{physicalMetrics.spacingMeters}m gap</span>
              <span className="text-cyan-400 font-bold">
                {apsPerUnit.toLocaleString()} APs/{densityUnit}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min="5"
                max="5000"
                step="25"
                value={Math.min(5000, apsPerUnit)}
                onChange={(e) => setApsPerUnit(parseInt(e.target.value))}
                className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
              <input
                type="number"
                min="1"
                max="50000"
                value={apsPerUnit}
                onChange={(e) => setApsPerUnit(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-cyan-300 text-right"
              />
            </div>

            <div className="flex items-center justify-between gap-1 pt-0.5">
              {DENSITY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setApsPerUnit(p.value)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition border ${
                    apsPerUnit === p.value
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Card 2: Letter Size & Scale (Scales up to 100x+ for massive statewide maps) */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Maximize2 className="w-3 h-3 text-emerald-400" />
                <span>Size & Scale</span>
              </label>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="200"
                  value={letterScale}
                  onChange={(e) => setLetterScale(Math.max(0.05, parseFloat(e.target.value) || 1.0))}
                  className="w-12 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-emerald-300 text-right font-bold"
                />
                <span className="text-[11px] font-mono text-emerald-400 font-bold">x</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-500">Span:</span>
              <span className="text-slate-300">
                ~{physicalMetrics.widthKm}×~{physicalMetrics.heightKm} km (~{physicalMetrics.widthMi}×~{physicalMetrics.heightMi} mi)
              </span>
            </div>

            <input
              type="range"
              min="0.1"
              max="50.0"
              step="0.5"
              value={Math.min(50, letterScale)}
              onChange={(e) => setLetterScale(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded cursor-pointer"
            />

            <div className="flex items-center justify-between gap-1 pt-0.5 overflow-x-auto">
              {SCALE_PRESETS.map((p) => (
                <button
                  key={p.scale}
                  onClick={() => setLetterScale(p.scale)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition border whitespace-nowrap ${
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

          {/* Card 3: Wardrive Vehicle Speed */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Gauge className="w-3 h-3 text-amber-400" />
                <span>Drive Speed</span>
              </label>
              <span className="text-[10px] font-mono text-amber-400 font-bold">
                {speedKmh} km/h ({(speedKmh * 0.621371).toFixed(0)} mph)
              </span>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-500">Timeline simulation</span>
              <span className="text-slate-400 font-mono">Virtual drive</span>
            </div>

            <input
              type="range"
              min="5"
              max="250"
              step="5"
              value={speedKmh}
              onChange={(e) => setSpeedKmh(parseFloat(e.target.value))}
              className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded cursor-pointer"
            />

            <div className="flex items-center justify-between gap-1 pt-0.5">
              {SPEED_PRESETS.map((p) => (
                <button
                  key={p.speed}
                  onClick={() => setSpeedKmh(p.speed)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition border ${
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

          {/* Card 4: Wardrive Start Clock & Date */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Clock className="w-3 h-3 text-purple-400" />
                <span>Start Clock</span>
              </label>
              <button
                onClick={handleSetClockNow}
                title="Set to Current Time"
                className="text-[9px] font-mono text-purple-400 hover:text-purple-300 font-bold px-1.5 py-0.2 rounded bg-purple-500/10 border border-purple-500/20 transition"
              >
                Set Now
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-500">Timestamp:</span>
              <span className="text-purple-300 truncate max-w-[120px]">
                {startTimeLocal ? startTimeLocal.replace('T', ' ') : 'Now'}
              </span>
            </div>

            <input
              type="datetime-local"
              value={startTimeLocal}
              onChange={(e) => setStartTimeLocal(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 focus:border-purple-500 rounded px-2 py-0.5 text-[11px] font-mono text-purple-300 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-1 pt-0.5">
              <button
                onClick={handleSetClockNow}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono transition border bg-slate-900 border-slate-800 text-purple-300 hover:text-white"
              >
                Now
              </button>
              <button
                onClick={handleSetClockMinus1Hour}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono transition border bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              >
                -1h
              </button>
              <button
                onClick={handleSetClockYesterday}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono transition border bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              >
                -24h
              </button>
              <button
                onClick={handleSetClockMinus7Days}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono transition border bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              >
                -7d
              </button>
            </div>
          </div>
        </div>

        {/* Quick Location Presets & Coordinate Helpers */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800/60 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
              <Crosshair className="w-3 h-3 text-emerald-400" />
              Locations:
            </span>
            {LOCATION_PRESETS.slice(0, 5).map((p) => (
              <button
                key={p.name}
                onClick={() => handleSelectPreset(p)}
                className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-300 font-mono transition"
              >
                {p.name.split(' ')[0]}
              </button>
            ))}
            <button
              onClick={handleUseMyLocation}
              className="px-1.5 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded text-[10px] text-emerald-400 font-medium transition flex items-center gap-1"
            >
              <Crosshair className="w-2.5 h-2.5" />
              <span>Current GPS</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-400">
            Click map or drag the green crosshair to reposition starting point.
          </div>
        </div>

        {/* Collapsible Advanced Settings */}
        {showAdvanced && (
          <div className="mt-3 p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-3 animate-fadeIn">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Base Font Geometry & PRNG</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 text-xs">
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

      {/* Stats Summary Bar */}
      {generatedResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase font-mono tracking-wider text-slate-500">Synthesized APs</div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                {generatedResult.aps.length.toLocaleString()}
              </div>
            </div>
            <Radio className="w-4 h-4 text-emerald-500/40" />
          </div>

          <div className="bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase font-mono tracking-wider text-slate-500">Stroke Distance</div>
              <div className="text-sm font-bold font-mono text-cyan-400">
                {generatedResult.totalPathLengthKm ? generatedResult.totalPathLengthKm.toFixed(1) : 0} km
              </div>
            </div>
            <Ruler className="w-4 h-4 text-cyan-500/40" />
          </div>

          <div className="bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase font-mono tracking-wider text-slate-500">Footprint</div>
              <div className="text-sm font-bold font-mono text-purple-400">
                {physicalMetrics.widthKm} × {physicalMetrics.heightKm} km
              </div>
            </div>
            <Maximize2 className="w-4 h-4 text-purple-500/40" />
          </div>

          <div className="bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase font-mono tracking-wider text-slate-500">Timeline ({speedKmh} km/h)</div>
              <div className="text-xs font-bold font-mono text-purple-400 truncate">
                {generatedResult.startTime ? (generatedResult.startTime instanceof Date ? generatedResult.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') : ''}
                {' → '}
                {generatedResult.endTime ? (generatedResult.endTime instanceof Date ? generatedResult.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') : ''}
                <span className="text-[10px] text-slate-500 font-normal ml-1">({Math.round(generatedResult.durationSeconds / 60)}m)</span>
              </div>
            </div>
            <Clock className="w-4 h-4 text-purple-500/40" />
          </div>
        </div>
      )}

      {/* Main View Area */}
      {activeTab === 'map' && (
        <div className="space-y-2">
          {/* Map Chrome Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 font-semibold flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Tiles:</span>
              </span>
              <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px]">
                {Object.keys(TILE_PROVIDERS).map((k) => (
                  <button
                    key={k}
                    onClick={() => setMapType(k)}
                    className={`px-1.5 py-0.5 rounded transition ${
                      mapType === k ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {TILE_PROVIDERS[k].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Export Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleDownloadWigle}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded text-xs font-semibold transition"
              >
                <Download className="w-3 h-3" />
                <span>WiGLE CSV ({generatedResult?.aps?.length > 1000 ? `${(generatedResult.aps.length/1000).toFixed(0)}k` : generatedResult?.aps?.length || 0})</span>
              </button>

              <button
                onClick={handleDownloadKepler}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1 px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 rounded text-xs font-semibold transition"
              >
                <Download className="w-3 h-3" />
                <span>Kepler CSV</span>
              </button>

              <a
                href="https://kepler.gl/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 rounded text-xs font-semibold transition"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open Kepler.gl</span>
              </a>
            </div>
          </div>

          {/* Map Container */}
          <div className="relative w-full h-[540px] rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950">
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            {/* Floating Map Legend & Overlay with Performance Notice */}
            <div className="absolute top-3 right-3 z-[1000] bg-slate-950/90 border border-slate-800 p-2.5 rounded-lg backdrop-blur shadow-xl text-[11px] space-y-1.5 pointer-events-auto">
              <div className="font-bold text-slate-200 flex items-center justify-between gap-4">
                <span>Signal Strength (RSSI)</span>
                <span className="text-[10px] text-cyan-400 font-mono">
                  {generatedResult?.aps?.length > 1500 
                    ? `Showing 1,500 preview markers (${generatedResult.aps.length.toLocaleString()} in CSV)` 
                    : `${generatedResult?.aps?.length || 0} APs`}
                </span>
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
              <span className="text-xs text-slate-400 font-mono">
                Showing top {filteredAps.length.toLocaleString()} of {generatedResult?.aps?.length?.toLocaleString() || 0} APs
              </span>
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
                Self-contained Python script with your configured AP density ({apsPerUnit}/{densityUnit}), letter size, speed, and coordinates
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
              mode: artMode,
              svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
              latCenter,
              lonCenter,
              letterW,
              letterH,
              letterScale,
              gap,
              densityUnit,
              apsPerUnit,
              speedKmh,
              startTime: startTimeLocal,
              rotationDeg,
              svgScale,
              flipH,
              flipV,
              includePreheader
            })}
          </pre>
        </div>
      )}

      {/* Kepler.gl Visualizer Guide */}
      {activeTab === 'guide' && (
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">Visualizing in Kepler.gl in 3 Steps</h3>
                <p className="text-[11px] text-slate-400">Turn generated synthetic AP points into glowing map art</p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              Inspired by OSINTIAL
            </span>
          </div>

          <div className="p-2.5 bg-cyan-950/20 border border-cyan-800/40 rounded-lg text-xs text-cyan-300 flex items-center justify-between gap-2">
            <span>Special credit to <strong>OSINTIAL</strong> for inspiring this tool and the concept of drawing vector words and shapes onto wardriving maps using synthesized AP trails.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center border border-emerald-500/30">
                1
              </div>
              <h4 className="text-xs font-bold text-slate-200">Download Kepler CSV</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click the <strong>Kepler CSV</strong> button to get clean tabular coordinates (<code className="text-cyan-400 font-mono">lat</code>, <code className="text-cyan-400 font-mono">lon</code>, <code className="text-cyan-400 font-mono">first_seen</code>).
              </p>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center border border-cyan-500/30">
                2
              </div>
              <h4 className="text-xs font-bold text-slate-200">Open Kepler.gl Demo</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Open <a href="https://kepler.gl/demo" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline font-semibold">kepler.gl/demo</a> in your browser and drag & drop the CSV into the window.
              </p>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold flex items-center justify-center border border-purple-500/30">
                3
              </div>
              <h4 className="text-xs font-bold text-slate-200">Customize Layers</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Kepler detects the points. Enable the <strong>Point</strong> layer, pick Cyan or Emerald, and watch your vector artwork illuminate the map!
              </p>
            </div>
          </div>

          <div className="pt-1 flex justify-end">
            <a
              href="https://kepler.gl/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition shadow-md shadow-purple-950/40"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Launch Kepler.gl Demo</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
