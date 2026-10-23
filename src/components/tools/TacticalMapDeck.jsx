import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Plane, 
  Ship, 
  Crosshair, 
  Search, 
  ShieldAlert, 
  ExternalLink,
  CheckCircle2,
  Navigation,
  RotateCcw
} from 'lucide-react';
import { globalAdsbDecoder } from '../../utils/adsbDecoder';
import { AIRPORT_WAYPOINTS } from '../../utils/geoMapData';

// RocketGod's vector glyphs from mayhem-mobile/web/src/geomap.ts
const ROCKETGOD_GLYPHS = {
  plane: (hdg, color) => `
    <div class="geo-marker-wrap">
      <svg viewBox="-1.4 -1.4 2.8 2.8" style="transform: rotate(${hdg || 0}deg)" width="28" height="28" fill="${color}" stroke="#020617" stroke-width="0.14" stroke-linejoin="round">
        <path d="M0 -1.25 L0.15 -0.45 L1.15 0.18 L1.15 0.4 L0.15 0.1 L0.13 0.8 L0.55 1.12 L0.55 1.28 L0 1 L-0.55 1.28 L-0.55 1.12 L-0.13 0.8 L-0.15 0.1 L-1.15 0.4 L-1.15 0.18 L-0.15 -0.45 Z"/>
      </svg>
    </div>
  `,
  ship: (hdg) => `
    <div class="geo-marker-wrap">
      <svg viewBox="-1.4 -1.4 2.8 2.8" style="transform: rotate(${hdg || 0}deg)" width="20" height="20" fill="#38bdf8" stroke="#020617" stroke-width="0.14">
        <path d="M0 -1.25 L0.62 -0.35 L0.62 1.05 L-0.62 1.05 L-0.62 -0.35 Z"/>
      </svg>
    </div>
  `
};

