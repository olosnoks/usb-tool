// Window-manager state for the workspace: every tool opens in its own
// draggable, resizable window so several tools can run side by side, each
// talking to a different device. Pure functions over a plain state object so
// the layout logic is testable without a DOM; the React side (Desktop.jsx,
// ToolWindow.jsx) only renders this state and feeds pointer events back in.

export const TITLE_BAR_H = 34;        // px, must match ToolWindow's title bar
export const MIN_W = 420;
export const MIN_H = 240;
export const DEFAULT_W = 1040;
export const DEFAULT_H = 680;
export const CASCADE_STEP = 32;
export const KEEP_VISIBLE_PX = 140;   // how much of the title bar must stay on screen
export const STORAGE_KEY = 'skon-workspace-windows-v1';
// Per-window content zoom (CSS zoom on the tool, the browser viewport is untouched).
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

/**
 * Tool ids that are tabs of one workbench share a window. Opening 'hex' when
 * the Packet & Protocol Lab is already open focuses that window instead of
 * opening a second lab.
 */
export const TOOL_GROUPS = {
  hex: 'packet-analyzer', packets: 'packet-analyzer', kismet: 'packet-analyzer',
  ubx: 'wardrive',
  cyberchef: 'ducky',
  ch341a: 'programmers', 'cmsis-dap': 'programmers', 'jtag-programmer': 'programmers', 'avr-isp': 'programmers',
  'rfid-nfc': 'proxmark',
  'wifi-scanner': 'alfa-wifi'
};

export const windowKeyFor = (toolId) => TOOL_GROUPS[toolId] || toolId;

// A window's id is its tool group key for the first instance, and
// `<key>#<n>` for additional instances, so the same tool can open more than
// once (each window gets its own component and its own device).
export const baseIdOf = (windowId) => String(windowId).split('#')[0];
export const instanceOf = (windowId) => {
  const n = String(windowId).split('#')[1];
  return n ? parseInt(n, 10) : 1;
};
/** Next free instance number for a tool group (1 when none are open). */
export function nextInstanceFor(state, baseId) {
  let max = 0;
  for (const w of state.windows) if (baseIdOf(w.id) === baseId) max = Math.max(max, w.instance || instanceOf(w.id));
  return max + 1;
}
/** How many windows of this tool group are open. */
export const instanceCount = (state, baseId) => state.windows.filter((w) => baseIdOf(w.id) === baseId).length;
/** Title with an instance number when the tool is open more than once. */
export const displayTitle = (win) => {
  const n = win.instance || instanceOf(win.id);
  return n > 1 ? `${win.title} (${n})` : win.title;
};

export const createInitialState = () => ({ windows: [], nextZ: 1, focusedId: null });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Keep a window reachable: its title bar stays inside the desktop. */
export function clampToViewport(win, viewport) {
  const vw = Math.max(MIN_W, viewport?.width || DEFAULT_W);
  const vh = Math.max(MIN_H, viewport?.height || DEFAULT_H);
  const w = clamp(Math.round(win.w), MIN_W, Math.max(MIN_W, vw));
  const h = clamp(Math.round(win.h), MIN_H, Math.max(MIN_H, vh));
  const x = clamp(Math.round(win.x), -(w - KEEP_VISIBLE_PX), Math.max(0, vw - KEEP_VISIBLE_PX));
  const y = clamp(Math.round(win.y), 0, Math.max(0, vh - TITLE_BAR_H));
  return { ...win, x, y, w, h };
}

/** Default size for a new window: as large as fits, with a margin. */
export function defaultGeometry(viewport, index = 0) {
  const vw = viewport?.width || DEFAULT_W + 64;
  const vh = viewport?.height || DEFAULT_H + 64;
  const w = Math.min(DEFAULT_W, Math.max(MIN_W, vw - 48));
  const h = Math.min(DEFAULT_H, Math.max(MIN_H, vh - 48));
  // Cascade from the top-left, wrapping once a window would fall off the desktop.
  const slots = Math.max(1, Math.floor(Math.min((vw - w) / CASCADE_STEP, (vh - h) / CASCADE_STEP)) + 1);
  const k = index % slots;
  return { x: 16 + k * CASCADE_STEP, y: 12 + k * CASCADE_STEP, w, h };
}

const bump = (state) => ({ z: state.nextZ, nextZ: state.nextZ + 1 });

export function focusWindow(state, id) {
  const win = state.windows.find((w) => w.id === id);
  if (!win) return state;
  if (state.focusedId === id && !win.minimized && win.z === state.nextZ - 1) return state;
  const { z, nextZ } = bump(state);
  return {
    ...state, nextZ, focusedId: id,
    windows: state.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w))
  };
}

