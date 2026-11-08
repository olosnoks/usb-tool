import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { mergeDatabases, renameCreateTable, renameCreateIndex, sourceTag } from '../src/utils/sqliteMerge.js';

let SQL;
beforeAll(async () => { SQL = await initSqlJs(); });

/** Build a database from SQL and return its bytes (as if read from a file). */
function dbBytes(sql) {
  const db = new SQL.Database();
  db.run(sql);
  const bytes = db.export();
  db.close();
  return bytes;
}
const q = (db, sql) => { const r = db.exec(sql); return r.length ? r[0].values : []; };
const names = (db, type) => q(db, `SELECT name FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((r) => r[0]);

const A = () => dbBytes(`
  CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT UNIQUE, data BLOB);
  CREATE INDEX users_name_idx ON users(name);
  INSERT INTO users VALUES (1,'alice',x'0102'),(2,'bob',NULL);
  CREATE TABLE only_a(x);
  INSERT INTO only_a VALUES (10),(11);
  CREATE VIEW v_users AS SELECT name FROM users;
`);
const B = () => dbBytes(`
  CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT UNIQUE, email TEXT);
  INSERT INTO users VALUES (2,'bob','b@x'),(3,'carol','c@x');
  CREATE TABLE only_b(y TEXT);
  INSERT INTO only_b VALUES ('hi');
