/**
 * sessionLog.js — one log for the whole session, across every hardware tool.
 *
 * Tools record what they did (log lines, errors, confirmed or declined
 * destructive actions); the device pickers are wrapped so every USB / HID /
 * serial / Bluetooth device the user chooses is noted with its IDs. The log
 * survives a page reload (sessionStorage) and exports as a Markdown report or
 * JSON, so a bench session can be attached to a ticket or kept with a dump.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'skon_session_log';
const MAX_ENTRIES = 2000;
export const LEVELS = ['info', 'ok', 'warn', 'error', 'action', 'device'];

let entries = load();
let currentTool = 'app';
let seq = entries.length ? entries[entries.length - 1].seq : 0;
const listeners = new Set();

function load() {
  try {
    const raw = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

let saveTimer = null;
function save() {
  if (typeof sessionStorage === 'undefined' || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (e) { /* storage full: keep in memory */ }
  }, 250);
}

function emit() {
  listeners.forEach((fn) => fn(entries));
  save();
}

/** The tool device pickers and unnamed records are attributed to. */
export function setCurrentTool(name) { currentTool = name || 'app'; }
export function getCurrentTool() { return currentTool; }

/** Record one entry. Repeats of the same line from the same tool within 2 s are folded into a count. */
export function record(tool, level, text, data) {
  let msg = String(text ?? '').trim();
  if (!msg) return null;
  if (msg.length > 2000) msg = `${msg.slice(0, 2000)}… (${msg.length} chars)`;
  const lv = LEVELS.includes(level) ? level : (level === 'err' ? 'error' : 'info');
  const t = Date.now();
  const last = entries[entries.length - 1];
  if (last && last.tool === (tool || currentTool) && last.level === lv && last.text === msg && t - last.t < 2000) {
    entries = [...entries.slice(0, -1), { ...last, t, count: (last.count || 1) + 1 }];
    emit();
    return entries[entries.length - 1];
  }
  const entry = { seq: ++seq, t, tool: tool || currentTool, level: lv, text: msg };
  if (data !== undefined) entry.data = data;
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  emit();
  return entry;
}

export function getEntries() { return entries; }

