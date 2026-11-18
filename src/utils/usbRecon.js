// Pure helpers for the USB Recon deck (kept out of the component so they can be unit tested).

/** Stable key for an endpoint: direction matters, 0x81 (IN 1) and 0x01 (OUT 1) are different endpoints. */
export function endpointKey(ep) {
  return `${ep.direction}:${ep.endpointNumber}`;
}

/** Endpoint address byte as lsusb prints it: IN has bit 7 set. */
export function endpointAddress(ep) {
  return (ep.endpointNumber & 0x0f) | (ep.direction === 'in' ? 0x80 : 0);
}

export function describeEndpointOption(ep) {
  const addr = endpointAddress(ep).toString(16).padStart(2, '0').toUpperCase();
  return `0x${addr} ${ep.direction.toUpperCase()} ${ep.type} (${ep.packetSize ?? '?'}B)`;
}

/**
 * The DFU runtime/DFU-mode interface: class 0xFE, subclass 0x01 (protocol 1 = runtime, 2 = DFU mode).
 * Looks through every alternate setting. Returns { interfaceNumber, protocol } or null.
 */
export function findDfuInterface(configuration) {
  for (const iface of configuration?.interfaces ?? []) {
    for (const alt of iface.alternates ?? []) {
      if (alt.interfaceClass === 0xfe && alt.interfaceSubclass === 0x01) {
        return { interfaceNumber: iface.interfaceNumber, protocol: alt.interfaceProtocol };
      }
    }
  }
  return null;
}

/** Strict hex payload parse: bytes separated by spaces/commas, optional 0x prefix. Throws a readable error. */
export function parseHexPayload(text) {
  const parts = String(text ?? '').trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) throw new Error('Enter at least one hex byte.');
  return Uint8Array.from(parts.map((p) => {
    const h = p.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Error(`"${p}" is not a full hex byte (two hex digits, e.g. 0A).`);
    return parseInt(h, 16);
  }));
}

/** USB version from WebUSB's major/minor/subminor (minor and subminor are BCD nibbles). */
export function formatUsbVersion(major, minor, subminor = 0) {
  const base = `${major}.${(minor ?? 0).toString(16)}`;
  return subminor ? `${base}.${subminor.toString(16)}` : base;
}

/** Send DFU_DETACH to the DFU interface (class 0xFE / subclass 0x01) only. Throws when the device has none. */
export async function dfuDetach(device, timeoutMs = 1000) {
  const dfu = findDfuInterface(device.configuration);
  if (!dfu) throw new Error('This device has no DFU interface (class 0xFE, subclass 0x01), so DFU_DETACH was not sent.');
  await device.controlTransferOut({
    requestType: 'class', recipient: 'interface', request: 0x00, value: timeoutMs, index: dfu.interfaceNumber
  });
  return dfu;
}

/** OUT transfer to one specific endpoint. Refuses IN endpoints, unclaimed interfaces and malformed hex. */
export async function sendHexToEndpoint(device, ep, interfaceNumber, claimed, text) {
  if (ep.direction !== 'out') throw new Error(`Endpoint ${describeEndpointOption(ep)} is IN; pick an OUT endpoint to send.`);
  if (!claimed.has(interfaceNumber)) throw new Error(`Claim interface #${interfaceNumber} before sending.`);
  const data = parseHexPayload(text);
  await device.transferOut(ep.endpointNumber, data);
  return data;
}

/** One IN read on a specific endpoint, sized to the endpoint's packet size. */
export async function readFromEndpoint(device, ep, interfaceNumber, claimed) {
  if (ep.direction !== 'in') throw new Error(`Endpoint ${describeEndpointOption(ep)} is OUT; pick an IN endpoint to listen.`);
  if (!claimed.has(interfaceNumber)) throw new Error(`Claim interface #${interfaceNumber} before listening.`);
  const result = await device.transferIn(ep.endpointNumber, ep.packetSize || 64);
  return result.data ? new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength) : new Uint8Array(0);
}

/** Release every claimed interface, then close the device. Errors on already-gone devices are ignored. */
export async function releaseDevice(device, claimed) {
  if (!device) return;
  for (const n of claimed) {
    try { await device.releaseInterface(n); } catch { /* already released */ }
  }
  try { await device.close(); } catch { /* already closed */ }
}