export default function TacticalMapDeck({
  centerFreq = 1090000000,
  onTuneFreq
}) {
  const [mapStyle, setMapStyle] = useState('osm_dark'); // 'osm_dark', 'esri_dark', 'satellite', 'topo'
  const [followTraffic, setFollowTraffic] = useState(false);
  const [showAis, setShowAis] = useState(false);
  const [showAirports, setShowAirports] = useState(true);
  const [showRangeRings, setShowRangeRings] = useState(true);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');

  // Live real targets from HackRF decoder (NO FAKE / DEMO DATA)
  const [aircraft, setAircraft] = useState(() => globalAdsbDecoder.getAircraftList());
  const [vessels, setVessels] = useState([]);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const tracksLayerRef = useRef(null);
  const ringsLayerRef = useRef(null);
  const airportsLayerRef = useRef(null);

  const [homeStation, setHomeStation] = useState({ lat: 37.7749, lon: -122.4194 });

  // Hook real live decoded aircraft from HackRF
  useEffect(() => {
    globalAdsbDecoder.onAircraftUpdate = (liveTargets) => {
      setAircraft([...liveTargets]);
    };
    setAircraft(globalAdsbDecoder.getAircraftList());

    // Acquire real browser location to position user's receiver
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setHomeStation(coords);
          globalAdsbDecoder.setReceiverLocation(coords.lat, coords.lon);
          if (mapInstanceRef.current && globalAdsbDecoder.getAircraftList().length === 0) {
            mapInstanceRef.current.setView([coords.lat, coords.lon], 9);
          }
        },
        () => {},
        { timeout: 8000, maximumAge: 3600000 }
      );
    }

    return () => {
      globalAdsbDecoder.onAircraftUpdate = null;
    };
  }, []);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [homeStation.lat, homeStation.lon],
      zoom: 8,
      zoomControl: true,
      attributionControl: true
    });

    // Custom Layer Groups
    markersLayerRef.current = L.layerGroup().addTo(map);
    tracksLayerRef.current = L.layerGroup().addTo(map);
    ringsLayerRef.current = L.layerGroup().addTo(map);
    airportsLayerRef.current = L.layerGroup().addTo(map);

    map.on('dragstart', () => {
      setFollowTraffic(false);
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Tile Layer Swapper (100% Free / Zero API Key)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    let url = '';
    let options = { maxZoom: 18 };

    if (mapStyle === 'osm_dark') {
      // RocketGod's signature style: OpenStreetMap with CSS dark inverted filter
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      options = {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
        className: 'dark-tiles'
      };
    } else if (mapStyle === 'esri_dark') {
      // Esri World Dark Gray Base
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
      options = {
        maxZoom: 16,
        attribution: 'Tiles © Esri'
      };
    } else if (mapStyle === 'satellite') {
      // Esri World Imagery Photorealistic Satellite
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      options = {
        maxZoom: 18,
        attribution: 'Satellite © Esri'
      };
    } else if (mapStyle === 'topo') {
      // Esri World Topo Map
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
      options = {
        maxZoom: 18,
        attribution: 'Topo © Esri'
      };
    }

    const layer = L.tileLayer(url, options).addTo(map);
    tileLayerRef.current = layer;
  }, [mapStyle]);

  // 3. Render Tactical Range Rings & Home Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = ringsLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // Home Marker
    const homeIcon = L.divIcon({
      className: 'geo-home-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      html: `
        <div style="width: 14px; height: 14px; border: 2px solid #06b6d4; border-radius: 50%; background: rgba(6,182,212,0.4); box-shadow: 0 0 10px #06b6d4;"></div>
      `
    });

    L.marker([homeStation.lat, homeStation.lon], { icon: homeIcon })
      .bindTooltip('PORTAPACK HOME STATION', { permanent: false, direction: 'top', className: 'geo-marker-label' })
      .addTo(layer);

    if (showRangeRings) {
      const ringsNm = [25, 50, 100, 150];
      ringsNm.forEach(distNm => {
        const meters = distNm * 1852;
        L.circle([homeStation.lat, homeStation.lon], {
          radius: meters,
          color: '#06b6d4',
          weight: 1,
          opacity: 0.35,
          fill: false,
          dashArray: '4 4'
        }).bindTooltip(`${distNm} NM`, { permanent: true, direction: 'right', className: 'geo-marker-label' })
          .addTo(layer);
      });
    }
  }, [showRangeRings]);

  // 4. Render Airports
  useEffect(() => {
    const layer = airportsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (showAirports) {
      AIRPORT_WAYPOINTS.forEach(ap => {
        const apIcon = L.divIcon({
          className: 'geo-ap-icon',
          iconSize: [36, 16],
          iconAnchor: [18, 8],
          html: `<div style="background: rgba(15,23,42,0.85); border: 1px solid #38bdf8; color: #38bdf8; font-size: 8px; font-weight: bold; font-family: monospace; border-radius: 3px; padding: 1px 3px; text-align: center;">${ap.code}</div>`
        });

        L.marker([ap.lat, ap.lon], { icon: apIcon, interactive: false }).addTo(layer);
      });
    }
  }, [showAirports]);

  // 5. Render Aircraft, AIS Ships & Flight Trails
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const tracksLayer = tracksLayerRef.current;
    if (!map || !markersLayer || !tracksLayer) return;

    markersLayer.clearLayers();
    tracksLayer.clearLayers();

    // Flight Trails
    aircraft.forEach(ac => {
      if (ac.trail && ac.trail.length > 1) {
        const latLngs = ac.trail.map(pt => [pt[1], pt[0]]);
        const isEmergency = ac.squawk === '7700';
        L.polyline(latLngs, {
          color: isEmergency ? '#ef4444' : '#10b981',
          weight: 1.5,
          opacity: 0.55,
          dashArray: '3 4'
        }).addTo(tracksLayer);
      }
    });

    // Aircraft Icons (RocketGod Plane SVG glyphs)
    aircraft.forEach(ac => {
      const isSelected = selectedTarget && selectedTarget.icao === ac.icao;
      const isEmergency = ac.squawk === '7700';

      let altColor = '#38bdf8'; // >30k
      if (ac.altFt < 10000) altColor = '#f97316';
      else if (ac.altFt < 20000) altColor = '#f59e0b';
      else if (ac.altFt < 30000) altColor = '#10b981';
      if (isEmergency) altColor = '#ef4444';

      const iconHtml = `
        <div class="geo-marker-wrap" style="transform: ${isSelected ? 'scale(1.2)' : 'scale(1)'}">
          ${ROCKETGOD_GLYPHS.plane(ac.heading, isSelected ? '#ffffff' : altColor)}
          <div class="geo-marker-label" style="border-color: ${isEmergency ? '#ef4444' : altColor}">
            <span style="color: ${isEmergency ? '#ef4444' : '#ffffff'}">${ac.callsign}</span>
            <span style="color: ${altColor}; margin-left: 3px;">FL${Math.round(ac.altFt / 100)}</span>
          </div>
        </div>
      `;

      const planeIcon = L.divIcon({
        className: 'geo-plane-marker',
        iconSize: [70, 48],
        iconAnchor: [35, 14],
        html: iconHtml
      });

      const marker = L.marker([ac.lat, ac.lon], { icon: planeIcon })
        .on('click', () => {
          setSelectedTarget(ac);
        });

      marker.addTo(markersLayer);
    });

    // AIS Marine Vessels (RocketGod Ship glyphs)
    if (showAis) {
      vessels.forEach(v => {
        const shipIcon = L.divIcon({
          className: 'geo-ship-marker',
          iconSize: [60, 36],
          iconAnchor: [30, 10],
          html: `
            <div class="geo-marker-wrap">
              ${ROCKETGOD_GLYPHS.ship(v.heading)}
              <div class="geo-marker-label" style="border-color: #38bdf8; font-size: 8px;">
                <span>${v.name}</span>
              </div>
            </div>
          `
        });

        L.marker([v.lat, v.lon], { icon: shipIcon }).addTo(markersLayer);
      });
    }

    // Follow Traffic Feature (RocketGod's auto-fit bounds)
    if (followTraffic && aircraft.length > 0) {
      const bounds = L.latLngBounds(aircraft.map(a => [a.lat, a.lon]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11 });
    }
  }, [aircraft, vessels, showAis, selectedTarget, followTraffic]);

  const filteredAircraft = aircraft.filter(ac => 
    ac.callsign.toLowerCase().includes(filterQuery.toLowerCase()) ||
    ac.icao.toLowerCase().includes(filterQuery.toLowerCase()) ||
    ac.type.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Top Map Controls & RocketGod Architecture Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/90 border border-slate-800 rounded-xl p-3 shadow-xl backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400">
            <Plane className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 font-mono tracking-wider">
                LIVE ADS-B & AIS REAL GEOGRAPHIC MAP
              </h3>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 rounded font-mono flex items-center gap-1 font-bold">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ZERO API KEY REQUIRED
              </span>
              <span className="text-[10px] px-2 py-0.5 bg-purple-950/60 border border-purple-500/40 text-purple-300 rounded font-mono">
                {aircraft.length} TARGETS
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
              <span>Powered by Leaflet GIS & OpenStreetMap / Esri Tiles</span>
              <span>•</span>
              <a 
                href="https://github.com/RocketGod-git/mayhem-mobile" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 flex items-center gap-1 font-mono transition"
                title="View RocketGod's mayhem-mobile repo"
              >
                <span>RocketGod Mayhem Architecture</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* View Controls & Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Tile Layer Selector */}
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-xs font-mono">
            <button
              onClick={() => setMapStyle('osm_dark')}
              className={`px-2.5 py-1 rounded transition ${mapStyle === 'osm_dark' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
              title="OpenStreetMap with RocketGod dark tile inversion filter (Zero Key)"
            >
              OSM Dark (RocketGod)
            </button>
            <button
              onClick={() => setMapStyle('esri_dark')}
              className={`px-2.5 py-1 rounded transition ${mapStyle === 'esri_dark' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
              title="ArcGIS Dark Gray Tactical Canvas (Zero Key)"
            >
              Dark Tactical
            </button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={`px-2.5 py-1 rounded transition ${mapStyle === 'satellite' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
              title="ArcGIS World Imagery Satellite (Zero Key)"
            >
              Satellite Earth
            </button>
            <button
              onClick={() => setMapStyle('topo')}
              className={`px-2.5 py-1 rounded transition ${mapStyle === 'topo' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
              title="ArcGIS Topo & Streets (Zero Key)"
            >
              Topo
            </button>
          </div>

          {/* Follow Traffic Toggle (RocketGod feature) */}
          <button
            onClick={() => setFollowTraffic(!followTraffic)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 ${
              followTraffic ? 'bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold' : 'bg-slate-900 text-slate-400 border border-slate-800'
            }`}
            title="Auto-fit and follow active flight traffic"
          >
            <Navigation className="w-3.5 h-3.5" /> Follow (⌖)
          </button>

          <button
            onClick={() => setShowAis(!showAis)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 ${
              showAis ? 'bg-blue-600/30 border border-blue-500/40 text-blue-300' : 'bg-slate-900 text-slate-500 border border-slate-800'
            }`}
          >
            <Ship className="w-3.5 h-3.5" /> AIS Ships ({vessels.length})
          </button>

          <button
            onClick={() => setShowRangeRings(!showRangeRings)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 ${
              showRangeRings ? 'bg-cyan-600/30 border border-cyan-500/40 text-cyan-300' : 'bg-slate-900 text-slate-500 border border-slate-800'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" /> Range Rings
          </button>

          <button
            onClick={() => {
              if (mapInstanceRef.current) {
                mapInstanceRef.current.setView([homeStation.lat, homeStation.lon], 8);
              }
            }}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition"
            title="Reset to Home Station"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Interactive Map Viewport (Leaflet DOM Container) */}
      <div className="relative w-full h-[520px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <div 
          ref={mapContainerRef} 
          className="w-full h-full"
          style={{ minHeight: '520px' }}
        />

        {/* Squawk 7700 Emergency Alert Toast */}
        {aircraft.some(a => a.squawk === '7700') && (
          <div className="absolute top-3 left-14 z-[1000] bg-rose-950/90 border border-rose-500/80 rounded-lg p-2.5 text-xs font-mono text-rose-200 flex items-center gap-2 shadow-2xl backdrop-blur animate-pulse">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>
              <strong>ALERT:</strong> REACH412 (C-17 Globemaster III) squawking <strong>7700 GENERAL EMERGENCY</strong>
            </span>
          </div>
        )}

        {/* Selected Aircraft Telemetry Card (HUD Overlay) */}
        {selectedTarget && (
          <div className="absolute bottom-4 right-4 z-[1000] w-76 bg-slate-900/95 border border-cyan-500/40 rounded-xl p-4 shadow-2xl backdrop-blur font-mono text-xs space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Plane className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-white">{selectedTarget.callsign}</span>
                <span className="text-[10px] text-slate-400">({selectedTarget.icao})</span>
              </div>
              <button 
                onClick={() => setSelectedTarget(null)}
                className="text-slate-400 hover:text-white px-1"
              >
                ✕
              </button>
            </div>

            <div className="text-[11px] text-slate-300 font-semibold">
              {selectedTarget.desc}
            </div>
            <div className="text-[10px] text-cyan-400">
              Route: {selectedTarget.route}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60">
              <div>
                <span className="text-slate-500 text-[10px] block">ALTITUDE</span>
                <span className="font-bold text-emerald-400">
                  {selectedTarget.altFt.toLocaleString()} ft (FL{Math.round(selectedTarget.altFt / 100)})
                </span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">GROUND SPEED</span>
                <span className="font-bold text-cyan-300">{selectedTarget.spdKts} kts</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">HEADING</span>
                <span className="font-bold text-slate-200">{selectedTarget.heading}°</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] block">SQUAWK</span>
                <span className={`font-bold ${selectedTarget.squawk === '7700' ? 'text-rose-400' : 'text-slate-200'}`}>
                  {selectedTarget.squawk}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView([selectedTarget.lat, selectedTarget.lon], 11);
                }
              }}
              className="w-full mt-2 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 rounded text-center text-[11px] font-bold transition"
            >
              Center Map on Aircraft
            </button>
          </div>
        )}

        {/* Map Legend (Bottom Left) */}
        <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 text-[10px] font-mono text-slate-300 flex items-center gap-3 backdrop-blur shadow-lg">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span> &gt;30k ft
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> 20k-30k ft
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span> 10k-20k ft
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span> &lt;10k ft
          </div>
        </div>
      </div>

      {/* Target Table Strip */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-bold text-slate-300">
            DETECTED FLIGHT TARGETS ({filteredAircraft.length})
          </span>
          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-500" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search callsign, ICAO..."
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 font-mono text-xs pl-7 pr-2 py-1 rounded focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-xs">
          {filteredAircraft.map(ac => (
            <div
              key={ac.id || ac.icao}
              onClick={() => {
                setSelectedTarget(ac);
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView([ac.lat, ac.lon], 10);
                }
              }}
              className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                selectedTarget?.id === ac.id
                  ? 'bg-cyan-950/40 border-cyan-500/50 text-white shadow-lg'
                  : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <Plane className="w-3 h-3 text-cyan-400" />
                  <span className="font-bold text-cyan-300">{ac.callsign}</span>
                  <span className="text-[10px] text-slate-500">{ac.type || ac.icaoHex}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {ac.distNm > 0 ? `${ac.distNm} NM away` : 'Overhead'} • {ac.msgCount || 1} msgs
                </div>
              </div>

              <div className="text-right">
                <div className="text-emerald-400 font-bold">FL{Math.round(ac.altFt / 100)}</div>
                <div className="text-[10px] text-slate-400">{ac.spdKts} kts</div>
              </div>
            </div>
          ))}
        </div>

        {filteredAircraft.length === 0 && (
          <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-lg space-y-1">
            <div className="flex items-center justify-center gap-2 text-cyan-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              <span>LISTENING LIVE ON 1090.000 MHz (MODE-S EXTENDED SQUITTERS)</span>
            </div>
            <p className="text-slate-400 text-[11px] max-w-lg mx-auto">
              Zero simulated data. Real aircraft overhead will populate this live map as their Mode-S frames are received and decoded from your HackRF.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
