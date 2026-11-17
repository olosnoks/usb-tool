// Dependency-free OpenAPI/Swagger helpers for the API Client tool.
// Supports OpenAPI 3.x and Swagger 2.0 specs as JSON or (a common subset of) YAML.

// --- minimal YAML parser (OpenAPI subset) ----------------------------------
// Handles nested maps, "- " sequences, scalars, quoted strings, inline
// JSON-style flow (`[...]`, `{...}`), comments and blank lines. Not a full YAML
// implementation; complex specs should be provided as JSON.
function parseYaml(text) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of rawLines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.match(/^ */)[0].length;
    // strip trailing comments that aren't inside quotes (best effort)
    let content = line.slice(indent);
    lines.push({ indent, content });
  }
  let pos = 0;
  const scalar = (s) => {
    const v = s.trim();
    if (v === '' || v === '~' || v === 'null') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) return v.slice(1, -1);
    if ((v[0] === '[' || v[0] === '{')) { try { return JSON.parse(v.replace(/'/g, '"')); } catch { return v; } }
    return v;
  };
  function parseBlock(minIndent) {
    // Peek first line to decide map vs sequence
    if (pos >= lines.length || lines[pos].indent < minIndent) return null;
    const isSeq = lines[pos].content.startsWith('- ');
    if (isSeq) {
      const arr = [];
      const indent = lines[pos].indent;
      while (pos < lines.length && lines[pos].indent === indent && lines[pos].content.startsWith('- ')) {
        const rest = lines[pos].content.slice(2);
        if (/^[\w"'./-]+\s*:/.test(rest) || /:\s*$/.test(rest)) {
          // sequence of maps: rewrite current line as a map line at deeper indent
          lines[pos] = { indent: indent + 2, content: rest };
          arr.push(parseBlock(indent + 2));
        } else {
          arr.push(scalar(rest));
          pos++;
        }
      }
      return arr;
    }
    // map
    const obj = {};
    const indent = lines[pos].indent;
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].content.startsWith('- ')) {
      const m = lines[pos].content.match(/^([^:]+):\s?(.*)$/);
      if (!m) { pos++; continue; }
      const key = m[1].trim().replace(/^["']|["']$/g, '');
      const val = m[2];
      pos++;
      if (val.trim() === '') {
        const child = (pos < lines.length && lines[pos].indent > indent) ? parseBlock(indent + 1) : null;
        obj[key] = child === null ? null : child;
      } else {
        obj[key] = scalar(val);
      }
    }
    return obj;
  }
  return parseBlock(0) || {};
}

export function parseSpec(text) {
  const t = (text || '').trim();
  if (!t) throw new Error('Empty spec');
  try { return JSON.parse(t); } catch { /* try yaml */ }
  const obj = parseYaml(t);
  if (!obj || (!obj.openapi && !obj.swagger)) {
    throw new Error('Not a recognizable OpenAPI/Swagger spec (YAML parsing is limited — try JSON).');
  }
  return obj;
}

export function resolveRef(spec, node) {
  let n = node;
  let guard = 0;
  while (n && n.$ref && guard++ < 20) {
    const path = n.$ref.replace(/^#\//, '').split('/');
    let cur = spec;
    for (const p of path) cur = cur?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
    n = cur;
  }
  return n;
}

export const isAbsoluteUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());

function withServerVariables(server) {
  let url = String(server?.url ?? '');
  for (const [k, v] of Object.entries(server?.variables || {})) {
    url = url.split(`{${k}}`).join(String(v?.default ?? v?.enum?.[0] ?? ''));
  }
  return url;
}

/**
 * Candidate base URLs for a spec. Relative server URLs ("/api/v1") are resolved
 * against `specUrl` when it is absolute; otherwise they stay relative and the
 * caller must ask for an absolute base (buildRequest refuses relative bases, so a
 * request can never be sent to this app's own origin by accident).
 */
export function getServers(spec, specUrl = '') {
  let list;
  if (Array.isArray(spec.servers) && spec.servers.length) list = spec.servers.map(withServerVariables);
  else if (spec.host) {
    const scheme = (spec.schemes && spec.schemes[0]) || 'https';
    list = [`${scheme}://${spec.host}${spec.basePath || ''}`];
  } else list = [spec.basePath || ''];
  return list.map((u) => {
    if (isAbsoluteUrl(u) || !isAbsoluteUrl(specUrl)) return u;
    try { return new URL(u || '/', specUrl).href.replace(/\/$/, ''); } catch { return u; }
  });
}

/** Stable key for a parameter: a path "id" and a query "id" are different parameters. */
export const paramKey = (p) => `${p.in}:${p.name}`;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function listOperations(spec) {
  const ops = [];
  const paths = spec.paths || {};
  for (const [path, item] of Object.entries(paths)) {
    const pathParams = (item.parameters || []).map((p) => resolveRef(spec, p));
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = [...pathParams, ...((op.parameters || []).map((p) => resolveRef(spec, p)))];
      ops.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary || op.operationId || '',
        operationId: op.operationId || `${method}_${path}`,
        parameters: params,
        requestBody: op.requestBody ? resolveRef(spec, op.requestBody) : null,
        consumes: op.consumes || spec.consumes || [],
        raw: op,
      });
    }
  }
  return ops;
}

