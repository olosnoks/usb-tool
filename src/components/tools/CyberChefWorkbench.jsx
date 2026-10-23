import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Binary, 
  Play, 
  Trash2, 
  Plus, 
  ArrowRight, 
  Copy, 
  Check, 
  Download, 
  Upload, 
  RefreshCw, 
  Sliders, 
  FileCode, 
  Sparkles, 
  Layers, 
  ShieldCheck, 
  Terminal, 
  Zap,
  RotateCcw,
  Search,
  Code
} from 'lucide-react';

// ============================================================================
// PURE JAVASCRIPT HASHING & TRANSFORMATION UTILITIES
// ============================================================================

function crc32(str) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

function adler32(str) {
  let a = 1, b = 0;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a).toString(16).padStart(8, '0');
}

async function shaHash(str, algo) {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest(algo, msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple MD5 implementation in pure JS
function md5(string) {
  function rotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX, lY) {
    const lX8 = (lX & 0x80000000);
    const lY8 = (lY & 0x80000000);
    const lX4 = (lX & 0x40000000);
    const lY4 = (lY & 0x40000000);
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    } else return (lResult ^ lX8 ^ lY8);
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return (x ^ y ^ z); }
  function I(x, y, z) { return (y ^ (x | (~z))); }
  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  const utf8 = new TextEncoder().encode(string);
  const nWords = (((utf8.length + 8) >> 6) + 1) * 16;
  const x = new Array(nWords).fill(0);
  for (let i = 0; i < utf8.length; i++) {
    x[i >> 2] |= utf8[i] << ((i % 4) * 8);
  }
  x[utf8.length >> 2] |= 0x80 << ((utf8.length % 4) * 8);
  x[nWords - 2] = utf8.length * 8;

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k + 0], 7, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], 17, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], 12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], 17, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], 7, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], 7, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], 12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], 17, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], 22, 0x49b40821);

    a = GG(a, b, c, d, x[k + 1], 5, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], 9, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], 14, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], 5, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], 9, 0x02441453);
    c = GG(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], 9, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], 14, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

    a = HH(a, b, c, d, x[k + 5], 4, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], 11, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], 4, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], 23, 0xc4ac5665);

    a = II(a, b, c, d, x[k + 0], 6, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], 10, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], 15, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], 6, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], 15, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], 15, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], 6, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], 10, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], 21, 0xeb86d391);

    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }

  function wordToHex(lValue) {
    let wordToHexValue = '', wordToHexValueTemp = '', lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      wordToHexValueTemp = '0' + lByte.toString(16);
      wordToHexValue += wordToHexValueTemp.substr(wordToHexValueTemp.length - 2, 2);
    }
    return wordToHexValue;
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

// ============================================================================
// CYBERCHEF OPERATIONS DEFINITIONS
// ============================================================================

