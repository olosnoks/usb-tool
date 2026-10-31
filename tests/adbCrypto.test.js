import { describe, it, expect } from 'vitest';
import { generateAdbKey, signAdbToken, encodeAdbPublicKey, jwkToRsa, _internal } from '../src/utils/adbCrypto';

const { modPow, bytesToBigInt, SHA1_DIGEST_INFO } = _internal;

// Decode Android's android_pubkey blob back into (n, e).
function decodeAndroidPubkey(b64WithName) {
  const b64 = b64WithName.split(' ')[0];
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const dv = new DataView(bytes.buffer);
  const words = dv.getUint32(0, true);
  let n = 0n;
  for (let i = 0; i < words; i++) n |= BigInt(dv.getUint32(8 + i * 4, true)) << BigInt(32 * i);
  const e = dv.getUint32(8 + words * 4 + words * 4, true);
  return { words, n, e, byteLength: bytes.length };
}

describe('ADB RSA auth crypto', () => {
  it('generates a 2048-bit key and encodes the Android public-key blob', async () => {
    const key = await generateAdbKey();
    const blob = encodeAdbPublicKey(key.publicJwk, 'tester@unit');
    expect(blob.endsWith(' tester@unit\u0000')).toBe(true);
    const dec = decodeAndroidPubkey(blob);
    expect(dec.words).toBe(64);
    expect(dec.e).toBe(65537);
    expect(dec.byteLength).toBe(524); // 4 + 4 + 256 + 256 + 4
    // The modulus encoded in the blob must equal the key's real modulus.
    expect(dec.n).toBe(jwkToRsa(key.publicJwk).n);
  });

  it('signs a token so that sig^e mod n is a valid PKCS#1 v1.5 SHA-1 block', async () => {
    const key = await generateAdbKey();
    const token = Uint8Array.from({ length: 20 }, (_, i) => (i * 7 + 3) & 0xff);
    const sig = signAdbToken(key.privateJwk, token);
    expect(sig.length).toBe(256);

    // Verify with the public key by raw RSA, then check the padding by hand.
    const { n, e } = jwkToRsa(key.publicJwk);
    const em = _internal.bigIntToBytes(modPow(bytesToBigInt(sig), e, n), 256);
    expect(em[0]).toBe(0x00);
    expect(em[1]).toBe(0x01);
    let i = 2;
    while (em[i] === 0xff) i++;        // padding string
    expect(em[i]).toBe(0x00); i++;     // separator
    expect(Array.from(em.slice(i, i + 15))).toEqual(SHA1_DIGEST_INFO);
    expect(Array.from(em.slice(i + 15))).toEqual(Array.from(token));
  });

  it('rejects a token that is not 20 bytes', async () => {
    const key = await generateAdbKey();
    expect(() => signAdbToken(key.privateJwk, new Uint8Array(16))).toThrow(/20 bytes/);
  });

  it('round-trips a key through JWK with a stable modulus', async () => {
    const key = await generateAdbKey();
    expect(jwkToRsa(key.publicJwk).n).toBe(jwkToRsa(key.privateJwk).n);
    expect(jwkToRsa(key.publicJwk).e).toBe(65537n);
  });
});
