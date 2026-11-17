// Host-side `mip`: resolve a package (micropython-lib name, github: spec, or
// package.json / file URL), fetch its files in the browser and return what to
// write to the device. https only, allow-listed hosts, safe destination paths.

export const MIP_INDEX = 'https://micropython.org/pi/v2';
export const ALLOWED_HOSTS = ['raw.githubusercontent.com', 'micropython.org'];

export function assertAllowedUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`invalid URL: ${url}`); }
  if (u.protocol !== 'https:') throw new Error(`only https URLs are allowed: ${url}`);
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  return u.href;
}

/** github:org/repo/path[@branch] -> raw.githubusercontent.com URL. */
export function githubToRaw(spec) {
  let rest = spec.replace(/^github:/, '');
  let branch = 'HEAD';
  const at = rest.lastIndexOf('@');
  if (at > 0) { branch = rest.slice(at + 1); rest = rest.slice(0, at); }
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 3) throw new Error(`bad github spec: ${spec}`);
  const [org, repo, ...path] = parts;
  return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${path.join('/')}`;
}

/** Normalise a device-relative path under /lib; reject traversal. */
export function safeLibPath(rel, libDir = '/lib') {
  const parts = String(rel).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || /[\x00-\x1f]/.test(p))) {
    throw new Error(`unsafe destination path: ${rel}`);
  }
  return `${libDir}/${parts.join('/')}`;
}

function resolveFileUrl(url, base) {
  if (url.startsWith('github:')) return githubToRaw(url);
  if (/^https?:/i.test(url)) return url;
  return new URL(url, base).href;
}

async function fetchChecked(fetchFn, url, as) {
  assertAllowedUrl(url);
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${url}`);
  if (res.url) assertAllowedUrl(res.url); // redirects must stay on the allow-list
  return as === 'json' ? res.json() : new Uint8Array(await res.arrayBuffer());
}

/**
 * Resolve a spec to files: [{ path, bytes }]. Handles dependencies and
 * de-duplicates visited packages.
 * @param {string} spec  "umqtt.simple", "umqtt.simple@1.0", "github:org/repo/path", or https URL
 */
export async function resolvePackage(spec, { fetchFn = fetch, libDir = '/lib', onStatus } = {}, seen = new Set()) {
  spec = String(spec).trim();
  if (!spec) throw new Error('empty package name');
  if (seen.has(spec)) return [];
  seen.add(spec);

  let url;
  if (spec.startsWith('github:')) url = githubToRaw(spec);
  else if (/^https?:/i.test(spec)) url = spec;
  else {
    const [name, version = 'latest'] = spec.split('@');
    if (!/^[A-Za-z0-9_.\-/]+$/.test(name)) throw new Error(`bad package name: ${name}`);
    url = `${MIP_INDEX}/package/py/${name}/${version}.json`;
  }
  const baseName = url.split('?')[0].split('/').pop();
  const files = [];

  if (/\.json$/i.test(baseName)) {
    onStatus?.(`package ${spec}`);
    const pkg = await fetchChecked(fetchFn, url, 'json');
    const entries = (pkg.urls && pkg.urls.length)
      ? pkg.urls
      : (pkg.hashes || []).map(([dest, h]) => [dest, `${MIP_INDEX}/file/${h.slice(0, 2)}/${h}`]);
    for (const entry of entries) {
      const [dest, src] = entry;
      const fileUrl = resolveFileUrl(src, url);
      onStatus?.(`fetching ${dest}`);
      files.push({ path: safeLibPath(dest, libDir), bytes: await fetchChecked(fetchFn, fileUrl, 'bytes') });
    }
    for (const dep of pkg.deps || []) {
      const [dname, dver] = Array.isArray(dep) ? dep : [dep];
      const depSpec = dver ? `${dname}@${dver}` : dname;
      files.push(...await resolvePackage(depSpec, { fetchFn, libDir, onStatus }, seen));
    }
  } else {
    onStatus?.(`fetching ${baseName}`);
    files.push({ path: safeLibPath(baseName, libDir), bytes: await fetchChecked(fetchFn, url, 'bytes') });
  }
  return files;
}