export const CYBERCHEF_OPERATIONS = [
  // --- ENCODING & DECODING ---
  {
    id: 'to_base64',
    name: 'To Base64',
    category: 'En/Decoding',
    desc: 'Encodes raw text or bytes into Base64 format.',
    run: (input) => {
      const bytes = new TextEncoder().encode(input);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
  },
  {
    id: 'from_base64',
    name: 'From Base64',
    category: 'En/Decoding',
    desc: 'Decodes Base64 string into UTF-8 text.',
    run: (input) => {
      const clean = input.trim().replace(/\s+/g, '');
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
  },
  {
    id: 'to_hex',
    name: 'To Hex',
    category: 'En/Decoding',
    desc: 'Converts input text to hexadecimal bytes.',
    args: [{ name: 'delimiter', label: 'Delimiter', type: 'select', options: ['None', 'Space', '0x prefix', 'Comma'], default: 'Space' }],
    run: (input, { delimiter = 'Space' } = {}) => {
      const bytes = new TextEncoder().encode(input);
      const hexes = Array.from(bytes).map(b => b.toString(16).padStart(2, '0'));
      if (delimiter === 'Space') return hexes.join(' ');
      if (delimiter === '0x prefix') return hexes.map(h => `0x${h}`).join(' ');
      if (delimiter === 'Comma') return hexes.join(',');
      return hexes.join('');
    }
  },
  {
    id: 'from_hex',
    name: 'From Hex',
    category: 'En/Decoding',
    desc: 'Converts hexadecimal byte string into UTF-8 text.',
    run: (input) => {
      const clean = input.replace(/0x|\s+|,/gi, '');
      if (clean.length % 2 !== 0) throw new Error('Hex string must have an even number of characters.');
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < clean.length; i += 2) {
        bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
      }
      return new TextDecoder().decode(bytes);
    }
  },
  {
    id: 'url_encode',
    name: 'URL Encode',
    category: 'En/Decoding',
    desc: 'Standard percent-encoding for URI query strings.',
    run: (input) => encodeURIComponent(input)
  },
  {
    id: 'url_decode',
    name: 'URL Decode',
    category: 'En/Decoding',
    desc: 'Decodes percent-encoded URL characters.',
    run: (input) => decodeURIComponent(input)
  },
  {
    id: 'to_binary',
    name: 'To Binary',
    category: 'En/Decoding',
    desc: 'Converts text into 8-bit binary strings (01010001).',
    run: (input) => {
      const bytes = new TextEncoder().encode(input);
      return Array.from(bytes).map(b => b.toString(2).padStart(8, '0')).join(' ');
    }
  },
  {
    id: 'from_binary',
    name: 'From Binary',
    category: 'En/Decoding',
    desc: 'Converts binary representation back to text.',
    run: (input) => {
      const chunks = input.trim().split(/\s+/);
      const bytes = new Uint8Array(chunks.map(c => parseInt(c, 2)));
      return new TextDecoder().decode(bytes);
    }
  },

  // --- HASHING & CHECKSUMS ---
  {
    id: 'md5',
    name: 'MD5 Hash',
    category: 'Hashing',
    desc: 'Computes 128-bit MD5 message digest.',
    run: (input) => md5(input)
  },
  {
    id: 'sha256',
    name: 'SHA-256 Hash',
    category: 'Hashing',
    desc: 'Computes cryptographic 256-bit SHA-2 hash digest.',
    run: async (input) => await shaHash(input, 'SHA-256')
  },
  {
    id: 'sha1',
    name: 'SHA-1 Hash',
    category: 'Hashing',
    desc: 'Computes 160-bit SHA-1 digest.',
    run: async (input) => await shaHash(input, 'SHA-1')
  },
  {
    id: 'crc32',
    name: 'CRC-32 Checksum',
    category: 'Hashing',
    desc: 'Computes 32-bit cyclic redundancy checksum.',
    run: (input) => crc32(input)
  },
  {
    id: 'adler32',
    name: 'Adler-32 Checksum',
    category: 'Hashing',
    desc: 'Computes Adler-32 checksum algorithm.',
    run: (input) => adler32(input)
  },

  // --- CIPHERS & TRANSFORMS ---
  {
    id: 'rot13',
    name: 'ROT13',
    category: 'Ciphers',
    desc: 'Rotates letters by 13 positions.',
    run: (input) => {
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      });
    }
  },
  {
    id: 'xor',
    name: 'XOR',
    category: 'Ciphers',
    desc: 'Performs bitwise XOR with single-byte or repeating text key.',
    args: [{ name: 'key', label: 'Key (hex or text)', type: 'text', default: '5A' }],
    run: (input, { key = '5A' } = {}) => {
      const kBytes = key.length === 2 && /^[0-9a-fA-F]+$/.test(key)
        ? [parseInt(key, 16)]
        : Array.from(new TextEncoder().encode(key || 'X'));
      const inBytes = new TextEncoder().encode(input);
      const out = new Uint8Array(inBytes.length);
      for (let i = 0; i < inBytes.length; i++) {
        out[i] = inBytes[i] ^ kBytes[i % kBytes.length];
      }
      return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }
  },
  {
    id: 'reverse_string',
    name: 'Reverse String',
    category: 'Ciphers',
    desc: 'Reverses the character sequence.',
    run: (input) => input.split('').reverse().join('')
  },

  // --- OBFUSCATION / SECURITY PAYLOAD ANALYSIS ---
  {
    id: 'obfuscate_charcode',
    name: 'JavaScript CharCode Array',
    category: 'Obfuscation',
    desc: 'Converts string into String.fromCharCode(c1, c2, c3...).',
    run: (input) => {
      const codes = Array.from(new TextEncoder().encode(input)).join(',');
      return `String.fromCharCode(${codes})`;
    }
  },
  {
    id: 'obfuscate_hex_escape',
    name: 'Hex Escape Sequence',
    category: 'Obfuscation',
    desc: 'Encodes string as \\x41\\x42 escape codes for C, Python, and JS strings.',
    run: (input) => {
      const bytes = new TextEncoder().encode(input);
      return Array.from(bytes).map(b => `\\x${b.toString(16).padStart(2, '0')}`).join('');
    }
  },
  {
    id: 'obfuscate_unicode_escape',
    name: 'Unicode Escape Sequence',
    category: 'Obfuscation',
    desc: 'Encodes string as \\u0041\\u0042 escape codes.',
    run: (input) => {
      let out = '';
      for (let i = 0; i < input.length; i++) {
        out += '\\u' + input.charCodeAt(i).toString(16).padStart(4, '0');
      }
      return out;
    }
  },
  {
    id: 'obfuscate_powershell',
    name: 'PowerShell String Slicing',
    category: 'Obfuscation',
    desc: 'Splits strings into scrambled format tokens (e.g. "{1}{0}" -f "x","e").',
    run: (input) => {
      if (!input || input.length < 2) return input;
      const chunks = [];
      const chunkSize = Math.max(1, Math.floor(input.length / 4));
      for (let i = 0; i < input.length; i += chunkSize) {
        chunks.push(input.substring(i, i + chunkSize));
      }
      const indices = chunks.map((_, idx) => idx).reverse();
      const formatStr = indices.map(idx => `{${idx}}`).join('');
      const formatArgs = indices.map(idx => `"${chunks[idx]}"`).join(',');
      return `('${formatStr}' -f ${formatArgs})`;
    }
  },
  {
    id: 'ducky_jitter',
    name: 'DuckyScript Micro-Delay Jitter',
    category: 'Obfuscation',
    desc: 'Adds random DELAYs between DuckyScript keystrokes to simulate human typing and evade behavioral keystroke rate-limiters.',
    args: [{ name: 'minDelay', label: 'Min Delay (ms)', type: 'number', default: 20 }, { name: 'maxDelay', label: 'Max Delay (ms)', type: 'number', default: 80 }],
    run: (input, { minDelay = 20, maxDelay = 80 } = {}) => {
      const lines = input.split('\n');
      const outLines = [];
      for (const line of lines) {
        if (line.startsWith('STRING ')) {
          const text = line.substring(7);
          for (let i = 0; i < text.length; i++) {
            outLines.push(`STRING ${text[i]}`);
            const jitter = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            outLines.push(`DELAY ${jitter}`);
          }
        } else {
          outLines.push(line);
        }
      }
      return outLines.join('\n');
    }
  }
];

