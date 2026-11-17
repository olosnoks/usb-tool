import { describe, it, expect } from 'vitest';
import { WIKI_ARTICLES, WIKI_CATEGORIES } from '../src/wiki/wikiArticles.js';
import { TOOL_TO_ARTICLE_MAP, resolveArticleForTool } from '../src/wiki/WikiApp.jsx';
import { SIDEBAR_SECTIONS } from '../src/components/layout/Sidebar.jsx';
import { searchTools } from '../src/utils/toolSearch.js';
import { KNOWN_TOOL_IDS, toolMeta } from '../src/components/ToolRegistry.jsx';

describe('Wiki Article Index & Tool Deep-Linking', () => {
  it('has valid categories and non-empty articles', () => {
    expect(WIKI_CATEGORIES.length).toBeGreaterThan(5);
    expect(WIKI_ARTICLES.length).toBeGreaterThan(25);

    for (const article of WIKI_ARTICLES) {
      expect(article.id).toBeDefined();
      expect(article.title).toBeDefined();
      expect(article.category).toBeDefined();
      expect(article.content).toBeDefined();
      expect(article.content.length).toBeGreaterThan(100);
      expect(article.tags).toBeInstanceOf(Array);
      expect(article.tags.length).toBeGreaterThan(0);
    }
  });

  it('maps every known tool and subtab to its dedicated wiki article', () => {
    const keyTools = [
      'terminal', 'flasher', 'hardware', 'setup',
      'packet-analyzer', 'hex', 'packets', 'kismet', 'bridge', 'plotter',
      'can-bus', 'bus-explorer', 'modbus-rtu', 'usbtmc', 'cyberchef',
      'alfa-wifi', 'wifi-scanner', 'flipper', 'proxmark', 'rfid-nfc',
      'mayhem', 'wardrive', 'ubx', 'warhog-piglet', 'warhog-sd', 'warhog-config',
      'wardrive-generator', 'ble', 'ducky', 'programmers', 'ch341a', 'cmsis-dap',
      'jtag-programmer', 'avr-isp', 'usb-pd', 'dfu', 'fastboot', 'adb',
      'micropython', 'improv', 'telemetry', 'alerts', 'automation', 'autopsy',
      'usb-descriptors', 'hid', 'mass-storage', 'ptp', 'fido2', 'session-log', 'esp-dump'
    ];

    for (const toolId of keyTools) {
      const article = resolveArticleForTool(toolId);
      expect(article, `Expected tool "${toolId}" to resolve to an article`).toBeDefined();
      expect(article.id, `Expected tool "${toolId}" to resolve to non-generic article`).not.toBe('workspace');
    }
  });

  it('specifically resolves CyberChef and BadUSB Studio to distinct wiki articles', () => {
    const chefArticle = resolveArticleForTool('cyberchef');
    const duckyArticle = resolveArticleForTool('ducky');

    expect(chefArticle.id).toBe('cyberchef-workbench');
    expect(chefArticle.title).toContain('CyberChef');

    expect(duckyArticle.id).toBe('ducky');
    expect(duckyArticle.title).toContain('BadUSB');
    expect(chefArticle.id).not.toBe(duckyArticle.id);
  });

  it('specifically resolves DFU, BLE, and Session Log to their dedicated articles', () => {
    const dfu = resolveArticleForTool('dfu');
    expect(dfu.id).toBe('dfu');
    expect(dfu.title).toContain('DFU');

    const ble = resolveArticleForTool('ble');
    expect(ble.id).toBe('ble');
    expect(ble.title).toContain('Bluetooth');

    const session = resolveArticleForTool('session-log');
    expect(session.id).toBe('session-log');
    expect(session.title).toContain('Session Log');
  });

  it('specifically resolves Warhog CYD & Piglet Suite and Demo Wardrive Generator', () => {
    const warhog = resolveArticleForTool('warhog-piglet');
    expect(warhog.id).toBe('piglet-suite');

    const generator = resolveArticleForTool('wardrive-generator');
    expect(generator.id).toBe('wardrive-generator');
    expect(generator.title).toContain('Wardrive');
  });

  it('resolves workspace, null, empty, or undefined targets to the workspace article', () => {
    const ws1 = resolveArticleForTool('workspace');
    expect(ws1.id).toBe('workspace');
    expect(ws1.title).toContain('Workspace');

    const wsNull = resolveArticleForTool(null);
    expect(wsNull.id).toBe('workspace');

    const wsEmpty = resolveArticleForTool('');
    expect(wsEmpty.id).toBe('workspace');

    const wsUndef = resolveArticleForTool(undefined);
    expect(wsUndef.id).toBe('workspace');
  });

  it('provides fallback meta for workspace and null tools in toolMeta', () => {
    const metaNull = toolMeta(null);
    expect(metaNull.title).toBe('Workspace');
    expect(metaNull.id).toBe('workspace');

    const metaWs = toolMeta('workspace');
    expect(metaWs.title).toBe('Workspace');
    expect(metaWs.id).toBe('workspace');
  });
});

describe('Sidebar & Search Filter Index', () => {
  it('every sidebar item has non-empty search keywords', () => {
    for (const section of SIDEBAR_SECTIONS) {
      for (const item of section.items) {
        expect(item.keywords, `Item "${item.id}" missing keywords`).toBeInstanceOf(Array);
        expect(item.keywords.length, `Item "${item.id}" has empty keywords`).toBeGreaterThan(0);
      }
    }
  });

  it('searches by keyword accurately matching expected tools', () => {
    const searchSidebar = (query) => {
      const matches = [];
      for (const section of SIDEBAR_SECTIONS) {
        for (const item of searchTools(section.items, query)) matches.push(item.id);
      }
      return matches;
    };

    expect(searchSidebar('kepler')).toContain('wardrive-generator');
    expect(searchSidebar('pau09')).toContain('alfa-wifi');
    expect(searchSidebar('swd')).toContain('programmers');
    expect(searchSidebar('stm32')).toContain('dfu');
    expect(searchSidebar('gatt')).toContain('ble');
    expect(searchSidebar('ducky')).toContain('ducky');
    expect(searchSidebar('cyberchef')).toContain('cyberchef');
    expect(searchSidebar('piglet')).toContain('warhog-piglet');
    expect(searchSidebar('yubikey')).toContain('fido2');
    expect(searchSidebar('scpi')).toContain('usbtmc');
    expect(searchSidebar('scsi')).toContain('mass-storage');
  });
});
