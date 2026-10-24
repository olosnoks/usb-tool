/**
 * Compression Operations
 * Gzip, Gunzip, Raw Deflate, Raw Inflate, Zip, Unzip
 */

import { gzip as gzipFn, ungzip as ungzipFn, deflateRaw as deflateRawFn, inflateRaw as inflateRawFn } from 'pako';
import JSZip from 'jszip';
import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

export class GzipOperation extends Operation {
  constructor() {
    super({
      name: 'Gzip',
      id: 'gzip',
      module: 'Compression',
      description: 'Compresses input data into RFC 1952 Gzip format.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'level', label: 'Compression Level (1-9)', type: 'number', default: 6 }
      ]
    });
  }

  async run(dish, { level = 6 } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    const compressed = gzipFn(bytes, { level: Number(level) || 6 });
    return new Dish(compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), 'ArrayBuffer');
  }
}

export class GunzipOperation extends Operation {
  constructor() {
    super({
      name: 'Gunzip',
      id: 'gunzip',
      module: 'Compression',
      description: 'Decompresses RFC 1952 Gzip-compressed binary, Hex, or Base64 data.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let uint8;

    if (inputDish.type === 'ArrayBuffer') {
      uint8 = inputDish.toUint8Array();
    } else {
      const str = inputDish.toString().trim();
      if (/^[0-9a-fA-F\s]{4,}$/.test(str) && str.length % 2 === 0) {
        try {
          uint8 = Dish.fromHex(str).toUint8Array();
        } catch {
          uint8 = inputDish.toUint8Array();
        }
      } else if (/^[A-Za-z0-9+/=]{4,}$/.test(str.replace(/\s+/g, ''))) {
        try {
          uint8 = Dish.fromBase64(str).toUint8Array();
        } catch {
          uint8 = inputDish.toUint8Array();
        }
      } else {
        uint8 = inputDish.toUint8Array();
      }
    }

    const decompressed = ungzipFn(uint8);
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
      return new Dish(decoded, 'string');
    } catch {
      return new Dish(decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength), 'ArrayBuffer');
    }
  }
}

export class RawDeflateOperation extends Operation {
  constructor() {
    super({
      name: 'Raw Deflate',
      id: 'raw_deflate',
      module: 'Compression',
      description: 'Compresses data using raw DEFLATE algorithm without zlib/gzip headers per RFC 1951.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'level', label: 'Compression Level (1-9)', type: 'number', default: 6 }
      ]
    });
  }

  async run(dish, { level = 6 } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const compressed = deflateRawFn(inputDish.toUint8Array(), { level: Number(level) || 6 });
    return new Dish(compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), 'ArrayBuffer');
  }
}

export class RawInflateOperation extends Operation {
  constructor() {
    super({
      name: 'Raw Inflate',
      id: 'raw_inflate',
      module: 'Compression',
      description: 'Decompresses raw headerless DEFLATE streams per RFC 1951.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const decompressed = inflateRawFn(inputDish.toUint8Array());
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
      return new Dish(text, 'string');
    } catch {
      return new Dish(decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength), 'ArrayBuffer');
    }
  }
}

export class ZipOperation extends Operation {
  constructor() {
    super({
      name: 'Zip',
      id: 'zip',
      module: 'Compression',
      description: 'Creates a standard PKZip (.zip) archive containing the input data.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'filename', label: 'Filename in Archive', type: 'text', default: 'file.txt' }
      ]
    });
  }

  async run(dish, { filename = 'file.txt' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const zip = new JSZip();
    zip.file(filename || 'file.txt', inputDish.toUint8Array());
    const uint8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Dish(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength), 'ArrayBuffer');
  }
}

