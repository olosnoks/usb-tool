// HAR 1.2 import/export for Repeater history, plus localStorage persistence.
//
// A history entry is { req: { method, url, headers (text), body }, res?: { status,
// statusText, headers: [[k, v]], body, size, contentType, isBinary }, timeMs?, startedAt? }.

import { headerPairs } from './httpImport';

export const HISTORY_KEY = 'skon.http.history';
export const HISTORY_CAP = 100;

const headersToHar = (pairs) => pairs.map(([name, value]) => ({ name, value }));

function queryOf(url) {
  try { return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value })); } catch { return []; }
}

/** Convert history entries to a HAR 1.2 object. */
export function historyToHar(entries, { creator = 'Skon USB Tool' } = {}) {
  return {
    log: {
      version: '1.2',
      creator: { name: creator, version: '1' },
      entries: (entries || []).map((e) => {
        const req = e.req || {};
        const res = e.res;
        const reqHeaders = headerPairs(req.headers);
        const ct = reqHeaders.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
        const bodyBytes = new TextEncoder().encode(req.body || '').length;
        const hasBody = !!req.body && req.method !== 'GET' && req.method !== 'HEAD';
        return {
          startedDateTime: new Date(e.startedAt || Date.now()).toISOString(),
          time: e.timeMs ?? 0,
          request: {
            method: req.method || 'GET',
            url: req.url || '',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: headersToHar(reqHeaders),
            queryString: queryOf(req.url),
            headersSize: -1,
            bodySize: hasBody ? bodyBytes : 0,
            ...(hasBody ? { postData: { mimeType: ct || 'text/plain', text: req.body } } : {}),
          },
          response: {
            status: res?.status ?? 0,
            statusText: res?.statusText || '',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: headersToHar(res?.headers || []),
            content: {
              size: res?.size ?? 0,
              mimeType: res?.contentType || '',
              ...(res && !res.isBinary && res.body !== undefined ? { text: res.body } : {}),
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: res?.size ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: e.timeMs ?? 0, receive: 0 },
        };
      }),
    },
  };
}

/** Extract editable requests from a HAR object (or its JSON text). */
export function harToRequests(har) {
  const doc = typeof har === 'string' ? JSON.parse(har) : har;
  const entries = doc?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('Not a HAR file (missing log.entries)');
  return entries.map((e) => {
    const r = e.request || {};
    const res = e.response || {};
    return {
      method: String(r.method || 'GET').toUpperCase(),
      url: r.url || '',
      headers: (r.headers || []).filter((h) => h.name && !h.name.startsWith(':')).map((h) => `${h.name}: ${h.value}`).join('\n'),
      body: r.postData?.text ?? '',
      status: res.status || 0,
      statusText: res.statusText || '',
      timeMs: Math.round(e.time || 0),
      size: res.content?.size ?? 0,
    };
  });
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|x-auth-token|x-csrf-token)$/i;

/** Blank the values of credential-bearing headers before anything is written to localStorage. */
export function redactHeaders(text) {
  return (text || '').split('\n').map((line) => {
    const i = line.indexOf(':');
    return i > 0 && SECRET_HEADER.test(line.slice(0, i).trim()) ? `${line.slice(0, i)}: [redacted]` : line;
  }).join('\n');
}

/** Light shape persisted to localStorage (no response bodies, so quota stays small). */
function slim(e) {
  return {
    req: { ...e.req, headers: redactHeaders(e.req?.headers) },
    startedAt: e.startedAt,
    timeMs: e.timeMs,
    status: e.status ?? e.res?.status,
    statusText: e.statusText ?? e.res?.statusText,
    size: e.size ?? e.res?.size,
  };
}

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => e?.req?.url).slice(0, HISTORY_CAP) : [];
  } catch { return []; }
}

export function saveHistory(entries, storage = globalThis.localStorage) {
  try { storage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_CAP).map(slim))); } catch { /* quota or private mode */ }
}

export function clearHistory(storage = globalThis.localStorage) {
  try { storage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
