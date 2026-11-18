// Pure helpers for the DFU Flasher: .dfu container export, firmware sanity checks,
// erase-plan summary and dfu-util command export. No WebUSB access here.
import { dfuCrc32, planDfuseErase } from './dfuDriver';

const hex = (n) => '0x' + (n >>> 0).toString(16);

/** 16-byte DFU 1.1 suffix (signature bytes 'U','F','D'); CRC covers everything before the CRC field. */
export function appendDfuSuffix(body, { vid = 0xffff, pid = 0xffff, bcdDevice = 0xffff, bcdDFU = 0x011a } = {}) {
  const out = new Uint8Array(body.length + 16);
  out.set(body, 0);
  const dv = new DataView(out.buffer);
  const b = body.length;
  dv.setUint16(b, bcdDevice, true);
  dv.setUint16(b + 2, pid, true);
  dv.setUint16(b + 4, vid, true);
  dv.setUint16(b + 6, bcdDFU, true);
  out[b + 8] = 0x55;
  out[b + 9] = 0x46;
  out[b + 10] = 0x44;
  out[b + 11] = 16;
  dv.setUint32(b + 12, dfuCrc32(out.subarray(0, out.length - 4)), true);
  return out;
}

/**
 * Build a DfuSe container (.dfu) with ONE target and the given elements
 * ([{ address, data: Uint8Array }]). Returns the file with a DFU suffix appended.
 */
export function buildDfuSeFile(elements, { alternate = 0, targetName = 'ST...', vid, pid } = {}) {
  if (!elements?.length) throw new Error('No data to pack.');
  let targetSize = 0;
  for (const e of elements) {
    if (!Number.isInteger(e.address) || e.address < 0 || e.address > 0xffffffff) {
      throw new Error('Invalid element address.');
    }
    targetSize += 8 + e.data.length;
  }
  const imageSize = 11 + 274 + targetSize;
  const out = new Uint8Array(imageSize);
  const dv = new DataView(out.buffer);
  out.set([0x44, 0x66, 0x75, 0x53, 0x65], 0); // "DfuSe"
  out[5] = 1; // format version
  dv.setUint32(6, imageSize, true);
  out[10] = 1; // one target
  let off = 11;
  out.set([0x54, 0x61, 0x72, 0x67, 0x65, 0x74], off); // "Target"
  out[off + 6] = alternate;
  dv.setUint32(off + 7, targetName ? 1 : 0, true);
  if (targetName) out.set(new TextEncoder().encode(targetName).subarray(0, 254), off + 11);
  dv.setUint32(off + 266, targetSize, true);
  dv.setUint32(off + 270, elements.length, true);
  off += 274;
  for (const e of elements) {
    dv.setUint32(off, e.address >>> 0, true);
    dv.setUint32(off + 4, e.data.length, true);
    out.set(e.data, off + 8);
    off += 8 + e.data.length;
  }
  return appendDfuSuffix(out, { vid, pid, bcdDFU: 0x011a });
}

/**
 * Sanity-check a raw Cortex-M image: word 0 = initial stack pointer, word 1 = reset vector.
 * Heuristic only. Returns { applicable, ok, findings: [{ level, msg }] }.
 */
export function inspectCortexMImage(data, address, region = null) {
  if (!data || data.length < 8) {
    return { applicable: false, ok: true, findings: [{ level: 'info', msg: 'Image is shorter than a vector table.' }] };
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sp = dv.getUint32(0, true);
  const reset = dv.getUint32(4, true);
  const spRam =
    (sp >= 0x10000000 && sp <= 0x10100000) || (sp >= 0x20000000 && sp <= 0x30080000) || (sp >= 0x24000000 && sp < 0x24100000);
  if (!spRam || (reset & 1) !== 1) {
    return {
      applicable: false,
      ok: true,
      findings: [{ level: 'info', msg: `No Cortex-M vector table recognised (SP ${hex(sp)}, reset ${hex(reset)}); checks skipped.` }]
    };
  }
  const findings = [{ level: 'info', msg: `Cortex-M vector table: SP ${hex(sp)}, reset ${hex(reset & ~1)}.` }];
  const entry = reset & ~1;
  const end = address + data.length;
  if (entry < address || entry >= end) {
    findings.push({
      level: 'warn',
      msg: `Reset vector ${hex(entry)} is outside the image range ${hex(address)}-${hex(end - 1)}; it may be linked for a different address.`
    });
  }
  if (region && (entry < region.start || entry >= region.end)) {
    findings.push({
      level: 'warn',
      msg: `Reset vector ${hex(entry)} is outside the selected memory ${hex(region.start)}-${hex(region.end - 1)}.`
    });
  }
  return { applicable: true, ok: !findings.some((f) => f.level === 'warn'), findings };
}

/** Summarise the sectors a flash would erase: { sectors, bytes } or { error }. */
export function summarizeErasePlan(layout, address, length) {
  try {
    const sectors = planDfuseErase(layout, address, length);
    return { sectors: sectors.length, bytes: sectors.reduce((a, s) => a + s.size, 0) };
  } catch (err) {
    return { error: err.message };
  }
}

/** dfu-util command line equivalent (an export for the CLI tool; this app does not run it). */
export function buildDfuUtilCommand({ vid, pid, alt = 0, address, fileName, leave = true, dfuse = false, upload = false, length } = {}) {
  const parts = ['dfu-util'];
  if (Number.isInteger(vid) && Number.isInteger(pid)) {
    parts.push('-d', `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`);
  }
  parts.push('-a', String(alt));
  parts.push(upload ? '-U' : '-D', `"${fileName || (upload ? 'read.bin' : 'firmware.bin')}"`);
  if (dfuse && Number.isInteger(address)) {
    let spec = hex(address);
    if (upload && length > 0) spec += ':' + length;
    else if (!upload && leave) spec += ':leave';
    parts.push('-s', spec);
  }
  return parts.join(' ');
}
