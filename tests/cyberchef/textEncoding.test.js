import { describe, it, expect } from 'vitest';
import { Dish, Chef, registry } from '../../src/utils/cyberchef/core/index.js';
import '../../src/utils/cyberchef/operations/index.js';
import { punycodeEncode, punycodeDecode, parseCsv } from '../../src/utils/cyberchef/operations/encodingOps.js';

const bake = async (input, op, args = {}) => (await Chef.bake(input, [{ op, args }])).toString();
const bakeHex = async (input, op, args = {}) => (await Chef.bake(input, [{ op, args }, { op: 'to_hex', args: { delimiter: 'None' } }])).toString();

describe('DAT-6 text operations', () => {
  it('Find / Replace: simple, extended and regex modes', async () => {
    expect(await bake('a.b.c', 'find_replace', { find: '.', replace: '-' })).toBe('a-b-c');
    expect(await bake('x$1y', 'find_replace', { find: 'x', replace: '$1' })).toBe('$1$1y');
    expect(await bake('a\nb', 'find_replace', { find: '\\n', replace: ',', mode: 'Extended (\\n, \\t, \\x...)' })).toBe('a,b');
    expect(await bake('2024-05-06', 'find_replace', { find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3/$2/$1', mode: 'Regex' })).toBe('06/05/2024');
    expect(await bake('Aaa', 'find_replace', { find: 'a', replace: 'x', ignoreCase: 'Yes', global: 'No' })).toBe('xaa');
    await expect(bake('x', 'find_replace', { find: '', replace: 'y' })).rejects.toThrow(/must not be empty/);
    await expect(bake('x', 'find_replace', { find: '(', replace: 'y', mode: 'Regex' })).rejects.toThrow(/Invalid regular expression/);
    await expect(bake('x', 'find_replace', { find: 'x', mode: 'bogus' })).rejects.toThrow(/Search mode must be one of/);
  });

  it('Regular expression: matches, groups, replace, total', async () => {
    const text = 'id=12 id=345 name=bob';
    expect(await bake(text, 'regular_expression', { regex: 'id=(\\d+)' })).toBe('id=12\nid=345');
    expect(await bake(text, 'regular_expression', { regex: 'id=(\\d+)', outputFormat: 'List capture groups' })).toBe('12\n345');
    expect(await bake(text, 'regular_expression', { regex: 'id=(\\d+)', outputFormat: 'List matches with capture groups' }))
      .toBe('id=12\n  Group 1: 12\nid=345\n  Group 1: 345');
    expect(await bake(text, 'regular_expression', { regex: '\\d+', displayTotal: 'Yes' })).toBe('Total found: 2\n\n12\n345');
    expect(await bake(text, 'regular_expression', { regex: '(\\w+)=(\\w+)', outputFormat: 'Replace', replacement: '$2:$1' })).toBe('12:id 345:id bob:name');
    expect(await bake('abc', 'regular_expression', { regex: '' })).toBe('abc');
    await expect(bake('x', 'regular_expression', { regex: '[' })).rejects.toThrow(/Invalid regular expression/);
    await expect(bake('x', 'regular_expression', { regex: 'x', outputFormat: 'nope' })).rejects.toThrow(/Output format/);
  });

  it('To Upper / Lower case', async () => {
    expect(await bake('hello world. second one', 'to_upper_case')).toBe('HELLO WORLD. SECOND ONE');
    expect(await bake('hello world. second one', 'to_upper_case', { scope: 'Word' })).toBe('Hello World. Second One');
    expect(await bake('hELLO world. second one', 'to_upper_case', { scope: 'Sentence' })).toBe('Hello world. Second one');
    expect(await bake('one two\nthree four', 'to_upper_case', { scope: 'Paragraph' })).toBe('One two\nThree four');
    expect(await bake('MiXeD', 'to_lower_case')).toBe('mixed');
    await expect(bake('x', 'to_upper_case', { scope: 'Galaxy' })).rejects.toThrow(/Scope must be one of/);
  });

  it('Sort and Unique', async () => {
    expect(await bake('b\nB\na\nA', 'sort')).toBe('A\nB\na\nb');
    expect(await bake('b\nB\na\nA', 'sort', { order: 'Alphabetical (case insensitive)' })).toBe('a\nA\nb\nB');
    expect(await bake('10\n9\n100\nx', 'sort', { order: 'Numeric' })).toBe('9\n10\n100\nx');
    expect(await bake('10.0.0.10\n10.0.0.9\n192.168.0.1', 'sort', { order: 'IP address', reverse: 'Yes' })).toBe('192.168.0.1\n10.0.0.10\n10.0.0.9');
    expect(await bake('c,a,b', 'sort', { delimiter: 'Comma' })).toBe('a,b,c');
    await expect(bake('x', 'sort', { delimiter: 'Pipe' })).rejects.toThrow(/Delimiter must be one of/);
    expect(await bake('a\nb\na\nc\nb', 'unique')).toBe('a\nb\nc');
    expect(await bake('a\nb\na', 'unique', { displayCount: 'Yes' })).toBe('Total number of unique values: 2');
  });

  it('Head and Tail, including negative counts', async () => {
    const t = '1\n2\n3\n4\n5';
    expect(await bake(t, 'head', { number: 2 })).toBe('1\n2');
    expect(await bake(t, 'head', { number: -2 })).toBe('1\n2\n3');
    expect(await bake(t, 'tail', { number: 2 })).toBe('4\n5');
    expect(await bake(t, 'tail', { number: -2 })).toBe('3\n4\n5');
    await expect(bake(t, 'head', { number: 'abc' })).rejects.toThrow(/Number of items must be an integer/);
  });

  it('Remove whitespace and Remove null bytes', async () => {
    expect(await bake(' a b\tc\r\nd\f.e ', 'remove_whitespace')).toBe('abcd.e');
    expect(await bake('a b.c', 'remove_whitespace', { spaces: 'No', fullStops: 'Yes' })).toBe('a bc');
    expect(await bakeHex(new Dish(new Uint8Array([0x41, 0, 0x42, 0, 0, 0x43])), 'remove_null_bytes')).toBe('414243');
    expect(await bakeHex(new Dish(new Uint8Array([0, 0])), 'remove_null_bytes')).toBe('');
  });

  it('Count occurrences', async () => {
    expect(await bake('abababa', 'count_occurrences', { search: 'aba' })).toBe('2');
    expect(await bake('a1b22c333', 'count_occurrences', { search: '\\d+', mode: 'Regex' })).toBe('3');
    await expect(bake('x', 'count_occurrences', { search: '' })).rejects.toThrow(/must not be empty/);
  });

  it('Strings extracts ASCII and UTF-16 runs with offsets', async () => {
    const bytes = new Uint8Array([0, 1, ...new TextEncoder().encode('hello'), 2, 0x61, 0x62, 0, ...new TextEncoder().encode('world!')]);
    expect(await bake(new Dish(bytes), 'strings')).toBe('hello\nworld!');
    expect(await bake(new Dish(bytes), 'strings', { showOffsets: 'Yes', minLength: 6 })).toBe('0x0000000b: world!');
    expect(await bake(new Dish(bytes), 'strings', { displayTotal: 'Yes' })).toMatch(/^Total found: 2/);
    const utf16 = new Uint8Array([0x68, 0, 0x69, 0, 0x21, 0, 0x21, 0, 0xff]);
    expect(await bake(new Dish(utf16), 'strings', { encoding: '16-bit little endian' })).toBe('hi!!');
    expect(await bake(new Dish(utf16.slice(0, 8)), 'strings')).toBe('');
    await expect(bake('x', 'strings', { minLength: 0 })).rejects.toThrow(/Minimum length/);
  });

  it('Swap endianness', async () => {
    expect(await bake('01020304 05060708', 'swap_endianness')).toBe('0403020108070605');
    expect(await bake('0102', 'swap_endianness', { wordLength: 2 })).toBe('0201');
    expect(await bake('010203', 'swap_endianness', { wordLength: 2 })).toBe('020103');
    expect(await bake('010203', 'swap_endianness', { wordLength: 2, padIncomplete: 'Yes' })).toBe('02010003');
    await expect(bake('abc', 'swap_endianness')).rejects.toThrow(/even number/);
    await expect(bake('0102', 'swap_endianness', { wordLength: 0 })).rejects.toThrow(/Word length/);
  });

  it('Reverse by character, byte and line', async () => {
    expect(await bake('abc', 'reverse')).toBe('cba');
    expect(await bake('a\nb\nc', 'reverse', { by: 'Line' })).toBe('c\nb\na');
    expect(await bakeHex(new Dish(new Uint8Array([1, 2, 3])), 'reverse', { by: 'Byte' })).toBe('030201');
    await expect(bake('x', 'reverse', { by: 'Word' })).rejects.toThrow(/Reverse by must be one of/);
  });

  it('Add line numbers', async () => {
    expect(await bake('a\nb', 'add_line_numbers')).toBe('1 a\n2 b');
    expect(await bake(Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'), 'add_line_numbers')).toMatch(/^ 1 l0\n 2 l1/);
    expect(await bake('a\nb', 'add_line_numbers', { offset: 9 })).toBe('10 a\n11 b');
    await expect(bake('x', 'add_line_numbers', { offset: 'zz' })).rejects.toThrow(/Offset/);
  });

  it('Diff by line, word and character', async () => {
    expect(await bake('a\nb\nc\n\na\nx\nc', 'diff')).toBe('  a\n- b\n+ x\n  c');
    expect(await bake('the cat sat\n\nthe dog sat', 'diff', { diffBy: 'Word' })).toBe('the [-cat-]{+dog+} sat');
    expect(await bake('abc\n\nabd', 'diff', { diffBy: 'Character' })).toBe('ab[-c-]{+d+}');
    expect(await bake('a  b\n\na b', 'diff', { diffBy: 'Line', ignoreWhitespace: 'Yes' })).toBe('  a  b');
    await expect(bake('only one sample', 'diff')).rejects.toThrow(/two samples/);
    await expect(bake('a\n\nb', 'diff', { diffBy: 'Paragraph' })).rejects.toThrow(/Difference by/);
  });
});

describe('DAT-6 ciphers', () => {
  it('Caesar, ROT-N, ROT47', async () => {
    expect(await bake('Hello, World!', 'caesar_cipher', { shift: 3 })).toBe('Khoor, Zruog!');
    expect(await bake('Khoor, Zruog!', 'caesar_cipher', { shift: 3, mode: 'Decrypt' })).toBe('Hello, World!');
    expect(await bake('abc', 'caesar_cipher', { shift: -1 })).toBe('zab');
    expect(await bake('Hello', 'rot_n', { amount: 13 })).toBe('Uryyb');
    expect(await bake('abc123', 'rot_n', { amount: 5, digits: 'Yes', letters: 'No' })).toBe('abc678');
    expect(await bake('Hello, World!', 'rot47')).toBe('w6==@[ (@C=5P');
    expect(await bake('w6==@[ (@C=5P', 'rot47')).toBe('Hello, World!');
    await expect(bake('x', 'caesar_cipher', { shift: 'a' })).rejects.toThrow(/Shift must be an integer/);
    await expect(bake('x', 'caesar_cipher', { mode: 'Both' })).rejects.toThrow(/Mode must be one of/);
  });

  it('Vigenere encode / decode', async () => {
    expect(await bake('ATTACKATDAWN', 'vigenere_encode', { key: 'LEMON' })).toBe('LXFOPVEFRNHR');
    expect(await bake('LXFOPVEFRNHR', 'vigenere_decode', { key: 'LEMON' })).toBe('ATTACKATDAWN');
    expect(await bake('Attack at Dawn!', 'vigenere_encode', { key: 'lemon' })).toBe('Lxfopv ef Rnhr!');
    await expect(bake('x', 'vigenere_encode', { key: '123' })).rejects.toThrow(/at least one letter/);
  });

  it('Atbash', async () => {
    expect(await bake('Hello', 'atbash_cipher')).toBe('Svool');
    expect(await bake('Svool, Dliow!', 'atbash_cipher')).toBe('Hello, World!');
  });

  it('Morse code', async () => {
    expect(await bake('SOS', 'to_morse_code')).toBe('... --- ...');
    expect(await bake('hi there', 'to_morse_code')).toBe('.... ..\n- .... . .-. .');
    expect(await bake('A1', 'to_morse_code', { format: '_/.' })).toBe('._ .____');
    expect(await bake('... --- ...', 'from_morse_code')).toBe('SOS');
    expect(await bake('.... ..\n- .... . .-. .', 'from_morse_code')).toBe('HI THERE');
    await expect(bake('~', 'to_morse_code')).rejects.toThrow(/no Morse code/);
    await expect(bake('.-.-.-.-.-', 'from_morse_code')).rejects.toThrow(/Unrecognised Morse/);
    await expect(bake('x', 'to_morse_code', { letterDelimiter: 'Line feed', wordDelimiter: 'Line feed' })).rejects.toThrow(/must differ/);
  });

  it('A1Z26', async () => {
    expect(await bake('Hello', 'a1z26_encode')).toBe('8 5 12 12 15');
    expect(await bake('ab cd', 'a1z26_encode', { delimiter: 'Comma' })).toBe('1,2\n3,4');
    expect(await bake('8 5 12 12 15', 'a1z26_decode')).toBe('HELLO');
    expect(await bake('1,2\n3,4', 'a1z26_decode', { delimiter: 'Comma' })).toBe('AB CD');
    await expect(bake('27', 'a1z26_decode')).rejects.toThrow(/outside the range/);
    await expect(bake('abc', 'a1z26_decode')).rejects.toThrow(/not a number/);
  });
});

describe('DAT-6 encodings', () => {
  it('HTML entities', async () => {
    expect(await bake('<a href="x">Tom & Jerry\'s</a>', 'to_html_entity')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(await bake('é€', 'to_html_entity', { convertAll: 'Yes' })).toBe('&eacute;&euro;');
    expect(await bake('A', 'to_html_entity', { convertAll: 'Yes', format: 'Numeric (hex)' })).toBe('&#x41;');
    expect(await bake('&lt;b&gt; &amp; &#65;&#x42; &eacute; &bogus;', 'from_html_entity')).toBe('<b> & AB é &bogus;');
    expect(await bake('&#1114112; &#xD800;', 'from_html_entity')).toBe('&#1114112; &#xD800;');
    await expect(bake('x', 'to_html_entity', { format: 'Octal' })).rejects.toThrow(/Format must be one of/);
  });

  it('Punycode (RFC 3492)', async () => {
    expect(punycodeEncode('münchen')).toBe('mnchen-3ya');
    expect(punycodeEncode('ü')).toBe('tda');
    expect(punycodeEncode('他们为什么不说中文')).toBe('ihqwcrb4cv8a8dqg056pqjye');
    expect(punycodeDecode('ihqwcrb4cv8a8dqg056pqjye')).toBe('他们为什么不说中文');
    expect(await bake('bücher.example', 'to_punycode')).toBe('xn--bcher-kva.example');
    expect(await bake('xn--bcher-kva.example', 'from_punycode')).toBe('bücher.example');
    expect(await bake('münchen', 'to_punycode', { domain: 'No' })).toBe('mnchen-3ya');
    expect(await bake('mnchen-3ya', 'from_punycode', { domain: 'No' })).toBe('münchen');
    await expect(bake('a-!', 'from_punycode', { domain: 'No' })).rejects.toThrow(/Invalid Punycode/);
  });

  it('Quoted-printable', async () => {
    expect(await bake('a=b é', 'to_quoted_printable')).toBe('a=3Db =C3=A9');
    expect(await bake('trailing \nnext', 'to_quoted_printable')).toBe('trailing=20\nnext');
    const long = await bake('a'.repeat(100), 'to_quoted_printable');
    expect(long).toBe('a'.repeat(75) + '=\n' + 'a'.repeat(25));
    expect(long.split('\n').every((l) => l.length <= 76)).toBe(true);
    expect(await bake('a=3Db =C3=A9', 'from_quoted_printable')).toBe('a=b é');
    expect(await bake(long, 'from_quoted_printable')).toBe('a'.repeat(100));
    expect(await bake('bad =ZZ stays', 'from_quoted_printable')).toBe('bad =ZZ stays');
    const rt = 'Mixed ünïcödé text with = signs and\ttabs  \nlines ' + 'x'.repeat(200);
    expect(await bake(await bake(rt, 'to_quoted_printable'), 'from_quoted_printable')).toBe(rt);
  });

  it('Encode / Decode text charsets', async () => {
    expect(await bakeHex('é€', 'encode_text', { charset: 'UTF-8' })).toBe('c3a9e282ac');
    expect(await bakeHex('hi', 'encode_text', { charset: 'UTF-16LE' })).toBe('68006900');
    expect(await bakeHex('hi', 'encode_text', { charset: 'UTF-16BE' })).toBe('00680069');
    expect(await bakeHex('é', 'encode_text', { charset: 'ISO-8859-1' })).toBe('e9');
    expect(await bakeHex('€', 'encode_text', { charset: 'windows-1252' })).toBe('80');
    expect(await bakeHex('Привет', 'encode_text', { charset: 'windows-1251' })).toBe('cff0e8e2e5f2');
    expect(await bake('€', 'encode_text', { charset: 'windows-1252' })).not.toBe('');
    await expect(bake('€', 'encode_text', { charset: 'ISO-8859-1' })).rejects.toThrow(/cannot be encoded in ISO-8859-1/);
    await expect(bake('é', 'encode_text', { charset: 'US-ASCII' })).rejects.toThrow(/cannot be encoded in US-ASCII/);
    expect(await bakeHex('é', 'encode_text', { charset: 'US-ASCII', onUnmappable: 'Replace with ?' })).toBe('3f');

    const fromHex = (hex, charset, extra = {}) => Chef.bake(hex, [{ op: 'from_hex', args: {} }, { op: 'decode_text', args: { charset, ...extra } }]).then((d) => d.toString());
    expect(await fromHex('c3a9e282ac', 'UTF-8')).toBe('é€');
    expect(await fromHex('68006900', 'UTF-16LE')).toBe('hi');
    expect(await fromHex('e9', 'ISO-8859-1')).toBe('é');
    expect(await fromHex('80', 'ISO-8859-1')).toBe('\u0080');
    expect(await fromHex('80', 'windows-1252')).toBe('€');
    expect(await fromHex('82a0', 'Shift_JIS')).toBe('あ');
    await expect(fromHex('ff', 'UTF-8', { invalid: 'Error' })).rejects.toThrow(/not valid UTF-8/);
    expect(await fromHex('ff', 'UTF-8')).toBe('�');
    await expect(fromHex('41', 'EBCDIC')).rejects.toThrow(/Character set must be one of/);
  });

  it('Base62 and Base45', async () => {
    expect(await bakeChain('3d', 'from_hex', 'to_base62')).toBe('z');
    expect(await bakeChain('0100', 'from_hex', 'to_base62')).toBe('48');
    expect(await bakeChain('00003d', 'from_hex', 'to_base62')).toBe('00z');
    expect(await bakeHex('48', 'from_base62')).toBe('0100');
    const rt = await bake('Hello, Base62 world!', 'to_base62');
    expect(await bake(rt, 'from_base62')).toBe('Hello, Base62 world!');
    await expect(bake('abc!', 'from_base62')).rejects.toThrow(/not in the Base62 alphabet/);
    await expect(bake('abc', 'to_base62', { alphabet: 'abc' })).rejects.toThrow(/exactly 62/);

    expect(await bake('AB', 'to_base45')).toBe('BB8');
    expect(await bake('Hello!!', 'to_base45')).toBe('%69 VD92EX0');
    expect(await bake('base-45', 'to_base45')).toBe('UJCLQE7W581');
    expect(await bake('ietf!', 'to_base45')).toBe('QED8WEX0');
    expect(await bake('QED8WEX0', 'from_base45')).toBe('ietf!');
    expect(await bake('%69 VD92EX0', 'from_base45')).toBe('Hello!!');
    await expect(bake('A', 'from_base45')).rejects.toThrow(/Invalid Base45/);
    await expect(bake('GGW', 'from_base45')).rejects.toThrow(/exceeds 65535/);
    await expect(bake('ab', 'from_base45')).rejects.toThrow(/Invalid Base45 character/);
  });

  it('URL-safe Base64 alphabet option on To/From Base64', async () => {
    const bytes = new Dish(new Uint8Array([0xfb, 0xff, 0xfe]));
    expect((await Chef.bake(bytes, [{ op: 'to_base64', args: {} }])).toString()).toBe('+//+');
    expect((await Chef.bake(bytes, [{ op: 'to_base64', args: { alphabet: 'A-Za-z0-9-_' } }])).toString()).toBe('-__-');
    expect((await Chef.bake(new Dish(new Uint8Array([0xfb])), [{ op: 'to_base64', args: { alphabet: 'A-Za-z0-9-_=' } }])).toString()).toBe('-w==');
    expect((await Chef.bake(new Dish(new Uint8Array([0xfb])), [{ op: 'to_base64', args: { alphabet: 'A-Za-z0-9-_' } }])).toString()).toBe('-w');
    expect(await bakeHex('-__-', 'from_base64', { alphabet: 'A-Za-z0-9-_' })).toBe('fbfffe');
    expect(await bakeHex('-w', 'from_base64', { alphabet: 'A-Za-z0-9-_' })).toBe('fb');
    expect(await bake('SGVsbG8=', 'from_base64')).toBe('Hello');
    expect(await bake('Hello', 'to_base64')).toBe('SGVsbG8=');
    await expect(bake('x', 'to_base64', { alphabet: 'abc' })).rejects.toThrow(/64 characters/);
    await expect(bake('+/+/', 'from_base64', { alphabet: 'A-Za-z0-9-_' })).rejects.toThrow(/not in the Base64 alphabet/);
  });

  it('Defang URL / Fang URL / Defang IP', async () => {
    expect(await bake('Visit http://example.com/path?a=1 now', 'defang_url')).toBe('Visit hxxp[://]example[.]com/path?a=1 now');
    expect(await bake('see evil.example.org and 1.2', 'defang_url')).toBe('see evil[.]example[.]org and 1.2');
    expect(await bake('http://a.io', 'defang_url', { escapeDots: 'No', escapeColon: 'No' })).toBe('hxxp://a.io');
    expect(await bake('https://a.io x.io', 'defang_url', { process: 'Only full URLs' })).toBe('hxxps[://]a[.]io x.io');
    expect(await bake('hxxps[://]a[.]io', 'fang_url')).toBe('https://a.io');
    expect(await bake('10.0.0.1 and 2001:db8::1 at 10:30:15', 'defang_ip')).toBe('10[.]0[.]0[.]1 and 2001[:]db8[:][:]1 at 10:30:15');
    await expect(bake('x', 'defang_url', { process: 'Nothing' })).rejects.toThrow(/Process must be one of/);
  });

  it('JSON <-> CSV and Parse CSV', async () => {
    const json = '[{"name":"Ann","note":"hi, there"},{"name":"Bob","extra":"say \\"x\\"","note":null}]';
    expect(await bake(json, 'json_to_csv')).toBe('name,note,extra\r\nAnn,"hi, there",\r\nBob,,"say ""x"""');
    expect(await bake('[[1,"a b"],[2,"c"]]', 'json_to_csv', { rowDelimiter: '\\n' })).toBe('1,a b\n2,c');
    expect(await bake('{"a":1}', 'json_to_csv')).toBe('a\r\n1');
    expect(await bake('name,note\r\nAnn,"hi, there"\r\nBob,"multi\nline"', 'csv_to_json', { format: 'Array of dictionaries' }))
      .toBe(JSON.stringify([{ name: 'Ann', note: 'hi, there' }, { name: 'Bob', note: 'multi\nline' }], null, 2));
    expect(await bake('a;b\n1;2\n', 'csv_to_json', { cellDelimiter: ';', rowDelimiter: '\\n', format: 'Array of arrays' }))
      .toBe(JSON.stringify([['a', 'b'], ['1', '2']], null, 2));
    expect(parseCsv('x,y\n\n"q""r",z\n', ',', '\r\n')).toEqual([['x', 'y'], ['q"r', 'z']]);
    expect(await bake('id,name\n1,Ann\n22,Bartholomew', 'parse_csv')).toBe('id | name\n1  | Ann\n22 | Bartholomew');
    expect(await bake('a,b\n1', 'parse_csv', { output: 'TSV' })).toBe('a\tb\n1');
    expect(await bake('a,b\n1', 'parse_csv')).toMatch(/1 row\(s\) have a different number of columns/);
    await expect(bake('not json', 'json_to_csv')).rejects.toThrow(/Invalid JSON/);
    await expect(bake('[{"a":1},2]', 'json_to_csv')).rejects.toThrow(/array of objects/);
    await expect(bake('a,"b', 'csv_to_json')).rejects.toThrow(/closing quote/);
    await expect(bake('a', 'csv_to_json', { cellDelimiter: '' })).rejects.toThrow(/Cell delimiter/);
  });

  it('PEM <-> Hex', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nAQID\nBAU=\n-----END CERTIFICATE-----\n';
    expect(await bake(pem, 'pem_to_hex')).toBe('0102030405');
    expect(await bake('-----BEGIN TEST-----\nProc-Type: 4,ENCRYPTED\n\nAQ==\n-----END TEST-----\n-----BEGIN B-----\nAg==\n-----END B-----', 'pem_to_hex')).toBe('01\n02');
    expect(await bake('0102030405', 'hex_to_pem')).toBe('-----BEGIN CERTIFICATE-----\nAQIDBAU=\n-----END CERTIFICATE-----');
    const long = '00'.repeat(100);
    const out = await bake(long, 'hex_to_pem', { label: 'private key' });
    expect(out.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(out.split('\n')[1]).toHaveLength(64);
    expect(await bake(out, 'pem_to_hex')).toBe(long);
    await expect(bake('no pem here', 'pem_to_hex')).rejects.toThrow(/No PEM block/);
    await expect(bake('0102', 'hex_to_pem', { label: 'bad!label' })).rejects.toThrow(/PEM label/);
    await expect(bake('', 'hex_to_pem')).rejects.toThrow(/empty/);
    await expect(bake('0g', 'hex_to_pem')).rejects.toThrow(/hex/i);
  });
});

async function bakeChain(input, ...ops) {
  return (await Chef.bake(input, ops.map((op) => ({ op, args: {} })))).toString();
}

describe('DAT-6 registry integration', () => {
  const textIds = ['find_replace', 'regular_expression', 'to_upper_case', 'to_lower_case', 'sort', 'unique', 'head', 'tail',
    'remove_whitespace', 'remove_null_bytes', 'count_occurrences', 'strings', 'swap_endianness', 'reverse', 'add_line_numbers', 'diff'];
  const encIds = ['caesar_cipher', 'rot_n', 'rot47', 'vigenere_encode', 'vigenere_decode', 'atbash_cipher', 'to_morse_code', 'from_morse_code',
    'a1z26_encode', 'a1z26_decode', 'to_html_entity', 'from_html_entity', 'to_punycode', 'from_punycode', 'to_quoted_printable',
    'from_quoted_printable', 'encode_text', 'decode_text', 'to_base62', 'from_base62', 'to_base45', 'from_base45', 'defang_url',
    'fang_url', 'defang_ip', 'json_to_csv', 'csv_to_json', 'parse_csv', 'pem_to_hex', 'hex_to_pem'];

  it('registers every operation once with a category and search keywords', () => {
    const all = registry.getAll();
    const ids = all.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...textIds, ...encIds]) {
      const op = registry.get(id);
      expect(op, id).toBeTruthy();
      expect(op.module).toBeTruthy();
      expect(op.keywords.length, id).toBeGreaterThan(0);
    }
  });

  it('keeps existing ids stable', () => {
    for (const id of ['to_base64', 'from_base64', 'to_hex', 'from_hex', 'rot13', 'reverse_string', 'xor', 'url_encode', 'fork', 'merge']) {
      expect(registry.get(id), id).toBeTruthy();
    }
  });
});
