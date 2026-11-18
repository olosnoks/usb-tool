/**
 * Generic CRC engine (Rocksoft model) for widths 1..64.
 *
 * Two implementations of the same bit-serial algorithm:
 *  - crcNum: plain Numbers, widths up to 32 (used by the brute-force search, which runs many thousands of times)
 *  - crcBig: BigInt, any width up to 64 (used for the 40/64-bit catalogue entries and cross-checks)
 *
 * Model fields: width, poly, init, refin, refout, xorout (poly/init/xorout are normal, non-reflected form).
 */

const REFL8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let k = 0; k < 8; k++) r |= ((i >> k) & 1) << (7 - k);
  REFL8[i] = r;
}

/** Reverse the low `w` bits of a Number (w <= 32). */
export function reflectNum(x, w) {
  let r = 0;
  for (let i = 0; i < w; i++) r = r * 2 + ((x >>> i) & 1);
  return r;
}

/** Reverse the low `w` bits of a BigInt. */
export function reflectBig(x, w) {
  let r = 0n;
  const W = BigInt(w);
  for (let i = 0n; i < W; i++) r = (r << 1n) | ((x >> i) & 1n);
  return r;
}

/**
 * CRC with Number arithmetic. `p` has Number fields; width must be <= 32.
 * @returns {number} unsigned CRC value
 */
export function crcNum(bytes, p) {
  const w = p.width;
  const mask = w === 32 ? 0xffffffff : 2 ** w - 1;
  const top = w - 1;
  const poly = p.poly;
  let reg = p.init >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = p.refin ? REFL8[bytes[i]] : bytes[i];
    for (let k = 7; k >= 0; k--) {
      const fb = ((reg >>> top) & 1) ^ ((b >>> k) & 1);
      reg = ((reg << 1) & mask) >>> 0;
      if (fb) reg = (reg ^ poly) >>> 0;
    }
  }
  if (p.refout) reg = reflectNum(reg, w);
  return (reg ^ p.xorout) >>> 0;
}

/**
 * CRC with BigInt arithmetic. `m` has BigInt poly/init/xorout; any width up to 64.
 * @returns {bigint}
 */
export function crcBig(bytes, m) {
  const w = m.width;
  const W = BigInt(w);
  const mask = (1n << W) - 1n;
  const top = W - 1n;
  let reg = m.init & mask;
  for (let i = 0; i < bytes.length; i++) {
    const b = m.refin ? REFL8[bytes[i]] : bytes[i];
    for (let k = 7; k >= 0; k--) {
      const fb = ((reg >> top) & 1n) ^ BigInt((b >> k) & 1);
      reg = (reg << 1n) & mask;
      if (fb) reg ^= m.poly;
    }
  }
  if (m.refout) reg = reflectBig(reg, w);
  return (reg ^ m.xorout) & mask;
}

/** Numeric view of a model (width <= 32 only). */
export function numModel(m) {
  return {
    width: m.width,
    poly: Number(m.poly),
    init: Number(m.init),
    refin: !!m.refin,
    refout: !!m.refout,
    xorout: Number(m.xorout),
  };
}

/** BigInt view of a model. */
export function bigModel(m) {
  return {
    width: m.width,
    poly: BigInt(m.poly),
    init: BigInt(m.init),
    refin: !!m.refin,
    refout: !!m.refout,
    xorout: BigInt(m.xorout),
  };
}

/** CRC of `bytes` under any model, returned as a BigInt. */
export function crcOf(bytes, m) {
  if (m.width <= 32) return BigInt(crcNum(bytes, numModel(m)));
  return crcBig(bytes, bigModel(m));
}

/**
 * Residue: CRC of (message + CRC bytes), with the CRC appended LSB-first when refout is set and
 * MSB-first otherwise. Constant for a given model. Only defined for widths that are whole bytes.
 * @returns {bigint|null}
 */
export function residueOf(bytes, m) {
  if (m.width % 8 !== 0) return null;
  const crc = crcOf(bytes, m);
  const nb = m.width / 8;
  const tail = new Uint8Array(nb);
  for (let i = 0; i < nb; i++) {
    const byte = Number((crc >> BigInt(8 * i)) & 0xffn);
    tail[m.refout ? i : nb - 1 - i] = byte;
  }
  const all = new Uint8Array(bytes.length + nb);
  all.set(bytes, 0);
  all.set(tail, bytes.length);
  return crcOf(all, m);
}

/** Hex text of a value, zero-padded to the width in hex digits. */
export function hexOf(value, width) {
  const digits = Math.max(1, Math.ceil(width / 4));
  return BigInt(value).toString(16).padStart(digits, '0');
}
