import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  byteLength, isBinaryContent, hexDumpBytes, readResponse, sendHttp, timeoutFromSeconds, toCsv,
} from '../src/utils/httpSend.js';
import { toCurl, parseCurl, shQuote, toFetch, toPowerShell, toPython } from '../src/utils/httpImport.js';
import { historyToHar, harToRequests, redactHeaders, loadHistory, saveHistory, clearHistory, HISTORY_CAP } from '../src/utils/httpHar.js';
import { buildRequest, getServers, listOperations, fuzzCases, paramKey, exampleBody, bodyContentType } from '../src/utils/openapi.js';

const enc = (s) => new TextEncoder().encode(s);

describe('byte counting and text/binary detection', () => {
  it('reports 6 bytes for "héllo"', async () => {
    expect(byteLength('héllo')).toBe(6);
    const r = await readResponse(new Response(enc('héllo'), { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    expect(r.size).toBe(6);
    expect(r.isBinary).toBe(false);
    expect(r.body).toBe('héllo');
  });
  it('PNG bytes are binary, kept byte-identical, and get a hex view', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff, 0xfe]);
    const r = await readResponse(new Response(png, { headers: { 'content-type': 'image/png' } }));
    expect(r.isBinary).toBe(true);
    expect(r.size).toBe(png.length);
    expect(Array.from(r.bytes)).toEqual(Array.from(png));
    expect(hexDumpBytes(r.bytes)).toContain('89 50 4e 47');
  });
  it.each([
    ['application/json', 'text', false], ['application/vnd.api+json', 'text', false], ['text/html; charset=x', 'text', false],
    ['image/svg+xml', 'text', false], ['image/png', 'text', true], ['application/pdf', 'text', true],
  ])('content type %s', (ct, body, expected) => {
    expect(isBinaryContent(ct, enc(body))).toBe(expected);
  });
  it('unknown type falls back to UTF-8 validity / NUL bytes', () => {
    expect(isBinaryContent('', enc('plain text é'))).toBe(false);
    expect(isBinaryContent('', new Uint8Array([0xc3, 0x28]))).toBe(true);
    expect(isBinaryContent('', new Uint8Array([65, 0, 66]))).toBe(true);
    expect(isBinaryContent('application/x-unknown', new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(true);
  });
  it('hex dump truncates long input', () => {
    expect(hexDumpBytes(new Uint8Array(100), 16)).toContain('truncated');
  });
});

describe('cancel and timeout', () => {
  // A fetch that never resolves but honours its signal, like the real one.
  const hangingFetch = (_url, { signal }) => new Promise((_, reject) => {
    if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); return; }
    signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  it('Cancel aborts an in-flight request promptly', async () => {
    const ctrl = new AbortController();
    const p = sendHttp('http://x.test/', {}, { signal: ctrl.signal, fetchImpl: hangingFetch, timeoutMs: 0 });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError', message: 'Request cancelled' });
  });
  it('an already-aborted signal rejects immediately', async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(sendHttp('http://x.test/', {}, { signal: ctrl.signal, fetchImpl: hangingFetch, timeoutMs: 0 })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('times out with a clear error', async () => {
    await expect(sendHttp('http://x.test/', {}, { fetchImpl: hangingFetch, timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
  it('cancelling a loop of requests stops it', async () => {
    const ctrl = new AbortController();
    let sent = 0;
    const fetchImpl = vi.fn(async (_u, { signal }) => { sent++; if (sent === 3) ctrl.abort(); if (signal.aborted) { const e = new Error('x'); e.name = 'AbortError'; throw e; } return new Response('ok'); });
    const done = [];
    for (let i = 0; i < 10; i++) {
      try { done.push(await sendHttp('http://x.test/', {}, { signal: ctrl.signal, fetchImpl, timeoutMs: 0 })); } catch { break; }
    }
    expect(done).toHaveLength(2);
    expect(fetchImpl.mock.calls.length).toBeLessThan(10);
  });
  it('passes through normal responses with timing', async () => {
    const r = await sendHttp('http://x.test/', {}, { fetchImpl: async () => new Response('hi'), timeoutMs: 1000 });
    expect(r.body).toBe('hi');
    expect(typeof r.timeMs).toBe('number');
  });
  it('timeoutFromSeconds', () => {
    expect(timeoutFromSeconds('5')).toBe(5000);
    expect(timeoutFromSeconds('abc')).toBe(30000);
    expect(timeoutFromSeconds('0')).toBe(0);
  });
});

describe('toCurl quoting and round trip', () => {
  const hostile = [
    { method: 'POST', url: 'https://a.test/x', headers: 'Content-Type: text/plain', body: '$(touch x)' },
    { method: 'POST', url: 'https://a.test/x', headers: 'X-Test: it\'s', body: 'it\'s' },
    { method: 'POST', url: 'https://a.test/?q=$(id)&r=`id`', headers: 'X-A: "quoted" $HOME', body: '`id` ; rm -rf / "q" \\n\nline2' },
    { method: 'PUT', url: 'https://a.test/x', headers: '', body: '@/etc/passwd' },
  ];
  it.each(hostile)('round trips %#', (r) => {
    const back = parseCurl(toCurl(r));
    expect(back).toEqual({ method: r.method, url: r.url, headers: r.headers, body: r.body });
  });
  it('quotes with POSIX single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(toCurl(hostile[0])).toContain("--data-raw '$(touch x)'");
  });
  it('is inert when actually run through a POSIX shell', () => {
    // Use echo via sh: if $(...) were expanded, the output would differ from the literal text.
    let sh = null;
    try { execFileSync('sh', ['-c', 'true']); sh = 'sh'; } catch { /* no sh on this machine */ }
    if (!sh) return;
    const out = execFileSync('sh', ['-c', `printf %s ${shQuote('$(echo PWNED) `echo PWNED` it\'s')}`]).toString();
    expect(out).toBe('$(echo PWNED) `echo PWNED` it\'s');
  });
  it('other copy-as formats escape their own metacharacters', () => {
    const r = hostile[1];
    expect(toPowerShell(r)).toContain("'it''s'");
    expect(toPowerShell({ ...hostile[0] })).toContain('-ContentType \'text/plain\'');
    expect(toPython(r)).toContain('"it\'s"');
    expect(JSON.parse(toFetch(r).replace(/^fetch\(".*?", /, '').replace(/\);$/, '')).body).toBe("it's");
  });
});

describe('HAR round trip and history storage', () => {
  const entries = [
    { req: { method: 'POST', url: 'https://a.test/p?x=1', headers: 'Content-Type: application/json\nX-K: v', body: '{"a":"é"}' }, res: { status: 201, statusText: 'Created', headers: [['content-type', 'application/json']], body: '{}', size: 2, contentType: 'application/json' }, timeMs: 12 },
    { req: { method: 'GET', url: 'https://a.test/', headers: '', body: '' }, res: { status: 200, statusText: 'OK', headers: [], bytes: new Uint8Array([1]), isBinary: true, size: 1, contentType: 'image/png' }, timeMs: 3 },
  ];
  it('export then import restores method, URL, headers and body', () => {
    const har = historyToHar(entries);
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries[0].request.queryString).toEqual([{ name: 'x', value: '1' }]);
    expect(har.log.entries[0].request.bodySize).toBe(byteLength('{"a":"é"}'));
    const back = harToRequests(JSON.parse(JSON.stringify(har)));
    expect(back).toHaveLength(2);
    entries.forEach((e, i) => {
      expect(back[i]).toMatchObject({ method: e.req.method, url: e.req.url, headers: e.req.headers, body: e.req.body });
    });
    expect(back[0].status).toBe(201);
  });
  it('rejects non-HAR input and accepts JSON text', () => {
    expect(() => harToRequests({})).toThrow(/HAR/);
    expect(harToRequests(JSON.stringify(historyToHar(entries)))).toHaveLength(2);
  });
  it('persists capped history without bodies and redacts credentials', () => {
    const store = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
    const many = Array.from({ length: 130 }, (_, i) => ({ req: { method: 'GET', url: `https://a.test/${i}`, headers: 'Authorization: Bearer secret\nAccept: */*', body: '' }, res: { status: 200, body: 'x'.repeat(50), size: 50 } }));
    saveHistory(many, store);
    const loaded = loadHistory(store);
    expect(loaded).toHaveLength(HISTORY_CAP);
    expect(JSON.stringify(loaded)).not.toContain('secret');
    expect(loaded[0].req.headers).toContain('Authorization: [redacted]');
    expect(loaded[0].res).toBeUndefined();
    clearHistory(store);
    expect(loadHistory(store)).toEqual([]);
    expect(redactHeaders('Cookie: a=b')).toBe('Cookie: [redacted]');
  });
  it('csv helper quotes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=1+1'], ['q"q', 3]])).toBe('a,b\n"x,y",\'=1+1\n"q""q",3');
  });
});

describe('OpenAPI parameter collisions and servers', () => {
  const spec = {
    openapi: '3.0.0',
    servers: [{ url: '/api/v1' }],
    paths: {
      '/items/{id}': {
        get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'query', schema: { type: 'string' } }] },
      },
      '/login': {
        post: { requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { user: { type: 'string' }, n: { type: 'integer' } } } } } } },
      },
    },
  };
  const op = (path) => listOperations(spec).find((o) => o.path === path);

  it('keeps path and query "id" independent', () => {
    const o = op('/items/{id}');
    const built = buildRequest({ op: o, spec, baseUrl: 'https://h.test', paramValues: { 'path:id': '7', 'query:id': 'abc' } });
    expect(built.url).toBe('https://h.test/items/7?id=abc');
    const onlyQuery = buildRequest({ op: o, spec, baseUrl: 'https://h.test', paramValues: { 'query:id': 'q' } });
    expect(onlyQuery.url).toBe('https://h.test/items/{id}?id=q');
    expect(paramKey(o.parameters[0])).toBe('path:id');
  });
  it('fuzz cases target one of the colliding parameters only', () => {
    const o = op('/items/{id}');
    const cases = fuzzCases(o, spec, { 'path:id': '7', 'query:id': 'abc' }, '');
    const inj = cases.filter((c) => c.paramValues['path:id'] !== '7');
    expect(inj.length).toBeGreaterThan(0);
    inj.forEach((c) => expect(c.paramValues['query:id']).toBe('abc'));
  });
  it('relative server URLs resolve against the spec URL', () => {
    expect(getServers(spec, 'https://api.example.com/docs/openapi.json')).toEqual(['https://api.example.com/api/v1']);
    expect(getServers(spec)).toEqual(['/api/v1']);
  });
  it('a relative base never produces a request', () => {
    expect(() => buildRequest({ op: op('/items/{id}'), spec, baseUrl: '/api/v1', paramValues: {} })).toThrow(/absolute/);
    expect(() => buildRequest({ op: op('/items/{id}'), spec, baseUrl: '', paramValues: {} })).toThrow(/absolute/);
  });
  it('server variables use their defaults', () => {
    const s2 = { servers: [{ url: 'https://{region}.example.com/{base}', variables: { region: { default: 'eu' }, base: { default: 'v2' } } }], paths: {} };
    expect(getServers(s2)).toEqual(['https://eu.example.com/v2']);
  });
  it('honours form-urlencoded request bodies', () => {
    const o = op('/login');
    expect(bodyContentType(o)).toBe('application/x-www-form-urlencoded');
    expect(exampleBody(o, spec)).toBe('user=string&n=0');
    const built = buildRequest({ op: o, spec, baseUrl: 'https://h.test', bodyText: '{"user":"a b","n":3}' });
    expect(built.body).toBe('user=a+b&n=3');
    expect(built.headers).toContain('Content-Type: application/x-www-form-urlencoded');
    const raw = buildRequest({ op: o, spec, baseUrl: 'https://h.test', bodyText: 'user=x' });
    expect(raw.body).toBe('user=x');
  });
  it('JSON bodies still default to application/json', () => {
    const s3 = { openapi: '3.0.0', paths: { '/j': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'string' } } } } } } } } } };
    const o = listOperations(s3)[0];
    const built = buildRequest({ op: o, spec: s3, baseUrl: 'https://h.test', bodyText: '{"a":1}' });
    expect(built.headers).toContain('Content-Type: application/json');
    expect(built.body).toBe('{"a":1}');
  });
});
