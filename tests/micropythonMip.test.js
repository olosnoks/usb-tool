import { describe, it, expect } from 'vitest';
import { resolvePackage, githubToRaw, assertAllowedUrl, safeLibPath } from '../src/utils/micropythonMip';

const text = (s) => new TextEncoder().encode(s);
function mockFetch(map) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in map)) return { ok: false, status: 404 };
    const v = map[url];
    return { ok: true, status: 200, url, json: async () => v, arrayBuffer: async () => (typeof v === 'string' ? text(v).buffer : v) };
  };
  fn.calls = calls;
  return fn;
}

describe('mip', () => {
  it('installs umqtt.simple: resolves the index JSON, fetches github raw, writes /lib/umqtt/simple.py', async () => {
    const fetchFn = mockFetch({
      'https://micropython.org/pi/v2/package/py/umqtt.simple/latest.json': {
        v: 1, urls: [['umqtt/simple.py', 'github:micropython/micropython-lib/micropython/umqtt.simple/umqtt/simple.py']],
      },
      'https://raw.githubusercontent.com/micropython/micropython-lib/HEAD/micropython/umqtt.simple/umqtt/simple.py': 'class MQTTClient: pass\n',
    });
    const files = await resolvePackage('umqtt.simple', { fetchFn });
    expect(files.map((f) => f.path)).toEqual(['/lib/umqtt/simple.py']);
    expect(new TextDecoder().decode(files[0].bytes)).toBe('class MQTTClient: pass\n');
  });

  it('follows deps once and handles a direct .py URL', async () => {
    const fetchFn = mockFetch({
      'https://micropython.org/pi/v2/package/py/a/latest.json': { urls: [['a.py', 'github:o/r/a.py']], deps: [['b', 'latest'], ['b', 'latest']] },
      'https://micropython.org/pi/v2/package/py/b/latest.json': { urls: [['b.py', 'github:o/r/b.py']] },
      'https://raw.githubusercontent.com/o/r/HEAD/a.py': 'A',
      'https://raw.githubusercontent.com/o/r/HEAD/b.py': 'B',
      'https://raw.githubusercontent.com/o/r/main/x.py': 'X',
    });
    expect((await resolvePackage('a', { fetchFn })).map((f) => f.path)).toEqual(['/lib/a.py', '/lib/b.py']);
    expect((await resolvePackage('https://raw.githubusercontent.com/o/r/main/x.py', { fetchFn })).map((f) => f.path)).toEqual(['/lib/x.py']);
  });

  it('rejects non-https and non-allow-listed hosts before fetching', async () => {
    const fetchFn = mockFetch({});
    await expect(resolvePackage('https://evil.example.com/p.json', { fetchFn })).rejects.toThrow(/not allowed/);
    await expect(resolvePackage('http://micropython.org/p.json', { fetchFn })).rejects.toThrow(/https/);
    expect(fetchFn.calls).toEqual([]);
    expect(() => assertAllowedUrl('https://raw.githubusercontent.com/a')).not.toThrow();
  });

  it('rejects a package that points at a disallowed host or a traversal path', async () => {
    const f1 = mockFetch({
      'https://micropython.org/pi/v2/package/py/p/latest.json': { urls: [['p.py', 'https://evil.example.com/p.py']] },
    });
    await expect(resolvePackage('p', { fetchFn: f1 })).rejects.toThrow(/not allowed/);
    const f2 = mockFetch({
      'https://micropython.org/pi/v2/package/py/q/latest.json': { urls: [['../../main.py', 'github:o/r/q.py']] },
      'https://raw.githubusercontent.com/o/r/HEAD/q.py': 'Q',
    });
    await expect(resolvePackage('q', { fetchFn: f2 })).rejects.toThrow(/unsafe/);
  });

  it('helpers', () => {
    expect(githubToRaw('github:o/r/dir/f.py@v1')).toBe('https://raw.githubusercontent.com/o/r/v1/dir/f.py');
    expect(safeLibPath('a/./b.py')).toBe('/lib/a/b.py');
    expect(() => safeLibPath('a/../b')).toThrow();
  });

  it('reports HTTP errors', async () => {
    await expect(resolvePackage('nope', { fetchFn: mockFetch({}) })).rejects.toThrow(/404/);
  });
});
