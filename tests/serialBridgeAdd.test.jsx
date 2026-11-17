import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SerialProvider } from '../src/context/SerialContext';
import SerialBridgeDeck from '../src/components/SerialBridgeDeck';

const mk = (id, name, isConnected = true) => ({ id, name, baudRate: 115200, isConnected });
const startBtn = (html) => html.match(/<button[^>]*>(?:(?!<\/button>).)*START MitM BRIDGE.*?<\/button>/s)[0];

describe('SerialBridgeDeck port management', () => {
  it('offers an add-port control and guidance with one board', () => {
    const html = renderToString(<SerialProvider><SerialBridgeDeck boards={[mk('a', 'A')]} /></SerialProvider>);
    expect(html).toContain('+ Add serial port');
    expect(html).toContain('Only one port is available');
    expect(startBtn(html)).toContain('disabled');
  });

  it('enables the start button with two boards and shows their state', () => {
    const html = renderToString(<SerialProvider><SerialBridgeDeck boards={[mk('a', 'A'), mk('b', 'B')]} /></SerialProvider>);
    expect(html).toContain('+ Add serial port');
    expect(html).toContain('connected');
    expect(startBtn(html)).not.toContain('disabled');
  });
});
