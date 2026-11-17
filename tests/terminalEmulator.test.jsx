import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import TerminalEmulator from '../src/components/TerminalEmulator';
import { MiniTerm, keyToBytes, pasteBytes, enterBytes, backspaceBytes } from '../src/utils/miniTerm';

const enc = new TextEncoder();
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join(' ');
const key = (k, extra = {}) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra });

describe('keystroke passthrough mapping', () => {
  it('maps arrows, Tab, Ctrl-C/D, Esc, Delete', () => {
    expect(hex(keyToBytes(key('ArrowUp')))).toBe('1b 5b 41');
    expect(hex(keyToBytes(key('ArrowLeft')))).toBe('1b 5b 44');
    expect(hex(keyToBytes(key('Tab')))).toBe('09');
    expect(hex(keyToBytes(key('c', { ctrlKey: true })))).toBe('03');
    expect(hex(keyToBytes(key('d', { ctrlKey: true })))).toBe('04');
    expect(hex(keyToBytes(key('Escape')))).toBe('1b');
    expect(hex(keyToBytes(key('Delete')))).toBe('1b 5b 33 7e');
  });
  it('Ctrl-C copies when text is selected; Ctrl-V is left to the paste event', () => {
    expect(keyToBytes(key('c', { ctrlKey: true }), { hasSelection: true })).toBeNull();
    expect(keyToBytes(key('v', { ctrlKey: true }))).toBeNull();
    expect(keyToBytes(key('Shift'))).toBeNull();
  });
  it('maps Enter and Backspace per settings', () => {
    expect(hex(keyToBytes(key('Enter'), { enter: 'cr' }))).toBe('0d');
    expect(hex(keyToBytes(key('Enter'), { enter: 'crlf' }))).toBe('0d 0a');
    expect(hex(keyToBytes(key('Enter'), { enter: 'lf' }))).toBe('0a');
    expect(hex(keyToBytes(key('Backspace'), { backspace: 'del' }))).toBe('7f');
    expect(hex(keyToBytes(key('Backspace'), { backspace: 'bs' }))).toBe('08');
    expect(enterBytes()).toBe('\r');
    expect(backspaceBytes('bs')).toBe('\b');
  });
  it('encodes printable and unicode text as UTF-8, Alt as ESC prefix', () => {
    expect(hex(keyToBytes(key('a')))).toBe('61');
    expect(hex(keyToBytes(key('é')))).toBe('c3 a9');
    expect(hex(keyToBytes(key('b', { altKey: true })))).toBe('1b 62');
  });
  it('brackets pastes when enabled and maps newlines', () => {
    expect(new TextDecoder().decode(pasteBytes('a\nb', { bracketed: true, enter: 'cr' }))).toBe('\x1b[200~a\rb\x1b[201~');
    expect(new TextDecoder().decode(pasteBytes('x\r\ny', { enter: 'crlf' }))).toBe('x\r\ny');
  });
});

describe('MiniTerm screen', () => {
  it('renders text, CRLF, backspace overwrite, and UTF-8 split across writes', () => {
    const t = new MiniTerm({ cols: 20, rows: 5 });
    const e = enc.encode('\u{1F600}');
    t.write(enc.encode('ab\r\ncd\b'));
    t.write(enc.encode('X'));
    t.write(e.subarray(0, 2));
    t.write(e.subarray(2));
    expect(t.toText()).toBe('ab\ncX\u{1F600}');
  });
  it('handles cursor addressing, clear screen and erase line', () => {
    const t = new MiniTerm({ cols: 20, rows: 5 });
    t.writeText('hello\x1b[2J\x1b[2;3Hhi\x1b[1;1Hz\x1b[K');
    expect(t.toText()).toBe('z\n  hi');
  });
  it('supports a prompt redraw (CR + erase) like a shell history recall', () => {
    const t = new MiniTerm({ cols: 30, rows: 5 });
    t.writeText('>>> old command');
    t.writeText('\r\x1b[K>>> new');
    expect(t.toText()).toBe('>>> new');
  });
  it('alternate screen restores the main screen (vi/top)', () => {
    const t = new MiniTerm({ cols: 20, rows: 5 });
    t.writeText('shell$ ');
    t.writeText('\x1b[?1049h\x1b[Hvi screen');
    expect(t.toText()).toBe('vi screen');
    t.writeText('\x1b[?1049l');
    expect(t.toText()).toBe('shell$');
  });
  it('keeps scrollback up to the limit and tracks bracketed-paste mode', () => {
    const t = new MiniTerm({ cols: 10, rows: 3, scrollback: 50 });
    for (let i = 0; i < 200; i++) t.writeText(`l${i}\r\n`);
    expect(t.lines.length).toBeLessThanOrEqual(53);
    t.writeText('\x1b[?2004h');
    expect(t.bracketedPaste).toBe(true);
  });
  it('colours via SGR', () => {
    const t = new MiniTerm({ cols: 20, rows: 3 });
    t.writeText('\x1b[31mred\x1b[0m ok');
    const runs = t.snapshot()[0];
    expect(runs[0]).toMatchObject({ text: 'red', className: 'text-rose-400' });
    expect(runs[1].className).toBe('');
  });
});

describe('TerminalEmulator component', () => {
  it('renders the controls and the capture hint', () => {
    const html = renderToString(<TerminalEmulator subscribeRx={() => () => {}} boardId="b1" sendRawBytes={() => {}} isConnected={true} />);
    expect(html).toContain('INTERACTIVE TERMINAL');
    expect(html).toContain('Click the screen to capture the keyboard');
    expect(html).toContain('Backspace');
  });
  it('tells the user to connect when no port is open', () => {
    const html = renderToString(<TerminalEmulator isConnected={false} />);
    expect(html).toContain('Connect a port to type into the device');
  });
});
