import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, listSchema, readRows, countRows, parseColumns } from '../src/utils/sqlite.js';

// Build a real SQLite file with the sqlite3 CLI (available in CI/dev images),
// then read it back with our dependency-free parser.
function buildDb() {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-test-'));
  const path = join(dir, 'fixture.sqlite');
  const sql = [
    'CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB);',
    'CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);',
    ...Array.from({ length: 250 }, (_, i) => `INSERT INTO users VALUES(${i + 1}, 'user${i + 1}', ${(i + 1) * 1.5}, x'000102');`),
    `INSERT INTO notes VALUES(1, '${'x'.repeat(6000)}');`, // forces an overflow chain
  ].join('\n');
  execFileSync('sqlite3', [path], { input: sql });
  const buf = readFileSync(path);
  rmSync(dir, { recursive: true, force: true });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

let haveSqlite = true;
let ab;
beforeAll(() => {
  try { ab = buildDb(); } catch { haveSqlite = false; }
});

describe('sqlite reader', () => {
  it('parses the header', () => {
    if (!haveSqlite) return;
    const db = openDatabase(ab);
    expect(db.pageSize % 512).toBe(0);
    expect(db.encoding).toBe('utf-8');
  });

  it('rejects a non-sqlite buffer', () => {
    expect(() => openDatabase(new TextEncoder().encode('not a db').buffer)).toThrow(/SQLite/);
  });

  it('lists tables with columns', () => {
    if (!haveSqlite) return;
    const db = openDatabase(ab);
    const tables = listSchema(db).filter((s) => s.type === 'table');
    expect(tables.map((t) => t.name).sort()).toEqual(['notes', 'users']);
    const users = tables.find((t) => t.name === 'users');
    expect(users.columns).toEqual(['id', 'name', 'score', 'data']);
  });

  it('counts and pages rows, decoding types', () => {
    if (!haveSqlite) return;
    const db = openDatabase(ab);
    const users = listSchema(db).find((s) => s.name === 'users');
    expect(countRows(db, users.rootpage)).toBe(250);
    const first = readRows(db, users.rootpage, { limit: 3, offset: 0 });
    expect(first.rows[0].rowid).toBe(1);
    expect(first.rows[0].values[1]).toBe('user1'); // TEXT
    expect(first.rows[0].values[2]).toBeCloseTo(1.5); // REAL
    expect(first.rows[0].values[3]).toBeInstanceOf(Uint8Array); // BLOB
    expect(first.hasMore).toBe(true);
    const tail = readRows(db, users.rootpage, { limit: 10, offset: 247 });
    expect(tail.rows.map((r) => r.rowid)).toEqual([248, 249, 250]);
    expect(tail.hasMore).toBe(false);
  });

  it('reassembles overflow payloads', () => {
    if (!haveSqlite) return;
    const db = openDatabase(ab);
    const notes = listSchema(db).find((s) => s.name === 'notes');
    const { rows } = readRows(db, notes.rootpage, { limit: 1 });
    expect(rows[0].values[1]).toBe('x'.repeat(6000));
  });
});

describe('parseColumns', () => {
  it('extracts column names and skips table constraints', () => {
    const cols = parseColumns('CREATE TABLE t (a INT, "b c" TEXT, PRIMARY KEY(a), FOREIGN KEY(a) REFERENCES u(x))');
    expect(cols).toEqual(['a', 'b c']);
  });
  it('returns [] for non-strings', () => {
    expect(parseColumns(null)).toEqual([]);
  });
});
