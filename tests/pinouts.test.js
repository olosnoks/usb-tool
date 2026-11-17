import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PINOUT_BOARDS, getBoard, searchPins } from '../src/data/pinouts.js';
import { KNOWN_TOOL_IDS } from '../src/components/ToolRegistry.jsx';
import { SIDEBAR_SECTIONS } from '../src/components/layout/Sidebar.jsx';
import PinoutModal from '../src/components/PinoutModal.jsx';
import { UDEV_RULES_TEXT, UDEV_SETUP_COMMAND, UDEV_VENDORS, buildUdevRules } from '../src/data/udevRules.js';

const SIDEBAR_IDS = new Set(SIDEBAR_SECTIONS.flatMap((s) => s.items || []).map((i) => i.id));
const VALID_TOOL_IDS = new Set([...KNOWN_TOOL_IDS, ...SIDEBAR_IDS]);

describe('pinout data (DAT-8)', () => {
  it('has the required boards', () => {
    const ids = PINOUT_BOARDS.map((b) => b.id);
    for (const id of ['esp32', 'esp32-s3', 'esp32-c3', 'esp8266', 'esp32-cam', 'rp2040', 'arduino-avr', 'bluepill', 'swd10', 'jtag20', 'soic8', 'usb-c', 'ftdi', 'shifter']) {
      expect(ids, id).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate pin numbers per board and every pin belongs to a declared group', () => {
    for (const b of PINOUT_BOARDS) {
      const pins = b.pins.map((p) => p.pin);
      expect(new Set(pins).size, `${b.id} duplicate pins: ${pins.filter((p, i) => pins.indexOf(p) !== i)}`).toBe(pins.length);
      const groups = new Set(b.groups.map((g) => g.id));
      for (const p of b.pins) {
        expect(groups.has(p.group), `${b.id}:${p.pin} group ${p.group}`).toBe(true);
        expect(p.name && p.fn, `${b.id}:${p.pin} needs name and fn`).toBeTruthy();
      }
    }
  });

  it('every referenced tool id exists', () => {
    for (const b of PINOUT_BOARDS) {
      for (const t of b.tools) {
        expect(VALID_TOOL_IDS.has(t.id), `${b.id} references unknown tool "${t.id}"`).toBe(true);
        expect(t.label).toBeTruthy();
      }
    }
  });

  it('well-known facts are right', () => {
    const pin = (b, p) => getBoard(b).pins.find((x) => x.pin === p);
    expect(pin('rp2040', '1').name).toBe('GP0');
    expect(pin('rp2040', '40').name).toBe('VBUS');
    expect(getBoard('rp2040').pins).toHaveLength(40);
    expect(getBoard('swd10').pins).toHaveLength(10);
    expect(getBoard('jtag20').pins).toHaveLength(20);
    expect(pin('soic8', '1').name).toBe('/CS');
    expect(pin('soic8', '8').name).toBe('VCC');
    expect(pin('esp32-s3', 'GPIO19').name).toBe('USB D-');
    expect(pin('esp32-s3', 'GPIO20').name).toBe('USB D+');
    expect(pin('esp32-c3', 'GPIO18').name).toBe('USB D-');
    expect(pin('bluepill', 'PA13').name).toBe('SWDIO');
    expect(pin('esp32', 'GPIO1').name).toBe('U0TXD');
    expect(pin('esp32', 'GPIO3').name).toBe('U0RXD');
  });

  it('searches by GPIO number, name and function', () => {
    const boardsFor = (q) => new Set(searchPins(q).map((r) => r.board.id));
    expect(boardsFor('21').has('esp32')).toBe(true);
    expect(boardsFor('SDA').has('arduino-avr')).toBe(true);
    expect(boardsFor('MOSI').has('rp2040')).toBe(true);
    expect(boardsFor('swdio').has('bluepill')).toBe(true);
    expect(searchPins('')).toEqual([]);
    expect(searchPins('zzzzzz')).toEqual([]);
  });

  it('renders every board from data (name, pins, warnings)', () => {
    for (const b of PINOUT_BOARDS) {
      const html = renderToString(React.createElement(PinoutModal, { isOpen: true, onClose() {}, initialBoard: b.id }));
      expect(html, b.id).toContain('role="dialog"');
      expect(html, b.id).toContain('aria-modal="true"');
      expect(html, b.id).toContain(b.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
      for (const p of b.pins.slice(0, 3)) expect(html, `${b.id}:${p.pin}`).toContain(`>${p.pin}<`);
    }
  });

  it('renders nothing when closed and handles Esc / focus return in source', () => {
    expect(renderToString(React.createElement(PinoutModal, { isOpen: false, onClose() {} }))).toBe('');
    const src = readFileSync(new URL('../src/components/PinoutModal.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/key === 'Escape'/);
    expect(src).toMatch(/opener\.focus\(\)/);
    expect(src).toMatch(/document\.activeElement/);
  });
});

describe('udev rules (DAT-8)', () => {
  it('never contains a wildcard vendor or a 0666 mode', () => {
    for (const text of [UDEV_RULES_TEXT, UDEV_SETUP_COMMAND]) {
      expect(text).not.toMatch(/idVendor\}?=="\*"/);
      expect(text).not.toMatch(/0666/);
    }
  });

  it('has one per-vendor rule with uaccess, group and 0660', () => {
    const rules = UDEV_RULES_TEXT.split('\n').filter((l) => l.startsWith('SUBSYSTEM'));
    expect(rules).toHaveLength(UDEV_VENDORS.length);
    for (const r of rules) {
      expect(r).toMatch(/ATTRS\{idVendor\}=="[0-9a-f]{4}"/);
      expect(r).toContain('TAG+="uaccess"');
      expect(r).toContain('GROUP="dialout"');
      expect(r).toContain('MODE="0660"');
    }
    expect(buildUdevRules(UDEV_VENDORS, 'uucp')).toContain('GROUP="uucp"');
  });

  it('the setup tab displays and copies the same string', () => {
    const src = readFileSync(new URL('../src/components/tabs/HelpTroubleshootingTab.jsx', import.meta.url), 'utf8');
    expect(src.match(/\{UDEV_SETUP_COMMAND\}/g)).toHaveLength(1);        // displayed
    expect(src).toMatch(/copyToClipboard\(UDEV_SETUP_COMMAND,/);          // copied
    expect(src).not.toMatch(/idVendor\}?=="\*"/);
    expect(src).not.toMatch(/0666/);
    expect(src).toMatch(/aria-expanded=\{openSections\.linux\}/);
  });

  it('the wiki setup article carries the same rule text', async () => {
    const { REFERENCE_ARTICLES } = await import('../src/wiki/articles/referenceArticles.js');
    const setup = REFERENCE_ARTICLES.find((a) => a.id === 'setup');
    expect(setup.content).toContain(UDEV_RULES_TEXT);
    expect(setup.content).toContain(UDEV_SETUP_COMMAND);
  });
});
