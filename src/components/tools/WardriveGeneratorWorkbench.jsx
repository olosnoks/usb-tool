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
  FlipVertical,
  Scissors,
  FileArchive,
  Wifi,
  Route,
  Navigation,
  Milestone
} from 'lucide-react';
import JSZip from 'jszip';
import { 
  generateDemoAps, 
  generateWigleCsv, 
  generateTestCsv, 
  splitApsIntoFileChunks,
  exportPythonScriptSource,
  parseSvgToNormalizedStrokes,
  dateToLocalDatetimeString,
  fetchOsrmRoadRoute,
  channelToFrequency,
  WIGLE_PREHEADER,
  WIGLE_HEADER,
  SSID_PROFILES,
  VECTOR_FONTS,
  AUTH_MODES,
  CHANNELS
} from '../../utils/wardriveDemoGenerator';

const ROUTE_PRESETS = [
  {
    name: 'Las Vegas Strip',
    description: 'Iconic 6 km drive down Las Vegas Blvd from Mandalay Bay past Bellagio to Stratosphere',
    waypoints: [
      { lat: 36.0950, lon: -115.1760, label: 'Mandalay Bay' },
      { lat: 36.1147, lon: -115.1728, label: 'Bellagio' },
      { lat: 36.1250, lon: -115.1650, label: 'Venetian' },
      { lat: 36.1475, lon: -115.1555, label: 'Stratosphere' }
    ]
  },
  {
    name: 'San Francisco Waterfront',
    description: 'Scenic 11 km drive from Ferry Building through Fisherman\'s Wharf and Presidio to Golden Gate Bridge',
    waypoints: [
      { lat: 37.7955, lon: -122.3937, label: 'Ferry Building' },
      { lat: 37.8080, lon: -122.4177, label: 'Fishermans Wharf' },
      { lat: 37.8020, lon: -122.4660, label: 'Presidio' },
      { lat: 37.8199, lon: -122.4783, label: 'Golden Gate' }
    ]
  },
  {
    name: 'Austin Congress Ave',
    description: 'Historic drive from Texas State Capitol south down Congress Ave across Lady Bird Lake',
    waypoints: [
      { lat: 30.2747, lon: -97.7404, label: 'State Capitol' },
      { lat: 30.2645, lon: -97.7431, label: 'Congress & 6th' },
      { lat: 30.2520, lon: -97.7490, label: 'South Congress' }
    ]
  },
  {
    name: 'Miami Ocean Drive',
    description: 'Vibrant cruise through South Beach from Ocean Drive up Collins Ave',
    waypoints: [
      { lat: 25.7725, lon: -80.1320, label: 'South Pointe' },
      { lat: 25.7820, lon: -80.1305, label: 'Ocean Drive' },
      { lat: 25.7950, lon: -80.1280, label: 'Collins Ave' },
      { lat: 25.8150, lon: -80.1225, label: 'Mid-Beach' }
    ]
  }
];

const DEFAULT_ROUTE_WAYPOINTS = [
  { id: 'wp_1', lat: 36.0950, lon: -115.1760, label: 'Mandalay Bay' },
  { id: 'wp_2', lat: 36.1147, lon: -115.1728, label: 'Bellagio' },
  { id: 'wp_3', lat: 36.1250, lon: -115.1650, label: 'Venetian' },
  { id: 'wp_4', lat: 36.1475, lon: -115.1555, label: 'Stratosphere' }
];

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
  { label: 'Walk (3 mph)', speed: 5 },
  { label: 'City (30 mph)', speed: 48 },
  { label: 'Hwy (65 mph)', speed: 105 },
  { label: 'Jet (250 mph)', speed: 402 },
  { label: '666 mph (Hyper)', speed: 1071.82 }
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
  { label: '50', value: 50 },
  { label: '200', value: 200 },
  { label: '1,000', value: 1000 },
  { label: '5,000', value: 5000 },
  { label: '10k (~1M)', value: 10000 }
];

const SPLIT_SIZE_OPTIONS = [
  { label: 'No Limit (Single File)', bytes: 0 },
  { label: '1 MB limit (~8k APs)', bytes: 1 * 1024 * 1024 },
  { label: '2 MB limit (~16k APs)', bytes: 2 * 1024 * 1024 },
  { label: '5 MB limit (~40k APs)', bytes: 5 * 1024 * 1024 },
  { label: '10 MB limit (WiGLE upload)', bytes: 10 * 1024 * 1024 },
  { label: '25 MB limit (Discord/Email)', bytes: 25 * 1024 * 1024 },
  { label: '50 MB limit (Kepler heap)', bytes: 50 * 1024 * 1024 },
  { label: '100 MB limit', bytes: 100 * 1024 * 1024 }
];