export function exampleForSchema(schema, spec, depth = 0) {
  if (!schema || depth > 6) return null;
  schema = resolveRef(spec, schema);
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  const type = schema.type || (schema.properties ? 'object' : undefined);
  if (type === 'object' || schema.properties) {
    const o = {};
    for (const [k, v] of Object.entries(schema.properties || {})) o[k] = exampleForSchema(v, spec, depth + 1);
    return o;
  }
  if (type === 'array') return [exampleForSchema(schema.items, spec, depth + 1)].filter((x) => x !== null);
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    if (schema.format === 'date-time') return new Date().toISOString();
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    return 'string';
  }
  return null;
}

const isFormType = (ct) => /^application\/x-www-form-urlencoded/i.test(ct || '');

/** Content type the operation expects for its body (null when it has none). */
export function bodyContentType(op) {
  if (op.requestBody) {
    const keys = Object.keys(op.requestBody.content || {});
    if (!keys.length) return null;
    return keys.includes('application/json') ? 'application/json' : keys[0];
  }
  const params = op.parameters || [];
  const consumes = op.consumes || [];
  if (params.some((p) => p.in === 'body')) return consumes.find((c) => /json/i.test(c)) || consumes[0] || 'application/json';
  if (params.some((p) => p.in === 'formData')) {
    return consumes.find(isFormType) || consumes[0] || 'application/x-www-form-urlencoded';
  }
  return null;
}

export function bodySchemaFor(op, spec) {
  if (op.requestBody) {
    const content = op.requestBody.content || {};
    const entry = content[bodyContentType(op)] || content[Object.keys(content)[0]];
    return entry ? resolveRef(spec, entry.schema) : null;
  }
  // swagger 2 body param
  const bodyParam = (op.parameters || []).find((p) => p.in === 'body');
  return bodyParam ? resolveRef(spec, bodyParam.schema) : null;
}

/** application/x-www-form-urlencoded text from a plain object (arrays repeat the key). */
export function formEncode(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, typeof x === 'object' ? JSON.stringify(x) : String(x)));
    else sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return sp.toString();
}

function jsonToForm(text) {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return formEncode(v);
  } catch { /* already form text */ }
  return text;
}

export function exampleBody(op, spec) {
  const schema = bodySchemaFor(op, spec);
  if (!schema) return '';
  const ex = exampleForSchema(schema, spec);
  if (ex === null) return '';
  return isFormType(bodyContentType(op)) && typeof ex === 'object' ? formEncode(ex) : JSON.stringify(ex, null, 2);
}

function substituteVars(str, env) {
  return (str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (env[k] !== undefined ? env[k] : `{{${k}}}`));
}

/**
 * Build a concrete request from an operation and user-supplied values.
 * paramValues: { [paramName]: value }. env: { baseUrl, token, ... }.
 * auth: { type: 'none'|'bearer'|'basic'|'apikey', token, user, pass, headerName }.
 */
