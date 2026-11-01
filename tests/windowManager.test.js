import { describe, it, expect } from 'vitest';
import {
  createInitialState, openWindow, closeWindow, closeAll, focusWindow, minimizeWindow, toggleMaximize, moveWindow, resizeWindow,
  tileWindows, cascadeWindows, topWindowId, focusedWindow, serializeState, deserializeState, windowKeyFor, clampToViewport,
  MIN_W, MIN_H, TITLE_BAR_H, KEEP_VISIBLE_PX
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

  it('a saved layout from a bigger screen is pulled back onto a smaller one', () => {
    const w = clampToViewport({ id: 'a', x: 3000, y: 2000, w: 1600, h: 1200 }, { width: 800, height: 600 });
    expect(w.w).toBe(800); expect(w.h).toBe(600);
    expect(w.x).toBe(800 - KEEP_VISIBLE_PX); expect(w.y).toBe(600 - TITLE_BAR_H);
  });
});
