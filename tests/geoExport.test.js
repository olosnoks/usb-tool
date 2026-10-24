import { describe, it, expect } from 'vitest';
import { generateGeoJSON, generateKML } from '../src/utils/reportGenerator.js';

describe('Geographic Spatial Exporters (GeoJSON & KML)', () => {
  const mockDevices = [
    {
      bssid: '00:11:22:33:44:55',
      ssid: 'Corp-HQ-Secure',
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: 15.5,
      rssi: -58,
      vendor: 'Cisco Systems',
      channel: 36,
      security: 'WPA3'
    },
    {
      bssid: 'AA:BB:CC:DD:EE:FF',
      ssid: 'Guest-WiFi',
      latitude: '37.7752',
      longitude: '-122.4180',
      altitude: 10,
      rssi: -72,
      vendor: 'Ubiquiti Inc.',
      channel: 6,
      security: 'Open'
    },
    {
      // Device without valid coordinates
      bssid: '11:22:33:44:55:66',
      ssid: 'No-GPS-AP',
      latitude: null,
      longitude: null,
      rssi: -80
    },
    {
      // Device with (0,0) null island coordinates
      bssid: '22:33:44:55:66:77',
      ssid: 'Null-Island-AP',
      latitude: 0,
      longitude: 0,
      rssi: -85
    }
  ];

  describe('generateGeoJSON', () => {
    it('returns a standard FeatureCollection schema', () => {
      const geojson = generateGeoJSON(mockDevices);

      expect(geojson).toBeDefined();
      expect(geojson.type).toBe('FeatureCollection');
      expect(Array.isArray(geojson.features)).toBe(true);
      // Only 2 devices have valid non-zero GPS coordinates
      expect(geojson.features.length).toBe(2);
    });

    it('formats features as standard GeoJSON Points with [longitude, latitude, altitude]', () => {
      const geojson = generateGeoJSON(mockDevices);
      const feature = geojson.features[0];

      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('Point');
      // Lon, Lat, Alt
      expect(feature.geometry.coordinates).toEqual([-122.4194, 37.7749, 15.5]);

      // Check properties
      expect(feature.properties.SSID).toBe('Corp-HQ-Secure');
      expect(feature.properties.BSSID).toBe('00:11:22:33:44:55');
      expect(feature.properties.RSSI).toBe(-58);
      expect(feature.properties.Vendor).toBe('Cisco Systems');
    });

    it('handles empty or null device inputs gracefully', () => {
      expect(generateGeoJSON(null)).toEqual({ type: 'FeatureCollection', features: [] });
      expect(generateGeoJSON({})).toEqual({ type: 'FeatureCollection', features: [] });
      expect(generateGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
    });
  });

  describe('generateKML', () => {
    it('produces valid KML XML with Placemark nodes and coordinate strings', () => {
      const kml = generateKML(mockDevices);

      expect(typeof kml).toBe('string');
      expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
      expect(kml).toContain('<Document>');
      expect(kml).toContain('<Placemark>');
      expect(kml).toContain('<name>Corp-HQ-Secure (00:11:22:33:44:55)</name>');
      expect(kml).toContain('<coordinates>-122.4194,37.7749,15.5</coordinates>');
      expect(kml).toContain('<coordinates>-122.418,37.7752,10</coordinates>');
      expect(kml).not.toContain('No-GPS-AP');
      expect(kml).not.toContain('Null-Island-AP');
      expect(kml).toContain('</Document>');
      expect(kml).toContain('</kml>');
    });

    it('escapes special XML characters in SSIDs and Vendors', () => {
      const xssDevices = [
        {
          bssid: '33:44:55:66:77:88',
          ssid: 'Test & <Special> Network',
          latitude: 40.7128,
          longitude: -74.006,
          vendor: 'AT&T / Netgear <Inc>'
        }
      ];

      const kml = generateKML(xssDevices);
      expect(kml).toContain('Test &amp; &lt;Special&gt; Network');
      expect(kml).toContain('AT&amp;T / Netgear &lt;Inc&gt;');
    });

    it('handles empty input gracefully', () => {
      const kml = generateKML([]);
      expect(kml).toContain('<Document>');
      expect(kml).not.toContain('<Placemark>');
    });
  });
});
