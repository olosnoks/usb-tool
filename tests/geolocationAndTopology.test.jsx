import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import TopologyView, { getTopologySecurityColor } from '../src/components/workbenches/TopologyView';
import { calculateHaversineDistance } from '../src/utils/wardrivingExporter';

describe('Geolocation API Mock & Distance Calculation', () => {
  let originalGeolocation;

  beforeEach(() => {
    originalGeolocation = globalThis.navigator?.geolocation;
  });

  afterEach(() => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, 'geolocation', {
        value: originalGeolocation,
        configurable: true
      });
    }
  });

  it('mocks navigator.geolocation.watchPosition and calculates distance from user to AP', () => {
    let watchCallback = null;
    let watchErrorCallback = null;
    const mockWatchId = 42;

    const mockWatchPosition = vi.fn((success, error, options) => {
      watchCallback = success;
      watchErrorCallback = error;
      return mockWatchId;
    });

    const mockClearWatch = vi.fn();

    // Mock navigator.geolocation
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        watchPosition: mockWatchPosition,
        clearWatch: mockClearWatch
      },
      configurable: true
    });

    // Verify watchPosition call
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {},
      (err) => {}
    );
    expect(mockWatchPosition).toHaveBeenCalled();
    expect(watchId).toBe(42);

    // Simulate GPS fix from browser
    let userCoords = null;
    watchCallback({
      coords: {
        latitude: 37.774929,
        longitude: -122.419416,
        accuracy: 5.2,
        altitude: 12
      }
    });
    userCoords = {
      latitude: 37.774929,
      longitude: -122.419416
    };

    // AP located ~100 meters away (approx 0.0009 deg latitude difference)
    const apDevice = {
      bssid: '00:11:22:33:44:55',
      ssid: 'Test_AP',
      latitude: 37.775829,
      longitude: -122.419416
    };

    const dist = calculateHaversineDistance(
      userCoords.latitude,
      userCoords.longitude,
      apDevice.latitude,
      apDevice.longitude
    );

    expect(dist).toBeGreaterThan(90);
    expect(dist).toBeLessThan(110);

    // Clear watch
    navigator.geolocation.clearWatch(mockWatchId);
    expect(mockClearWatch).toHaveBeenCalledWith(42);
  });
});

describe('Network Topology View Component', () => {
  it('correctly maps security encryption to color indicators', () => {
    const wpa3 = getTopologySecurityColor('WPA3');
    expect(wpa3.fill).toBe('#10b981'); // Green
    expect(wpa3.text).toContain('Secure');

    const wpa2 = getTopologySecurityColor('WPA2');
    expect(wpa2.fill).toBe('#eab308'); // Yellow
    expect(wpa2.text).toContain('Standard');

    const openSec = getTopologySecurityColor('Open');
    expect(openSec.fill).toBe('#ef4444'); // Red
    expect(openSec.text).toContain('Open');
  });

  it('renders empty state when no nodes exist', () => {
    const html = renderToString(
      <TopologyView devices={{}} clients={{}} />
    );
    expect(html).toContain('No active nodes in topology');
  });

  it('renders interactive SVG graph for APs and connected client stations', () => {
    const devices = {
      '00:11:22:33:44:55': {
        bssid: '00:11:22:33:44:55',
        ssid: 'Corp_WiFi',
        security: 'WPA3',
        channel: 36
      }
    };

    const clients = {
      'AA:BB:CC:DD:EE:01': {
        clientMac: 'AA:BB:CC:DD:EE:01',
        bssid: '00:11:22:33:44:55'
      }
    };

    const html = renderToString(
      <TopologyView devices={devices} clients={clients} />
    );

    expect(html).toContain('Corp_WiFi');
    expect(html).toContain('WPA3');
    expect(html).toContain('EE:01');
    expect(html).toContain('<line'); // Connected line between client and AP
  });

  it('renders high density warning fallback when total nodes exceed 50', () => {
    const devices = {};
    for (let i = 0; i < 30; i++) {
      const bssid = `00:11:22:33:44:${String(i).padStart(2, '0')}`;
      devices[bssid] = { bssid, ssid: `AP_${i}`, security: 'WPA2', channel: 6 };
    }

    const clients = {};
    for (let j = 0; j < 25; j++) {
      const mac = `AA:BB:CC:DD:EE:${String(j).padStart(2, '0')}`;
      clients[mac] = { clientMac: mac, bssid: '00:11:22:33:44:00' };
    }

    // Total 55 nodes > 50
    const html = renderToString(
      <TopologyView devices={devices} clients={clients} />
    );

    expect(html).toContain('High Density Environment Detected');
    expect(html).toContain('55');
    expect(html).toContain('Access Points');
    expect(html).toContain('Stations');
    expect(html).toContain('Switch to Table View');
  });
});
