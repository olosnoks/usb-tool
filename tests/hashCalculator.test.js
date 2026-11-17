import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import HashCalculatorWorkbench from '../src/components/tools/HashCalculatorWorkbench.jsx';
import { createHash, createHmac, getHashes } from 'node:crypto';
import {
  digestHex, hmacHex, decodeKey, computeAll, detectAlgorithms, compareDigest, normalizeDigest,
  formatSums, sumsFileName, crc32, adler32, ntlmHex, toHex,
} from '../src/utils/hashSuite.js';

const enc = new TextEncoder();
const abc = enc.encode('abc');
const empty = new Uint8Array(0);

const VECTORS = {
  'MD5': ['d41d8cd98f00b204e9800998ecf8427e', '900150983cd24fb0d6963f7d28e17f72'],
  'MD4': ['31d6cfe0d16ae931b73c59d7e0c089c0', 'a448017aaf21d8525fc10ae87aa6729d'],
  'SHA-1': ['da39a3ee5e6b4b0d3255bfef95601890afd80709', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
  'SHA-224': ['d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f', '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7'],
  'SHA-256': ['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  'SHA-384': ['38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b', 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'],
  'SHA-512': ['cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e', 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
  'SHA-512/256': ['c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a', '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23'],
  'SHA3-224': ['6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7', 'e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf'],
  'SHA3-256': ['a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
  'SHA3-384': ['0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004', 'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25'],
  'SHA3-512': ['a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26', 'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0'],
  'RIPEMD-160': ['9c1185a5c5e9fc54612808977ee8f548b2258d31', '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc'],
  'CRC-32': ['00000000', '352441c2'],
  'Adler-32': ['00000001', '024d0127'],
};

describe('known vectors', () => {
  for (const [id, [e, a]] of Object.entries(VECTORS)) {
    it(`${id}: "" and "abc"`, async () => {
      expect(await digestHex(id, empty)).toBe(e);
      expect(await digestHex(id, abc)).toBe(a);
    });
  }
  it('NTLM of "password"', () => {
    expect(ntlmHex('password')).toBe('8846f7eaee8fb117ad06bdd830b7586c');
  });
  it('crc32 / adler32 numeric', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(adler32(enc.encode('Wikipedia'))).toBe(0x11e60398);
  });
});

describe('1 MB buffer matches node:crypto', () => {
  const big = new Uint8Array(1_000_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
  const nodeNames = { 'SHA-1': 'sha1', 'SHA-224': 'sha224', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', 'SHA-512/256': 'sha512-256', 'SHA3-224': 'sha3-224', 'SHA3-256': 'sha3-256', 'SHA3-384': 'sha3-384', 'SHA3-512': 'sha3-512', 'RIPEMD-160': 'ripemd160', 'MD5': 'md5' };
  const have = new Set(getHashes());
  for (const [id, n] of Object.entries(nodeNames)) {
    it.skipIf(!have.has(n))(id, async () => {
      expect(await digestHex(id, big)).toBe(createHash(n).update(big).digest('hex'));
    });
  }
  it('known sha256 of 1,000,000 x "a"', async () => {
    expect(await digestHex('SHA-256', new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(await digestHex('SHA3-256', new Uint8Array(1_000_000).fill(0x61))).toBe('5c8875ae474a3634ba4fd55ec85bffd661f32aca75c6d699d0cdcb6c115891c1');
  });
  it('edge lengths around block boundaries', async () => {
    for (const n of [55, 56, 63, 64, 111, 112, 127, 128, 135, 136, 137]) {
      const d = big.subarray(0, n);
      expect(await digestHex('SHA-512/256', d)).toBe(createHash('sha512-256').update(d).digest('hex'));
      expect(await digestHex('SHA3-256', d)).toBe(createHash('sha3-256').update(d).digest('hex'));
    }
  });
});

describe('HMAC', () => {
  const k = (n, b) => new Uint8Array(n).fill(b);
  it('RFC 2202 MD5 and SHA-1', async () => {
    expect(await hmacHex('MD5', k(16, 0x0b), enc.encode('Hi There'))).toBe('9294727a3638bb1c13f48ef8158bfc9d');
    expect(await hmacHex('MD5', enc.encode('Jefe'), enc.encode('what do ya want for nothing?'))).toBe('750c783e6ab0b503eaa86e310a5db738');
    expect(await hmacHex('SHA-1', k(20, 0x0b), enc.encode('Hi There'))).toBe('b617318655057264e28bc0b6fb378c8ef146be00');
    expect(await hmacHex('SHA-1', enc.encode('Jefe'), enc.encode('what do ya want for nothing?'))).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
    // key longer than the block size
    expect(await hmacHex('MD5', k(80, 0xaa), enc.encode('Test Using Larger Than Block-Size Key - Hash Key First'))).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd');
  });
  it('RFC 4231 SHA-2 (cases 1, 2, 6)', async () => {
    const hi = enc.encode('Hi There');
    const jefe = enc.encode('Jefe');
    const what = enc.encode('what do ya want for nothing?');
    expect(await hmacHex('SHA-224', k(20, 0x0b), hi)).toBe('896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22');
    expect(await hmacHex('SHA-256', k(20, 0x0b), hi)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    expect(await hmacHex('SHA-384', k(20, 0x0b), hi)).toBe('afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6');
    expect(await hmacHex('SHA-512', k(20, 0x0b), hi)).toBe('87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854');
    expect(await hmacHex('SHA-256', jefe, what)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(await hmacHex('SHA-512', jefe, what)).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737');
    const big = k(131, 0xaa);
    const msg = enc.encode('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(await hmacHex('SHA-256', big, msg)).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });
  it('new variants agree with node:crypto, including empty key', async () => {
    const msg = enc.encode('The quick brown fox');
    const have = new Set(getHashes());
    const pairs = { 'SHA3-256': 'sha3-256', 'SHA3-512': 'sha3-512', 'SHA-512/256': 'sha512-256', 'SHA-224': 'sha224', 'RIPEMD-160': 'ripemd160', 'SHA3-224': 'sha3-224', 'SHA3-384': 'sha3-384' };
    for (const [id, n] of Object.entries(pairs)) {
      if (!have.has(n)) continue;
      for (const key of [empty, enc.encode('secret'), k(200, 7)]) {
        expect(await hmacHex(id, key, msg)).toBe(createHmac(n, key).update(msg).digest('hex'));
      }
    }
  });
  it('rejects HMAC for non-keyed algorithms', async () => {
    await expect(hmacHex('CRC-32', empty, abc)).rejects.toThrow();
  });
});

describe('key decoding', () => {
  it('text / hex / base64', () => {
    expect(toHex(decodeKey('abc', 'text'))).toBe('616263');
    expect(toHex(decodeKey('0a:ff 10', 'hex'))).toBe('0aff10');
    expect(toHex(decodeKey('YWJj', 'base64'))).toBe('616263');
    expect(toHex(decodeKey('YWJjZA', 'base64'))).toBe('61626364');
  });
  it('reports bad keys', () => {
    expect(() => decodeKey('xyz', 'hex')).toThrow(/hex/);
    expect(() => decodeKey('abc', 'hex')).toThrow(/odd/);
    expect(() => decodeKey('***', 'base64')).toThrow(/base64/);
  });
});

describe('computeAll', () => {
  it('lists MD5 and keeps it in HMAC mode', async () => {
    const plain = await computeAll(abc, { text: 'abc' });
    expect(plain.map((r) => r.label)).toEqual(expect.arrayContaining(['MD5', 'SHA-256', 'SHA3-256', 'CRC-32', 'NTLM']));
    const keyed = await computeAll(abc, { keyBytes: enc.encode('Jefe') });
    expect(keyed.find((r) => r.label === 'HMAC-MD5')).toBeTruthy();
    expect(keyed.find((r) => r.label === 'HMAC-SHA3-256')).toBeTruthy();
    expect(keyed.find((r) => r.label === 'CRC-32')).toBeUndefined();
  });
  it('no NTLM row for files (no text)', async () => {
    const rows = await computeAll(abc);
    expect(rows.find((r) => r.id === 'NTLM')).toBeUndefined();
  });
});

describe('expected digest', () => {
  const sha = VECTORS['SHA-256'][1];
  it('detects by length and normalizes', () => {
    expect(detectAlgorithms(sha)).toEqual(expect.arrayContaining(['SHA-256', 'SHA3-256', 'SHA-512/256']));
    expect(detectAlgorithms('d41d8cd98f00b204e9800998ecf8427e')).toEqual(expect.arrayContaining(['MD5', 'MD4', 'NTLM']));
    expect(detectAlgorithms('zz')).toEqual([]);
    expect(normalizeDigest(` ${sha.toUpperCase().match(/.{1,8}/g).join(' ')} `)).toBe(sha);
  });
  it('matches ignoring case and whitespace', () => {
    expect(compareDigest(sha, sha.toUpperCase())).toBe('match');
    expect(compareDigest(sha, ` ${sha.slice(0, 32)} \n ${sha.slice(32)}`)).toBe('match');
    expect(compareDigest(sha, `${sha.slice(0, 63)}0`)).toBe('mismatch');
    expect(compareDigest(sha, VECTORS.MD5[1])).toBeNull();
    expect(compareDigest(sha, '')).toBeNull();
  });
});

describe('SHA256SUMS', () => {
  it('formats sums lines', () => {
    expect(formatSums([{ name: 'a.bin', value: 'aa' }, { name: 'b dir/c.txt', value: 'bb' }])).toBe('aa  a.bin\nbb  b dir/c.txt\n');
    expect(sumsFileName('SHA-256')).toBe('SHA256SUMS');
    expect(sumsFileName('SHA3-256')).toBe('SHA3256SUMS');
  });
});

describe('component (no jsdom in this repo, so server render only)', () => {
  it('renders the file picker as multiple and the expected-digest box', () => {
    const html = renderToString(React.createElement(HashCalculatorWorkbench, {}));
    expect(html).toContain('multiple');
    expect(html).toContain('Expected digest');
    expect(html).toContain('HMAC mode');
  });
});