export default function CyberChefWorkbench() {
  const [inputText, setInputText] = useState('Skon USB Flasher CyberChef Pipeline');
  const [outputText, setOutputText] = useState('');
  const [searchOp, setSearchOp] = useState('');
  const [activeRecipe, setActiveRecipe] = useState([
    { id: 'to_base64', args: {} }
  ]);
  const [isBaking, setIsBaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  // Execute recipe pipeline
  const bake = async () => {
    setIsBaking(true);
    setErrorMsg(null);
    let current = inputText;

    try {
      for (let i = 0; i < activeRecipe.length; i++) {
        const step = activeRecipe[i];
        const op = CYBERCHEF_OPERATIONS.find(o => o.id === step.id);
        if (!op) continue;
        current = await op.run(current, step.args || {});
      }
      setOutputText(current);
    } catch (err) {
      console.error(err);
      setErrorMsg(`Recipe Step Error: ${err.message}`);
    } finally {
      setIsBaking(false);
    }
  };

  useEffect(() => {
    bake();
  }, [inputText, activeRecipe]);

  const addOperation = (opId) => {
    const op = CYBERCHEF_OPERATIONS.find(o => o.id === opId);
    if (!op) return;
    const defaultArgs = {};
    if (op.args) {
      for (const a of op.args) defaultArgs[a.name] = a.default;
    }
    setActiveRecipe(prev => [...prev, { id: opId, args: defaultArgs }]);
  };

  const removeStep = (index) => {
    setActiveRecipe(prev => prev.filter((_, idx) => idx !== index));
  };

  const updateStepArg = (index, argName, val) => {
    setActiveRecipe(prev => prev.map((step, idx) => {
      if (idx !== index) return step;
      return { ...step, args: { ...step.args, [argName]: val } };
    }));
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const swapOutputToInput = () => {
    setInputText(outputText);
  };

  // Grouped operations
  const categories = ['En/Decoding', 'Hashing', 'Ciphers', 'Obfuscation'];
  const filteredOps = useMemo(() => {
    const q = searchOp.toLowerCase();
    return CYBERCHEF_OPERATIONS.filter(o => !q || o.name.toLowerCase().includes(q) || o.desc.toLowerCase().includes(q));
  }, [searchOp]);

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Top Header Card */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>CYBERCHEF & DATA OBFUSCATOR WORKBENCH</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">v2.0 Native</span>
            </h2>
            <p className="text-xs text-slate-400">
              Multi-step data pipeline for encoding, hashing, hex transforms, payload obfuscation, and reverse analysis.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveRecipe([])}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2b303c] rounded-xl text-xs transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Clear Recipe</span>
          </button>
          <button
            onClick={bake}
            disabled={isBaking}
            className="px-4 py-1.5 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-md shadow-cyan-500/20 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBaking ? 'animate-spin' : ''}`} />
            <span>Bake Output</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Layout: Operations Library | Recipe Pipeline | Input & Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Operations Library (3 cols) */}
        <div className="lg:col-span-3 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[750px] overflow-hidden">
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">OPERATIONS</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search operations..."
                value={searchOp}
                onChange={(e) => setSearchOp(e.target.value)}
                className="w-full bg-[#1e212b] border border-[#2b303c] rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition"
              />
            </div>
          </div>

          <div className="overflow-y-auto space-y-4 pr-1 scrollbar-none flex-1">
            {categories.map(cat => {
              const ops = filteredOps.filter(o => o.category === cat);
              if (ops.length === 0) return null;
              return (
                <div key={cat} className="space-y-1.5">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">{cat}</span>
                  <div className="space-y-1">
                    {ops.map(op => (
                      <button
                        key={op.id}
                        onClick={() => addOperation(op.id)}
                        className="w-full text-left p-2 rounded-xl bg-[#1e212b] hover:bg-[#252a37] border border-[#2b303c] hover:border-cyan-500/40 text-xs text-slate-300 transition flex items-center justify-between group"
                      >
                        <div>
                          <span className="font-bold block text-slate-200 group-hover:text-cyan-300 transition">{op.name}</span>
                          <span className="text-[10px] text-slate-500 line-clamp-1">{op.desc}</span>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0 ml-1" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Recipe Pipeline (4 cols) */}
        <div className="lg:col-span-4 bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-3 max-h-[750px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#232733] pb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>RECIPE PIPELINE ({activeRecipe.length})</span>
            </span>
            <span className="text-[10px] text-slate-500">Executes Sequentially</span>
          </div>

          <div className="overflow-y-auto space-y-2 pr-1 scrollbar-none flex-1">
            {activeRecipe.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs">
                No operations in recipe.<br />Click an operation from the left to add.
              </div>
            ) : (
              activeRecipe.map((step, idx) => {
                const op = CYBERCHEF_OPERATIONS.find(o => o.id === step.id);
                if (!op) return null;
                return (
                  <div
                    key={idx}
                    className="p-3 bg-[#1e212b] border border-[#2b303c] rounded-xl space-y-2 relative group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] flex items-center justify-center font-mono">
                          {idx + 1}
                        </span>
                        <span>{op.name}</span>
                      </span>
                      <button
                        onClick={() => removeStep(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition"
                        title="Remove Step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {op.args && op.args.length > 0 && (
                      <div className="pt-1.5 border-t border-[#282d3b] space-y-1.5">
                        {op.args.map(arg => (
                          <div key={arg.name} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-400">{arg.label}:</span>
                            {arg.type === 'select' ? (
                              <select
                                value={step.args?.[arg.name] ?? arg.default}
                                onChange={(e) => updateStepArg(idx, arg.name, e.target.value)}
                                className="bg-[#14161d] border border-[#2b303c] rounded-lg px-2 py-0.5 text-slate-200 text-[11px] focus:outline-none focus:border-cyan-400 font-mono"
                              >
                                {arg.options.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={arg.type}
                                value={step.args?.[arg.name] ?? arg.default}
                                onChange={(e) => updateStepArg(idx, arg.name, e.target.value)}
                                className="bg-[#14161d] border border-[#2b303c] rounded-lg px-2 py-0.5 text-slate-200 text-[11px] w-24 text-right focus:outline-none focus:border-cyan-400 font-mono"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Column 3: Input & Output Areas (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Input Deck */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold uppercase tracking-wider text-[11px]">INPUT DATA</span>
              <span className="text-[10px] font-mono text-slate-500">
                {inputText.length} chars | {new TextEncoder().encode(inputText).length} bytes
              </span>
            </div>
            <textarea
              rows={6}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste or type raw string, hex payload, or script to transform..."
              className="w-full bg-[#12141a] border border-[#282d3a] rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-400 transition resize-y leading-relaxed"
            />
          </div>

          {/* Feedback Button: Send Output -> Input */}
          <div className="flex items-center justify-center">
            <button
              onClick={swapOutputToInput}
              disabled={!outputText}
              className="px-3 py-1.5 bg-[#171920] hover:bg-[#1f232d] text-cyan-400 border border-[#2b303c] rounded-xl text-xs font-mono transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
              title="Replace input with current output for recursive transforms"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Use Output as Input</span>
            </button>
          </div>

          {/* Output Deck */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 flex flex-col space-y-2 flex-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold uppercase tracking-wider text-[11px] text-emerald-400">BAKED OUTPUT</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-500">
                  {outputText.length} chars | {new TextEncoder().encode(outputText).length} bytes
                </span>
                <button
                  onClick={copyOutput}
                  className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 rounded-lg border border-[#2b303c] transition flex items-center gap-1 text-[11px]"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {errorMsg ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
                {errorMsg}
              </div>
            ) : (
              <textarea
                readOnly
                rows={8}
                value={outputText}
                className="w-full bg-[#12141a] border border-[#282d3a] rounded-xl p-3 text-xs text-emerald-300 font-mono focus:outline-none transition resize-y leading-relaxed"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