export function clearLog() {
  entries = [];
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** window.confirm that records what was asked and what the user answered. */
export function confirmAction(message, tool) {
  const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false;
  const first = String(message).split('\n')[0];
  record(tool, 'action', `${ok ? 'Confirmed' : 'Declined'}: ${first}`);
  return ok;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export function useSessionEntries() {
  const [list, setList] = useState(entries);
  useEffect(() => subscribe(setList), []);
  return list;
}

/** useState('') for a tool's error message that also records every error shown. */
export function useSessionError(tool) {
  const [error, setErrorState] = useState('');
  const last = useRef('');
  const setError = useCallback((value) => {
    const next = typeof value === 'function' ? value(last.current) : value;
    // Recorded here, not in a state updater: React may run updaters twice.
    if (next && next !== last.current) record(tool, 'error', next);
    last.current = next;
    setErrorState(next);
  }, [tool]);
  return [error, setError];
}

// ---------------------------------------------------------------------------
// Device picker capture
// ---------------------------------------------------------------------------

const hex4 = (n) => (typeof n === 'number' ? n.toString(16).padStart(4, '0') : '????');

export function describeDevice(kind, d) {
  if (!d) return null;
  if (kind === 'usb') return { kind, vid: hex4(d.vendorId), pid: hex4(d.productId), name: [d.manufacturerName, d.productName].filter(Boolean).join(' ') || undefined, serial: d.serialNumber || undefined };
  if (kind === 'hid') return { kind, vid: hex4(d.vendorId), pid: hex4(d.productId), name: d.productName || undefined };
  if (kind === 'serial') {
    const info = typeof d.getInfo === 'function' ? d.getInfo() : {};
    return { kind, vid: info.usbVendorId !== undefined ? hex4(info.usbVendorId) : undefined, pid: info.usbProductId !== undefined ? hex4(info.usbProductId) : undefined };
  }
  if (kind === 'bluetooth') return { kind, name: d.name || undefined, id: d.id };
  return { kind };
}

export function deviceLabel(info) {
  if (!info) return 'device';
  const ids = info.vid ? `${info.vid}:${info.pid}` : info.id ? `id ${info.id.slice(0, 8)}` : '';
  return [info.kind.toUpperCase(), info.name, ids && `(${ids})`].filter(Boolean).join(' ');
}

let installed = false;

/** Wrap navigator.usb/hid/serial/bluetooth pickers once so every chosen device is recorded. */
export function installDeviceCapture(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (installed || !nav) return;
  installed = true;
  const wrap = (kind, api, method) => {
    if (!api || typeof api[method] !== 'function') return;
    const orig = api[method].bind(api);
    api[method] = async (...args) => {
      try {
        const res = await orig(...args);
        const list = Array.isArray(res) ? res : [res];
        list.filter(Boolean).forEach((d) => { const info = describeDevice(kind, d); record(undefined, 'device', `Selected ${deviceLabel(info)}`, info); });
        return res;
      } catch (err) {
        if (err?.name !== 'NotFoundError') record(undefined, 'warn', `${kind} picker: ${err.message}`);
        throw err;
      }
    };
  };
  wrap('usb', nav.usb, 'requestDevice');
  wrap('hid', nav.hid, 'requestDevice');
  wrap('serial', nav.serial, 'requestPort');
  wrap('bluetooth', nav.bluetooth, 'requestDevice');
  ['usb', 'hid'].forEach((kind) => {
    const api = nav[kind];
    if (!api?.addEventListener) return;
    api.addEventListener('disconnect', (e) => record(undefined, 'device', `Unplugged ${deviceLabel(describeDevice(kind, e.device))}`));
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
const LEVEL_TAG = { info: '', ok: 'OK', warn: 'WARN', error: 'ERROR', action: 'ACTION', device: 'DEVICE' };

export function exportJson(list = entries, meta = {}) {
  return JSON.stringify({ format: 'skon-session-log', version: 1, exported: new Date().toISOString(), ...meta, entries: list }, null, 2);
}

/** A readable report: summary, devices used, actions and errors, then the full timeline. */
export function exportMarkdown(list = entries, { title = "Skon's USB Tool session", userAgent } = {}) {
  const lines = [`# ${title}`, ''];
  if (!list.length) return `${lines.join('\n')}No entries.\n`;
  const start = list[0].t;
  const end = list[list.length - 1].t;
  const tools = [...new Set(list.map((e) => e.tool))];
  const count = (lv) => list.filter((e) => e.level === lv).reduce((n, e) => n + (e.count || 1), 0);
  lines.push(
    `- **From:** ${new Date(start).toLocaleString()}`,
    `- **To:** ${new Date(end).toLocaleString()}`,
    `- **Tools:** ${tools.join(', ')}`,
    `- **Entries:** ${list.length} (${count('error')} errors, ${count('warn')} warnings, ${count('action')} confirmations)`
  );
  if (userAgent) lines.push(`- **Browser:** ${userAgent}`);
  const devices = new Map();
  list.filter((e) => e.level === 'device' && e.data).forEach((e) => devices.set(deviceLabel(e.data), e.tool));
  if (devices.size) {
    lines.push('', '## Devices', '');
    devices.forEach((tool, label) => lines.push(`- ${label} — ${tool}`));
  }
  const notable = list.filter((e) => e.level === 'action' || e.level === 'error');
  if (notable.length) {
    lines.push('', '## Actions and errors', '');
    notable.forEach((e) => lines.push(`- ${clock(e.t)} **${e.tool}** ${e.level === 'error' ? 'ERROR: ' : ''}${e.text}`));
  }
  lines.push('', '## Timeline', '', '```');
  list.forEach((e) => {
    const tag = LEVEL_TAG[e.level] ? ` ${LEVEL_TAG[e.level]}` : '';
    const rep = e.count > 1 ? ` (x${e.count})` : '';
    lines.push(`${clock(e.t)} [${e.tool}]${tag} ${e.text.replace(/```/g, "'''")}${rep}`);
  });
  lines.push('```', '');
  return lines.join('\n');
}

/** Read back an exported JSON log (to view a session someone sent). */
export function parseJsonLog(text) {
  const obj = JSON.parse(text);
  if (obj?.format !== 'skon-session-log' || !Array.isArray(obj.entries)) throw new Error('Not a session log exported by this tool.');
  return obj.entries.filter((e) => e && typeof e.t === 'number' && typeof e.text === 'string');
}

/** For tests: reset module state. */
export function _resetForTests() {
  entries = [];
  seq = 0;
  currentTool = 'app';
  installed = false;
  listeners.clear();
}