const EOL_BYTES = { none: [], cr: [0x0d], lf: [0x0a], crlf: [0x0d, 0x0a] };

/**
 * Build an OUT payload from the text box. mode 'hex' uses parseHexPayload; mode 'ascii' sends the
 * characters as UTF-8 (backslash escapes for n, r, t, 0, backslash and xNN are honoured). eol appends CR / LF / CRLF.
 */
export function buildPayload(text, mode = 'hex', eol = 'none') {
  const suffix = EOL_BYTES[eol];
  if (!suffix) throw new Error(`Unknown line ending "${eol}".`);
  let body;
  if (mode === 'ascii') {
    const raw = String(text ?? '');
    if (!raw.length) throw new Error('Enter some text to send.');
    const out = [];
    const enc = new TextEncoder();
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '\\' && i + 1 < raw.length) {
        const n = raw[i + 1];
        const map = { n: 0x0a, r: 0x0d, t: 0x09, 0: 0x00, '\\': 0x5c };
        if (n in map) { out.push(map[n]); i++; continue; }
        const m = /^x([0-9a-fA-F]{2})/.exec(raw.slice(i + 1, i + 4));
        if (m) { out.push(parseInt(m[1], 16)); i += 3; continue; }
      }
      out.push(...enc.encode(ch.codePointAt(0) > 0xffff ? raw.slice(i, i + 2) : ch));
      if (ch.codePointAt(0) > 0xffff) i++;
    }
    body = out;
  } else if (mode === 'hex') {
    body = Array.from(parseHexPayload(text));
  } else {
    throw new Error(`Unknown payload mode "${mode}".`);
  }
  return Uint8Array.from([...body, ...suffix]);
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function bytesToAscii(bytes) {
  return Array.from(bytes).map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

/** Plain-text export of the inbound packet log (oldest first; the UI keeps newest first). */
export function formatCaptureLog(entries, endpointLabel = '') {
  const lines = [`# USB IN capture${endpointLabel ? ` on ${endpointLabel}` : ''}`, `# ${entries.length} packet(s), ${entries.reduce((n, e) => n + e.len, 0)} byte(s)`];
  for (const e of [...entries].reverse()) lines.push(`[${e.time}] ${e.len}B  ${e.hex}  |${e.ascii}|`);
  return lines.join('\n') + '\n';
}

/** Text report of an interrogated device: identifiers, chip database match and the interface/endpoint map. */
export function buildAutopsyReport(info, interfaces = []) {
  if (!info) return '';
  const hex2 = (n) => (n == null ? '??' : `0x${n.toString(16).padStart(2, '0').toUpperCase()}`);
  const lines = [
    'USB device autopsy (WebUSB, as reported by the browser)',
    `Product:      ${info.productName}`,
    `Manufacturer: ${info.manufacturerName}`,
    `VID:PID:      ${info.vidHex.slice(2)}:${info.pidHex.slice(2)}`,
    `USB version:  ${info.usbVersion}`,
    `Serial:       ${info.serialNumber}`,
    `Device class: ${hex2(info.deviceClass)}/${hex2(info.deviceSubclass)}/${hex2(info.deviceProtocol)}`
  ];
  if (info.intel) {
    lines.push(`Chip match:   ${info.intel.known === false ? 'none in the built-in database' : info.intel.chip}`);
    if (info.intel.known !== false && info.intel.notes) lines.push(`Notes:        ${info.intel.notes}`);
  }
  lines.push('', 'Interfaces (first alternate setting):');
  if (!interfaces.length) lines.push('  (none; the device has no active configuration)');
  for (const i of interfaces) {
    lines.push(`  #${i.interfaceNumber}  class ${hex2(i.interfaceClass)}/${hex2(i.interfaceSubclass)}/${hex2(i.interfaceProtocol)}  ${i.interfaceName}`);
    for (const ep of i.endpoints) lines.push(`      ${describeEndpointOption(ep)}`);
  }
  return lines.join('\n') + '\n';
}

/** Total bytes across packet entries. */
export function totalBytes(entries) {
  return entries.reduce((n, e) => n + e.len, 0);
}