export class UnzipOperation extends Operation {
  constructor() {
    super({
      name: 'Unzip',
      id: 'unzip',
      module: 'Compression',
      description: 'Decompresses and extracts files from a PKZip (.zip) binary or Base64/Hex stream.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'filename', label: 'File Path to Extract (empty to list all)', type: 'text', default: '' }
      ]
    });
  }

  async run(dish, { filename = '' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let bytes = inputDish.toUint8Array();

    // Check if Base64 or Hex encoded
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      const text = inputDish.toString().trim();
      if (/^[0-9a-fA-F\s]{8,}$/.test(text)) {
        try { bytes = Dish.fromHex(text).toUint8Array(); } catch {}
      } else if (/^[A-Za-z0-9+/=]{8,}$/.test(text.replace(/\s+/g, ''))) {
        try { bytes = Dish.fromBase64(text).toUint8Array(); } catch {}
      }
    }

    const zip = await JSZip.loadAsync(bytes);
    const fileNames = Object.keys(zip.files);
    if (fileNames.length === 0) return new Dish('Empty ZIP Archive', 'string');

    const targetName = (filename || '').trim();
    if (targetName) {
      const targetFile = zip.files[targetName] ||
        zip.files[fileNames.find(n => n.toLowerCase() === targetName.toLowerCase())];
      if (!targetFile) {
        return new Dish(`Error: File '${targetName}' not found in ZIP archive.\nAvailable files:\n${fileNames.join('\n')}`, 'string');
      }
      const data = await targetFile.async('uint8array');
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
        return new Dish(text, 'string');
      } catch {
        return new Dish(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), 'ArrayBuffer');
      }
    }

    const results = [];
    for (const name of fileNames) {
      const file = zip.files[name];
      if (file.dir) continue;
      const text = await file.async('string');
      results.push(`=== File: ${name} (${file._data?.uncompressedSize || text.length} bytes) ===\n${text}`);
    }

    return new Dish(results.join('\n\n'), 'string');
  }
}

export class UntarOperation extends Operation {
  constructor() {
    super({
      name: 'Untar',
      id: 'untar',
      module: 'Compression',
      description: 'Reads POSIX USTAR / GNU TAR archive streams, listing contents or extracting a specific file.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'filename', label: 'File Path to Extract (empty to list all)', type: 'text', default: '' }
      ]
    });
  }

  async run(dish, { filename = '' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let bytes = inputDish.toUint8Array();

    const text = inputDish.toString().trim();
    if (/^[0-9a-fA-F\s]{16,}$/.test(text) && text.replace(/\s+/g, '').length % 2 === 0) {
      try { bytes = Dish.fromHex(text).toUint8Array(); } catch {}
    } else if (/^[A-Za-z0-9+/=]{16,}$/.test(text.replace(/\s+/g, ''))) {
      try { bytes = Dish.fromBase64(text).toUint8Array(); } catch {}
    }

    if (bytes.length < 512) {
      return new Dish('Invalid TAR stream: payload is smaller than minimum 512-byte block.', 'string');
    }

    const entries = [];
    let offset = 0;
    const targetFile = (filename || '').trim();

    while (offset + 512 <= bytes.length) {
      let allZero = true;
      for (let i = 0; i < 512; i++) {
        if (bytes[offset + i] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) break;

      let name = '';
      for (let i = 0; i < 100 && bytes[offset + i] !== 0; i++) {
        name += String.fromCharCode(bytes[offset + i]);
      }

      let prefix = '';
      for (let i = 0; i < 155 && bytes[offset + 345 + i] !== 0; i++) {
        prefix += String.fromCharCode(bytes[offset + 345 + i]);
      }
      if (prefix) name = prefix + '/' + name;

      let sizeStr = '';
      for (let i = 0; i < 12 && bytes[offset + 124 + i] !== 0; i++) {
        const c = String.fromCharCode(bytes[offset + 124 + i]);
        if (c >= '0' && c <= '7') sizeStr += c;
      }
      const fileSize = sizeStr ? parseInt(sizeStr, 8) : 0;
      const typeFlag = String.fromCharCode(bytes[offset + 156]) || '0';
      const isDir = typeFlag === '5' || name.endsWith('/');

      const dataOffset = offset + 512;
      const dataEnd = dataOffset + fileSize;

      if (targetFile && (name === targetFile || name.toLowerCase() === targetFile.toLowerCase())) {
        const extractedData = bytes.slice(dataOffset, Math.min(bytes.length, dataEnd));
        try {
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(extractedData);
          return new Dish(decoded, 'string');
        } catch {
          return new Dish(extractedData.buffer.slice(extractedData.byteOffset, extractedData.byteOffset + extractedData.byteLength), 'ArrayBuffer');
        }
      }

      entries.push({
        path: name,
        size: fileSize,
        isDirectory: isDir,
        typeFlag
      });

      const blocks = Math.ceil(fileSize / 512);
      offset += 512 + blocks * 512;
    }

    if (targetFile) {
      return new Dish(`Error: File '${targetFile}' not found in TAR archive.\nAvailable files:\n${entries.map(e => e.path).join('\n')}`, 'string');
    }

    return new Dish(JSON.stringify(entries, null, 2), 'string');
  }
}

export const compressionOperations = [
  new GzipOperation(),
  new GunzipOperation(),
  new RawDeflateOperation(),
  new RawInflateOperation(),
  new ZipOperation(),
  new UnzipOperation(),
  new UntarOperation()
];
