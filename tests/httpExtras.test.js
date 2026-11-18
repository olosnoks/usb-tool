import { describe, it, expect } from 'vitest';
import { parseVars, substituteVars, missingVars, jsonPath, extractFromJson, toRawHttp, toHttpie, toGo } from '../src/utils/httpExtras.js';

describe('httpExtras', () => {
  it('parses vars and substitutes, leaving unknown markers', () => {
    const v = parseVars('# c\nHOST = api.test\nTOKEN=a=b\n');
    expect(v).toEqual({ HOST: 'api.test', TOKEN: 'a=b' });
    expect(substituteVars('https://{{HOST}}/{{value}}', v)).toBe('https://api.test/{{value}}');
    expect(missingVars(['{{HOST}} {{x}}'], v)).toEqual(['x']);
  });
  it('json path', () => {
    const d = { a: { b: [{ c: 1 }, { c: 2 }] }, 'k k': 5 };
    expect(jsonPath(d, '$.a.b[1].c').value).toBe(2);
    expect(jsonPath(d, 'a.b[*].c').value).toEqual([1, 2]);
    expect(jsonPath(d, '["k k"]').value).toBe(5);
    expect(jsonPath(d, 'a.z').ok).toBe(false);
    expect(extractFromJson('{"t":"x"}', 't').text).toBe('x');
    expect(extractFromJson('nope', 't').ok).toBe(false);
  });
  it('copy-as formats', () => {
    const r = { method: 'POST', url: 'https://h.test/p?q=1', headers: 'A: b', body: "it's" };
    expect(toRawHttp(r)).toContain('POST /p?q=1 HTTP/1.1\r\nHost: h.test\r\nA: b\r\n\r\nit\'s');
    expect(toHttpie(r)).toBe("http --raw 'it'\\''s' POST 'https://h.test/p?q=1' 'A:b'");
    expect(toGo(r)).toContain('strings.NewReader("it\'s")');
  });
});
