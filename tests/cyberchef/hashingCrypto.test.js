import { describe, it, expect } from 'vitest';
import nodeCrypto from 'node:crypto';
import { Dish, Chef, registry } from '../../src/utils/cyberchef/core/index.js';
import '../../src/utils/cyberchef/operations/index.js';
import {
  sha512Bytes, sha384Bytes, sha512_256Bytes, sha512_224Bytes, ripemd160, md4, ntlm, crc, CRC_PRESETS,
  blake2s, chacha20, poly1305, hmac
} from '../../src/utils/cyberchef/algorithms.js';
import { bytesToHex, hexToBytes } from '../../src/utils/cyberchef/operations/opHelpers.js';

const bake = async (input, op, args = {}) => (await Chef.bake(input, [{ op, args }])).toString();
const bakeChain = async (input, steps) => (await Chef.bake(input, steps)).toString();
const enc = (s) => new TextEncoder().encode(s);
const hex = (b) => bytesToHex(b);
const ones = (n, v) => new Uint8Array(n).fill(v);

describe('DAT-5 hashing operations', () => {
  it('SHA-2 family matches published vectors', async () => {
    expect(await bake('abc', 'sha512')).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    expect(await bake('', 'sha512')).toBe('cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e');
    expect(await bake('abc', 'sha384')).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    expect(await bake('abc', 'sha224')).toBe('23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7');
    expect(await bake('abc', 'sha512_256')).toBe('53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23');
    expect(await bake('', 'sha512_256')).toBe('c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a');
  });

  it('in-house SHA-512 family matches vectors and node:crypto on multi-block data', () => {
    expect(hex(sha512Bytes(enc('abc')))).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    expect(hex(sha384Bytes(enc('abc')))).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    expect(hex(sha512_224Bytes(enc('abc')))).toBe('4634270f707b6a54daae7530460842e20e37ed265ceee9a43e8924aa');
    const big = new Uint8Array(1000).map((_, i) => (i * 7 + 3) & 0xff);
    expect(hex(sha512Bytes(big))).toBe(nodeCrypto.createHash('sha512').update(big).digest('hex'));
    expect(hex(sha384Bytes(big))).toBe(nodeCrypto.createHash('sha384').update(big).digest('hex'));
    expect(hex(sha512_256Bytes(big))).toBe(nodeCrypto.createHash('sha512-256').update(big).digest('hex'));
  });

  it('RIPEMD-160, MD4 and NTLM match vectors', async () => {
    expect(await bake('', 'ripemd160')).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31');
    expect(await bake('abc', 'ripemd160')).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
    expect(await bake('message digest', 'ripemd160')).toBe('5d0689ef49d2fae572b881b123a85ffa21595f36');
    expect(hex(ripemd160(enc('a'.repeat(1000))))).toBe(hex(ripemd160(enc('a'.repeat(1000)))));
    expect(await bake('', 'md4')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
    expect(await bake('a', 'md4')).toBe('bde52cb31de33e46245e05fbdbd6fb24');
    expect(await bake('abc', 'md4')).toBe('a448017aaf21d8525fc10ae87aa6729d');
    expect(await bake('message digest', 'md4')).toBe('d9130a8164549fe818874806e1c7014b');
    expect(await bake('password', 'ntlm_hash')).toBe('8846F7EAEE8FB117AD06BDD830B7586C');
    expect(await bake('', 'ntlm_hash')).toBe('31D6CFE0D16AE931B73C59D7E0C089C0');
    expect(hex(ntlm('password')).toUpperCase()).toBe('8846F7EAEE8FB117AD06BDD830B7586C');
    expect(hex(md4(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890')))).toBe('e33b4ddc9c38f2199c3e7b164fcc0536');
  });

  it('RIPEMD-160 agrees with node:crypto when the provider has it', () => {
    let ref;
    try { ref = nodeCrypto.createHash('ripemd160').update('x'.repeat(777)).digest('hex'); } catch { return; }
    expect(hex(ripemd160(enc('x'.repeat(777))))).toBe(ref);
  });

  it('HMAC matches RFC 2202 vectors', async () => {
    const hi = 'Hi There';
    const h = (key, keyFormat, hash, msg) => bake(msg, 'hmac', { key, keyFormat, hash });
    expect(await h('0b'.repeat(16), 'Hex', 'MD5', hi)).toBe('9294727a3638bb1c13f48ef8158bfc9d');
    expect(await h('Jefe', 'UTF8', 'MD5', 'what do ya want for nothing?')).toBe('750c783e6ab0b503eaa86e310a5db738');
    expect(await h('0b'.repeat(20), 'Hex', 'SHA-1', hi)).toBe('b617318655057264e28bc0b6fb378c8ef146be00');
    expect(await h('Jefe', 'UTF8', 'SHA-1', 'what do ya want for nothing?')).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
    expect(await h('aa'.repeat(80), 'Hex', 'MD5', 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd');
    expect(await h('0b'.repeat(20), 'Hex', 'RIPEMD-160', hi)).toBe('24cb4bd67d20fc1a5d2ed7732dcc39377f0a5668');
  });

  it('HMAC matches RFC 4231 vectors', async () => {
    const hi = 'Hi There';
    const k = '0b'.repeat(20);
    const h = (key, keyFormat, hash, msg) => bake(msg, 'hmac', { key, keyFormat, hash });
    expect(await h(k, 'Hex', 'SHA-224', hi)).toBe('896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22');
    expect(await h(k, 'Hex', 'SHA-256', hi)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    expect(await h(k, 'Hex', 'SHA-384', hi)).toBe('afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6');
    expect(await h(k, 'Hex', 'SHA-512', hi)).toBe('87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854');
    expect(await h('Jefe', 'UTF8', 'SHA-256', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(await h('Jefe', 'UTF8', 'SHA-512', 'what do ya want for nothing?')).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737');
    expect(await h('aa'.repeat(131), 'Hex', 'SHA-256', 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('HMAC supports Base64 keys, agrees with node:crypto and rejects bad input', async () => {
    const key = ones(37, 0x5a);
    const msg = 'node cross check';
    const ref = nodeCrypto.createHmac('sha512', key).update(msg).digest('hex');
    expect(hex(hmac('SHA-512', key, enc(msg)))).toBe(ref);
    expect(await bake(msg, 'hmac', { key: Buffer.from(key).toString('base64'), keyFormat: 'Base64', hash: 'SHA-512' })).toBe(ref);
    await expect(bake('x', 'hmac', { key: 'zz', keyFormat: 'Hex', hash: 'SHA-256' })).rejects.toThrow(/hex/i);
    await expect(bake('x', 'hmac', { key: 'k', hash: 'WHIRLPOOL' })).rejects.toThrow(/Unsupported HMAC hash/);
  });

  it('CRC presets match their catalogue check values for "123456789"', async () => {
    const data = enc('123456789');
    for (const group of Object.values(CRC_PRESETS)) {
      for (const [name, p] of Object.entries(group)) {
        expect(crc(data, p).toString(16).padStart(Math.ceil(p.width / 4), '0'), name).toBe(p.check);
      }
    }
    expect(await bake('123456789', 'crc8', { variant: 'CRC-8' })).toBe('f4');
    expect(await bake('123456789', 'crc16', { variant: 'CRC-16/MODBUS' })).toBe('4b37');
    expect(await bake('123456789', 'crc64', { variant: 'CRC-64/XZ' })).toBe('995dc9bbdf1939fa');
  });

  it('generic CRC reproduces CRC-32 variants and narrow widths', async () => {
    const run = (a) => bake('123456789', 'crc_custom', a);
    expect(await run({ width: 32, poly: '04C11DB7', init: 'FFFFFFFF', xorout: 'FFFFFFFF', refin: 'Yes', refout: 'Yes' })).toBe('cbf43926');
    expect(await run({ width: 32, poly: '1EDC6F41', init: 'FFFFFFFF', xorout: 'FFFFFFFF', refin: 'Yes', refout: 'Yes' })).toBe('e3069283');
    expect(await run({ width: 32, poly: '04C11DB7', init: 'FFFFFFFF', xorout: 'FFFFFFFF', refin: 'No', refout: 'No' })).toBe('fc891918');
    expect(await run({ width: 32, poly: '04C11DB7', init: 'FFFFFFFF', xorout: '0', refin: 'No', refout: 'No' })).toBe('0376e6e7');
    expect(await run({ width: 5, poly: '05', init: '1F', xorout: '1F', refin: 'Yes', refout: 'Yes' })).toBe('19');
    expect(await run({ width: 7, poly: '09', init: '0', xorout: '0', refin: 'No', refout: 'No' })).toBe('75');
    expect(await run({ width: 4, poly: '3', init: '0', xorout: '0', refin: 'Yes', refout: 'Yes' })).toBe('7');
    expect(await bake('123456789', 'crc32')).toBe('cbf43926');
  });

  it('generic CRC rejects bad arguments with readable errors', async () => {
    await expect(bake('x', 'crc_custom', { width: 99, poly: '1' })).rejects.toThrow(/between 1 and 64/);
    await expect(bake('x', 'crc_custom', { width: 16, poly: 'xyz' })).rejects.toThrow(/hexadecimal/);
    await expect(bake('x', 'crc16', { variant: 'nope' })).rejects.toThrow(/Unknown CRC-16 variant/);
  });

  it('Fletcher-16 and Fletcher-32 match published vectors', async () => {
    expect(await bake('abcde', 'fletcher16')).toBe('c8f0');
    expect(await bake('abcdef', 'fletcher16')).toBe('2057');
    expect(await bake('abcdefgh', 'fletcher16')).toBe('0627');
    expect(await bake('abcde', 'fletcher32')).toBe('f04fc729');
    expect(await bake('abcdef', 'fletcher32')).toBe('56502d2a');
    expect(await bake('abcdefgh', 'fletcher32')).toBe('ebe19591');
  });

  it('BLAKE2s matches RFC 7693 vectors and node:crypto', async () => {
    expect(await bake('abc', 'blake2s')).toBe('508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');
    expect(await bake('', 'blake2s')).toBe('69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9');
    for (const n of [63, 64, 65, 128, 1000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 13 + 1) & 0xff);
      expect(hex(blake2s(data)), `len ${n}`).toBe(nodeCrypto.createHash('blake2s256').update(data).digest('hex'));
    }
    expect(await bake('abc', 'blake2s', { length: '128' })).toHaveLength(32);
  });
});

describe('DAT-5 cryptography operations', () => {
  const nistKey = '2b7e151628aed2a6abf7158809cf4f3c';

  it('AES-GCM matches NIST vectors (test cases 2 and 4)', async () => {
    expect(await bakeChain('00000000000000000000000000000000', [
      { op: 'from_hex', args: {} },
      { op: 'aes_gcm_encrypt', args: { key: '00'.repeat(16), iv: '00'.repeat(12), output: 'Ciphertext only' } }
    ])).toBe('0388dace60b6a392f328c2b971b2fe78');
    expect(await bake('00000000000000000000000000000000', 'aes_gcm_encrypt', {
      key: '00'.repeat(16), iv: '00'.repeat(12), inputFormat: 'Hex'
    })).toBe('0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf');

    const args = {
      key: 'feffe9928665731c6d6a8f9467308308',
      iv: 'cafebabefacedbaddecaf888',
      aad: 'feedfacedeadbeeffeedfacedeadbeefabaddad2',
      aadFormat: 'Hex',
      inputFormat: 'Hex'
    };
    const pt = 'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39';
    const ct = '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091';
    const tag = '5bc94fbc3221a5db94fae95ae7121a47';
    expect(await bake(pt, 'aes_gcm_encrypt', args)).toBe(ct + tag);
    expect(await bake(pt, 'aes_gcm_encrypt', { ...args, output: 'Ciphertext only' })).toBe(ct);
    expect(await bake(pt, 'aes_gcm_encrypt', { ...args, output: 'Tag only' })).toBe(tag);
    const { inputFormat, ...decArgs } = args;
    expect(await bake(ct + tag, 'aes_gcm_decrypt', { ...decArgs, outputFormat: 'Hex' })).toBe(pt);
    expect(await bake(ct, 'aes_gcm_decrypt', { ...decArgs, tag, outputFormat: 'Hex' })).toBe(pt);
  });

  it('AES-GCM reports a clear error for a flipped tag byte, wrong AAD, or wrong key', async () => {
    const base = { key: nistKey, iv: '000102030405060708090a0b', aad: 'header' };
    const sealed = await bake('attack at dawn', 'aes_gcm_encrypt', base);
    expect(await bake(sealed, 'aes_gcm_decrypt', base)).toBe('attack at dawn');
    const flipped = sealed.slice(0, -2) + (sealed.slice(-2) === '00' ? '01' : '00');
    await expect(bake(flipped, 'aes_gcm_decrypt', base)).rejects.toThrow(/authentication failed/);
    await expect(bake(sealed, 'aes_gcm_decrypt', { ...base, aad: 'other' })).rejects.toThrow(/authentication failed/);
    await expect(bake(sealed, 'aes_gcm_decrypt', { ...base, key: '00'.repeat(16) })).rejects.toThrow(/authentication failed/);
    await expect(bake('abcd', 'aes_gcm_decrypt', base)).rejects.toThrow(/shorter than the authentication tag/);
  });

  it('AES-GCM validates arguments', async () => {
    await expect(bake('x', 'aes_gcm_encrypt', { key: '0011', iv: '00' })).rejects.toThrow(/16, 24 or 32 bytes/);
    await expect(bake('x', 'aes_gcm_encrypt', { key: nistKey, iv: '' })).rejects.toThrow(/non-empty IV/);
    await expect(bake('x', 'aes_gcm_encrypt', { key: 'zz', iv: '00' })).rejects.toThrow(/hex/i);
  });

  it('AES-CTR matches NIST SP 800-38A F.5.1 and round-trips', async () => {
    const args = { key: nistKey, iv: 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff', inputFormat: 'Hex' };
    expect(await bake('6bc1bee22e409f96e93d7e117393172a', 'aes_ctr', args)).toBe('874d6191b620e3261bef6864990db6ce');
    expect(await bake('874d6191b620e3261bef6864990db6ce', 'aes_ctr', { ...args, outputFormat: 'Hex' })).toBe('6bc1bee22e409f96e93d7e117393172a');
    await expect(bake('x', 'aes_ctr', { ...args, iv: '00' })).rejects.toThrow(/exactly 16 bytes/);
  });

  it('AES-CBC matches NIST F.2.1 with padding control and validates PKCS7', async () => {
    const args = { key: nistKey, iv: '000102030405060708090a0b0c0d0e0f', inputFormat: 'Hex', padding: 'None (length must be a multiple of 16)' };
    const pt = '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51';
    const ct = '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2';
    expect(await bake(pt, 'aes_cbc_encrypt', args)).toBe(ct);
    expect(await bake(ct, 'aes_cbc_decrypt', { ...args, outputFormat: 'Hex' })).toBe(pt);

    // PKCS7 adds a full block for aligned input; the first two blocks equal the unpadded result.
    const padded = await bake(pt, 'aes_cbc_encrypt', { ...args, padding: 'PKCS7' });
    expect(padded.startsWith(ct)).toBe(true);
    expect(padded).toHaveLength(ct.length + 32);
    expect(await bake(padded, 'aes_cbc_decrypt', { ...args, padding: 'PKCS7', outputFormat: 'Hex' })).toBe(pt);

    // Text round trip, zero padding, and a bad-padding error.
    const text = { key: nistKey, iv: '000102030405060708090a0b0c0d0e0f' };
    const c = await bake('secret message!!!', 'aes_cbc_encrypt', text);
    expect(await bake(c, 'aes_cbc_decrypt', text)).toBe('secret message!!!');
    const z = await bake('short', 'aes_cbc_encrypt', { ...text, padding: 'Zero' });
    expect(await bake(z, 'aes_cbc_decrypt', { ...text, padding: 'Zero' })).toBe('short');
    await expect(bake(ct, 'aes_cbc_decrypt', { ...args, padding: 'PKCS7' })).rejects.toThrow(/Invalid PKCS7 padding/);
    await expect(bake('abc', 'aes_cbc_encrypt', { ...text, padding: 'None (length must be a multiple of 16)' })).rejects.toThrow(/multiple of 16/);
    await expect(bake('abc', 'aes_cbc_encrypt', { ...text, iv: '00' })).rejects.toThrow(/IV must be exactly 16 bytes/);
  });

  const rfcKey = hex(new Uint8Array(32).map((_, i) => i));
  const sunscreen = "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";

  it('ChaCha20 matches RFC 8439 section 2.3.2 and 2.4.2', async () => {
    const block = chacha20(hexToBytes(rfcKey), hexToBytes('000000090000004a00000000'), 1, new Uint8Array(64));
    expect(hex(block.slice(0, 16))).toBe('10f1e7e4d13b5915500fdd1fa32071c4');
    expect(hex(block.slice(48))).toBe('b5129cd1de164eb9cbd083e8a2503c4e');

    const ct = await bake(sunscreen, 'chacha20', { key: rfcKey, nonce: '000000000000004a00000000', counter: 1 });
    expect(ct.startsWith('6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b')).toBe(true);
    expect(ct.endsWith('874d')).toBe(true);
    expect(ct).toBe(hex(new Uint8Array(nodeCrypto.createCipheriv('chacha20',
      Buffer.from(rfcKey, 'hex'), Buffer.from('01000000' + '000000000000004a00000000', 'hex')).update(sunscreen))));
    expect(await bake(ct, 'chacha20', { key: rfcKey, nonce: '000000000000004a00000000', counter: 1, inputFormat: 'Hex', outputFormat: 'Raw' })).toBe(sunscreen);
  });

  it('ChaCha20 supports the 8-byte-nonce layout and validates arguments', async () => {
    // DJB test vector: zero key, zero 8-byte nonce, first keystream bytes.
    const ks = chacha20(new Uint8Array(32), new Uint8Array(8), 0, new Uint8Array(16));
    expect(hex(ks)).toBe('76b8e0ada0f13d90405d6ae55386bd28');
    await expect(bake('x', 'chacha20', { key: '00', nonce: '00'.repeat(12) })).rejects.toThrow(/32 bytes/);
    await expect(bake('x', 'chacha20', { key: rfcKey, nonce: '00' })).rejects.toThrow(/nonce/i);
  });

  it('Poly1305 and ChaCha20-Poly1305 match RFC 8439 vectors', async () => {
    const polyKey = hexToBytes('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b');
    expect(hex(poly1305(polyKey, enc('Cryptographic Forum Research Group')))).toBe('a8061dc1305136c6c22b8baf0c0127a9');

    const args = {
      key: '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
      nonce: '070000004041424344454647',
      aad: '50515253c0c1c2c3c4c5c6c7',
      aadFormat: 'Hex'
    };
    const sealed = await bake(sunscreen, 'chacha20_poly1305_encrypt', args);
    expect(sealed.startsWith('d31a8d34648e60db7b86afbc53ef7ec2')).toBe(true);
    expect(sealed.endsWith('1ae10b594f09e26a7e902ecbd0600691')).toBe(true);
    expect(await bake(sealed, 'chacha20_poly1305_decrypt', args)).toBe(sunscreen);
    expect(await bake(sealed.slice(0, -32), 'chacha20_poly1305_decrypt', { ...args, tag: sealed.slice(-32) })).toBe(sunscreen);

    // Cross-check with node:crypto
    const c = nodeCrypto.createCipheriv('chacha20-poly1305', Buffer.from(args.key, 'hex'), Buffer.from(args.nonce, 'hex'), { authTagLength: 16 });
    c.setAAD(Buffer.from(args.aad, 'hex'));
    const ref = Buffer.concat([c.update(sunscreen), c.final(), c.getAuthTag()]).toString('hex');
    expect(sealed).toBe(ref);

    const flipped = sealed.slice(0, -2) + (sealed.slice(-2) === '00' ? '01' : '00');
    await expect(bake(flipped, 'chacha20_poly1305_decrypt', args)).rejects.toThrow(/authentication failed/);
    await expect(bake(sealed, 'chacha20_poly1305_decrypt', { ...args, aad: '00' })).rejects.toThrow(/authentication failed/);
  });

  it('PBKDF2 matches RFC 6070 (HMAC-SHA1)', async () => {
    const p = (pw, salt, iterations, bits) => bake(pw, 'pbkdf2', { salt, iterations, keySize: bits, hash: 'SHA-1' });
    expect(await p('password', 'salt', 1, 160)).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6');
    expect(await p('password', 'salt', 2, 160)).toBe('ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957');
    expect(await p('password', 'salt', 4096, 160)).toBe('4b007901b765489abead49d926f721d065a429c1');
    expect(await p('passwordPASSWORDpassword', 'saltSALTsaltSALTsaltSALTsaltSALTsalt', 4096, 200)).toBe('3d2eec4fe41c849b80c8d83662c0e44a8b291a964cf2f07038');
  });

  it('PBKDF2 validates arguments and agrees with node:crypto for SHA-256', async () => {
    const ref = nodeCrypto.pbkdf2Sync('hunter2', 'NaCl', 1000, 32, 'sha256').toString('hex');
    expect(await bake('hunter2', 'pbkdf2', { salt: 'NaCl', iterations: 1000, keySize: 256, hash: 'SHA-256' })).toBe(ref);
    await expect(bake('x', 'pbkdf2', { iterations: 0 })).rejects.toThrow(/Iterations/);
    await expect(bake('x', 'pbkdf2', { keySize: 12 })).rejects.toThrow(/multiple of 8/);
    await expect(bake('x', 'pbkdf2', { hash: 'MD5' })).rejects.toThrow(/PBKDF2 hash/);
  });

  it('HKDF matches RFC 5869 vectors', async () => {
    expect(await bake('0b'.repeat(22), 'hkdf', {
      inputFormat: 'Hex', salt: '000102030405060708090a0b0c', info: 'f0f1f2f3f4f5f6f7f8f9', length: 42
    })).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
    expect(await bake('0b'.repeat(22), 'hkdf', { inputFormat: 'Hex', length: 42 }))
      .toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
    await expect(bake('x', 'hkdf', { length: 99999 })).rejects.toThrow(/Output length/);
    await expect(bake('x', 'hkdf', { hash: 'MD5' })).rejects.toThrow(/HKDF hash/);
  });
});

describe('DAT-5 registry integration', () => {
  const newIds = [
    'sha512', 'sha384', 'sha224', 'sha512_256', 'ripemd160', 'md4', 'ntlm_hash', 'hmac', 'crc8', 'crc16', 'crc64',
    'crc_custom', 'fletcher16', 'fletcher32', 'blake2s'
  ];
  const cryptoIds = [
    'aes_gcm_encrypt', 'aes_gcm_decrypt', 'aes_ctr', 'aes_cbc_encrypt', 'aes_cbc_decrypt', 'chacha20',
    'chacha20_poly1305_encrypt', 'chacha20_poly1305_decrypt', 'pbkdf2', 'hkdf'
  ];

  it('registers every new operation under the right category with keywords', () => {
    for (const id of newIds) {
      const op = registry.get(id);
      expect(op, id).toBeTruthy();
      expect(op.module).toBe('Hashing');
      expect(op.keywords.length).toBeGreaterThan(0);
    }
    for (const id of cryptoIds) {
      const op = registry.get(id);
      expect(op, id).toBeTruthy();
      expect(op.module).toBe('Cryptography');
      expect(op.keywords.length).toBeGreaterThan(0);
    }
  });

  it('leaves existing operations untouched', async () => {
    for (const id of ['md5', 'sha1', 'sha256', 'sha3', 'blake2b', 'crc32', 'adler32', 'aes_encrypt', 'aes_decrypt', 'rc4', 'bcrypt', 'scrypt']) {
      expect(registry.get(id), id).toBeTruthy();
    }
    expect(await bake('abc', 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await bake('abc', 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts binary Dish input for hashes (not just UTF-8 text)', async () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 2, 3]);
    const out = (await Chef.bake(new Dish(bytes), [{ op: 'sha512', args: {} }])).toString();
    expect(out).toBe(nodeCrypto.createHash('sha512').update(bytes).digest('hex'));
  });
});
