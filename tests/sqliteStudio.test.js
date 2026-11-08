import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import {
  splitStatements, statementAt, parseCreateTable, buildCreateTable, alterTable, buildCreateIndex,
  filterToSql, buildBrowseQuery, updateCell, insertRow, deleteRows, rowKeyFor, listObjects,
  parseCsv, toCsv, inferType, importRows, dumpSql, exportJson, sqlLiteral, readPragmas, writePragmas,
  executeScript, registerFunctions, detectBlobType, looksLikeText, hexDump, lineCol, queryAll,
  qname, listSchemas, foreignKeysOf, snapshotRows, restoreRows, rowsToInsertSql, formatValue, buildSqbpro, columnsOf,
} from '../src/utils/sqliteStudio.js';

let SQL;
beforeAll(async () => { SQL = await initSqlJs(); });
const mk = (sql) => { const db = new SQL.Database(); registerFunctions(db); if (sql) db.run(sql); return db; };
const rows = (db, sql, p) => queryAll(db, sql, p).rows;

describe('splitStatements', () => {
  it('splits on semicolons outside strings and comments', () => {
    const s = splitStatements("SELECT 'a;b'; -- c;\nSELECT \"x;\" /* ; */ FROM t;  SELECT 3");
    expect(s.map((x) => x.sql)).toEqual(["SELECT 'a;b';", 'SELECT "x;" /* ; */ FROM t;', 'SELECT 3']);
  });
  it('keeps trigger bodies (including CASE ... END) together', () => {
    const sql = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET v = CASE WHEN 1 THEN 2 END; INSERT INTO a VALUES(1); END; SELECT 1;';
    const s = splitStatements(sql);
    expect(s).toHaveLength(2);
    expect(s[0].sql.endsWith('END;')).toBe(true);
    expect(s[1].sql).toBe('SELECT 1;');
  });
  it('statementAt finds the statement under the cursor', () => {
    const t = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    expect(statementAt(t, t.indexOf('2')).sql).toBe('SELECT 2;');
    expect(statementAt(t, t.length).sql).toBe('SELECT 3;');
  });
});

describe('CREATE TABLE model', () => {
  it('parses column constraints', () => {
    const m = parseCreateTable(`CREATE TABLE IF NOT EXISTS "my t" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(20) NOT NULL UNIQUE COLLATE NOCASE DEFAULT 'x',
      price DECIMAL(10, 2) CHECK (price >= 0) DEFAULT -1.5,
      owner INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      total GENERATED ALWAYS AS (price * 2) STORED,
      CONSTRAINT u UNIQUE(name, price)
    ) WITHOUT ROWID, STRICT`);
    expect(m.name).toBe('my t');
    expect(m.withoutRowid).toBe(true);
    expect(m.strict).toBe(true);
    const [id, name, price, owner, total] = m.columns;
    expect(id).toMatchObject({ name: 'id', type: 'INTEGER', pk: 1, autoinc: true });
    expect(name).toMatchObject({ type: 'VARCHAR(20)', notnull: true, unique: true, collate: 'NOCASE', default: "'x'" });
    expect(price).toMatchObject({ type: 'DECIMAL(10, 2)', check: 'price >= 0', default: '-1.5' });
    expect(owner).toMatchObject({ fk: 'users(id) ON DELETE CASCADE', notnull: true });
    expect(total.generated).toEqual({ expr: 'price * 2', stored: true });
    expect(m.constraints).toEqual(['CONSTRAINT u UNIQUE(name, price)']);
  });

  it('lifts a table-level PRIMARY KEY into column flags', () => {
    const m = parseCreateTable('CREATE TABLE t(a TEXT, b INT, c, PRIMARY KEY(b, a DESC))');
    expect(m.columns.map((c) => c.pk)).toEqual([2, 1, 0]);
    expect(m.columns[0].pkDesc).toBe(true);
    expect(m.constraints).toEqual([]);
  });

  it('rejects things it cannot model', () => {
    expect(parseCreateTable('CREATE TABLE t AS SELECT 1')).toBeNull();
    expect(parseCreateTable('CREATE VIRTUAL TABLE t USING fts4(x)')).toBeNull();
  });

  it('round-trips through buildCreateTable into a working schema', () => {
    const src = "CREATE TABLE t(id INTEGER PRIMARY KEY, n TEXT NOT NULL DEFAULT 'a b', p REAL CHECK(p > 0), a INT, b INT, UNIQUE(a,b))";
    const m = parseCreateTable(src);
    const sql = buildCreateTable(m);
    const db = mk(sql);
    db.run('INSERT INTO t(p) VALUES (1)');
    expect(rows(db, 'SELECT id, n FROM t')).toEqual([[1, 'a b']]);
    expect(() => db.run('INSERT INTO t(p) VALUES (-1)')).toThrow(/CHECK/);
    expect(buildCreateTable(parseCreateTable(sql))).toBe(sql); // stable
  });

  it('quotes bare-word defaults and composite keys', () => {
    const sql = buildCreateTable({ name: 't', constraints: [], columns: [
      { name: 'a', type: 'TEXT', pk: 1, default: 'hello' },
      { name: 'b', type: 'INTEGER', pk: 2, default: 'CURRENT_TIMESTAMP' },
    ] });
    expect(sql).toContain("DEFAULT 'hello'");
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP');
    expect(sql).toContain('PRIMARY KEY("a","b")');
  });
});

