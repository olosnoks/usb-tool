// Client for the local Docker backend services (see backends.js and /backend).
//
// Each service has a base URL (default http://localhost:<port>) the user can
// override in the Docker Backends panel. Tools call the typed helpers below and
// fall back to their browser-only behavior when the backend is not configured or
// not reachable.

import { serviceById } from './backends';

const key = (id) => `skon.backend.${id}`;

export function getBackendUrl(serviceId) {
  try {
    const v = localStorage.getItem(key(serviceId));
    if (v) return v.replace(/\/+$/, '');
  } catch { /* ignore */ }
  const s = serviceById(serviceId);
  return s ? `http://localhost:${s.port}` : '';
}

export function setBackendUrl(serviceId, url) {
  try {
    if (url) localStorage.setItem(key(serviceId), url.trim().replace(/\/+$/, ''));
    else localStorage.removeItem(key(serviceId));
  } catch { /* ignore */ }
}

// True once the user has explicitly saved a URL (opted in to using the backend).
export function isBackendConfigured(serviceId) {
  try { return !!localStorage.getItem(key(serviceId)); } catch { return false; }
}

export async function checkHealth(serviceId, { timeoutMs = 4000 } = {}) {
  const base = getBackendUrl(serviceId);
  if (!base) return { ok: false, error: 'No URL' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, data: j };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out' : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function postJson(serviceId, path, body) {
  const base = getBackendUrl(serviceId);
  const r = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function getJson(serviceId, path) {
  const base = getBackendUrl(serviceId);
  const r = await fetch(`${base}${path}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// Typed helpers used by the tools.
export const nmapScan = (params) => postJson('nmap', '/scan', params);
export const tlsCert = ({ host, port = 443, servername = '' }) =>
  getJson('tls-inspector', `/cert?host=${encodeURIComponent(host)}&port=${port}${servername ? `&servername=${encodeURIComponent(servername)}` : ''}`);
export const dnsResolve = ({ name, type = 'A', server = '' }) =>
  getJson('dns', `/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}${server ? `&server=${encodeURIComponent(server)}` : ''}`);
export const hydraAttack = (params) => postJson('hydra', '/attack', params);
