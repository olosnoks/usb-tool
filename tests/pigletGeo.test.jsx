import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { parseWigle } from '../src/utils/pigletToolkit';
import {
  hasFix, rowsToGeoJson, rowsToKml, mergeWigleLogs, rowsToWigleCsv,
  channelHistogram, securityHistogram, typeHistogram, mapPoints
} from '../src/utils/pigletGeo';

vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const PRE = 'WigleWifi-1.6,appRelease=1,model=x,release=1,device=test-dev,display=,board=,brand=';
const HDR = 'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type';
const mac = (n) => 'AA:BB:CC:DD:EE:' + n.toString(16).toUpperCase().padStart(2, '0');

function fixtureLog() {
  const lines = [PRE, HDR];
  for (let i = 0; i < 100; i++) {
    const fix = i < 80;
    lines.push(`${mac(i)},Net${i},[WPA2-PSK][ESS],2024-05-01 10:00:${String(i % 60).padStart(2, '0')},${1 + (i % 11)},2412,-${40 + i % 40},${fix ? 40 + i * 0.001 : 0},${fix ? -74 : 0},0,10,,,${i % 10 === 0 ? 'BLE' : 'WIFI'}`);
  }
  return lines.join('\n');
}

// jsdom is not installed in this repo (node environment), so there is no DOMParser:
// a small well-formedness check instead (balanced tags, no stray & or <, entities valid).
function checkXml(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  let placemarks = 0;
  const re = /<(\/?)([A-Za-z][\w:-]*)([^<>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[2]) {
      if (m[1]) { expect(stack.pop()).toBe(m[2]); }
      else if (!m[4]) { stack.push(m[2]); if (m[2] === 'Placemark') placemarks++; }
    } else {
      const text = m[5];
      expect(text.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toMatch(/&/);
      expect(text).not.toMatch(/[<>]/);
    }
  }
  expect(stack).toEqual([]);
  return { placemarks };
}

describe('pigletGeo', () => {
  const parsed = parseWigle(fixtureLog());

  it('treats 0,0 and missing coordinates as no fix', () => {
    expect(hasFix({ lat: 0, lon: 0 })).toBe(false);
    expect(hasFix({ lat: null, lon: 5 })).toBe(false);
    expect(hasFix({ lat: 91, lon: 5 })).toBe(false);
    expect(hasFix({ lat: 40, lon: -74 })).toBe(true);
  });

  it('100 rows / 80 fixes -> 80 markers, 80 placemarks, 80 features', () => {
    expect(parsed.rows).toHaveLength(100);
    expect(mapPoints(parsed.rows).points).toHaveLength(80);
    expect(rowsToGeoJson(parsed.rows).features).toHaveLength(80);
    expect(checkXml(rowsToKml(parsed.rows)).placemarks).toBe(80);
  });

  it('escapes XML special characters in SSIDs and stays well-formed', () => {
    const ssid = 'A&B <"x"> \'y\'';
    const rows = [{ mac: mac(1), ssid, auth: '', seen: '', ch: 1, freq: 2412, rssi: -50, lat: 1, lon: 2, type: 'WIFI' }];
    const kml = rowsToKml(rows);
    expect(kml).toContain('A&amp;B &lt;&quot;x&quot;&gt; &apos;y&apos;');
    expect(checkXml(kml).placemarks).toBe(1);
  });

  it('uses the strongest-RSSI row per BSSID', () => {
    const rows = [
      { mac: mac(1), ssid: 'a', rssi: -80, lat: 1, lon: 1, type: 'WIFI' },
      { mac: mac(1), ssid: 'a', rssi: -40, lat: 2, lon: 2, type: 'WIFI' }
    ];
    const f = rowsToGeoJson(rows).features;
    expect(f).toHaveLength(1);
    expect(f[0].geometry.coordinates).toEqual([2, 2]);
  });

  it('merges logs: one row per MAC, best-RSSI position, earliest FirstSeen', () => {
    const a = { rows: [
      { mac: mac(1), ssid: 'x', rssi: -70, lat: 1, lon: 1, seen: '2024-05-02 00:00:00', type: 'WIFI' },
      { mac: mac(2), ssid: 'y', rssi: -60, lat: 5, lon: 5, seen: '2024-05-02 00:00:00', type: 'WIFI' }] };
    const b = { rows: [
      { mac: mac(1), ssid: 'x', rssi: -50, lat: 9, lon: 9, seen: '2024-05-03 00:00:00', type: 'WIFI' },
      { mac: mac(1), ssid: 'x', rssi: -90, lat: 0, lon: 0, seen: '2024-05-01 00:00:00', type: 'WIFI' }] };
    const m = mergeWigleLogs([a, b]);
    expect(m).toHaveLength(2);
    const r1 = m.find((r) => r.mac === mac(1));
    expect([r1.lat, r1.lon, r1.rssi, r1.seen]).toEqual([9, 9, -50, '2024-05-01 00:00:00']);
  });

  it('writes WiGLE CSV with the source pre-header only, and blank coords for no fix', () => {
    const out = rowsToWigleCsv(parsed.rows.slice(80, 82), { preHeader: PRE });
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe(PRE);
    expect(lines[1]).toBe(HDR);
    expect(lines[2]).toMatch(/,,,,,,,[A-Z]+$/);
    expect(rowsToWigleCsv(parsed.rows.slice(0, 1)).startsWith(HDR)).toBe(true);
    const round = parseWigle(rowsToWigleCsv(parsed.rows.slice(0, 5), { preHeader: PRE }));
    expect(round.rows).toHaveLength(5);
    expect(round.dev).toBe('test-dev');
  });

  it('builds histograms from parsed rows', () => {
    expect(channelHistogram(parsed.rows).every((h) => h.key >= 1)).toBe(true);
    expect(securityHistogram(parsed.rows)).toEqual([{ key: 'WPA2', count: 90 }]);
    expect(typeHistogram(parsed.rows)).toEqual([{ key: 'Wi-Fi', count: 90 }, { key: 'BLE', count: 10 }]);
  });

  it('caps plotted points at 5000, keeping the strongest', () => {
    const rows = Array.from({ length: 5100 }, (_, i) => ({ mac: 'M' + i, rssi: -i, lat: 1 + i * 1e-5, lon: 1, type: 'WIFI' }));
    const r = mapPoints(rows);
    expect(r.points).toHaveLength(5000);
    expect(r.capped).toBe(true);
    expect(r.total).toBe(5100);
  });

  it('panel renders the map container and export buttons', async () => {
    const { default: PigletGeoPanel } = await import('../src/components/workbenches/piglet/PigletGeoPanel');
    const html = renderToString(<PigletGeoPanel rows={parsed.rows} name="a.csv" />);
    expect(html).toContain('data-testid="piglet-map"');
    expect(html).toContain('Export KML');
    expect(html).toContain('Export GeoJSON');
    expect(html).toContain('80 points on the map');
  });
});
