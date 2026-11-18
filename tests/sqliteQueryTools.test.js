import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import {
  addHistory, togglePin, removeHistory, filterHistory, parseHistory, canExplain, explainSql, planTree, toMarkdown, toTsv,
} from '../src/utils/sqliteQueryTools.js';

describe('history', () => {
  it('dedupes by normalised text and counts runs', () => {
    let h = addHistory([], 'SELECT  1', { at: 1 });
    h = addHistory(h, 'SELECT 2', { at: 2 });
    h = addHistory(h, 'SELECT 1 ', { at: 3 });
    expect(h.map((x) => x.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(h[0].runs).toBe(2);
  });
  it('ignores blanks, filters, pins, removes', () => {
    expect(addHistory([], '  ')).toEqual([]);
    let h = addHistory(addHistory([], 'SELECT a FROM t'), 'DELETE FROM x');
    expect(filterHistory(h, 'delete')).toHaveLength(1);
    h = togglePin(h, 'SELECT a FROM t');
    expect(filterHistory(h)[0].sql).toBe('SELECT a FROM t');
    expect(removeHistory(h, 'DELETE FROM x')).toHaveLength(1);
  });
  it('keeps pinned entries beyond the limit and parses safely', () => {
    let h = addHistory([], 'P', {}, 2); h = togglePin(h, 'P');
    for (let i = 0; i < 5; i++) h = addHistory(h, `Q${i}`, {}, 2);
    expect(h.some((x) => x.sql === 'P')).toBe(true);
    expect(h.length).toBeLessThanOrEqual(3);
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory('[{"sql":"x"},{"a":1}]')).toHaveLength(1);
  });
});

describe('explain', () => {
  it('detects and builds', () => {
    expect(canExplain('-- hi\nselect 1')).toBe(true);
    expect(canExplain('CREATE TABLE t(a)')).toBe(false);
    expect(explainSql('EXPLAIN QUERY PLAN SELECT 1;')).toBe('EXPLAIN QUERY PLAN SELECT 1');
  });
  it('builds a tree from a real plan', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE a(id INTEGER PRIMARY KEY, x); CREATE TABLE b(id, y); CREATE INDEX bi ON b(id);');
    const r = db.exec(explainSql('SELECT * FROM a JOIN b ON b.id=a.id WHERE a.x=1'))[0].values;
    const t = planTree(r);
    expect(t.length).toBeGreaterThan(1);
    expect(t.some((n) => n.scan)).toBe(true);
    expect(t.some((n) => n.usesIndex)).toBe(true);
    expect(planTree([[2, 0, 0, 'SCAN a'], [3, 2, 0, 'SEARCH b USING INDEX i']]).map((n) => n.depth)).toEqual([0, 1]);
  });
});

describe('copy formats', () => {
  it('markdown escapes pipes and nulls', () => {
    expect(toMarkdown(['a', 'b'], [['x|y', null], [1, 'l1\nl2']])).toBe('| a | b |\n| --- | --- |\n| x\\|y |  |\n| 1 | l1<br>l2 |\n');
  });
  it('tsv flattens whitespace', () => {
    expect(toTsv(['a'], [['x\ty'], [new Uint8Array(2)]])).toBe('a\nx y\n<blob 2B>\n');
  });
});
