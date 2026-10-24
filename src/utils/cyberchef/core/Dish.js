/**
 * Dish.js
 * Encapsulates data flowing through CyberChef recipes, supporting both UTF-8 strings
 * and raw binary ArrayBuffers with seamless cross-type representations.
 */

export class Dish {
  /**
   * @param {string|ArrayBuffer|Uint8Array|Array<number>|Dish} value
   * @param {'string'|'ArrayBuffer'} [type]
   */
  constructor(value = '', type) {
    if (value instanceof Dish) {
      this._type = type || value._type;
      this._value = value._value;
      return;
    }

    if (value instanceof ArrayBuffer) {
      this._type = 'ArrayBuffer';
      this._value = value;
    } else if (ArrayBuffer.isView(value)) {
      this._type = 'ArrayBuffer';
      this._value = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    } else if (Array.isArray(value)) {
      this._type = 'ArrayBuffer';
      this._value = new Uint8Array(value).buffer;
    } else if (typeof value === 'string') {
      this._type = 'string';
      this._value = value;
    } else if (value === null || value === undefined) {
      this._type = 'string';
      this._value = '';
    } else {
      this._type = 'string';
      this._value = String(value);
    }

    if (type && (type === 'string' || type === 'ArrayBuffer')) {
      this._type = type;
    }
  }

  /**
   * Returns current internal storage type ('string' or 'ArrayBuffer')
   * @returns {'string'|'ArrayBuffer'}
   */
  get type() {
    return this._type;
  }

  /**
   * Returns length in characters (if string) or bytes (if ArrayBuffer)
   * @returns {number}
   */
  get length() {
    if (this._type === 'string') {
      return (this._value || '').length;
    }
    return this._value ? this._value.byteLength : 0;
  }

  /**
   * Underlying raw value
   */
  get value() {
    return this._value;
  }

  /**
   * Convert to UTF-8 decoded string
   * @returns {string}
   */
  toString() {
    if (this._type === 'string') {
      return this._value;
    }
    if (!this._value || this._value.byteLength === 0) {
      return '';
    }
    const uint8 = new Uint8Array(this._value);
    return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
  }

  /**
   * Convert to raw ArrayBuffer
   * @returns {ArrayBuffer}
   */
  toArrayBuffer() {
    if (this._type === 'ArrayBuffer') {
      return this._value;
    }
    const str = this._value || '';
    const uint8 = new TextEncoder().encode(str);
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  }

  /**
   * Returns Uint8Array representation
   * @returns {Uint8Array}
   */
  toUint8Array() {
    if (this._type === 'ArrayBuffer') {
      return new Uint8Array(this._value);
    }
    return new TextEncoder().encode(this._value || '');
  }

  /**
   * Convert data to hexadecimal representation
   * @param {string} [delimiter='']
   * @returns {string}
   */
  toHex(delimiter = '') {
    const uint8 = this.toUint8Array();
    if (uint8.length === 0) return '';
    const hexArr = [];
    for (let i = 0; i < uint8.length; i++) {
      const h = uint8[i].toString(16).padStart(2, '0');
      hexArr.push(delimiter === '0x' ? `0x${h}` : h);
    }
    if (delimiter === '0x') {
      return hexArr.join(' ');
    }
    return hexArr.join(delimiter);
  }

  /**
   * Convert data to Base64 representation
   * @returns {string}
   */
  toBase64() {
    const uint8 = this.toUint8Array();
    if (uint8.length === 0) return '';
    let bin = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, i + chunkSize);
      bin += String.fromCharCode.apply(null, chunk);
    }
    return btoa(bin);
  }

  /**
   * Convert data to canonical 16-bytes-per-line formatted hexdump
   * @param {number} [bytesPerLine=16]
   * @returns {string}
   */
  toHexdump(bytesPerLine = 16) {
    const uint8 = this.toUint8Array();
    if (uint8.length === 0) return '';
    const lines = [];

    for (let i = 0; i < uint8.length; i += bytesPerLine) {
      const offset = i.toString(16).padStart(8, '0');
      const chunk = uint8.subarray(i, Math.min(i + bytesPerLine, uint8.length));

      let hexPart = '';
      let asciiPart = '';

      for (let j = 0; j < bytesPerLine; j++) {
        if (j === 8) hexPart += ' ';
        if (j < chunk.length) {
          hexPart += chunk[j].toString(16).padStart(2, '0') + ' ';
          const b = chunk[j];
          asciiPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        } else {
          hexPart += '   ';
        }
      }

      lines.push(`${offset}  ${hexPart} |${asciiPart}|`);
    }

    return lines.join('\n');
  }

  /**
   * Create a Dish from Base64 string
   * @param {string} b64
   * @returns {Dish}
   */
  static fromBase64(b64) {
    const clean = (b64 || '').trim().replace(/\s+/g, '');
    if (!clean) return new Dish('', 'string');
    const bin = atob(clean);
    const uint8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      uint8[i] = bin.charCodeAt(i);
    }
    return new Dish(uint8.buffer, 'ArrayBuffer');
  }

  /**
   * Create a Dish from Hex string
   * @param {string} hex
   * @returns {Dish}
   */
  /**
   * Create a Dish from Hex string
   * @param {string} hex
   * @returns {Dish}
   */
  static fromHex(hex) {
    const clean = (hex || '').replace(/0x|\s+|,|:/gi, '');
    if (!clean) return new Dish('', 'string');
    if (clean.length % 2 !== 0) {
      throw new Error('Hex string must have an even number of characters.');
    }
    const uint8 = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      uint8[i / 2] = parseInt(clean.substr(i, 2), 16);
    }
    return new Dish(uint8.buffer, 'ArrayBuffer');
  }

  /**
   * Create a Dish from UTF-8 string
   * @param {string} str
   * @returns {Dish}
   */
  static fromString(str) {
    return new Dish(str, 'string');
  }

  /**
   * Create a Dish from byte array or buffer
   * @param {ArrayBuffer|Uint8Array|Array<number>} bytes
   * @returns {Dish}
   */
  static fromBytes(bytes) {
    return new Dish(bytes, 'ArrayBuffer');
  }



  /**
   * Clone this Dish
   * @returns {Dish}
   */
  clone() {
    if (this._type === 'string') {
      return new Dish(this._value, 'string');
    }
    const copyBuf = this._value ? this._value.slice(0) : new ArrayBuffer(0);
    return new Dish(copyBuf, 'ArrayBuffer');
  }
}

export default Dish;