/**
 * Open a tool. By default, if an instance of the tool (or its group) is already
 * open it is focused and restored; pass { forceNew: true } to open another
 * instance in a new window, each with its own component and device.
 * meta: { title, accent } for the title bar.
 */
export function openWindow(state, toolId, meta = {}, viewport, opts = {}) {
  const baseId = windowKeyFor(toolId);
  if (!opts.forceNew) {
    const existing = state.windows
      .filter((w) => baseIdOf(w.id) === baseId)
      .sort((a, b) => (a.instance || instanceOf(a.id)) - (b.instance || instanceOf(b.id)))[0];
    if (existing) return focusWindow(state, existing.id);
  }
  const instance = nextInstanceFor(state, baseId);
  const id = instance === 1 ? baseId : `${baseId}#${instance}`;
  const { z, nextZ } = bump(state);
  const geo = clampToViewport({ ...defaultGeometry(viewport, state.windows.length) }, viewport);
  const win = {
    id, toolId, baseId, instance, title: meta.title || toolId, accent: meta.accent || 'cyan',
    ...geo, z, minimized: false, maximized: false, restore: null, openedAt: Date.now(), zoom: 1, fit: false
  };
  return { ...state, nextZ, focusedId: id, windows: [...state.windows, win] };
}

/** Open another instance of an open window's tool. */
export function duplicateWindow(state, id, viewport) {
  const w = state.windows.find((x) => x.id === id);
  if (!w) return state;
  return openWindow(state, w.toolId, { title: w.title, accent: w.accent }, viewport, { forceNew: true });
}

export function closeWindow(state, id) {
  const windows = state.windows.filter((w) => w.id !== id);
  const focusedId = state.focusedId === id ? topWindowId({ ...state, windows }) : state.focusedId;
  return { ...state, windows, focusedId };
}

export function closeAll(state) { return { ...state, windows: [], focusedId: null }; }

export function minimizeWindow(state, id) {
  const windows = state.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
  const next = { ...state, windows };
  return { ...next, focusedId: state.focusedId === id ? topWindowId(next) : state.focusedId };
}

export function toggleMaximize(state, id, viewport) {
  const win = state.windows.find((w) => w.id === id);
  if (!win) return state;
  let updated;
  if (win.maximized) {
    const r = win.restore || defaultGeometry(viewport);
    updated = { ...win, ...clampToViewport(r, viewport), maximized: false, restore: null };
  } else {
    updated = { ...win, restore: { x: win.x, y: win.y, w: win.w, h: win.h }, maximized: true };
  }
  const s = { ...state, windows: state.windows.map((w) => (w.id === id ? updated : w)) };
  return focusWindow(s, id);
}

export function moveWindow(state, id, x, y, viewport) {
  return {
    ...state,
    windows: state.windows.map((w) => (w.id === id && !w.maximized ? clampToViewport({ ...w, x, y }, viewport) : w))
  };
}

export function resizeWindow(state, id, geo, viewport) {
  return {
    ...state,
    windows: state.windows.map((w) => {
      if (w.id !== id || w.maximized) return w;
      const n = { ...w, ...geo };
      n.w = Math.max(MIN_W, n.w); n.h = Math.max(MIN_H, n.h);
      return clampToViewport(n, viewport);
    })
  };
}

/** Set a window's content zoom (clamped, 2 decimals); leaves fit-to-width mode. */
export function setZoom(state, id, zoom) {
  const z = clamp(Math.round((Number(zoom) || 1) * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  return { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, zoom: z, fit: false } : w)) };
}

/** Step the zoom to the next (dir > 0) or previous (dir < 0) preset. */
export function zoomStep(state, id, dir, currentZoom) {
  const win = state.windows.find((w) => w.id === id);
  if (!win) return state;
  const cur = Number.isFinite(currentZoom) ? currentZoom : (win.zoom ?? 1);
  let next;
  if (dir > 0) next = ZOOM_STEPS.find((z) => z > cur + 1e-6) ?? ZOOM_MAX;
  else next = [...ZOOM_STEPS].reverse().find((z) => z < cur - 1e-6) ?? ZOOM_MIN;
  return setZoom(state, id, next);
}

/** Fit-to-width: the window scales its tool so the tool's natural width fits. */
export function toggleFit(state, id) {
  return { ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, fit: !w.fit } : w)) };
}

