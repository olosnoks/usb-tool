import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import ChannelOverlapChart from '../src/components/workbenches/ChannelOverlapChart';

describe('ChannelOverlapChart (2.4GHz Physical Channel Overlap Visualizer)', () => {
  const mockChannelStats = {
    1: 1200,
    2: 450,
    6: 2500,
    11: 300
  };

  const mockDevices = {
    '00:11:22:33:44:01': { bssid: '00:11:22:33:44:01', ssid: 'Corp_1', channel: 1, rssi: -50 },
    '00:11:22:33:44:02': { bssid: '00:11:22:33:44:02', ssid: 'Corp_2', channel: 6, rssi: -45 },
    '00:11:22:33:44:03': { bssid: '00:11:22:33:44:03', ssid: 'Corp_3', channel: 6, rssi: -60 },
    '00:11:22:33:44:04': { bssid: '00:11:22:33:44:04', ssid: 'Bad_Neighbor', channel: 2, rssi: -70 }
  };

  const mockClients = {
    'AA:BB:CC:DD:EE:01': { clientMac: 'AA:BB:CC:DD:EE:01', channel: 1 },
    'AA:BB:CC:DD:EE:02': { clientMac: 'AA:BB:CC:DD:EE:02', channel: 6 }
  };

  it('renders without throwing and contains header and key text', () => {
    const rawHtml = renderToString(
      <ChannelOverlapChart
        channelStats={mockChannelStats}
        devices={mockDevices}
        clients={mockClients}
        currentChannel={6}
      />
    );
    const html = rawHtml.replace(/<!--.*?-->/g, '');

    expect(html).toContain('2.4GHz Physical Channel Overlap');
    expect(html).toContain('Cleanest Primary Channel');
    expect(html).toContain('Channel 11'); // 11 is cleanest with 0 APs
    expect(html).toContain('Primary Channels (1, 6, 11)');
    expect(html).toContain('2412 MHz');
    expect(html).toContain('2437 MHz');
    expect(html).toContain('2462 MHz');
    expect(html).toContain('Non-Overlapping');
    expect(html).toContain('Interfering');
  });

  it('renders correctly with empty data', () => {
    const rawHtml = renderToString(
      <ChannelOverlapChart
        channelStats={{}}
        devices={{}}
        clients={{}}
        currentChannel={1}
      />
    );
    const html = rawHtml.replace(/<!--.*?-->/g, '');

    expect(html).toContain('2.4GHz Physical Channel Overlap');
    expect(html).toContain('<svg');
    expect(html).toContain('0 APs');
  });

  it('renders SVG bell curve paths with channels 1, 6, 11', () => {
    const rawHtml = renderToString(
      <ChannelOverlapChart
        channelStats={mockChannelStats}
        devices={mockDevices}
        clients={mockClients}
        currentChannel={1}
      />
    );
    const html = rawHtml.replace(/<!--.*?-->/g, '');

    expect(html).toContain('CH 1');
    expect(html).toContain('CH 6');
    expect(html).toContain('CH 11');
    expect(html).toContain('<path');
  });
});
