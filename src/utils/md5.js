// Compact, dependency-free MD5 (RFC 1321) for the hash cracker.
// The Web Crypto API deliberately omits MD5, so we implement it here.
// Returns the lowercase hex digest of a UTF-8 string.

function toUtf8Bytes(str) {
  return new TextEncoder().encode(str);
}

function md5cycle(x, k) {
  let [a, b, c, d] = x;

  const ff = (a, b, c, d, x, s, t) => {
    a = (a + ((b & c) | (~b & d)) + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  };
  const gg = (a, b, c, d, x, s, t) => {
    a = (a + ((b & d) | (c & ~d)) + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  };
  const hh = (a, b, c, d, x, s, t) => {
    a = (a + (b ^ c ^ d) + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  };
  const ii = (a, b, c, d, x, s, t) => {
    a = (a + (c ^ (b | ~d)) + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  };

  a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = (x[0] + a) | 0;
  x[1] = (x[1] + b) | 0;
  x[2] = (x[2] + c) | 0;
  x[3] = (x[3] + d) | 0;
}

function md5blk(bytes, off) {
  const md5blks = new Array(16);
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4;
    md5blks[i] = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
  }
  return md5blks;
}

function md5bytes(bytes) {
  const n = bytes.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= n; i += 64) {
    md5cycle(state, md5blk(bytes, i - 64));
  }
  const rest = bytes.subarray(i - 64);
  const tail = new Uint8Array(64).fill(0);
  tail.set(rest);
  tail[rest.length] = 0x80;
  if (rest.length > 55) {
    md5cycle(state, md5blk(tail, 0));
    tail.fill(0);
  }
  // append bit length (little-endian) in the last 8 bytes
  const bits = n * 8;
  tail[56] = bits & 0xff;
  tail[57] = (bits >>> 8) & 0xff;
  tail[58] = (bits >>> 16) & 0xff;
  tail[59] = (bits >>> 24) & 0xff;
  // high 32 bits (supports lengths beyond 512MB safely enough for this use)
  const hi = Math.floor(n / 0x20000000);
  tail[60] = hi & 0xff;
  tail[61] = (hi >>> 8) & 0xff;
  tail[62] = (hi >>> 16) & 0xff;
  tail[63] = (hi >>> 24) & 0xff;
  md5cycle(state, md5blk(tail, 0));
  return state;
}

function toHex(state) {
  const hexChars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 4; i++) {
    const word = state[i];
    for (let j = 0; j < 4; j++) {
      const byte = (word >>> (j * 8)) & 0xff;
      out += hexChars[(byte >>> 4) & 0x0f] + hexChars[byte & 0x0f];
    }
  }
  return out;
}

export function md5Hex(str) {
  return toHex(md5bytes(toUtf8Bytes(str)));
}
