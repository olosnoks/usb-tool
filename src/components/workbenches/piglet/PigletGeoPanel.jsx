// Map + exports + histograms for a parsed WiGLE log (used by PigletFileBrowser's CSV viewer).
// Everything is drawn from the parsed rows; rows without a fix are never plotted.
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Download } from 'lucide-react';
import {
  rowsToGeoJson, rowsToKml, rowsToGpx, dedupeWigleCsv, trackStats, mapPoints, strongestFixRows,
  channelHistogram, securityHistogram, typeHistogram, bandHistogram
} from '../../../utils/pigletGeo';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';

function save(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function popupEl(r) {
  const el = document.createElement('div');
  el.textContent = `${r.ssid || r.mac} | ${r.mac} | ${r.rssi ?? '?'} dBm`;   // textContent: SSIDs are untrusted
  return el;
}

function Histogram({ title, data, color }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="px-2 py-1.5 rounded-lg border border-slate-800 bg-slate-950 min-w-0">
      <div className="text-[10px] text-slate-500 mb-1">{title}</div>
      {data.length === 0 ? <div className="text-[11px] text-slate-600">no data</div> : (
        <div className="flex items-end gap-1 h-14" role="img" aria-label={title}>
          {data.map((d) => (
            <div key={d.key} className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full" title={`${d.key}: ${d.count}`}>
              <div className={`w-full rounded-t ${color}`} style={{ height: Math.max(4, Math.round((d.count / max) * 100)) + '%' }} />
              <span className="text-[8px] text-slate-500 mt-0.5 truncate max-w-full">{d.key}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PigletGeoPanel({ rows, name = 'warhog-log' }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const { points, total, capped } = useMemo(() => mapPoints(rows), [rows]);
  const fixCount = useMemo(() => strongestFixRows(rows).length, [rows]);
  const hist = useMemo(() => ({ ch: channelHistogram(rows), sec: securityHistogram(rows), type: typeHistogram(rows), band: bandHistogram(rows) }), [rows]);
  const track = useMemo(() => trackStats(rows), [rows])
  const base = String(name).replace(/\.[^.]+$/, '') || 'warhog-log';
  const leafletOk = typeof window !== 'undefined' && L && typeof L.map === 'function';

  useEffect(() => {
    if (!leafletOk || !mapEl.current || mapRef.current) return undefined;
    try {
      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false, preferCanvas: true });
      L.tileLayer(TILE_URL, { maxZoom: 16 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    } catch (e) { console.warn('Piglet map init:', e); }
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; } };
  }, [leafletOk]);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    try {
      layer.clearLayers();
      const latlngs = [];
      for (const r of points) {
        const ll = [r.lat, r.lon];
        latlngs.push(ll);
        L.circleMarker(ll, { radius: 5, weight: 1, color: r.type === 'BLE' ? '#818cf8' : '#38bdf8', fillOpacity: 0.7 })
          .bindPopup(popupEl(r))
          .addTo(layer);
      }
      if (latlngs.length) map.fitBounds(latlngs, { padding: [20, 20], maxZoom: 16 });
      else map.setView([0, 0], 1);
    } catch (e) { console.warn('Piglet map draw:', e); }
  }, [points]);

  const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] font-bold text-slate-200';
  return (
    <div className="space-y-2" data-testid="piglet-geo-panel">
      <div className="grid grid-cols-2 @lg:grid-cols-4 gap-2">
        <Histogram title="Wi-Fi channel" data={hist.ch} color="bg-amber-500" />
        <Histogram title="Wi-Fi security" data={hist.sec} color="bg-emerald-500" />
        <Histogram title="Wi-Fi vs BLE" data={hist.type} color="bg-sky-500" />
        <Histogram title="Band" data={hist.band} color="bg-fuchsia-500" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={!fixCount} onClick={() => save(base + '.kml', rowsToKml(rows, base), 'application/vnd.google-earth.kml+xml')}>
          <Download className="w-3 h-3" /> Export KML
        </button>
        <button type="button" className={btn} disabled={!fixCount} onClick={() => save(base + '.geojson', JSON.stringify(rowsToGeoJson(rows), null, 2), 'application/geo+json')}>
          <Download className="w-3 h-3" /> Export GeoJSON
        </button>
        <button type="button" className={btn} disabled={!fixCount} onClick={() => save(base + '.gpx', rowsToGpx(rows, base), 'application/gpx+xml')}>
          <Download className="w-3 h-3" /> Export GPX
        </button>
        <button type="button" className={btn} disabled={!rows.length} title="One row per MAC (strongest sighting)" onClick={() => save(base + '-deduped.csv', dedupeWigleCsv(rows), 'text/csv')}>
          <Download className="w-3 h-3" /> Deduped CSV
        </button>
        <span className="text-[11px] text-slate-500">
          {fixCount ? `${points.length.toLocaleString()} point${points.length === 1 ? '' : 's'} on the map` : 'No GPS fixes in this log'}
          {capped ? ` (strongest ${points.length.toLocaleString()} of ${total.toLocaleString()} shown; exports include all)` : ''}
        </span>
      </div>
      {track.fixRows > 0 && (
        <div className="text-[11px] text-slate-500" data-testid="piglet-track-stats">
          Route about {track.km.toFixed(2)} km (FirstSeen order{track.skippedHops ? `, ${track.skippedHops} jump(s) over 5 km ignored` : ''}); area {track.bbox.minLat.toFixed(4)}..{track.bbox.maxLat.toFixed(4)}, {track.bbox.minLon.toFixed(4)}..{track.bbox.maxLon.toFixed(4)}
        </div>
      )}
      <div ref={mapEl} data-testid="piglet-map" className="w-full h-56 rounded-lg border border-slate-800 bg-slate-950" />
    </div>
  );
}
