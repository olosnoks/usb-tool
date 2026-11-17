// Parse a curl command or a raw HTTP request into { method, url, headers, body }
// for the request editor. headers is returned as newline-joined "Key: Value" text.

// Tokenize a shell-ish command line, respecting single/double quotes and
// backslash-newline line continuations.
const BS = String.fromCharCode(92);
function tokenize(cmd) {
  const s = cmd.replace(/\\\r?\n/g, ' ');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let tok = '';
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === "'") {
        i++;
        while (i < s.length && s[i] !== "'") tok += s[i++];
        i++;
      } else if (c === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length) { tok += s[i + 1]; i += 2; }
          else tok += s[i++];
        }
        i++;
      } else if (c === BS && i + 1 < s.length) {
        tok += s[i + 1]; i += 2; // unquoted backslash escapes the next character
      } else {
        tok += c; i++;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

const ARG_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary',
  '--data-ascii', '--data-urlencode', '-b', '--cookie', '-u', '--user', '-A',
  '--user-agent', '-e', '--referer', '--url',
]);

export function parseCurl(input) {
  let cmd = input.trim();
  if (/^curl\b/.test(cmd)) cmd = cmd.replace(/^curl\b/, '').trim();
  const tokens = tokenize(cmd);
  const out = { method: '', url: '', headers: [], body: '' };
  const cookies = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i];
    if (t === '-X' || t === '--request') out.method = next();
    else if (t === '-H' || t === '--header') out.headers.push(next());
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(t)) {
      out.body += (out.body ? '&' : '') + next();
      if (!out.method) out.method = 'POST';
    } else if (t === '-b' || t === '--cookie') cookies.push(next());
    else if (t === '-u' || t === '--user') out.headers.push(`Authorization: Basic ${btoa(next())}`);
    else if (t === '-A' || t === '--user-agent') out.headers.push(`User-Agent: ${next()}`);
    else if (t === '-e' || t === '--referer') out.headers.push(`Referer: ${next()}`);
    else if (t === '--url') out.url = next();
    else if (t.startsWith('-')) {
      // unknown flag; if it clearly takes an arg skip it, else ignore
      if (ARG_FLAGS.has(t)) i++;
    } else if (!out.url) out.url = t;
  }
  if (cookies.length) out.headers.push(`Cookie: ${cookies.join('; ')}`);
  return { method: out.method || 'GET', url: out.url, headers: out.headers.join('\n'), body: out.body };
}

export function parseRawHttp(input) {
  const text = input.replace(/\r\n/g, '\n').trimStart();
  const sep = text.indexOf('\n\n');
  const head = sep >= 0 ? text.slice(0, sep) : text;
  const body = sep >= 0 ? text.slice(sep + 2) : '';
  const lines = head.split('\n');
  const reqLine = lines.shift() || '';
  const m = reqLine.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+/i);
  if (!m) throw new Error('First line must be: METHOD /path HTTP/1.1');
  const method = m[1].toUpperCase();
  let path = m[2];
  const headerLines = [];
  let host = '';
  let scheme = 'https';
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k.toLowerCase() === 'host') host = v;
    headerLines.push(`${k}: ${v}`);
  }
  let url = path;
  if (!/^https?:\/\//i.test(path)) {
    if (!host) throw new Error('No Host header and the path is not an absolute URL.');
    if (/:80$/.test(host)) scheme = 'http';
    url = `${scheme}://${host}${path.startsWith('/') ? '' : '/'}${path}`;
  }
  return { method, url, headers: headerLines.join('\n'), body: body.trim() };
}

// POSIX single-quote escaping: the result is inert in sh/bash/zsh (no expansion).
export function shQuote(str) {
  return `'${String(str ?? '').replace(/'/g, "'\\''")}'`;
}

/** Header text ("Key: Value" per line) -> [[k, v]]. */
export function headerPairs(headers) {
  const out = [];
  (headers || '').split('\n').forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(0, i).trim()) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  });
  return out;
}

const hasBody = (method, body) => !!body && method !== 'GET' && method !== 'HEAD';

// Build a copy-paste curl command from the request fields. Every user-controlled
// value is single-quoted with ' -> '\'' so shell metacharacters stay inert, and
// --data-raw is used so a body starting with @ is never read as a file.
export function toCurl({ method, url, headers, body }) {
  const parts = [`curl -i -X ${shQuote(method)} --url ${shQuote(url)}`];
  headerPairs(headers).forEach(([k, v]) => parts.push(`-H ${shQuote(`${k}: ${v}`)}`));
  if (hasBody(method, body)) parts.push(`--data-raw ${shQuote(body)}`);
  return parts.join(' ');
}

/** Browser fetch() snippet. */
export function toFetch({ method, url, headers, body }) {
  const h = Object.fromEntries(headerPairs(headers));
  const opts = { method, ...(Object.keys(h).length ? { headers: h } : {}), ...(hasBody(method, body) ? { body } : {}) };
  return `fetch(${JSON.stringify(url)}, ${JSON.stringify(opts, null, 2)});`;
}

const psQuote = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;

/** PowerShell Invoke-WebRequest command (single-quoted, so $ and backticks are inert). */
export function toPowerShell({ method, url, headers, body }) {
  const pairs = headerPairs(headers);
  const ct = pairs.find(([k]) => k.toLowerCase() === 'content-type');
  const rest = pairs.filter((p) => p !== ct);
  const parts = [`Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(url)} -Method ${psQuote(method)}`];
  if (rest.length) parts.push(`-Headers @{ ${rest.map(([k, v]) => `${psQuote(k)} = ${psQuote(v)}`).join('; ')} }`);
  if (ct) parts.push(`-ContentType ${psQuote(ct[1])}`);
  if (hasBody(method, body)) parts.push(`-Body ${psQuote(body)}`);
  return parts.join(' ');
}

/** Python requests snippet. */
export function toPython({ method, url, headers, body }) {
  const lit = (v) => JSON.stringify(String(v ?? ''));
  const pairs = headerPairs(headers);
  let call = `resp = requests.request(${lit(method)}, ${lit(url)}`;
  if (pairs.length) call += `,\n    headers={${pairs.map(([k, v]) => `${lit(k)}: ${lit(v)}`).join(', ')}}`;
  if (hasBody(method, body)) call += `,\n    data=${lit(body)}.encode("utf-8")`;
  call += ')';
  return ['import requests', '', call, 'print(resp.status_code)', 'print(resp.text)'].join('\n');
}
