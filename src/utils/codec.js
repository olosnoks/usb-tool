// Encoding/decoding helpers for the Decoder panel.
// UTF-8 safe. Each function takes a string and returns a string (or throws on
// invalid input, which the UI reports).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64Encode(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64Decode(str) {
  const bin = atob(str.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return dec.decode(bytes);
}

export function urlEncode(str) {
  return encodeURIComponent(str);
}

export function urlDecode(str) {
  return decodeURIComponent(str.replace(/\+/g, ' '));
}

export function hexEncode(str) {
  return Array.from(enc.encode(str)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexDecode(str) {
  const clean = str.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('Hex length must be even');
  const bytes = Uint8Array.from(clean.match(/../g).map((h) => parseInt(h, 16)));
  return dec.decode(bytes);
}

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function htmlEncode(str) {
  return str.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

export function htmlDecode(str) {
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return base64Decode(s);
}

// Decode a JWT into pretty-printed header + payload (signature is not verified).
export function jwtDecode(token) {
  const parts = token.trim().split('.');
  if (parts.length < 2) throw new Error('Not a JWT (expected header.payload.signature)');
  const header = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  const out = { header, payload };
  if (payload.exp) out.expires = new Date(payload.exp * 1000).toISOString();
  if (payload.iat) out.issuedAt = new Date(payload.iat * 1000).toISOString();
  return JSON.stringify(out, null, 2) + '\n\n// Signature is NOT verified.';
}

export const CODECS = [
  { id: 'base64', label: 'Base64', encode: base64Encode, decode: base64Decode },
  { id: 'url', label: 'URL', encode: urlEncode, decode: urlDecode },
  { id: 'hex', label: 'Hex', encode: hexEncode, decode: hexDecode },
  { id: 'html', label: 'HTML', encode: htmlEncode, decode: htmlDecode },
];