export default function WardriveGeneratorWorkbench({ onLogMessage = () => {} }) {
  // Input parameters & mode
  const [artMode, setArtMode] = useState('text'); // 'text' | 'route' | 'svg'
  const [text, setText] = useState('KEPLER');
  const [ssidMode, setSsidMode] = useState('isp_mix'); // 'isp_mix' | 'xfinity' | 'att' | 'spectrum' | 'prefix'
  const [latCenter, setLatCenter] = useState(32.25);
  const [lonCenter, setLonCenter] = useState(-90.13);

  // Road Route Mode state (snapped to real roads via OpenStreetMap OSRM)
  const [routeWaypoints, setRouteWaypoints] = useState(DEFAULT_ROUTE_WAYPOINTS);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [isRoutingLoading, setIsRoutingLoading] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  const [routeDurationSec, setRouteDurationSec] = useState(0);
  const [routeStatusMsg, setRouteStatusMsg] = useState('');

  // SVG mode state (user uploads or pastes custom SVGs; no premade shapes)
  const [customSvgCode, setCustomSvgCode] = useState('');
  const [showSvgPasteModal, setShowSvgPasteModal] = useState(false);
  const [svgFileName, setSvgFileName] = useState(null);
  const [parsedSvgStrokes, setParsedSvgStrokes] = useState([]);
  const fileInputRef = useRef(null);

  // File size split limit state (0 = single file)
  const [splitLimitBytes, setSplitLimitBytes] = useState(0);

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
  const routeLayerRef = useRef(null);
  const routeMarkersLayerRef = useRef(null);

  const artModeRef = useRef(artMode);
  useEffect(() => {
    artModeRef.current = artMode;
  }, [artMode]);

  const handleAddRouteWaypoint = useCallback((lat, lon) => {
    setRouteWaypoints((prev) => [
      ...prev,
      {
        id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        label: prev.length === 0 ? 'Start' : `Waypoint ${prev.length + 1}`
      }
    ]);
  }, []);

  const handleUpdateWaypoint = useCallback((id, lat, lon) => {
    setRouteWaypoints((prev) => prev.map((w) => w.id === id ? { ...w, lat, lon } : w));
  }, []);

  const handleRemoveWaypoint = useCallback((id) => {
    setRouteWaypoints((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const handleUndoLastWaypoint = useCallback(() => {
    setRouteWaypoints((prev) => prev.slice(0, -1));
  }, []);

  const handleReverseRoute = useCallback(() => {
    setRouteWaypoints((prev) => [...prev].reverse());
  }, []);

  const handleClearRoute = useCallback(() => {
    setRouteWaypoints([]);
    setRouteCoordinates([]);
    setRouteDistanceKm(0);
    setRouteDurationSec(0);
    if (routeLayerRef.current) routeLayerRef.current.clearLayers();
    if (routeMarkersLayerRef.current) routeMarkersLayerRef.current.clearLayers();
  }, []);

  const handleApplyRoutePreset = useCallback((preset) => {
    const wps = preset.waypoints.map((w, i) => ({
      ...w,
      id: 'wp_' + Date.now() + '_' + i
    }));
    setRouteWaypoints(wps);
    if (mapInstanceRef.current && wps.length > 0) {
      mapInstanceRef.current.setView([wps[0].lat, wps[0].lon], 12);
    }
    onLogMessage(`[ROUTE] Loaded road route preset "${preset.name}" (${wps.length} waypoints)`);
  }, [onLogMessage]);

  const handleAddRouteWaypointRef = useRef(handleAddRouteWaypoint);
  useEffect(() => {
    handleAddRouteWaypointRef.current = handleAddRouteWaypoint;
  }, [handleAddRouteWaypoint]);

  const handleUpdateWaypointRef = useRef(handleUpdateWaypoint);
  useEffect(() => {
    handleUpdateWaypointRef.current = handleUpdateWaypoint;
  }, [handleUpdateWaypoint]);

  // Road Routing Calculation Effect (OSRM API)
  useEffect(() => {
    let isCancelled = false;
    if (routeWaypoints.length < 2) {
      setRouteCoordinates([]);
      setRouteDistanceKm(0);
      setRouteDurationSec(0);
      setRouteStatusMsg(routeWaypoints.length === 1 ? 'Click on map to place a 2nd point to route roads' : 'Click anywhere on map to add waypoints');
      return;
    }

    if (!snapToRoads) {
      const directCoords = routeWaypoints.map((w) => [w.lon, w.lat]);
      setRouteCoordinates(directCoords);
      let dist = 0;
      for (let i = 0; i < routeWaypoints.length - 1; i++) {
        const p1 = routeWaypoints[i];
        const p2 = routeWaypoints[i + 1];
        const dx = (p2.lon - p1.lon) * 111.0 * Math.cos((p1.lat * Math.PI) / 180.0);
        const dy = (p2.lat - p1.lat) * 111.0;
        dist += Math.sqrt(dx * dx + dy * dy);
      }
      setRouteDistanceKm(dist);
      setRouteStatusMsg(`Direct straight-line route across ${routeWaypoints.length} waypoints (${dist.toFixed(2)} km)`);
      return;
    }

    setIsRoutingLoading(true);
    setRouteStatusMsg('Snapping waypoints to actual roads via OpenStreetMap OSRM...');

    fetchOsrmRoadRoute(routeWaypoints)
      .then((res) => {
        if (isCancelled) return;
        if (res.success && res.coordinates.length > 0) {
          setRouteCoordinates(res.coordinates);
          setRouteDistanceKm(res.distanceMeters / 1000);
          setRouteDurationSec(res.durationSeconds);
          setRouteStatusMsg(`Snapped to ${(res.distanceMeters / 1000).toFixed(2)} km of actual roads via OpenStreetMap OSRM`);
        } else {
          setRouteCoordinates(res.coordinates);
          setRouteDistanceKm(0);
          setRouteStatusMsg(`OSRM fallback: ${res.error || 'Connected directly'}`);
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        setRouteCoordinates(routeWaypoints.map((w) => [w.lon, w.lat]));
        setRouteStatusMsg(`Routing error: ${err.message}`);
      })
      .finally(() => {
        if (!isCancelled) setIsRoutingLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [routeWaypoints, snapToRoads]);

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

  // SVG Upload, Paste and Clear Handlers (no premade shapes)
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const svgText = evt.target.result;
      setCustomSvgCode(svgText);
      setSvgFileName(file.name);
      const res = parseSvgToNormalizedStrokes(svgText);
      if (res.strokes.length === 0) {
        alert('Could not find any readable vector strokes (<path>, <polyline>, <polygon>, <circle>, <line>) in the uploaded SVG.');
        return;
      }
      setParsedSvgStrokes(res.strokes);
      const cleanName = file.name.replace(/\.svg$/i, '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
      if (!text || text === 'KEPLER' || text.startsWith('SVG_')) {
        setText(cleanName);
      }
      onLogMessage(`[SVG] Imported "${file.name}" with ${res.strokes.length} vector strokes`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleApplyCustomSvgPaste = () => {
    if (!customSvgCode.trim()) return;
    const res = parseSvgToNormalizedStrokes(customSvgCode);
    if (res.strokes.length === 0) {
      alert('Could not parse any vector paths from the provided SVG markup.');
      return;
    }
    setParsedSvgStrokes(res.strokes);
    setSvgFileName('custom_vector.svg');
    setShowSvgPasteModal(false);
    onLogMessage(`[SVG] Applied custom SVG markup with ${res.strokes.length} paths`);
  };

  const handleClearSvg = () => {
    setParsedSvgStrokes([]);
    setCustomSvgCode('');
    setSvgFileName(null);
    onLogMessage('[SVG] Cleared SVG vector strokes');
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
      routeLayerRef.current = L.layerGroup().addTo(map);
      routeMarkersLayerRef.current = L.layerGroup().addTo(map);

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

      // Click on map to place origin or add road waypoint
      map.on('click', (e) => {
        const nLat = Number(e.latlng.lat.toFixed(6));
        const nLon = Number(e.latlng.lng.toFixed(6));
        if (artModeRef.current === 'route') {
          handleAddRouteWaypointRef.current?.(nLat, nLon);
        } else {
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

  // Synchronize Route Map Layers (Snapped Road Line & Numbered Waypoints)
  useEffect(() => {
    if (!mapInstanceRef.current || !isLeafletAvailable) return;
    if (!routeLayerRef.current || !routeMarkersLayerRef.current) return;

    if (artMode !== 'route') {
      routeLayerRef.current.clearLayers();
      routeMarkersLayerRef.current.clearLayers();
      if (originMarkerRef.current) originMarkerRef.current.setOpacity(1);
      return;
    }

    // In route mode: hide origin crosshair, show road waypoints & snapped line
    if (originMarkerRef.current) originMarkerRef.current.setOpacity(0);
    routeLayerRef.current.clearLayers();
    routeMarkersLayerRef.current.clearLayers();

    // 1. Draw Snapped Road Route Polyline
    if (routeCoordinates && routeCoordinates.length > 1) {
      const latLngs = routeCoordinates.map((pt) => [pt[1], pt[0]]);
      const casing = L.polyline(latLngs, {
        color: '#0891b2',
        weight: 7,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      });
      const roadLine = L.polyline(latLngs, {
        color: '#06b6d4',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      });
      routeLayerRef.current.addLayer(casing);
      routeLayerRef.current.addLayer(roadLine);
    } else if (routeWaypoints.length > 1) {
      const straightLatLngs = routeWaypoints.map((w) => [w.lat, w.lon]);
      const straightLine = L.polyline(straightLatLngs, {
        color: '#38bdf8',
        weight: 3,
        dashArray: '6, 6',
        opacity: 0.8
      });
      routeLayerRef.current.addLayer(straightLine);
    }

    // 2. Draw Numbered Draggable Waypoint Markers
    routeWaypoints.forEach((wp, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === routeWaypoints.length - 1 && routeWaypoints.length > 1;
      const color = isStart ? '#10b981' : (isEnd ? '#f59e0b' : '#0284c7');
      const badgeText = isStart ? '1' : (isEnd ? '🏁' : String(idx + 1));

      const icon = L.divIcon({
        className: 'custom-route-waypoint',
        html: `
          <div style="position: relative; width: 28px; height: 28px; transform: translate(-14px, -14px); background: ${color}; color: #ffffff; border: 2px solid #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: monospace; font-weight: bold; font-size: ${isEnd ? '13px' : '11px'}; box-shadow: 0 0 10px ${color}cc, 0 2px 4px rgba(0,0,0,0.5); cursor: grab;">
            ${badgeText}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([wp.lat, wp.lon], {
        icon,
        draggable: true,
        title: `Waypoint #${idx + 1} (${wp.label || (isStart ? 'Start' : 'Turn')}) - Drag to move`
      });

      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 11px; color: #0f172a; min-width: 140px;">
          <strong style="color: ${color}; font-size: 12px;">Waypoint #${idx + 1}</strong> ${isStart ? '(Start)' : (isEnd ? '(Finish)' : '')}<br/>
          <span style="color: #475569; font-weight: 500;">${wp.label || ''}</span><br/>
          Lat: ${wp.lat.toFixed(6)}<br/>
          Lon: ${wp.lon.toFixed(6)}<br/>
          <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b;">
            Drag pin to adjust road route
          </div>
        </div>
      `);

      marker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng();
        handleUpdateWaypointRef.current?.(wp.id, Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });

      routeMarkersLayerRef.current.addLayer(marker);
    });
  }, [artMode, routeWaypoints, routeCoordinates, isLeafletAvailable]);

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

        if (rotationDeg !== 0 || flipH || flipV) {
          const rad = ((Number(rotationDeg) || 0) * Math.PI) / 180.0;
          const cosR = Math.cos(rad);
          const sinR = Math.sin(rad);
          const centerX = lonCenter + totalWidth / 2.0;
          const centerY = latCenter - totalHeight / 2.0;

          const transformBoxPoint = (xRel, yRel) => {
            const rawLon = lonCenter + xRel * totalWidth;
            const rawLat = latCenter - yRel * totalHeight;
            let dx = rawLon - centerX;
            let dy = rawLat - centerY;
            if (flipH) dx = -dx;
            if (flipV) dy = -dy;
            const rx = dx * cosR - dy * sinR;
            const ry = dx * sinR + dy * cosR;
            return [centerY + ry, centerX + rx];
          };

          const corners = [
            transformBoxPoint(0, 0),
            transformBoxPoint(1, 0),
            transformBoxPoint(1, 1),
            transformBoxPoint(0, 1)
          ];
          const polygon = L.polygon(corners, {
            color: '#10b981',
            weight: 1.5,
            dashArray: '4, 6',
            fillColor: '#10b981',
            fillOpacity: 0.07
          });
          previewBoxLayerRef.current.addLayer(polygon);
        } else {
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
      const isRoute = artMode === 'route';
      const effectiveRouteCoords = routeCoordinates.length >= 2 ? routeCoordinates : routeWaypoints.map((w) => [w.lon, w.lat]);

      if (isRoute && effectiveRouteCoords.length < 2) {
        alert('Please plot at least 2 waypoints on the map to generate a road route.');
        setIsGenerating(false);
        return;
      }

      const result = generateDemoAps({
        text: isRoute ? (text || 'ROUTE') : text,
        mode: artMode,
        routeCoordinates: isRoute ? effectiveRouteCoords : null,
        svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
        latCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lat : Number(latCenter),
        lonCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lon : Number(lonCenter),
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
        ssidMode,
        seed: useFixedSeed ? Number(seed) : Math.floor(Math.random() * 100000)
      });

      setGeneratedResult(result);
      let modeDesc = `text "${text}"`;
      if (isRoute) {
        modeDesc = `road route (${routeWaypoints.length} waypoints, ${effectiveRouteCoords.length} road coordinates)`;
      } else if (artMode === 'svg') {
        modeDesc = `SVG art (${parsedSvgStrokes.length} paths)`;
      }
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

          const freqDisplay = ap.frequency || channelToFrequency(ap.channel);
          circle.bindPopup(`
            <div style="font-family: sans-serif; font-size: 11px; min-width: 170px; color: #0f172a;">
              <div style="font-weight: bold; font-size: 13px; color: #0284c7; margin-bottom: 2px;">
                ${ap.ssid}
              </div>
              <div style="font-family: monospace; font-size: 11px; color: #475569; margin-bottom: 6px;">
                ${ap.mac}
              </div>
              <div><strong>Signal:</strong> <span style="color: ${markerColor}; font-weight: bold;">${ap.rssi} dBm</span></div>
              <div><strong>Channel:</strong> ${ap.channel} <span style="color: #64748b;">(${freqDisplay} MHz)</span></div>
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
  }, [text, artMode, routeCoordinates, routeWaypoints, ssidMode, parsedSvgStrokes, startTimeLocal, latCenter, lonCenter, letterW, letterH, letterScale, gap, densityUnit, apsPerUnit, speedKmh, rotationDeg, svgScale, flipH, flipV, useFixedSeed, seed, isLeafletAvailable, onLogMessage]);

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

  const estimatedParts = useMemo(() => {
    if (!generatedResult?.aps?.length || !splitLimitBytes || splitLimitBytes <= 0) return 1;
    // Average WiGLE row is ~120 bytes
    const estTotalBytes = generatedResult.aps.length * 120 + 200;
    return Math.max(1, Math.ceil(estTotalBytes / splitLimitBytes));
  }, [generatedResult, splitLimitBytes]);

  const handleDownloadWigle = async () => {
    if (!generatedResult?.aps?.length) return;
    const baseName = getCleanBaseFilename();
    const chunks = splitApsIntoFileChunks(generatedResult.aps, {
      format: 'wigle',
      includePreheader,
      maxSizeBytes: splitLimitBytes,
      baseName
    });

    if (chunks.length === 1) {
      downloadFile(chunks[0].filename, chunks[0].content, 'text/csv');
    } else {
      const zip = new JSZip();
      chunks.forEach((chunk) => {
        zip.file(chunk.filename, chunk.content);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(`${baseName}_wigle_${chunks.length}_parts.zip`, zipBlob, 'application/zip');
      onLogMessage(`[EXPORT] Created multi-part ZIP with ${chunks.length} WiGLE CSV files (${(zipBlob.size / 1024).toFixed(0)} KB)`);
    }
  };

  const handleDownloadKepler = async () => {
    if (!generatedResult?.aps?.length) return;
    const baseName = getCleanBaseFilename();
    const chunks = splitApsIntoFileChunks(generatedResult.aps, {
      format: 'kepler',
      includePreheader: false,
      maxSizeBytes: splitLimitBytes,
      baseName
    });

    if (chunks.length === 1) {
      downloadFile(chunks[0].filename, chunks[0].content, 'text/csv');
    } else {
      const zip = new JSZip();
      chunks.forEach((chunk) => {
        zip.file(chunk.filename, chunk.content);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(`${baseName}_kepler_${chunks.length}_parts.zip`, zipBlob, 'application/zip');
      onLogMessage(`[EXPORT] Created multi-part ZIP with ${chunks.length} Kepler CSV files (${(zipBlob.size / 1024).toFixed(0)} KB)`);
    }
  };

  const handleDownloadPython = () => {
    const isRoute = artMode === 'route';
    const py = exportPythonScriptSource({
      text: isRoute ? (text || 'ROUTE') : text,
      mode: artMode,
      routeCoordinates: isRoute ? (routeCoordinates.length >= 2 ? routeCoordinates : routeWaypoints.map(w => [w.lon, w.lat])) : null,
      svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
      latCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lat : latCenter,
      lonCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lon : lonCenter,
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
      ssidMode,
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
      const isRoute = artMode === 'route';
      content = exportPythonScriptSource({
        text: isRoute ? (text || 'ROUTE') : text,
        mode: artMode,
        routeCoordinates: isRoute ? (routeCoordinates.length >= 2 ? routeCoordinates : routeWaypoints.map(w => [w.lon, w.lat])) : null,
        svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
        latCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lat : latCenter,
        lonCenter: isRoute && routeWaypoints.length > 0 ? routeWaypoints[0].lon : lonCenter,
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
        ssidMode,
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
        {/* Mode Switcher Header: Text vs Route vs SVG */}
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
              onClick={() => setArtMode('route')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition ${
                artMode === 'route'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Route className="w-3.5 h-3.5 text-cyan-400" />
              <span>Road Route (Click Map)</span>
            </button>
            <button
              onClick={() => setArtMode('svg')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition ${
                artMode === 'svg'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Image className="w-3.5 h-3.5" />
              <span>SVG Vector Art</span>
            </button>
          </div>

          {artMode === 'route' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                <Navigation className="w-3 h-3" />
                <span>{routeWaypoints.length} waypoints</span>
              </span>
              <button
                onClick={handleClearRoute}
                disabled={routeWaypoints.length === 0}
                className="flex items-center gap-1 px-2 py-0.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-300 rounded text-xs transition"
                title="Clear all route waypoints"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span>Reset</span>
              </button>
            </div>
          )}

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

        {/* Road Route Mode Interface: Plotting, OSRM Snapping & Presets */}
        {artMode === 'route' && (
          <div className="p-2.5 bg-slate-950/80 border border-cyan-500/30 rounded-xl space-y-2.5">
            {/* Route Status Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Route className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span>Road Route Plotter</span>
                    {isRoutingLoading ? (
                      <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded text-[10px] font-mono flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Snapping to roads...</span>
                      </span>
                    ) : routeCoordinates.length > 0 ? (
                      <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded text-[10px] font-mono flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Road Snapped ({routeCoordinates.length} nodes)</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {routeStatusMsg || 'Click anywhere on the map to plot route waypoints along actual roads'}
                  </div>
                </div>
              </div>

              {/* Snap to roads toggle */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={snapToRoads}
                    onChange={(e) => setSnapToRoads(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="font-medium">Snap to Actual Roads (OSRM)</span>
                </label>
              </div>
            </div>

            {/* Route Metrics & Quick Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300">
                  Waypoints: <strong className="text-cyan-400">{routeWaypoints.length}</strong>
                </span>
                <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300">
                  Road Length: <strong className="text-emerald-400">
                    {densityUnit === 'mile' ? `${(routeDistanceKm * 0.621371).toFixed(2)} mi` : `${routeDistanceKm.toFixed(2)} km`}
                  </strong>
                </span>
                {routeDurationSec > 0 && (
                  <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300">
                    Drive Time: <strong className="text-amber-400">{Math.round(routeDurationSec / 60)} min</strong>
                  </span>
                )}
              </div>

              {/* Action Buttons: Undo, Reverse, Clear */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleUndoLastWaypoint}
                  disabled={routeWaypoints.length === 0}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 rounded text-xs transition"
                  title="Remove the last waypoint placed"
                >
                  <RotateCcw className="w-3 h-3 text-amber-400" />
                  <span>Undo</span>
                </button>
                <button
                  onClick={handleReverseRoute}
                  disabled={routeWaypoints.length < 2}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 rounded text-xs transition"
                  title="Reverse route start & finish direction"
                >
                  <FlipHorizontal className="w-3 h-3 text-cyan-400" />
                  <span>Reverse</span>
                </button>
                <button
                  onClick={handleClearRoute}
                  disabled={routeWaypoints.length === 0}
                  className="flex items-center gap-1 px-2 py-1 bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 border border-rose-800/50 text-rose-300 rounded text-xs transition"
                  title="Clear all waypoints from map"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Route</span>
                </button>
              </div>
            </div>

            {/* Route Presets */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Milestone className="w-3 h-3 text-cyan-400" />
                <span>Road Presets:</span>
              </span>
              {ROUTE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => handleApplyRoutePreset(p)}
                  className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 rounded text-[11px] transition"
                  title={p.description}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Interactive Waypoints List Chips */}
            {routeWaypoints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-slate-900/40 rounded-lg border border-slate-800/80">
                {routeWaypoints.map((wp, idx) => {
                  const isStart = idx === 0;
                  const isEnd = idx === routeWaypoints.length - 1 && routeWaypoints.length > 1;
                  return (
                    <div
                      key={wp.id}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${
                        isStart
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                          : isEnd
                          ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                          : 'bg-slate-950/80 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="font-bold">{isStart ? '1. Start' : (isEnd ? '🏁 End' : `${idx + 1}. Pt`)}</span>
                      <span className="text-slate-400 text-[10px]">({wp.lat.toFixed(4)}, {wp.lon.toFixed(4)})</span>
                      <button
                        onClick={() => handleRemoveWaypoint(wp.id)}
                        className="text-slate-500 hover:text-rose-400 font-bold ml-0.5"
                        title="Delete waypoint"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Instructions Banner */}
            <div className="flex items-center justify-between text-[11px] text-cyan-400/90 bg-cyan-950/30 border border-cyan-800/40 px-2.5 py-1.5 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                </span>
                <span>Click anywhere on the interactive map to plot route waypoints. Drag markers to adjust road turns.</span>
              </div>
              <span className="font-mono text-[10px] text-slate-400">OpenStreetMap OSRM</span>
            </div>
          </div>
        )}

        {/* SVG Mode Interface (Upload / Custom Only - No Premade Shapes) */}
        {artMode === 'svg' && (
          <div className="p-2 bg-slate-950/70 border border-slate-800/90 rounded-lg space-y-2">
            {parsedSvgStrokes.length === 0 ? (
              <div className="p-3 bg-slate-900/60 border border-dashed border-slate-700 rounded-lg text-center space-y-2">
                <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  <span>No SVG Loaded — Import Any Vector Graphic</span>
                </div>
                <p className="text-[11px] text-slate-400 max-w-lg mx-auto">
                  Upload an SVG file or paste SVG markup (paths, circles, polygons). The generator traces outlines into GPS waypoints for virtual wardrive synthesis.
                </p>
                <div className="flex items-center justify-center gap-2 pt-0.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-bold transition flex items-center gap-1.5 shadow"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload .SVG File</span>
                  </button>
                  <button
                    onClick={() => setShowSvgPasteModal(true)}
                    className="px-3 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-xs font-medium transition flex items-center gap-1.5"
                  >
                    <FileCode className="w-3.5 h-3.5 text-amber-400" />
                    <span>Paste SVG XML</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 bg-slate-900/80 border border-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Custom SVG:</span>
                  </span>
                  <span className="px-2 py-0.5 bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 rounded text-xs font-mono font-bold flex items-center gap-1.5">
                    <span>{svgFileName || 'Custom Vector Graphic'}</span>
                    <span className="text-[10px] text-cyan-400/80 font-normal">({parsedSvgStrokes.length} {parsedSvgStrokes.length === 1 ? 'stroke' : 'strokes'})</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-0.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[11px] font-medium transition"
                  >
                    Replace
                  </button>
                  <button
                    onClick={() => setShowSvgPasteModal(!showSvgPasteModal)}
                    className="px-2 py-0.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[11px] font-medium transition"
                  >
                    Edit XML
                  </button>
                  <button
                    onClick={handleClearSvg}
                    className="px-2 py-0.5 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/50 text-rose-300 rounded text-[11px] font-medium transition"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

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

        {/* Text Mode Transformation Controls (Rotation & Flip) */}
        {artMode === 'text' && (
          <div className="p-2 bg-slate-950/70 border border-slate-800/90 rounded-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* 1. Text Rotation */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <RotateCw className="w-3 h-3 text-emerald-400" />
                    <span>Text Rotation</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={rotationDeg}
                      onChange={(e) => setRotationDeg((parseInt(e.target.value) || 0) % 360)}
                      className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-emerald-300 text-right font-bold"
                    />
                    <span className="text-[11px] font-mono text-emerald-400 font-bold">°</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  value={rotationDeg}
                  onChange={(e) => setRotationDeg(parseInt(e.target.value) || 0)}
                  className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded cursor-pointer"
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

              {/* 2. Text Mirror / Flip */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    <FlipHorizontal className="w-3 h-3 text-emerald-400" />
                    <span>Flip / Mirror Text</span>
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
                        ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-bold shadow-sm'
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
                        ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FlipVertical className="w-3 h-3" />
                    <span>Vert</span>
                  </button>
                </div>

                <div className="text-[9px] text-slate-500 text-center pt-0.5 font-mono">
                  Pivots around text center
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Row 1: Target Word / Prefix, SSID List Profile & Origin Coordinates */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          {/* Word / SSID Prefix Input */}
          <div className="md:col-span-3 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>{artMode === 'route' ? 'Route Name / Prefix' : (artMode === 'svg' ? 'Prefix' : 'Word to Map')}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {text.length} ch
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value.toUpperCase())}
                placeholder={artMode === 'route' ? 'e.g. STRIP_DRIVE' : (artMode === 'svg' ? 'e.g. MAP' : 'e.g. KEPLER')}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-400 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 tracking-wider"
              />
            </div>
          </div>

          {/* Router / SSID Profile Selector */}
          <div className="md:col-span-3 space-y-1">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Wifi className="w-3 h-3 text-cyan-400" />
                <span>Router / SSID List</span>
              </span>
              <span className="text-[10px] text-cyan-400 font-mono">
                {ssidMode === 'prefix' ? 'Text Prefix' : 'ISP Defaults'}
              </span>
            </label>
            <select
              value={ssidMode}
              onChange={(e) => setSsidMode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="isp_mix">Realistic Mix (Xfinity, AT&T, Spectrum)</option>
              <option value="xfinity">Xfinity / Comcast (xfinitywifi, Xfinity-XXXX)</option>
              <option value="att">AT&T (ATTXXX, ATT-WIFI-XXXX, attwifi)</option>
              <option value="spectrum">Spectrum (SpectrumSetup, MySpectrum)</option>
              <option value="prefix">Prefix / Word Only ({text || 'KEPLER'}-#)</option>
            </select>
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
          <div className="md:col-span-2 flex items-center gap-1.5">
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
                max="10000"
                step="50"
                value={Math.min(10000, apsPerUnit)}
                onChange={(e) => setApsPerUnit(parseInt(e.target.value))}
                className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
              <input
                type="number"
                min="1"
                max="100000"
                value={apsPerUnit}
                onChange={(e) => setApsPerUnit(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-cyan-300 text-right font-bold"
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

          {/* Card 2: Letter Size & Scale (or Road Route Bounds) */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            {artMode === 'route' ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                    <Route className="w-3 h-3 text-cyan-400" />
                    <span>Road Route Bounds</span>
                  </label>
                  <span className="text-[11px] font-mono text-cyan-400 font-bold">
                    {densityUnit === 'mile' ? `${(routeDistanceKm * 0.621371).toFixed(2)} mi` : `${routeDistanceKm.toFixed(2)} km`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">Waypoints:</span>
                  <span className="text-slate-300 font-bold">{routeWaypoints.length} nodes plotted</span>
                </div>
                <div className="p-1.5 bg-slate-900 rounded border border-slate-800 text-[10px] text-slate-400 leading-tight">
                  Road curves & intersections snapped via OpenStreetMap OSRM driving engine.
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Card 3: Wardrive Vehicle Speed */}
          <div className="p-2 sm:p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Gauge className="w-3 h-3 text-amber-400" />
                <span>Drive Speed</span>
              </label>
              <span className="text-[10px] font-mono text-amber-400 font-bold">
                {Math.round(speedKmh * 0.621371)} mph ({Math.round(speedKmh)} km/h)
              </span>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-500">Up to 666 mph</span>
              <span className="text-slate-400 font-mono">Virtual drive</span>
            </div>

            <input
              type="range"
              min="5"
              max="1072"
              step="5"
              value={Math.min(1072, speedKmh)}
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

            {/* Split Size Dropdown & Quick Export Action Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800 text-xs">
                <Scissors className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] text-slate-400 hidden sm:inline">Split:</span>
                <select
                  value={splitLimitBytes}
                  onChange={(e) => setSplitLimitBytes(Number(e.target.value))}
                  className="bg-transparent text-slate-200 text-xs font-mono focus:outline-none cursor-pointer"
                  title="Maximum file size limit per chunk (breaks up large files into standalone parts)"
                >
                  {SPLIT_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.bytes} value={opt.bytes} className="bg-slate-900 text-slate-200">
                      {opt.label}
                    </option>
                  ))}
                </select>
                {splitLimitBytes > 0 && estimatedParts > 1 && (
                  <span className="px-1.5 py-0.2 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-mono font-bold flex items-center gap-0.5">
                    <FileArchive className="w-3 h-3" />
                    <span>~{estimatedParts} parts</span>
                  </span>
                )}
              </div>

              <button
                onClick={handleDownloadWigle}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded text-xs font-semibold transition"
                title={splitLimitBytes > 0 && estimatedParts > 1 ? `Download ${estimatedParts}-part ZIP archive (each under size limit)` : "Download single WiGLE CSV"}
              >
                <Download className="w-3 h-3" />
                <span>
                  WiGLE CSV {splitLimitBytes > 0 && estimatedParts > 1 ? `(${estimatedParts} parts .zip)` : `(${generatedResult?.aps?.length > 1000 ? `${(generatedResult.aps.length/1000).toFixed(0)}k` : generatedResult?.aps?.length || 0})`}
                </span>
              </button>

              <button
                onClick={handleDownloadKepler}
                disabled={!generatedResult?.aps?.length}
                className="flex items-center gap-1 px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 rounded text-xs font-semibold transition"
                title={splitLimitBytes > 0 && estimatedParts > 1 ? `Download ${estimatedParts}-part ZIP archive` : "Download single Kepler CSV"}
              >
                <Download className="w-3 h-3" />
                <span>
                  Kepler CSV {splitLimitBytes > 0 && estimatedParts > 1 ? `(${estimatedParts} parts)` : ''}
                </span>
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
                  <th className="py-2 px-3">Frequency</th>
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
                    <td className="py-1.5 px-3 text-cyan-300 font-mono text-[11px]">{ap.frequency || channelToFrequency(ap.channel)} MHz</td>
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
              text: artMode === 'route' ? (text || 'ROUTE') : text,
              mode: artMode,
              routeCoordinates: artMode === 'route' ? (routeCoordinates.length >= 2 ? routeCoordinates : routeWaypoints.map((w) => [w.lon, w.lat])) : null,
              svgStrokes: artMode === 'svg' ? parsedSvgStrokes : null,
              latCenter: artMode === 'route' && routeWaypoints.length > 0 ? routeWaypoints[0].lat : latCenter,
              lonCenter: artMode === 'route' && routeWaypoints.length > 0 ? routeWaypoints[0].lon : lonCenter,
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
              ssidMode,
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