`);

describe('mergeDatabases', () => {
  it('appends same-named tables, adds missing columns and copies unique tables', () => {
    const { db, report } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }]);
    expect(names(db, 'table')).toEqual(['only_a', 'only_b', 'users']);
    expect(names(db, 'index')).toContain('users_name_idx');
    expect(names(db, 'view')).toEqual(['v_users']);
    // id 2 / 'bob' collides -> kept from a.db (ignore); carol appended; email column added
    expect(q(db, 'SELECT id, name, email FROM users ORDER BY id')).toEqual([[1, 'alice', null], [2, 'bob', null], [3, 'carol', 'c@x']]);
    expect(q(db, 'SELECT data FROM users WHERE id=1')[0][0]).toEqual(new Uint8Array([1, 2]));
    const users = report.sources[1].tables.find((t) => t.source === 'users');
    expect(users).toMatchObject({ action: 'appended', rows: 1, skipped: 1 });
    expect(report.totalRows).toBe(2 + 2 + 1 + 1);
    db.close();
  });

  it('replace: later source wins on key collisions', () => {
    const { db } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }], { rowConflict: 'replace' });
    expect(q(db, "SELECT email FROM users WHERE name='bob'")).toEqual([['b@x']]);
    db.close();
  });

  it('newkey: keeps every row by assigning fresh integer keys', () => {
    const a = dbBytes("CREATE TABLE log(id INTEGER PRIMARY KEY, msg TEXT); INSERT INTO log VALUES (1,'a1'),(2,'a2');");
    const b = dbBytes("CREATE TABLE log(id INTEGER PRIMARY KEY, msg TEXT); INSERT INTO log VALUES (1,'b1'),(2,'b2');");
    const { db } = mergeDatabases(SQL, [{ name: 'a', bytes: a }, { name: 'b', bytes: b }], { rowConflict: 'newkey' });
    expect(q(db, 'SELECT id, msg FROM log ORDER BY id')).toEqual([[1, 'a1'], [2, 'a2'], [3, 'b1'], [4, 'b2']]);
    db.close();
  });

  it('rename: keeps colliding tables separate, with their indexes', () => {
    const { db, report } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }], { tableConflict: 'rename' });
    expect(names(db, 'table')).toEqual(['only_a', 'only_b', 'users', 'users_b']);
    expect(q(db, 'SELECT COUNT(*) FROM users_b')).toEqual([[2]]);
    expect(report.sources[1].tables.find((t) => t.source === 'users')).toMatchObject({ action: 'renamed', target: 'users_b' });
    db.close();
  });

  it('skip: ignores colliding tables from later sources', () => {
    const { db } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }], { tableConflict: 'skip' });
    expect(q(db, 'SELECT COUNT(*) FROM users')).toEqual([[2]]);
    expect(q(db, "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='email'")).toEqual([[0]]);
    db.close();
  });

  it('tags rows with their source file when sourceColumn is set', () => {
    const { db } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }], { sourceColumn: '_source' });
    expect(q(db, 'SELECT name, _source FROM users ORDER BY id')).toEqual([['alice', 'a.db'], ['bob', 'a.db'], ['carol', 'b.db']]);
    expect(q(db, 'SELECT _source FROM only_b')).toEqual([['b.db']]);
    db.close();
  });

  it('accepts an already-open database and leaves it open', () => {
    const live = new SQL.Database(A());
    live.run("INSERT INTO users VALUES (9,'edited',NULL)");
    const { db } = mergeDatabases(SQL, [{ name: 'live', db: live }, { name: 'b.db', bytes: B() }]);
    expect(q(db, "SELECT COUNT(*) FROM users WHERE name='edited'")).toEqual([[1]]);
    expect(q(live, 'SELECT COUNT(*) FROM users')).toEqual([[3]]); // still usable
    db.close(); live.close();
  });

  it('creates triggers after the data copy so they do not fire on merged rows', () => {
    const a = dbBytes(`
      CREATE TABLE t(v); CREATE TABLE audit(n);
      CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN INSERT INTO audit VALUES (NEW.v); END;
      INSERT INTO t VALUES (1);`); // audit has 1 row from the original insert
    const { db } = mergeDatabases(SQL, [{ name: 'a', bytes: a }, { name: 'b', bytes: dbBytes('CREATE TABLE t(v); INSERT INTO t VALUES (2);') }]);
    expect(q(db, 'SELECT COUNT(*) FROM audit')).toEqual([[1]]);
    expect(names(db, 'trigger')).toEqual(['t_ai']);
    db.run('INSERT INTO t VALUES (3)'); // trigger is live afterwards
    expect(q(db, 'SELECT COUNT(*) FROM audit')).toEqual([[2]]);
    db.close();
  });

  it('copies FTS virtual tables through their visible columns, not shadow tables', () => {
    const mk = (txt) => dbBytes(`CREATE VIRTUAL TABLE docs USING fts4(body); INSERT INTO docs VALUES ('${txt}');`);
    const { db } = mergeDatabases(SQL, [{ name: 'a', bytes: mk('hello world') }, { name: 'b', bytes: mk('goodbye world') }]);
    expect(q(db, "SELECT body FROM docs WHERE docs MATCH 'world' ORDER BY body")).toEqual([['goodbye world'], ['hello world']]);
    db.close();
  });

  it('round-trips through export', () => {
    const { db } = mergeDatabases(SQL, [{ name: 'a.db', bytes: A() }, { name: 'b.db', bytes: B() }]);
    const re = new SQL.Database(db.export());
    expect(q(re, 'SELECT COUNT(*) FROM users')).toEqual([[3]]);
    re.close(); db.close();
  });

  it('rejects an empty list and unreadable input', () => {
    expect(() => mergeDatabases(SQL, [])).toThrow(/No databases/);
    expect(() => mergeDatabases(SQL, [{ name: 'junk.db', bytes: new TextEncoder().encode('not a database at all, really') }])).toThrow(/junk\.db/);
  });
});

describe('helpers', () => {
  it('renameCreateTable handles quoting styles', () => {
    expect(renameCreateTable('CREATE TABLE users(id)', 'u2')).toBe('CREATE TABLE "u2"(id)');
    expect(renameCreateTable('create table if not exists "my ""t"" x" (id)', 'n')).toBe('create table if not exists "n" (id)');
    expect(renameCreateTable('CREATE TABLE main.[a b](id)', 'n')).toBe('CREATE TABLE "n"(id)');
    expect(renameCreateTable('CREATE VIRTUAL TABLE `d` USING fts4(b)', 'n')).toBe('CREATE VIRTUAL TABLE "n" USING fts4(b)');
  });
  it('renameCreateIndex rewrites index and table names', () => {
    expect(renameCreateIndex('CREATE UNIQUE INDEX ix ON users (name)', 'ix2', 'users_b')).toBe('CREATE UNIQUE INDEX "ix2" ON "users_b" (name)');
  });
  it('sourceTag makes identifier-safe tags', () => {
    expect(sourceTag('logs-2024.sqlite', 0)).toBe('logs_2024');
    expect(sourceTag('', 2)).toBe('src3');
  });
});
