import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  MapPin, 
  Radio, 
  Navigation, 
  Layers, 
  Wifi, 
  Flame, 
  Smartphone,
  Eye,
  EyeOff,
  Crosshair,
  ShieldCheck,
  Maximize2
} from 'lucide-react';

/**
 * GeospatialMap Component
 * Interactive Leaflet map with multi-layer RF signal heatmapping,
 * satellite/standard/dark tile switching, and GPS accuracy visualization.
 */
export default function GeospatialMap({
  devices = {},
  clients = {},
  currentGps = { latitude: null, longitude: null, accuracy: null },
  onSelectDevice
}) {
  const [mapType, setMapType] = useState('dark'); // 'dark' | 'standard' | 'satellite'
  const [isHeatmapActive, setIsHeatmapActive] = useState(true);
  const [isMarkersActive, setIsMarkersActive] = useState(true);
  const [nodeFilter, setNodeFilter] = useState('all'); // 'all' | 'aps' | 'clients'
  const [selectedNetwork, setSelectedNetwork] = useState('all');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markerLayerGroupRef = useRef(null);
  const heatLayerRef = useRef(null);
  const userGpsMarkerRef = useRef(null);

  // Check if Leaflet is functional in current runtime (guards SSR / Vitest headless)
  const isLeafletAvailable = typeof window !== 'undefined' && L && typeof L.map === 'function';

  // Tile layer URL definitions
  const tileProviders = {
    dark: {
      // Esri World Dark Gray Base — free, no API key (same provider family as the
      // HackRF Tactical Map). Carto's basemaps.cartocdn.com dark tiles now return
      // "API KEY REQUIRED" watermark tiles, so we no longer use them.
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 16,
      attribution: 'Tiles &copy; Esri'
    },
    standard: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    }
  };

  // Helper: Get color based on RSSI signal strength
  const getRssiColor = (rssi) => {
    if (rssi >= -60) return '#10b981'; // Strong (Emerald)
    if (rssi >= -70) return '#06b6d4'; // Good (Cyan)
    if (rssi >= -80) return '#f59e0b'; // Moderate (Amber)
    return '#f43f5e';                 // Weak (Rose)
  };

  // 1. Extract valid geotagged APs and Clients
  const geotaggedAps = useMemo(() => {
    const list = Array.isArray(devices) ? devices : Object.values(devices || {});
    return list.filter(d => 
      d && 
      typeof d.latitude === 'number' && 
      typeof d.longitude === 'number' &&
      !isNaN(d.latitude) && 
      !isNaN(d.longitude)
    );
  }, [devices]);

  const geotaggedClients = useMemo(() => {
    const list = Array.isArray(clients) ? clients : Object.values(clients || {});
    return list.filter(c => 
      c && 
      typeof c.latitude === 'number' && 
      typeof c.longitude === 'number' &&
      !isNaN(c.latitude) && 
      !isNaN(c.longitude)
    );
  }, [clients]);

  // Filtered devices list based on node type and network dropdown
  const visibleNodes = useMemo(() => {
    let result = [];
    if (nodeFilter === 'all' || nodeFilter === 'aps') {
      result = result.concat(geotaggedAps.map(d => ({ ...d, nodeType: 'ap' })));
    }
    if (nodeFilter === 'all' || nodeFilter === 'clients') {
      result = result.concat(geotaggedClients.map(c => ({ ...c, nodeType: 'client' })));
    }

    if (selectedNetwork !== 'all') {
      result = result.filter(item => 
        (item.bssid || '').toUpperCase() === selectedNetwork.toUpperCase()
      );
    }
    return result;
  }, [geotaggedAps, geotaggedClients, nodeFilter, selectedNetwork]);

  // Average accuracy calculation for display
  const avgAccuracy = useMemo(() => {
    if (visibleNodes.length === 0) return 0;
    const sum = visibleNodes.reduce((acc, curr) => acc + (curr.accuracy || 15), 0);
    return Math.round(sum / visibleNodes.length);
  }, [visibleNodes]);

  // 2. Initialize Leaflet Map Instance
  useEffect(() => {
    if (!isLeafletAvailable || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    try {
      const defaultCenter = (currentGps?.latitude && currentGps?.longitude)
        ? [currentGps.latitude, currentGps.longitude]
        : visibleNodes.length > 0
        ? [visibleNodes[0].latitude, visibleNodes[0].longitude]
        : [37.7749, -122.4194];

      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 16,
        zoomControl: true,
        attributionControl: false
      });

      tileLayerRef.current = L.tileLayer(tileProviders[mapType].url, {
        maxZoom: tileProviders[mapType].maxZoom
      }).addTo(map);

      markerLayerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;

      // In browser runtime, attempt loading leaflet.heat dynamically
      if (typeof window !== 'undefined') {
        window.L = L;
        import('leaflet.heat').catch(() => {});
      }
    } catch (err) {
      console.warn('GeospatialMap initialization notice:', err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 3. Update Tile Provider on MapType switch
  useEffect(() => {
    if (!mapInstanceRef.current || !isLeafletAvailable) return;
    try {
      if (tileLayerRef.current) {
        mapInstanceRef.current.removeLayer(tileLayerRef.current);
      }
      const provider = tileProviders[mapType] || tileProviders.dark;
      tileLayerRef.current = L.tileLayer(provider.url, {
        maxZoom: provider.maxZoom
      }).addTo(mapInstanceRef.current);
    } catch (e) {
      console.warn('Tile layer update warning:', e);
    }
  }, [mapType, isLeafletAvailable]);

  // 4. Update Heatmap Layer
  useEffect(() => {
    if (!mapInstanceRef.current || !isLeafletAvailable) return;

    try {
      if (heatLayerRef.current) {
        mapInstanceRef.current.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      if (isHeatmapActive && visibleNodes.length > 0) {
        // Collect heat points: [lat, lng, normalized intensity]
        const heatPoints = visibleNodes.map(item => {
          const rssi = typeof item.rssi === 'number' ? item.rssi : -75;
          const intensity = Math.min(1.0, Math.max(0.15, (rssi + 100) / 60));
          return [item.latitude, item.longitude, intensity];
        });

        if (typeof L.heatLayer === 'function') {
          heatLayerRef.current = L.heatLayer(heatPoints, {
            radius: 28,
            blur: 18,
            maxZoom: 17,
            gradient: {
              0.2: '#06b6d4',
              0.5: '#10b981',
              0.75: '#f59e0b',
              1.0: '#f43f5e'
            }
          }).addTo(mapInstanceRef.current);
        }
      }
    } catch (e) {
      console.warn('Heatmap layer update warning:', e);
    }
  }, [isHeatmapActive, visibleNodes, isLeafletAvailable]);

  // 5. Update Markers & Accuracy Circles
  useEffect(() => {
    if (!mapInstanceRef.current || !markerLayerGroupRef.current || !isLeafletAvailable) return;

    try {
      markerLayerGroupRef.current.clearLayers();

      if (isMarkersActive) {
        visibleNodes.forEach(item => {
          const isAp = item.nodeType === 'ap';
          const rssi = typeof item.rssi === 'number' ? item.rssi : -70;
          const color = getRssiColor(rssi);
          const rawAccuracy = typeof item.accuracy === 'number' ? item.accuracy : 15;
          const radiusMeters = Math.max(8, Math.min(120, rawAccuracy));

          // Outer accuracy circle representing physical GPS error tolerance
          const accuracyCircle = L.circle([item.latitude, item.longitude], {
            radius: radiusMeters,
            color,
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.18,
            dashArray: isAp ? undefined : '3, 5'
          });

          // Inner pin marker
          const centerMarker = L.circleMarker([item.latitude, item.longitude], {
            radius: isAp ? 6 : 4,
            color: '#ffffff',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.95
          });

          const identifier = isAp 
            ? (item.ssid || '<Hidden SSID>') 
            : `Station: ${item.clientMac || 'Client'}`;
          const subIdentifier = isAp ? item.bssid : (item.bssid ? `AP: ${item.bssid}` : 'Unassociated');
          const vendor = item.vendor || 'Unknown Hardware Vendor';

          const popupContent = `
            <div style="font-family: sans-serif; min-width: 170px; color: #f1f5f9;">
              <div style="font-weight: bold; font-size: 13px; color: #38bdf8; margin-bottom: 2px;">
                ${identifier}
              </div>
              <div style="font-size: 11px; font-family: monospace; color: #94a3b8; margin-bottom: 6px;">
                ${subIdentifier}
              </div>
              <div style="font-size: 11px; margin-bottom: 3px;">
                <strong>Signal (RSSI):</strong> <span style="color: ${color}; font-weight: bold;">${rssi} dBm</span>
              </div>
              <div style="font-size: 11px; margin-bottom: 3px;">
                <strong>Channel:</strong> ${item.channel || '—'}
              </div>
              <div style="font-size: 11px; margin-bottom: 3px;">
                <strong>Vendor:</strong> ${vendor}
              </div>
              <div style="font-size: 10px; color: #64748b; margin-top: 4px; border-top: 1px solid #334155; padding-top: 4px;">
                GPS Acc: ±${Math.round(rawAccuracy)}m (${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)})
              </div>
            </div>
          `;

          centerMarker.bindPopup(popupContent);
          accuracyCircle.bindPopup(popupContent);

          if (typeof onSelectDevice === 'function') {
            centerMarker.on('click', () => {
              onSelectDevice({ type: isAp ? 'ap' : 'client', data: item });
            });
          }

          markerLayerGroupRef.current.addLayer(accuracyCircle);
          markerLayerGroupRef.current.addLayer(centerMarker);
        });
      }

      // Plot live user GPS location marker if valid
      if (currentGps?.latitude && currentGps?.longitude) {
        if (!userGpsMarkerRef.current) {
          userGpsMarkerRef.current = L.circleMarker([currentGps.latitude, currentGps.longitude], {
            radius: 8,
            color: '#38bdf8',
            weight: 2,
            fillColor: '#0284c7',
            fillOpacity: 1
          }).bindPopup('<strong>Your Current Position</strong>');
          markerLayerGroupRef.current.addLayer(userGpsMarkerRef.current);
        } else {
          userGpsMarkerRef.current.setLatLng([currentGps.latitude, currentGps.longitude]);
          markerLayerGroupRef.current.addLayer(userGpsMarkerRef.current);
        }
      }
    } catch (e) {
      console.warn('Marker rendering warning:', e);
    }
  }, [visibleNodes, isMarkersActive, currentGps, isLeafletAvailable, onSelectDevice]);

  // Handler: Recenter map on current user GPS or active nodes
  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    try {
      if (currentGps?.latitude && currentGps?.longitude) {
        mapInstanceRef.current.setView([currentGps.latitude, currentGps.longitude], 17);
      } else if (visibleNodes.length > 0) {
        mapInstanceRef.current.setView([visibleNodes[0].latitude, visibleNodes[0].longitude], 16);
      }
    } catch (e) {}
  };

  return (
    <div className="flex flex-col h-[650px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Map Control Action Bar */}
      <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Layer & Map Style Toggles */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800">
            <button
              onClick={() => setMapType('dark')}
              className={`px-2.5 py-1 rounded text-xs transition ${
                mapType === 'dark' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dark Map
            </button>
            <button
              onClick={() => setMapType('standard')}
              className={`px-2.5 py-1 rounded text-xs transition ${
                mapType === 'standard' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Standard Map
            </button>
            <button
              onClick={() => setMapType('satellite')}
              className={`px-2.5 py-1 rounded text-xs transition ${
                mapType === 'satellite' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Satellite View
            </button>
          </div>

          {/* Heatmap Toggle */}
          <button
            onClick={() => setIsHeatmapActive(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
              isHeatmapActive
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Heatmap Overlay</span>
          </button>

          {/* Markers Toggle */}
          <button
            onClick={() => setIsMarkersActive(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
              isMarkersActive
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            {isMarkersActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Device Markers</span>
          </button>
        </div>

        {/* Filter Controls & Recenter */}
        <div className="flex items-center gap-2">
          {/* Node Type Filter */}
          <select
            value={nodeFilter}
            onChange={(e) => setNodeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 outline-none text-xs"
          >
            <option value="all">All Radiating Nodes</option>
            <option value="aps">Access Points Only</option>
            <option value="clients">Client Stations Only</option>
          </select>

          {/* Network BSSID Filter */}
          {geotaggedAps.length > 0 && (
            <select
              value={selectedNetwork}
              onChange={(e) => setSelectedNetwork(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 outline-none text-xs max-w-[150px] truncate"
            >
              <option value="all">All Networks</option>
              {geotaggedAps.map(ap => (
                <option key={ap.bssid} value={ap.bssid}>
                  {ap.ssid && ap.ssid !== '<Hidden SSID>' ? `${ap.ssid} (${ap.bssid.slice(-5)})` : ap.bssid}
                </option>
              ))}
            </select>
          )}

          {/* Recenter Button */}
          <button
            onClick={handleRecenter}
            title="Recenter on current GPS coordinates"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-semibold transition"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Recenter</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Map Canvas */}
      <div className="relative flex-1 w-full bg-slate-950">
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Empty State Banner if no coordinates collected */}
        {visibleNodes.length === 0 && !currentGps?.latitude && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm pointer-events-none text-center">
            <MapPin className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
            <div className="text-sm font-bold text-slate-300 mb-1">No Geotagged RF Packets Captured</div>
            <div className="text-xs text-slate-500 max-w-sm">
              Enable "GPS Geotagging" in the workbench header to bind latitude and longitude coordinates to observed APs and client stations.
            </div>
          </div>
        )}
      </div>

      {/* Summary Metrics Footer Bar */}
      <div className="px-4 py-2 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Geotagged APs: <strong className="text-slate-200">{geotaggedAps.length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-purple-400" />
            <span>Geotagged STAs: <strong className="text-slate-200">{geotaggedClients.length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Avg Accuracy: <strong className="text-slate-200">±{avgAccuracy}m</strong></span>
          </div>
        </div>

        {/* Live GPS Fix Status */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {currentGps?.latitude ? (
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>GPS Fix: {currentGps.latitude.toFixed(5)}, {currentGps.longitude.toFixed(5)} (±{Math.round(currentGps.accuracy || 0)}m)</span>
            </span>
          ) : (
            <span className="text-slate-500">Live GPS Receiver: Inactive</span>
          )}
        </div>
      </div>
    </div>
  );
}