describe('alterTable', () => {
  const setup = () => mk(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, age INT);
    CREATE INDEX users_name ON users(name);
    CREATE TABLE log(msg TEXT);
    CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN INSERT INTO log VALUES ('new ' || NEW.name); END;
    CREATE VIEW adults AS SELECT name FROM users WHERE age >= 18;
    INSERT INTO users VALUES (1,'ann',30),(2,'bo',10);`);
  const modelOf = (db, t) => {
    const m = parseCreateTable(rows(db, 'SELECT sql FROM sqlite_master WHERE name=?', [t])[0][0]);
    m.columns.forEach((c) => { c.orig = c.name; });
    return m;
  };

  it('renames table and columns without a rebuild, keeping dependents', () => {
    const db = setup();
    const m = modelOf(db, 'users');
    m.name = 'people'; m.columns[1].name = 'full_name';
    const r = alterTable(db, 'users', m);
    expect(r.rebuilt).toBe(false);
    expect(rows(db, 'SELECT full_name FROM people ORDER BY id')).toEqual([['ann'], ['bo']]);
    expect(rows(db, 'SELECT * FROM adults')).toEqual([['ann']]);
    expect(rows(db, "SELECT sql FROM sqlite_master WHERE name='users_name'")[0][0]).toMatch(/people.*full_name/);
  });

  it('adds, drops, reorders and retypes columns via a rebuild', () => {
    const db = setup();
    const m = modelOf(db, 'users');
    const [id, name] = m.columns; // drop age
    name.notnull = true;
    m.columns = [id, { name: 'email', type: 'TEXT', default: 'none', orig: null, pk: 0 }, name];
    const r = alterTable(db, 'users', m);
    expect(r.rebuilt).toBe(true);
    expect(queryAll(db, 'SELECT * FROM users ORDER BY id')).toEqual({ columns: ['id', 'email', 'name'], rows: [[1, 'none', 'ann'], [2, 'none', 'bo']] });
    expect(rows(db, "SELECT name FROM sqlite_master WHERE type IN ('index','trigger') ORDER BY name")).toEqual([['users_ai'], ['users_name']]);
    db.run("INSERT INTO users(name) VALUES ('cy')"); // trigger survived
    expect(rows(db, 'SELECT msg FROM log ORDER BY rowid DESC LIMIT 1')).toEqual([['new cy']]);
    expect(() => db.run('INSERT INTO users(email) VALUES (1)')).toThrow(/NOT NULL/);
  });

  it('reports dependents that no longer apply and rolls back on failure', () => {
    const db = setup();
    const m = modelOf(db, 'users');
    m.columns = m.columns.filter((c) => c.name !== 'name');
    const r = alterTable(db, 'users', m);
    expect(r.warnings.join(' ')).toMatch(/users_name/);

    const db2 = setup();
    const m2 = modelOf(db2, 'users');
    m2.columns[2].check = 'age > 20'; // existing row violates it
    expect(() => alterTable(db2, 'users', m2)).toThrow(/CHECK/);
    expect(rows(db2, 'SELECT COUNT(*) FROM users')).toEqual([[2]]);
    expect(rows(db2, "SELECT sql FROM sqlite_master WHERE name='users'")[0][0]).not.toMatch(/CHECK/);
  });

  it('swaps column names', () => {
    const db = mk('CREATE TABLE t(a, b); INSERT INTO t VALUES (1, 2);');
    const m = modelOf(db, 't');
    m.columns[0].name = 'b'; m.columns[1].name = 'a';
    alterTable(db, 't', m);
    expect(queryAll(db, 'SELECT * FROM t')).toEqual({ columns: ['b', 'a'], rows: [[1, 2]] });
  });

  it('buildCreateIndex', () => {
    expect(buildCreateIndex({ name: 'ix', table: 't', unique: true, columns: [{ name: 'a' }, { name: 'b', desc: true }], where: 'a > 0' }))
      .toBe('CREATE UNIQUE INDEX "ix" ON "t" ("a" ASC, "b" DESC) WHERE a > 0');
  });
});

describe('browse queries and editing', () => {
  const db0 = () => mk("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, n INT); INSERT INTO t VALUES (1,'apple',5),(2,'banana',15),(3,'cherry',NULL),(4,'50% off',25);");
  const run = (db, q) => rows(db, q.sql, q.params);

  it('filterToSql understands operators', () => {
    expect(filterToSql('n', '>10')).toEqual({ sql: '"n" > ?', params: [10] });
    expect(filterToSql('n', '5~20')).toEqual({ sql: '"n" BETWEEN ? AND ?', params: [5, 20] });
    expect(filterToSql('n', '=NULL').sql).toBe('"n" IS NULL');
    expect(filterToSql('n', '!=NULL').sql).toBe('"n" IS NOT NULL');
    expect(filterToSql('s', '50%').params).toEqual(['%50\\%%']);
    expect(filterToSql('s', '')).toBeNull();
  });

  it('applies filters, global search, sort and paging', () => {
    const db = db0();
    const base = { table: 't', columns: ['id', 'name', 'n'], keyCols: ['_rowid_'] };
    expect(run(db, buildBrowseQuery({ ...base, filters: { n: '>10' }, sort: [{ column: 'n', dir: 'desc' }] })).map((r) => r[2])).toEqual(['50% off', 'banana']);
    expect(run(db, buildBrowseQuery({ ...base, filters: { name: '/^b|^c/' } })).length).toBe(2);
    expect(run(db, buildBrowseQuery({ ...base, global: '50%' })).length).toBe(1);
    expect(run(db, buildBrowseQuery({ ...base, limit: 2, offset: 2 })).map((r) => r[0])).toEqual([3, 4]);
    const q = buildBrowseQuery({ ...base, filters: { name: 'an' } });
    expect(rows(db, q.countSql, q.countParams)).toEqual([[1]]);
  });

  it('edits rows by rowid', () => {
    const db = db0();
    const key = rowKeyFor(db, 't');
    expect(key).toMatchObject({ editable: true, keyCols: ['_rowid_'] });
    updateCell(db, 't', key.keyCols, [2], 'name', 'blueberry');
    const { rowid } = insertRow(db, 't');
    expect(rowid).toBe(5);
    deleteRows(db, 't', key.keyCols, [[1], [3]]);
    expect(rows(db, 'SELECT id, name FROM t ORDER BY id')).toEqual([[2, 'blueberry'], [4, '50% off'], [5, null]]);
  });

  it('edits WITHOUT ROWID tables by primary key, and fills NOT NULL columns on insert', () => {
    const db = mk("CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL, n INT NOT NULL) WITHOUT ROWID; INSERT INTO kv VALUES ('a','1',0);");
    const key = rowKeyFor(db, 'kv');
    expect(key).toMatchObject({ editable: true, keyCols: ['k'] });
    updateCell(db, 'kv', key.keyCols, ['a'], 'v', 'z');
    expect(rows(db, 'SELECT v FROM kv')).toEqual([['z']]);
    const db2 = mk('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INT NOT NULL)');
    insertRow(db2, 't');
    expect(rows(db2, 'SELECT * FROM t')).toEqual([[1, '', 0]]);
    expect(rowKeyFor(mk('CREATE VIEW v AS SELECT 1'), 'v').editable).toBe(false);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, newlines and custom separators', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n1,\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['1', '']]);
    expect(parseCsv('a;b\n"multi\nline";2', { separator: ';' })).toEqual([['a', 'b'], ['multi\nline', '2']]);
    expect(parseCsv('a\tb', { separator: '\t' })).toEqual([['a', 'b']]);
    expect(parseCsv('﻿h1,h2\n1,2')[0]).toEqual(['h1', 'h2']);
  });
  it('emits CSV that parses back', () => {
    const cols = ['a', 'b']; const data = [['x,y', 'q"t'], [null, 3], [new Uint8Array([1, 255]), 'line\nbreak']];
    const text = toCsv(cols, data);
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x,y', 'q"t'], ['', '3'], ['01ff', 'line\nbreak']]);
  });
  it('infers column types', () => {
    expect(inferType(['1', '2', ''])).toBe('INTEGER');
    expect(inferType(['1', '2.5'])).toBe('REAL');
    expect(inferType(['1', 'x'])).toBe('TEXT');
    expect(inferType(['007'])).toBe('TEXT'); // keep leading zeros
  });
  it('imports into a new table, then appends to it', () => {
    const db = mk();
    const r = importRows(db, 'people', parseCsv('name,age,name\nann,30,a\nbo,,b'), { emptyAsNull: true });
    expect(r).toMatchObject({ created: true, rows: 2, columns: ['name', 'age', 'name_2'] });
    expect(rows(db, "SELECT type FROM pragma_table_info('people')").flat()).toEqual(['TEXT', 'INTEGER', 'TEXT']);
    expect(rows(db, 'SELECT age FROM people')).toEqual([[30], [null]]);
    importRows(db, 'people', [['cy', '5', 'c']], { header: false });
    expect(rows(db, 'SELECT COUNT(*) FROM people')).toEqual([[3]]);
    expect(() => importRows(db, 'people', [['1', '2', '3', '4']], { header: false })).toThrow(/4 column/);
    expect(rows(db, 'SELECT COUNT(*) FROM people')).toEqual([[3]]); // rolled back
  });
});

describe('export', () => {
  const src = () => mk(`
    CREATE TABLE a(id INTEGER PRIMARY KEY AUTOINCREMENT, s TEXT, b BLOB, r REAL);
    INSERT INTO a(s, b, r) VALUES ('it''s', x'00ff', 1.5), (NULL, NULL, NULL);
    CREATE INDEX a_s ON a(s);
    CREATE VIEW va AS SELECT s FROM a;
    CREATE TRIGGER ta AFTER DELETE ON a BEGIN SELECT 1; END;`);

  it('sqlLiteral', () => {
    expect([null, 3, 'a\'b', new Uint8Array([10]), Infinity].map(sqlLiteral)).toEqual(['NULL', '3', "'a''b'", "X'0a'", '9e999']);
  });

  it('dumpSql round-trips schema and data', () => {
    const dump = dumpSql(src());
    expect(dump.startsWith('BEGIN TRANSACTION;')).toBe(true);
    const db = mk(dump);
    expect(rows(db, 'SELECT id, s, b, r FROM a ORDER BY id')).toEqual([[1, "it's", new Uint8Array([0, 255]), 1.5], [2, null, null, null]]);
    expect(listObjects(db).map((o) => `${o.type}:${o.name}`).sort()).toEqual(['index:a_s', 'table:a', 'trigger:ta', 'view:va']);
    expect(rows(db, 'SELECT seq FROM sqlite_sequence')).toEqual([[2]]);
  });

  it('dumpSql options: schema only / data only / selected tables', () => {
    const db = src();
    db.run("CREATE TABLE other(x); INSERT INTO other VALUES (1);");
    expect(dumpSql(db, { data: false })).not.toMatch(/INSERT/);
    expect(dumpSql(db, { schema: false })).not.toMatch(/CREATE/);
    const only = dumpSql(db, { tables: ['other'], columnNames: true, ifNotExists: true });
    expect(only).toMatch(/CREATE TABLE IF NOT EXISTS other/);
    expect(only).toMatch(/INSERT INTO "other" \("x"\) VALUES \(1\);/);
    expect(only).not.toMatch(/"a"|va|a_s/);
  });

  it('exportJson', () => {
    expect(JSON.parse(exportJson(src(), 'a'))[0]).toEqual({ id: 1, s: "it's", b: 'AP8=', r: 1.5 });
  });
});

describe('pragmas', () => {
  it('reads and writes, vacuuming when needed', () => {
    const db = mk('CREATE TABLE t(x)');
    const p = readPragmas(db);
    expect(p.foreign_keys).toBe(false);
    expect(p.encoding).toBe('UTF-8');
    const ran = writePragmas(db, { user_version: 7, foreign_keys: true, page_size: 8192 });
    expect(ran).toContain('VACUUM');
    const q = readPragmas(db);
    expect(q).toMatchObject({ user_version: 7, foreign_keys: true, page_size: 8192 });
    expect(() => writePragmas(db, { synchronous: 'BOGUS' })).toThrow(/invalid/);
  });
});

describe('executeScript', () => {
  it('returns per-statement results with offsets and stops at errors', () => {
    const db = mk();
    const sql = 'CREATE TABLE t(a);\nINSERT INTO t VALUES (1),(2);\nSELECT * FROM t;\n  SELEC oops;\nSELECT 9;';
    const r = executeScript(db, sql);
    expect(r.results.map((x) => x.sql)).toEqual(['CREATE TABLE t(a);', 'INSERT INTO t VALUES (1),(2);', 'SELECT * FROM t;']);
    expect(r.results[1].changes).toBe(2);
    expect(r.results[2]).toMatchObject({ columns: ['a'], rows: [[1], [2]] });
    expect(r.results[2].start).toBe(sql.indexOf('SELECT * FROM'));
    expect(r.error).toMatch(/syntax error/);
    expect(r.errorAt).toBe(sql.indexOf('SELEC oops'));
    expect(lineCol(sql, r.errorAt)).toEqual({ line: 4, col: 3 });
  });
  it('points runtime errors at the failing statement', () => {
    const db = mk('CREATE TABLE t(a NOT NULL)');
    const sql = 'SELECT 1;\nINSERT INTO t VALUES (NULL);\nSELECT 2;';
    const r = executeScript(db, sql);
    expect(r.error).toMatch(/NOT NULL/);
    expect(r.errorAt).toBe(sql.indexOf('INSERT'));
  });
  it('caps result rows', () => {
    const r = executeScript(mk(), 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 100) SELECT x FROM c', { maxRows: 10 });
    expect(r.results[0].rows).toHaveLength(10);
    expect(r.results[0].truncated).toBe(true);
  });
});

describe('blob helpers', () => {
  it('detects types and dumps hex', () => {
    expect(detectBlobType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(detectBlobType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(looksLikeText(new TextEncoder().encode('héllo\n'))).toBe(true);
    expect(looksLikeText(new Uint8Array([0, 1, 2]))).toBe(false);
    expect(hexDump(new Uint8Array([0x41, 0x00]))).toBe('00000000  41 00' + ' '.repeat(42) + '  A.');
  });
});

describe('attached schemas', () => {
  it('lists, browses and edits tables in an attached database', () => {
    const other = new SQL.Database(); other.run("CREATE TABLE x(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO x VALUES (1,'a');");
    const holder = new SQL.Database(other.export());
    const db = mk('CREATE TABLE m(a)');
    db.run(`ATTACH '/${holder.filename}' AS o`);
    expect(listSchemas(db)).toEqual(['main', 'o']);
    expect(listObjects(db, 'o').map((x) => x.name)).toEqual(['x']);
    const t = { schema: 'o', name: 'x' };
    expect(qname(t)).toBe('"o"."x"');
    expect(qname('m')).toBe('"m"');
    expect(columnsOf(db, t).map((c) => c.name)).toEqual(['id', 'v']);
    const key = rowKeyFor(db, t);
    const q = buildBrowseQuery({ table: t, keyCols: key.keyCols });
    expect(rows(db, q.sql, q.params)).toEqual([[1, 1, 'a']]);
    updateCell(db, t, key.keyCols, [1], 'v', 'b');
    insertRow(db, t);
    expect(rows(db, 'SELECT v FROM o.x ORDER BY id')).toEqual([['b'], [null]]);
  });
});

describe('browse extras', () => {
  it('foreignKeysOf resolves implicit parent keys', () => {
    const db = mk('CREATE TABLE p(pid INTEGER PRIMARY KEY); CREATE TABLE c(id, a REFERENCES p, b REFERENCES p(pid));');
    expect(foreignKeysOf(db, 'c').map((f) => [f.from, f.table, f.to]).sort()).toEqual([['a', 'p', 'pid'], ['b', 'p', 'pid']]);
  });
  it('snapshotRows/restoreRows undo a delete with the same rowids', () => {
    const db = mk("CREATE TABLE t(a, b TEXT, g GENERATED ALWAYS AS (a*2)); INSERT INTO t VALUES (1,'x'),(2,'y'),(3,'z');");
    const snap = snapshotRows(db, 't', ['_rowid_'], [[1], [3]]);
    deleteRows(db, 't', ['_rowid_'], [[1], [3]]);
    restoreRows(db, 't', snap);
    expect(rows(db, 'SELECT rowid, a, b, g FROM t ORDER BY rowid')).toEqual([[1, 1, 'x', 2], [2, 2, 'y', 4], [3, 3, 'z', 6]]);
  });
  it('rowsToInsertSql', () => {
    expect(rowsToInsertSql('t', ['a', 'b'], [[1, "o'k"], [null, new Uint8Array([255])]])).toBe(`INSERT INTO "t" ("a", "b") VALUES (1, 'o''k');\nINSERT INTO "t" ("a", "b") VALUES (NULL, X'ff');`);
  });
  it('formatValue', () => {
    expect(formatValue(255, 'hex')).toBe('0xFF');
    expect(formatValue(8, 'octal')).toBe('010');
    expect(formatValue(0, 'unixepoch')).toBe('1970-01-01 00:00:00');
    expect(formatValue(1700000000000, 'unixepoch_ms')).toBe('2023-11-14 22:13:20');
    expect(formatValue(2440587.5, 'julian')).toBe('1970-01-01 00:00:00');
    expect(formatValue('3.14159', 'decimal')).toBe('3.14');
    expect(formatValue('abc', 'hex')).toBeNull();
    expect(formatValue('Hi', 'upper')).toBe('HI');
    expect(formatValue(null, 'hex')).toBeNull();
  });
  it('buildSqbpro escapes XML', () => {
    const x = buildSqbpro({ dbPath: 'a&b.db', tabs: [{ title: 'Q <1>', text: "SELECT 1 < 2 AND 'x' = \"x\";" }] });
    expect(x).toContain('<db path="a&amp;b.db"');
    expect(x).toContain('<sql name="Q &lt;1&gt;">SELECT 1 &lt; 2 AND \'x\' = &quot;x&quot;;</sql>');
  });
});
