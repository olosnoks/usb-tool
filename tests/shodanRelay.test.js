import { describe, it, expect, vi } from 'vitest';
import worker, { RELAYS, relayTarget, handleApi } from '../worker/index.js';
import { SHODAN_RELAYS, toRelayUrl, SHODAN_API, SHODAN_EXPLOITS_API } from '../src/utils/shodan.js';

const req = (path, init = {}) =>
  new Request(`https://usb-tool.example${path}`, { headers: { 'sec-fetch-site': 'same-origin' }, ...init });

const okJson = (body = '{"ok":1}') => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

describe('relay route table', () => {
  it('client and worker agree on the relay prefixes', () => {
    expect(SHODAN_RELAYS).toEqual(RELAYS);
  });

  it('maps relay paths to upstream urls and keeps the query', () => {
    expect(relayTarget('/api/shodan/shodan/host/search', '?key=K&query=port%3A22')).toBe('https://api.shodan.io/shodan/host/search?key=K&query=port%3A22');
    expect(relayTarget('/api/shodan-exploits/search', '?query=apache')).toBe('https://exploits.shodan.io/api/search?query=apache');
    expect(relayTarget('/api/shodanx/foo')).toBeNull();
    expect(relayTarget('/assets/app.js')).toBeNull();
  });

  it('client rewrites absolute Shodan urls to relay paths', () => {
    expect(toRelayUrl(`${SHODAN_API}/api-info?key=K`)).toBe('/api/shodan/api-info?key=K');
    expect(toRelayUrl(`${SHODAN_EXPLOITS_API}/search?query=x`)).toBe('/api/shodan-exploits/search?query=x');
    expect(toRelayUrl('https://urlscan.io/api/v1/search/?q=x')).toBeNull();
  });
});

describe('worker handleApi', () => {
  it('answers the health probe', async () => {
    const r = await handleApi(req('/api/health'));
    expect(r.status).toBe(200);
    expect((await r.json()).relays).toContain('/api/shodan');
  });

  it('forwards GET to the upstream with the query intact and no cookies', async () => {
    const calls = [];
    const f = vi.fn(async (url, init) => { calls.push({ url, init }); return okJson('{"plan":"dev"}'); });
    const r = await handleApi(req('/api/shodan/api-info?key=K', { headers: { 'sec-fetch-site': 'same-origin', cookie: 'a=b' } }), f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ plan: 'dev' });
    expect(calls[0].url).toBe('https://api.shodan.io/api-info?key=K');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.cookie).toBeUndefined();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-relay-upstream')).toBe('api.shodan.io');
  });

  it('passes upstream error statuses through unchanged', async () => {
    const f = vi.fn(async () => new Response('{"error":"Invalid API key"}', { status: 401, headers: { 'content-type': 'application/json' } }));
    const r = await handleApi(req('/api/shodan/shodan/host/count?key=bad&query=x'), f);
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('Invalid API key');
  });

  it('rejects writes, other sites and unknown routes', async () => {
    const f = vi.fn();
    expect((await handleApi(req('/api/shodan/shodan/scan', { method: 'POST' }), f)).status).toBe(405);
    expect((await handleApi(req('/api/shodan/api-info', { headers: { 'sec-fetch-site': 'cross-site' } }), f)).status).toBe(403);
    expect((await handleApi(req('/api/other/thing'), f)).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it('reports an unreachable upstream as 502', async () => {
    const f = vi.fn(async () => { throw new Error('boom'); });
    const r = await handleApi(req('/api/shodan/api-info'), f);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/boom/);
  });

  it('default export routes /api to the handler and everything else to assets', async () => {
    const env = { ASSETS: { fetch: vi.fn(async () => new Response('site', { status: 200 })) } };
    expect((await worker.fetch(req('/api/health'), env)).status).toBe(200);
    const r = await worker.fetch(req('/index.html'), env);
    expect(await r.text()).toBe('site');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