/** The zoom a fitted window uses for a given body width and tool width. */
export function fitZoomFor(bodyWidth, naturalWidth) {
  if (!(bodyWidth > 0) || !(naturalWidth > 0)) return 1;
  return clamp(Math.round((bodyWidth / naturalWidth) * 100) / 100, ZOOM_MIN, 1);
}

/** Highest, non-minimized window; null when everything is minimized or closed. */
export function topWindowId(state) {
  let best = null;
  for (const w of state.windows) if (!w.minimized && (!best || w.z > best.z)) best = w;
  return best ? best.id : null;
}

export const focusedWindow = (state) => state.windows.find((w) => w.id === state.focusedId) || null;

/** Lay every open window out in a grid that fills the desktop. */
export function tileWindows(state, viewport) {
  const open = state.windows.filter((w) => !w.minimized);
  if (!open.length) return state;
  const vw = viewport?.width || DEFAULT_W;
  const vh = viewport?.height || DEFAULT_H;
  const n = open.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = 8;
  const cw = Math.floor((vw - gap * (cols + 1)) / cols);
  const ch = Math.floor((vh - gap * (rows + 1)) / rows);
  const sorted = [...open].sort((a, b) => a.z - b.z);
  const placed = new Map();
  sorted.forEach((w, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    // The last row stretches if it has fewer windows than columns.
    const lastRow = r === rows - 1, inLast = n - r * cols;
    const w2 = lastRow && inLast < cols ? Math.floor((vw - gap * (inLast + 1)) / inLast) : cw;
    placed.set(w.id, { x: gap + c * (w2 + gap), y: gap + r * (ch + gap), w: Math.max(MIN_W, w2), h: Math.max(MIN_H, ch), maximized: false, restore: null });
  });
  return { ...state, windows: state.windows.map((w) => (placed.has(w.id) ? { ...w, ...placed.get(w.id) } : w)) };
}

/** Stack the open windows diagonally, in z order. */
export function cascadeWindows(state, viewport) {
  const open = [...state.windows.filter((w) => !w.minimized)].sort((a, b) => a.z - b.z);
  const geo = new Map(open.map((w, i) => [w.id, { ...clampToViewport({ ...w, ...defaultGeometry(viewport, i) }, viewport), maximized: false, restore: null }]));
  return { ...state, windows: state.windows.map((w) => (geo.has(w.id) ? { ...w, ...geo.get(w.id) } : w)) };
}

// ---- persistence -----------------------------------------------------------

export function serializeState(state) {
  return JSON.stringify({
    v: 1, focusedId: state.focusedId,
    windows: state.windows.map(({ id, toolId, baseId, instance, title, accent, x, y, w, h, z, minimized, maximized, restore, zoom, fit }) =>
      ({ id, toolId, baseId, instance, title, accent, x, y, w, h, z, minimized, maximized, restore, zoom, fit }))
  });
}

export function deserializeState(json, viewport) {
  try {
    const d = JSON.parse(json);
    if (!d || d.v !== 1 || !Array.isArray(d.windows)) return null;
    const windows = d.windows
      .filter((w) => w && typeof w.id === 'string' && typeof w.toolId === 'string')
      .map((w, i) => clampToViewport({
        id: w.id, toolId: w.toolId, baseId: w.baseId || baseIdOf(w.id), instance: Number.isFinite(w.instance) ? w.instance : instanceOf(w.id),
        title: w.title || w.toolId, accent: w.accent || 'cyan',
        x: Number.isFinite(w.x) ? w.x : 16, y: Number.isFinite(w.y) ? w.y : 12,
        w: Number.isFinite(w.w) ? w.w : DEFAULT_W, h: Number.isFinite(w.h) ? w.h : DEFAULT_H,
        z: Number.isFinite(w.z) ? w.z : i + 1, minimized: !!w.minimized, maximized: !!w.maximized,
        restore: w.restore && Number.isFinite(w.restore.w) ? w.restore : null, openedAt: Date.now(),
        zoom: Number.isFinite(w.zoom) ? clamp(w.zoom, ZOOM_MIN, ZOOM_MAX) : 1, fit: !!w.fit
      }, viewport));
    const nextZ = windows.reduce((m, w) => Math.max(m, w.z), 0) + 1;
    const focusedId = windows.some((w) => w.id === d.focusedId) ? d.focusedId : topWindowId({ windows });
    return { windows, nextZ, focusedId };
  } catch (_) { return null; }
}

export function loadState(viewport, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { const s = storage?.getItem(STORAGE_KEY); return s ? deserializeState(s, viewport) : null; } catch (_) { return null; }
}

export function saveState(state, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(STORAGE_KEY, serializeState(state)); } catch (_) { /* quota / private mode */ }
}
