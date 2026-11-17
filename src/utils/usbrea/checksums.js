// Port of usb_rea/checksums.py: checksum / CRC algorithms usb-rea can recognise (MIT, (c) 2026 Emir Mrkaljevic).
// Self-contained: copied verbatim into generated drivers.

function _rev(v, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (v & 1);
    v >>>= 1;
  }
  return r >>> 0;
}

export function _crc(data, width, poly, init, refin, refout, xorout) {
  const top = 2 ** (width - 1);
  const mask = 2 ** width - 1;
  let crc = init;
  for (let byte of data) {
    if (refin) byte = _rev(byte, 8);
    crc = (crc ^ (byte << (width - 8))) >>> 0;
    for (let i = 0; i < 8; i++) {
      crc = (crc & top) ? ((((crc << 1) ^ poly) >>> 0) & mask) : (((crc << 1) >>> 0) & mask);
    }
  }
  if (refout) crc = _rev(crc, width);
  return (crc ^ xorout) >>> 0;
}

export function _xor(data) {
  let x = 0;
  for (const c of data) x ^= c;
  return x;
}

const _sum = (b) => { let s = 0; for (const c of b) s += c; return s; };

// name -> [width in bytes, function]
export const CHECKSUMS = {
  sum8: [1, (b) => _sum(b) & 0xFF],
  xor8: [1, _xor],
  neg_sum8: [1, (b) => (-_sum(b)) & 0xFF],
  inv_sum8: [1, (b) => (~_sum(b)) & 0xFF],
  crc8: [1, (b) => _crc(b, 8, 0x07, 0x00, false, false, 0x00)],
  crc8_maxim: [1, (b) => _crc(b, 8, 0x31, 0x00, true, true, 0x00)],
  sum16: [2, (b) => _sum(b) & 0xFFFF],
  crc16_ccitt_false: [2, (b) => _crc(b, 16, 0x1021, 0xFFFF, false, false, 0x0000)],
  crc16_xmodem: [2, (b) => _crc(b, 16, 0x1021, 0x0000, false, false, 0x0000)],
  crc16_modbus: [2, (b) => _crc(b, 16, 0x8005, 0xFFFF, true, true, 0x0000)],
  crc16_kermit: [2, (b) => _crc(b, 16, 0x1021, 0x0000, true, true, 0x0000)],
};

/** data: Uint8Array (or array of byte values). */
export function compute(algo, data) {
  return CHECKSUMS[algo][1](Uint8Array.from(data));
}

export function width(algo) {
  return CHECKSUMS[algo][0];
}
