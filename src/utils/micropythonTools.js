// Pure helpers for the MicroPython file manager's extra operations
// (recursive delete, rename/move, run file, list sorting/filtering).
import { pyStr } from './micropythonFiles';

/** Join a directory ('.' = root as used by the tool) and a child name. */
export function joinPath(dir, name) {
  return !dir || dir === '.' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
}

/** Parent of a directory path; '.' when already at the top. */
export function parentPath(dir) {
  if (!dir || dir === '.') return '.';
  const parts = dir.split('/').filter((p, i) => p !== '' || i === 0);
  parts.pop();
  return parts.join('/') || '.';
}

/** Human-readable byte count. */
export function formatSize(n) {
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Filter by case-insensitive substring and sort (folders first). key: name | size | type */
export function sortFilterEntries(entries, { filter = '', key = 'name', desc = false } = {}) {
  const q = filter.trim().toLowerCase();
  const ext = (e) => (e.isDir ? '' : (e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : ''));
  const list = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
  const dir = desc ? -1 : 1;
  return list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let c = 0;
    if (key === 'size') c = (a.size || 0) - (b.size || 0);
    else if (key === 'type') c = ext(a).localeCompare(ext(b));
    if (c === 0) c = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return c * dir;
  });
}

/** Validate a single path segment / relative target for rename. Returns an error string or ''. */
export function validateName(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'Name is empty';
  if (/[\x00-\x1f\x7f]/.test(n)) return 'Name contains control characters';
  if (n.split('/').some((p) => p === '..')) return 'Name may not contain ".."';
  return '';
}

/** Recursively remove a file or folder tree on the device (like `mpremote fs rm -r`). */
export function buildRemoveTreeScript(path) {
  return `import os
def _rm(p):
    try:
        os.remove(p)
        return
    except OSError:
        pass
    for e in os.ilistdir(p):
        _rm(p + '/' + e[0])
    os.rmdir(p)
try:
    _rm(${pyStr(path)})
    print("__RM_OK__")
except Exception as e:
    print("__RM_ERR__", e)
del _rm`;
}

/** Rename / move (os.rename). */
export function buildRenameScript(from, to) {
  return `import os
try:
    os.rename(${pyStr(from)}, ${pyStr(to)})
    print("__MV_OK__")
except Exception as e:
    print("__MV_ERR__", e)`;
}

/** Run a script already stored on the device, like `mpremote run`, but from the device's own copy. */
export function buildRunFileScript(path) {
  return `exec(open(${pyStr(path)}).read())`;
}

/** Interpret a marker reply: {ok, error}. */
export function parseMarker(output, okMarker, errMarker) {
  if (output.includes(okMarker)) return { ok: true, error: '' };
  const i = output.indexOf(errMarker);
  if (i !== -1) return { ok: false, error: output.slice(i + errMarker.length).trim() || 'failed' };
  return { ok: false, error: output.trim() || 'no reply from device' };
}
