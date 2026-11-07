// Parse a curl command or a raw HTTP request into { method, url, headers, body }
// for the request editor. headers is returned as newline-joined "Key: Value" text.

// Tokenize a shell-ish command line, respecting single/double quotes and
// backslash-newline line continuations.
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

// Build a copy-paste curl command from the request fields.
export function toCurl({ method, url, headers, body }) {
  const parts = [`curl -i -X ${method} ${JSON.stringify(url)}`];
  (headers || '').split('\n').forEach((line) => {
    if (line.trim()) parts.push(`-H ${JSON.stringify(line.trim())}`);
  });
  if (body && method !== 'GET' && method !== 'HEAD') parts.push(`--data ${JSON.stringify(body)}`);
  return parts.join(' ');
}
