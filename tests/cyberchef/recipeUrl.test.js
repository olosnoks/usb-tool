import { describe, it, expect } from 'vitest';
import { Chef, registry } from '../../src/utils/cyberchef/core/index.js';
import '../../src/utils/cyberchef/operations/index.js';
import {
  parseCyberChefRecipe, formatCyberChefRecipe, encodeRecipeHash, decodeRecipeHash, normalizeSteps, unknownOps,
  tokenizeCyberChefRecipe
} from '../../src/utils/cyberchef/recipeUrl.js';

const bakeSteps = async (input, steps) => (await Chef.bake(input, steps.map((s) => ({ op: s.op, args: s.args })))).toString();

describe('DAT-6 recipeUrl: CyberChef recipe import', () => {
  it('imports real CyberChef recipe strings and bakes to the same output', async () => {
    const a = parseCyberChefRecipe("From_Hex('Auto')To_Base64('A-Za-z0-9+/=')");
    expect(a.unsupported).toEqual([]);
    expect(a.steps.map((s) => s.op)).toEqual(['From Hex', 'To Base64']);
    expect(await bakeSteps('48656c6c6f', a.steps)).toBe('SGVsbG8=');

    const b = parseCyberChefRecipe("To_Base64('A-Za-z0-9-_')");
    expect(await bakeSteps('hi??>>', b.steps)).toBe('aGk_Pz4-');

    const c = parseCyberChefRecipe("Find_/_Replace({'option':'Regex','string':'l+'},'L',true,false,true,false)\nTo_Upper_case('Word')\nReverse('Character')");
    expect(c.unsupported).toEqual([]);
    expect(await bakeSteps('hello world', c.steps)).toBe('dLroW oLeH');

    const d = parseCyberChefRecipe("From_Base64('A-Za-z0-9+/=',true,false)SHA2('256',64,160)");
    expect(await bakeSteps('SGVsbG8=', d.steps)).toBe('185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969');

    const e = parseCyberChefRecipe("To_Hex('0x',0)");
    expect(await bakeSteps('AB', e.steps)).toBe('0x41 0x42');

    const f = parseCyberChefRecipe("HMAC({'option':'UTF8','string':'Jefe'},'SHA2 256')");
    expect(await bakeSteps('what do ya want for nothing?', f.steps)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');

    const g = parseCyberChefRecipe("To_Morse_Code('-/.','Space','Line feed')");
    expect(await bakeSteps('SOS', g.steps)).toBe('... --- ...');
  });

  it('lists unsupported operations and arguments instead of silently dropping them', () => {
    const r = parseCyberChefRecipe("To_Base64('A-Za-z0-9+/=')XOR({'option':'Hex','string':'55'},'Standard',false)Magic(3,false,false,'')To_Hex('Colon',0)ROT13(true,false,13)");
    expect(r.steps.map((s) => s.op)).toEqual(['To Base64']);
    expect(r.unsupported.map((u) => u.name)).toEqual(['XOR', 'Magic', 'To Hex', 'ROT13']);
    expect(r.unsupported[0].reason).toMatch(/not available/);
    expect(r.unsupported[2].reason).toMatch(/delimiter "Colon"/);
    expect(r.unsupported.map((u) => u.index)).toEqual([1, 2, 3, 4]);
    const h = parseCyberChefRecipe("Regular_expression('User defined','a',true,true,false,false,false,false,'Highlight matches')");
    expect(h.steps).toEqual([]);
    expect(h.unsupported[0].reason).toMatch(/Highlight matches/);
  });

  it('handles escapes, flags and quotes in arguments', () => {
    const src = "Find_/_Replace({'option':'Simple string','string':'it\\'s'},'a \"q\"',true,false,true,false/disabled/breakpoint)";
    const r = parseCyberChefRecipe(src);
    expect(r.steps[0].args.find).toBe("it's");
    expect(r.steps[0].args.replace).toBe('a "q"');
    expect(r.steps[0].disabled).toBe(true);
    expect(r.steps[0].breakpoint).toBe(true);
    const out = formatCyberChefRecipe(r.steps);
    expect(out.text).toBe(src);
    expect(parseCyberChefRecipe(out.text).steps).toEqual(r.steps);
  });

  it('rejects malformed recipe strings with readable errors', () => {
    expect(() => parseCyberChefRecipe('To_Base64')).toThrow(/Expected "\("/);
    expect(() => parseCyberChefRecipe("To_Base64('A-Z")).toThrow(/Missing "\)"/);
    expect(() => parseCyberChefRecipe('To_Hex(Space)')).toThrow(/Could not read the arguments of To_Hex/);
    expect(tokenizeCyberChefRecipe('')).toEqual([]);
    expect(parseCyberChefRecipe('  ').steps).toEqual([]);
  });

  it('exports shared ops in CyberChef format and reports the rest', () => {
    const steps = [
      { op: 'From Hex', args: {} },
      { op: 'To Base64', args: { alphabet: 'A-Za-z0-9-_' } },
      { op: 'Parse JWT', args: {} },
      { op: 'AES-GCM Encrypt', args: {} },
      { op: 'ROT-N', args: { amount: 5, letters: 'Yes', digits: 'Yes' } },
      { op: 'SHA-256', args: {} }
    ];
    const { text, skipped } = formatCyberChefRecipe(steps);
    expect(text).toBe("From_Hex('Auto')To_Base64('A-Za-z0-9-_')SHA2('256',160)");
    expect(skipped.map((s) => s.name)).toEqual(['Parse JWT', 'AES-GCM Encrypt', 'ROT-N']);
    expect(skipped[2].reason).toMatch(/CyberChef cannot express/);
  });

  it('round-trips every mapped operation with default arguments', () => {
    const mappedIds = ['to_base64', 'from_base64', 'to_hex', 'from_hex', 'to_hexdump', 'to_binary', 'to_decimal', 'to_base32', 'to_base58', 'to_base62',
      'from_base62', 'to_base45', 'from_base45', 'url_encode', 'url_decode', 'rot13', 'rot47', 'reverse', 'find_replace', 'regular_expression',
      'to_upper_case', 'to_lower_case', 'sort', 'unique', 'head', 'tail', 'remove_whitespace', 'remove_null_bytes', 'count_occurrences',
      'swap_endianness', 'add_line_numbers', 'vigenere_encode', 'vigenere_decode', 'atbash_cipher', 'to_morse_code', 'from_morse_code',
      'a1z26_encode', 'a1z26_decode', 'to_html_entity', 'from_html_entity', 'to_punycode', 'from_punycode', 'to_quoted_printable',
      'from_quoted_printable', 'encode_text', 'decode_text', 'defang_url', 'fang_url', 'defang_ip', 'json_to_csv', 'csv_to_json', 'pem_to_hex',
      'hex_to_pem', 'md5', 'sha1', 'md4', 'ntlm_hash', 'sha512', 'sha384', 'sha224', 'sha256', 'sha512_256', 'sha3', 'ripemd160', 'hmac',
      'blake2b', 'blake2s', 'crc32', 'adler32', 'fletcher16', 'fletcher32', 'gunzip', 'extract_emails', 'extract_urls', 'extract_domains',
      'extract_mac_addresses', 'extract_ip_addresses', 'json_beautify', 'json_minify'];
    for (const id of mappedIds) {
      const op = registry.get(id);
      expect(op, id).toBeTruthy();
      const args = Object.fromEntries(op.args.filter((a) => a.default !== undefined).map((a) => [a.name, a.default]));
      if (id === 'regular_expression') args.outputFormat = 'List matches';
      if (id === 'sha3') args.length = '512';
      const step = { op: op.name, args };
      const { text, skipped } = formatCyberChefRecipe([step]);
      expect(skipped, id).toEqual([]);
      const back = parseCyberChefRecipe(text);
      expect(back.unsupported, `${id}: ${text}`).toEqual([]);
      expect(back.steps, id).toHaveLength(1);
      expect(back.steps[0].op, id).toBe(op.name);
      expect(back.steps[0].args, `${id}: ${text}`).toEqual(step.args);
    }
  });
});

describe('DAT-6 recipeUrl: URL hash', () => {
  const steps = [
    { op: 'From Hex', args: {} },
    { op: 'Parse JWT', args: {} },
    { op: 'AES-GCM Encrypt', args: { key: '00'.repeat(16), iv: '00'.repeat(12), aad: "it's", tagLength: '96' } },
    { op: 'To Base64', args: { alphabet: 'A-Za-z0-9-_' } }
  ];

  it('encodes and decodes recipe and input (including native-only ops and odd characters)', () => {
    const input = 'Hello, wörld! +/=&?# 日本 "quoted" \'single\'';
    const hash = encodeRecipeHash({ steps, input });
    expect(hash.startsWith('recipe=')).toBe(true);
    expect(hash).not.toMatch(/[ "#]/);
    const back = decodeRecipeHash(`#${hash}`);
    expect(back.unsupported).toEqual([]);
    expect(back.input).toBe(input);
    expect(back.steps.map((s) => s.op)).toEqual(steps.map((s) => s.op));
    expect(back.steps[2].args).toMatchObject({ key: '00'.repeat(16), aad: "it's", tagLength: '96' });
    expect(back.steps[3].args.alphabet).toBe('A-Za-z0-9-_');
  });

  it('restores a recipe from a plain CyberChef-style link', async () => {
    const back = decodeRecipeHash('#recipe=From_Hex(%27Auto%27)To_Base64(%27A-Za-z0-9%2B/%3D%27)&input=NDg2NTZjNmM2Zg');
    expect(back.input).toBe('48656c6c6f');
    expect(await bakeSteps(back.input, back.steps)).toBe('SGVsbG8=');
  });

  it('omits very long input and handles empty recipes', () => {
    expect(encodeRecipeHash({ steps: [], input: 'x'.repeat(5000) })).toBe('recipe=');
    expect(decodeRecipeHash('#recipe=')).toMatchObject({ steps: [], input: null });
    expect(decodeRecipeHash('')).toMatchObject({ steps: null, input: null });
    expect(decodeRecipeHash('#unrelated=1')).toMatchObject({ steps: null, input: null });
  });

  it('still reads older JSON-array links with raw-text input', () => {
    const legacy = `#recipe=${encodeURIComponent(JSON.stringify([{ op: 'To Base64', args: {} }, { op: 'Nope', args: {} }]))}&input=${encodeURIComponent('plain text input')}`;
    const back = decodeRecipeHash(legacy);
    expect(back.steps.map((s) => s.op)).toEqual(['To Base64', 'Nope']);
    expect(back.unsupported.map((u) => u.name)).toEqual(['Nope']);
    expect(back.input).toBe('plain text input');
  });

  it('reports malformed links', () => {
    expect(() => decodeRecipeHash('#recipe=%E0%A4%A')).toThrow(/malformed percent-encoding/);
    expect(() => decodeRecipeHash('#recipe=%5B%7B')).toThrow(/not valid JSON/);
    expect(() => decodeRecipeHash('#recipe=To_Base64(')).toThrow(/Missing "\)"/);
    expect(decodeRecipeHash('#recipe=Bogus_Op()').unsupported[0].name).toBe('Bogus Op');
  });

  it('normalizes saved recipe steps by op id or name and keeps old recipes loadable', async () => {
    const saved = [
      { op: 'to_base64', args: {} },
      { name: 'From Hex' },
      { id: 'rot13', args: [] },
      { op: 'HMAC', args: ['k', 'UTF8', 'MD5'] },
      { op: 'Retired Operation', args: { x: 1 }, uniqueId: 'u1' }
    ];
    const out = normalizeSteps(saved);
    expect(out.map((s) => s.op)).toEqual(['To Base64', 'From Hex', 'ROT13', 'HMAC', 'Retired Operation']);
    expect(out[0].args).toEqual({ alphabet: 'A-Za-z0-9+/=' });
    expect(out[3].args).toEqual({ key: 'k', keyFormat: 'UTF8', hash: 'MD5' });
    expect(out[4]).toMatchObject({ args: { x: 1 }, uniqueId: 'u1' });
    expect(unknownOps(out)).toEqual(['Retired Operation']);
    expect(normalizeSteps('nope')).toEqual([]);
    // A recipe saved before the alphabet argument existed still bakes
    expect(await bakeSteps('Hello', normalizeSteps([{ op: 'To Base64', args: {} }]))).toBe('SGVsbG8=');
  });

  it('registry size supports the banner count', () => {
    expect(registry.getAll().length).toBeGreaterThanOrEqual(150);
  });
});
