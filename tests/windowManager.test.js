import { describe, it, expect } from 'vitest';
import {
  createInitialState, openWindow, closeWindow, closeAll, focusWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow,
  tileWindows, cascadeWindows, topWindowId, focusedWindow, serializeState, deserializeState, windowKeyFor, clampToViewport,
  MIN_W, MIN_H, TITLE_BAR_H, KEEP_VISIBLE_PX, setZoom, zoomStep, toggleFit, fitZoomFor, ZOOM_MIN, ZOOM_MAX, ZOOM_STEPS,
  duplicateWindow, baseIdOf, instanceOf, instanceCount, displayTitle
} from '../src/utils/windowManager';

const VP = { width: 1400, height: 900 };
const open = (s, id) => openWindow(s, id, { title: id.toUpperCase(), accent: 'cyan' }, VP);

describe('workspace window manager', () => {
  it('opens several tools, each in its own window, cascaded inside the desktop', () => {
    let s = createInitialState();
    s = open(s, 'mayhem'); s = open(s, 'terminal'); s = open(s, 'flipper');
    expect(s.windows.map((w) => w.id)).toEqual(['mayhem', 'terminal', 'flipper']);
    expect(s.focusedId).toBe('flipper');
    expect(topWindowId(s)).toBe('flipper');
    // cascade: each later window sits down-right of the previous and stays on the desktop
    for (let i = 1; i < s.windows.length; i++) {
      expect(s.windows[i].x).toBeGreaterThan(s.windows[i - 1].x);
      expect(s.windows[i].y).toBeGreaterThan(s.windows[i - 1].y);
    }
    for (const w of s.windows) {
      expect(w.x + w.w).toBeLessThanOrEqual(VP.width + (w.w - KEEP_VISIBLE_PX));
      expect(w.y).toBeLessThanOrEqual(VP.height - TITLE_BAR_H);
      expect(w.title).toBe(w.id.toUpperCase());
    }
  });

  it('opens multiple instances of the same tool, each in its own window', () => {
    let s = createInitialState();
    const meta = { title: 'PortaPack Mayhem SDR', accent: 'purple' };
    s = openWindow(s, 'mayhem', meta, VP);
    expect(s.windows[0].id).toBe('mayhem');
    expect(s.windows[0].instance).toBe(1);
    // forceNew opens a second instance with a distinct id
    s = openWindow(s, 'mayhem', meta, VP, { forceNew: true });
    s = openWindow(s, 'mayhem', meta, VP, { forceNew: true });
    expect(s.windows.map((w) => w.id)).toEqual(['mayhem', 'mayhem#2', 'mayhem#3']);
    expect(s.windows.map((w) => w.instance)).toEqual([1, 2, 3]);
    expect(s.focusedId).toBe('mayhem#3');
    expect(instanceCount(s, 'mayhem')).toBe(3);
    // each window carries the real tool id so renderTool mounts a fresh component
    expect(s.windows.every((w) => w.toolId === 'mayhem')).toBe(true);
    // display title numbers the extra instances
    expect(displayTitle(s.windows[0])).toBe('PortaPack Mayhem SDR');
    expect(displayTitle(s.windows[2])).toBe('PortaPack Mayhem SDR (3)');
    // id helpers
    expect(baseIdOf('mayhem#3')).toBe('mayhem');
    expect(instanceOf('mayhem#3')).toBe(3);
    expect(baseIdOf('mayhem')).toBe('mayhem');
    expect(instanceOf('mayhem')).toBe(1);
  });

  it('duplicateWindow clones a window\'s tool into a new instance, and ids are reused as gaps close', () => {
    let s = createInitialState();
    s = open(s, 'terminal');
    s = duplicateWindow(s, 'terminal', VP);
    expect(s.windows.map((w) => w.id)).toEqual(['terminal', 'terminal#2']);
    expect(s.focusedId).toBe('terminal#2');
    // close the first instance; the second stays, still numbered 2
    s = closeWindow(s, 'terminal');
    expect(s.windows.map((w) => w.id)).toEqual(['terminal#2']);
    expect(displayTitle(s.windows[0])).toBe('TERMINAL (2)');
    // opening again (no forceNew) focuses the surviving instance rather than making a new one
    s = open(s, 'terminal');
    expect(s.windows.length).toBe(1);
    expect(s.focusedId).toBe('terminal#2');
    // a fresh forceNew picks the next free number above the max in use
    s = duplicateWindow(s, 'terminal#2', VP);
    expect(s.windows.map((w) => w.id)).toEqual(['terminal#2', 'terminal#3']);
  });

  it('round-trips instances through storage', () => {
    let s = createInitialState();
    s = open(s, 'mayhem');
    s = duplicateWindow(s, 'mayhem', VP);
    const back = deserializeState(serializeState(s), VP);
    expect(back.windows.map((w) => w.id)).toEqual(['mayhem', 'mayhem#2']);
    expect(back.windows.map((w) => w.instance)).toEqual([1, 2]);
    expect(back.windows[1].baseId).toBe('mayhem');
    // a legacy saved window without instance fields still loads
    const legacy = deserializeState('{"v":1,"windows":[{"id":"flipper#2","toolId":"flipper"}]}', VP);
    expect(legacy.windows[0].baseId).toBe('flipper');
    expect(legacy.windows[0].instance).toBe(2);
  });

  it('re-opening a tool (or one of its workbench tabs) focuses the existing window instead of duplicating it', () => {
    let s = createInitialState();
    s = open(s, 'packet-analyzer'); s = open(s, 'terminal');
    expect(s.focusedId).toBe('terminal');
    s = open(s, 'hex');                       // a tab of the Packet & Protocol Lab
    expect(s.windows.length).toBe(2);
    expect(s.focusedId).toBe('packet-analyzer');
    expect(windowKeyFor('cmsis-dap')).toBe('programmers');
    expect(windowKeyFor('mayhem')).toBe('mayhem');
    s = open(s, 'mayhem'); s = open(s, 'mayhem');
    expect(s.windows.length).toBe(3);
  });

  it('focus raises the window and restores it when minimized', () => {
    let s = createInitialState();
    s = open(s, 'a'); s = open(s, 'b');
    const zb = s.windows.find((w) => w.id === 'b').z;
    s = focusWindow(s, 'a');
    expect(s.windows.find((w) => w.id === 'a').z).toBeGreaterThan(zb);
    s = minimizeWindow(s, 'a');
    expect(s.windows.find((w) => w.id === 'a').minimized).toBe(true);
    expect(s.focusedId).toBe('b');            // focus falls to the top remaining window
    s = focusWindow(s, 'a');
    expect(s.windows.find((w) => w.id === 'a').minimized).toBe(false);
    expect(s.focusedId).toBe('a');
    s = minimizeWindow(s, 'a'); s = minimizeWindow(s, 'b');
    expect(topWindowId(s)).toBe(null);
    expect(focusedWindow(s)).toBe(null);
  });

  it('moving keeps the title bar reachable; resizing honours the minimum size', () => {
    let s = open(createInitialState(), 'a');
    s = moveWindow(s, 'a', -5000, -5000, VP);
    let w = s.windows[0];
    expect(w.x).toBe(-(w.w - KEEP_VISIBLE_PX));
    expect(w.y).toBe(0);
    s = moveWindow(s, 'a', 5000, 5000, VP);
    w = s.windows[0];
    expect(w.x).toBe(VP.width - KEEP_VISIBLE_PX);
    expect(w.y).toBe(VP.height - TITLE_BAR_H);
    s = resizeWindow(s, 'a', { x: 10, y: 10, w: 50, h: 20 }, VP);
    w = s.windows[0];
    expect(w.w).toBe(MIN_W); expect(w.h).toBe(MIN_H);
    s = resizeWindow(s, 'a', { x: 10, y: 10, w: 9000, h: 9000 }, VP);
    w = s.windows[0];
    expect(w.w).toBe(VP.width); expect(w.h).toBe(VP.height);
  });

  it('maximize remembers the old geometry and restore brings it back; moves are ignored while maximized', () => {
    let s = open(createInitialState(), 'a');
    const before = { ...s.windows[0] };
    s = toggleMaximize(s, 'a', VP);
    expect(s.windows[0].maximized).toBe(true);
    expect(s.windows[0].restore).toEqual({ x: before.x, y: before.y, w: before.w, h: before.h });
    s = moveWindow(s, 'a', 300, 300, VP);
    expect(s.windows[0].x).toBe(before.x);
    s = toggleMaximize(s, 'a', VP);
    expect(s.windows[0].maximized).toBe(false);
    expect(s.windows[0].x).toBe(before.x); expect(s.windows[0].w).toBe(before.w);
  });

  it('closing hands focus to the next window; close-all empties the desktop', () => {
    let s = createInitialState();
    s = open(s, 'a'); s = open(s, 'b'); s = open(s, 'c');
    s = closeWindow(s, 'c');
    expect(s.windows.map((w) => w.id)).toEqual(['a', 'b']);
    expect(s.focusedId).toBe('b');
    s = closeWindow(s, 'nope');
    expect(s.windows.length).toBe(2);
    s = closeAll(s);
    expect(s.windows).toEqual([]); expect(s.focusedId).toBe(null);
  });

  it('tiles the open windows into a non-overlapping grid that fits the desktop', () => {
    let s = createInitialState();
    for (const id of ['a', 'b', 'c', 'd', 'e']) s = open(s, id);
    s = minimizeWindow(s, 'e');
    s = tileWindows(s, VP);
    const tiled = s.windows.filter((w) => !w.minimized);
    expect(tiled.length).toBe(4);
    for (const w of tiled) {
      expect(w.x).toBeGreaterThanOrEqual(0); expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(VP.width); expect(w.y + w.h).toBeLessThanOrEqual(VP.height);
      expect(w.maximized).toBe(false);
    }
    for (let i = 0; i < tiled.length; i++) for (let j = i + 1; j < tiled.length; j++) {
      const a = tiled[i], b = tiled[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
    // the minimized one is left alone
    expect(s.windows.find((w) => w.id === 'e').minimized).toBe(true);
    s = cascadeWindows(s, VP);
    const cas = s.windows.filter((w) => !w.minimized).sort((a, b) => a.z - b.z);
    for (let i = 1; i < cas.length; i++) expect(cas[i].x).toBeGreaterThan(cas[i - 1].x);
  });

  it('survives a round trip through storage and rejects garbage', () => {
    let s = createInitialState();
    s = open(s, 'mayhem'); s = open(s, 'terminal');
    s = toggleMaximize(s, 'terminal', VP); s = minimizeWindow(s, 'mayhem');
    const back = deserializeState(serializeState(s), VP);
    expect(back.windows.map((w) => w.id)).toEqual(['mayhem', 'terminal']);
    expect(back.windows[0].minimized).toBe(true);
    expect(back.windows[1].maximized).toBe(true);
    expect(back.windows[1].restore).toEqual(s.windows[1].restore);
    expect(back.focusedId).toBe('terminal');
    expect(back.nextZ).toBeGreaterThan(Math.max(...back.windows.map((w) => w.z)));
    expect(deserializeState('not json', VP)).toBe(null);
    expect(deserializeState('{"v":2}', VP)).toBe(null);
    expect(deserializeState('{"v":1,"windows":[{"id":5}]}', VP).windows).toEqual([]);
  });

  it("zooms a window's content in preset steps, clamped, and fit-to-width scales the natural width into the body", () => {
    let s = open(createInitialState(), 'a');
    expect(s.windows[0].zoom).toBe(1); expect(s.windows[0].fit).toBe(false);
    s = zoomStep(s, 'a', -1);
    expect(s.windows[0].zoom).toBe(0.9);
    s = zoomStep(s, 'a', -1); s = zoomStep(s, 'a', -1);
    expect(s.windows[0].zoom).toBe(0.7);
    s = zoomStep(s, 'a', 1);
    expect(s.windows[0].zoom).toBe(0.8);
    for (let i = 0; i < 20; i++) s = zoomStep(s, 'a', 1);
    expect(s.windows[0].zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 20; i++) s = zoomStep(s, 'a', -1);
    expect(s.windows[0].zoom).toBe(ZOOM_MIN);
    s = setZoom(s, 'a', 3); expect(s.windows[0].zoom).toBe(ZOOM_MAX);
    s = setZoom(s, 'a', 0.853); expect(s.windows[0].zoom).toBe(0.85);
    // stepping from the live (fitted) zoom lands on the neighbouring preset
    s = zoomStep(s, 'a', 1, 0.82); expect(s.windows[0].zoom).toBe(0.9);
    s = toggleFit(s, 'a'); expect(s.windows[0].fit).toBe(true);
    s = setZoom(s, 'a', 1); expect(s.windows[0].fit).toBe(false);   // manual zoom leaves fit mode
    expect(ZOOM_STEPS).toContain(1);
    expect(fitZoomFor(1180, 1180)).toBe(1);
    expect(fitZoomFor(590, 1180)).toBe(0.5);
    expect(fitZoomFor(300, 1180)).toBe(ZOOM_MIN);   // never below the minimum
    expect(fitZoomFor(2000, 1180)).toBe(1);         // fit never enlarges
    expect(fitZoomFor(0, 1180)).toBe(1);
    // zoom and fit survive storage
    s = toggleFit(setZoom(s, 'a', 0.7), 'a');
    const back = deserializeState(serializeState(s), VP);
    expect(back.windows[0].zoom).toBe(0.7); expect(back.windows[0].fit).toBe(true);
    expect(deserializeState('{"v":1,"windows":[{"id":"x","toolId":"x","zoom":9}]}', VP).windows[0].zoom).toBe(ZOOM_MAX);
  });

  it('a saved layout from a bigger screen is pulled back onto a smaller one', () => {
    const w = clampToViewport({ id: 'a', x: 3000, y: 2000, w: 1600, h: 1200 }, { width: 800, height: 600 });
    expect(w.w).toBe(800); expect(w.h).toBe(600);
    expect(w.x).toBe(800 - KEEP_VISIBLE_PX); expect(w.y).toBe(600 - TITLE_BAR_H);
  });
});
