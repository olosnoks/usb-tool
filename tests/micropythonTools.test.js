import { describe, it, expect } from 'vitest';
import {
  joinPath, parentPath, formatSize, sortFilterEntries, validateName,
  buildRemoveTreeScript, buildRenameScript, buildRunFileScript, parseMarker,
} from '../src/utils/micropythonTools';

describe('micropythonTools', () => {
  it('joins and splits paths', () => {
    expect(joinPath('.', 'a.py')).toBe('a.py');
    expect(joinPath('lib/', 'a.py')).toBe('lib/a.py');
    expect(parentPath('lib/umqtt')).toBe('lib');
    expect(parentPath('lib')).toBe('.');
    expect(parentPath('.')).toBe('.');
  });
  it('formats sizes', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatSize(NaN)).toBe('-');
  });
  it('sorts folders first and filters', () => {
    const e = [
      { name: 'b.py', size: 5, isDir: false },
      { name: 'lib', size: 0, isDir: true },
      { name: 'a.txt', size: 50, isDir: false },
    ];
    expect(sortFilterEntries(e).map((x) => x.name)).toEqual(['lib', 'a.txt', 'b.py']);
    expect(sortFilterEntries(e, { key: 'size', desc: true }).map((x) => x.name)).toEqual(['lib', 'a.txt', 'b.py']);
    expect(sortFilterEntries(e, { key: 'type' }).map((x) => x.name)).toEqual(['lib', 'b.py', 'a.txt']);
    expect(sortFilterEntries(e, { filter: 'PY' }).map((x) => x.name)).toEqual(['b.py']);
  });
  it('validates names', () => {
    expect(validateName('')).toMatch(/empty/);
    expect(validateName('../x')).toMatch(/\.\./);
    expect(validateName('ok/sub.py')).toBe('');
  });
  it('quotes paths safely in generated scripts', () => {
    const evil = 'a"); import os; os.remove("/main.py';
    expect(buildRemoveTreeScript(evil)).toContain('\\"');
    expect(buildRenameScript('a', evil)).toContain('os.rename("a", "a\\"); import');
    expect(buildRunFileScript('/main.py')).toBe('exec(open("/main.py").read())');
  });
  it('parses markers', () => {
    expect(parseMarker('__MV_OK__', '__MV_OK__', '__MV_ERR__').ok).toBe(true);
    expect(parseMarker('__MV_ERR__ [Errno 2] ENOENT', '__MV_OK__', '__MV_ERR__')).toEqual({ ok: false, error: '[Errno 2] ENOENT' });
    expect(parseMarker('', '__MV_OK__', '__MV_ERR__').ok).toBe(false);
  });
});