export function buildRequest({ op, spec, baseUrl, paramValues = {}, bodyText = '', auth = { type: 'none' }, env = {} }) {
  let path = op.path;
  const query = [];
  const form = [];
  const headerLines = [];
  for (const p of op.parameters || []) {
    const val = paramValues[paramKey(p)];
    if (val === undefined || val === '') continue;
    if (p.in === 'path') path = path.split(`{${p.name}}`).join(encodeURIComponent(val));
    else if (p.in === 'query') query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(val)}`);
    else if (p.in === 'header') headerLines.push(`${p.name}: ${val}`);
    else if (p.in === 'formData') form.push([p.name, val]);
  }
  const base = substituteVars(baseUrl, env).trim().replace(/\/$/, '');
  if (!isAbsoluteUrl(base)) {
    throw new Error('Base URL must be absolute (http:// or https://). A relative base would send the request to this app\'s own origin.');
  }
  let url = base + substituteVars(path, env);
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.join('&');

  // auth
  if (auth.type === 'bearer' && auth.token) headerLines.push(`Authorization: Bearer ${substituteVars(auth.token, env)}`);
  else if (auth.type === 'basic' && auth.user) headerLines.push(`Authorization: Basic ${btoa(`${auth.user}:${auth.pass || ''}`)}`);
  else if (auth.type === 'apikey' && auth.token) headerLines.push(`${auth.headerName || 'X-API-Key'}: ${substituteVars(auth.token, env)}`);

  const ct = bodyContentType(op);
  let body = substituteVars(bodyText, env);
  if (isFormType(ct)) {
    body = body ? jsonToForm(body) : (form.length ? new URLSearchParams(form).toString() : '');
  }
  const hasBody = body && op.method !== 'GET' && op.method !== 'HEAD';
  if (hasBody && !headerLines.some((h) => /^content-type:/i.test(h))) {
    // multipart needs a boundary the browser must generate, so it is left unset
    if (!/^multipart\//i.test(ct || '')) headerLines.push(`Content-Type: ${ct || 'application/json'}`);
  }

  return { method: op.method, url, headers: headerLines.join('\n'), body: hasBody ? body : '' };
}

// --- schema-based fuzzing (Schemathesis-style negative cases) ----------------
const INJECTION_PAYLOADS = ["'", '"><script>alert(1)</script>', '../../../../etc/passwd', '${{7*7}}', "' OR '1'='1", '\u0000', 'A'.repeat(4096)];

/**
 * Generate negative/edge test cases for an operation. baseValues is keyed by
 * paramKey(p) (`${in}:${name}`). Each case returns a
 * description and a mutated { paramValues, bodyText } to send.
 */
export function fuzzCases(op, spec, baseValues, baseBody) {
  const cases = [];
  const params = op.parameters || [];
  const required = params.filter((p) => p.required);
  // 1. omit each required parameter
  for (const p of required) {
    const pv = { ...baseValues };
    delete pv[paramKey(p)];
    cases.push({ label: `omit required "${p.name}"`, paramValues: pv, bodyText: baseBody });
  }
  // 2. wrong type for typed params
  for (const p of params) {
    const t = (resolveRef(spec, p.schema) || p).type || p.type;
    if (t === 'integer' || t === 'number') {
      cases.push({ label: `"${p.name}" = non-numeric`, paramValues: { ...baseValues, [paramKey(p)]: 'not_a_number' }, bodyText: baseBody });
    }
    if (t === 'boolean') {
      cases.push({ label: `"${p.name}" = non-boolean`, paramValues: { ...baseValues, [paramKey(p)]: 'maybe' }, bodyText: baseBody });
    }
  }
  // 3. injection payloads into string params
  const stringParams = params.filter((p) => {
    if (p.in === 'body') return false;
    const t = (resolveRef(spec, p.schema) || p).type || p.type;
    return !t || t === 'string';
  });
  for (const p of stringParams.slice(0, 4)) {
    for (const payload of INJECTION_PAYLOADS.slice(0, 4)) {
      cases.push({ label: `"${p.name}" = ${payload.slice(0, 24)}`, paramValues: { ...baseValues, [paramKey(p)]: payload }, bodyText: baseBody });
    }
  }
  // 4. malformed JSON body (for body ops)
  if (baseBody) {
    cases.push({ label: 'malformed JSON body', paramValues: baseValues, bodyText: baseBody.slice(0, Math.max(1, baseBody.length - 2)) + '%%%' });
    cases.push({ label: 'empty JSON body', paramValues: baseValues, bodyText: '{}' });
  }
  return cases;
}
