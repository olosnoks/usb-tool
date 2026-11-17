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
