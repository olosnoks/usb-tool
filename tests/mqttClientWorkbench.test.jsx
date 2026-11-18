import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import MqttClientWorkbench from '../src/components/tools/MqttClientWorkbench.jsx';

// Server render of the idle (not connected) tool: proves the module loads without a browser
// WebSocket or localStorage, and that the idle state describes only what exists.
describe('MqttClientWorkbench', () => {
  it('renders the disconnected state without a browser', () => {
    const html = renderToString(<MqttClientWorkbench />);
    expect(html).toContain('MQTT Client');
    expect(html).toContain('DISCONNECTED');
    expect(html).toContain('wss://broker.hivemq.com:8884/mqtt');
    expect(html).toContain('No messages yet');
    expect(html).toContain('Remember password in this browser');
    expect(html).not.toContain('Connected to');
  });
});
