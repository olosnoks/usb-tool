import {
  PM3_MAGIC_COMMAND,
  PM3_MAGIC_RESPONSE,
  PM3_COMMAND_PREAMBLE_SIZE,
  PM3_RESPONSE_PREAMBLE_SIZE,
  PM3_POSTAMBLE_SIZE,
  PM3_POSTAMBLE_COMMAND,
  PM3_POSTAMBLE_RESPONSE,
  PM3_MIX_ARGS_SIZE,
  PM3_MAX_PAYLOAD_SIZE,
  isValidPm3Magic,
  Pm3Packet
} from './types';

export class Pm3ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Pm3ProtocolError';
  }
}

export class Pm3MagicMismatchError extends Pm3ProtocolError {
  constructor(actualMagic: number) {
    super(
      `Invalid Proxmark frame magic: expected 'PM3a'/'PM3b', ` +
        `received 0x${actualMagic.toString(16).toUpperCase()}`
    );
    this.name = 'Pm3MagicMismatchError';
  }
}

export class Pm3PayloadLengthError extends Pm3ProtocolError {
  constructor(length: number) {
    super(
      `Proxmark payload length ${length} exceeds maximum limit of ${PM3_MAX_PAYLOAD_SIZE} bytes`
    );
    this.name = 'Pm3PayloadLengthError';
  }
}

export class Pm3TruncatedFrameError extends Pm3ProtocolError {
  constructor(expectedBytes: number, actualBytes: number) {
    super(
      `Truncated Proxmark frame: expected at least ${expectedBytes} bytes, received ${actualBytes} bytes`
    );
    this.name = 'Pm3TruncatedFrameError';
  }
}

/**
 * Parameters for building an outgoing Proxmark frame.
 *
 * - NG frame (default when no arg0/arg1/arg2 given): data = payload.
 * - MIX frame (legacy "SendCommandMIX", used by most RF commands on release
 *   firmware): data = arg0,arg1,arg2 as u64 LE followed by payload.
 */
export interface CreatePacketOptions {
  cmd: number;
  /** Force MIX (true) or NG (false) framing. Auto-detected from args when omitted. */
  mix?: boolean;
  magic?: number;
  /** Ignored (kept for API compatibility). */
  flags?: number;
  arg0?: number;
  arg1?: number;
  arg2?: number;
  payload?: Uint8Array | number[];
}

function toBytes(p?: Uint8Array | number[]): Uint8Array {
  return p ? (p instanceof Uint8Array ? p : new Uint8Array(p)) : new Uint8Array(0);
}

/** Serializes a host->device frame (magic 'PM3a'). */
export function packNgFrame(options: CreatePacketOptions): Uint8Array {
  const payloadData = toBytes(options.payload);
  const isMix =
    options.mix ??
    (options.arg0 !== undefined || options.arg1 !== undefined || options.arg2 !== undefined);

  const dataLen = payloadData.byteLength + (isMix ? PM3_MIX_ARGS_SIZE : 0);
  if (dataLen > PM3_MAX_PAYLOAD_SIZE) {
    throw new Pm3PayloadLengthError(dataLen);
  }

  const magic = options.magic ?? PM3_MAGIC_COMMAND;
  const buffer = new Uint8Array(PM3_COMMAND_PREAMBLE_SIZE + dataLen + PM3_POSTAMBLE_SIZE);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, magic, true);
  view.setUint16(4, (dataLen & 0x7fff) | (isMix ? 0 : 0x8000), true);
  view.setUint16(6, options.cmd & 0xffff, true);

  let off = PM3_COMMAND_PREAMBLE_SIZE;
  if (isMix) {
    view.setBigUint64(off, BigInt((options.arg0 ?? 0) >>> 0), true);
    view.setBigUint64(off + 8, BigInt((options.arg1 ?? 0) >>> 0), true);
    view.setBigUint64(off + 16, BigInt((options.arg2 ?? 0) >>> 0), true);
    off += PM3_MIX_ARGS_SIZE;
  }
  buffer.set(payloadData, off);
  view.setUint16(off + payloadData.byteLength, PM3_POSTAMBLE_COMMAND, true);
  return buffer;
}

/**
 * Serializes a device->host frame (magic 'PM3b'). The real device does this;
 * the host uses it for tests / simulated ports.
 */
export function packResponseFrame(options: CreatePacketOptions & { status?: number }): Uint8Array {
  const payloadData = toBytes(options.payload);
  const isMix =
    options.mix ??
    (options.arg0 !== undefined || options.arg1 !== undefined || options.arg2 !== undefined);
  const dataLen = payloadData.byteLength + (isMix ? PM3_MIX_ARGS_SIZE : 0);
  if (dataLen > PM3_MAX_PAYLOAD_SIZE) {
    throw new Pm3PayloadLengthError(dataLen);
  }

  const buffer = new Uint8Array(PM3_RESPONSE_PREAMBLE_SIZE + dataLen + PM3_POSTAMBLE_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, PM3_MAGIC_RESPONSE, true);
  view.setUint16(4, (dataLen & 0x7fff) | (isMix ? 0 : 0x8000), true);
  view.setInt16(6, options.status ?? 0, true);
  view.setUint16(8, options.cmd & 0xffff, true);

  let off = PM3_RESPONSE_PREAMBLE_SIZE;
  if (isMix) {
    view.setBigUint64(off, BigInt((options.arg0 ?? 0) >>> 0), true);
    view.setBigUint64(off + 8, BigInt((options.arg1 ?? 0) >>> 0), true);
    view.setBigUint64(off + 16, BigInt((options.arg2 ?? 0) >>> 0), true);
    off += PM3_MIX_ARGS_SIZE;
  }
  buffer.set(payloadData, off);
  view.setUint16(off + payloadData.byteLength, PM3_POSTAMBLE_RESPONSE, true);
  return buffer;
}

function preambleSizeFor(magic: number): number {
  return magic === PM3_MAGIC_RESPONSE ? PM3_RESPONSE_PREAMBLE_SIZE : PM3_COMMAND_PREAMBLE_SIZE;
}

/**
 * Unpacks and validates one complete frame (either direction).
 * Fail-closed on magic, truncation and length bounds. CRC is not verified
 * (the firmware uses fixed 'a3'/'b3' postambles over USB).
 */
export function unpackNgFrame(data: Uint8Array): Pm3Packet {
  if (data.byteLength < PM3_COMMAND_PREAMBLE_SIZE) {
    throw new Pm3TruncatedFrameError(PM3_COMMAND_PREAMBLE_SIZE, data.byteLength);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0, true);
  if (!isValidPm3Magic(magic)) {
    throw new Pm3MagicMismatchError(magic);
  }

  const preSize = preambleSizeFor(magic);
  if (data.byteLength < preSize) {
    throw new Pm3TruncatedFrameError(preSize, data.byteLength);
  }

  const lenField = view.getUint16(4, true);
  const length = lenField & 0x7fff;
  const ng = (lenField & 0x8000) !== 0;
  if (length > PM3_MAX_PAYLOAD_SIZE) {
    throw new Pm3PayloadLengthError(length);
  }

  let status = 0;
  let cmd: number;
  if (magic === PM3_MAGIC_RESPONSE) {
    status = view.getInt16(6, true);
    cmd = view.getUint16(8, true);
  } else {
    cmd = view.getUint16(6, true);
  }

  const required = preSize + length + PM3_POSTAMBLE_SIZE;
  if (data.byteLength < required) {
    throw new Pm3TruncatedFrameError(required, data.byteLength);
  }

  let arg0 = 0;
  let arg1 = 0;
  let arg2 = 0;
  let dataStart = preSize;
  let payloadLen = length;
  if (!ng) {
    if (length < PM3_MIX_ARGS_SIZE) {
      throw new Pm3TruncatedFrameError(PM3_MIX_ARGS_SIZE, length);
    }
    arg0 = Number(view.getBigUint64(preSize, true) & 0xffffffffn);
    arg1 = Number(view.getBigUint64(preSize + 8, true) & 0xffffffffn);
    arg2 = Number(view.getBigUint64(preSize + 16, true) & 0xffffffffn);
    dataStart += PM3_MIX_ARGS_SIZE;
    payloadLen -= PM3_MIX_ARGS_SIZE;
  }

  return {
    magic,
    cmd,
    length: payloadLen,
    flags: 0,
    arg0,
    arg1,
    arg2,
    status,
    ng,
    payload: data.slice(dataStart, dataStart + payloadLen)
  };
}

/**
 * Returns the total byte length of the frame at the start of `data`, or null
 * if the header is incomplete / magic is wrong / length is out of bounds.
 */
export function peekNgFrameLength(data: Uint8Array): number | null {
  if (data.byteLength < PM3_COMMAND_PREAMBLE_SIZE) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0, true);
  if (!isValidPm3Magic(magic)) {
    return null;
  }
  const length = view.getUint16(4, true) & 0x7fff;
  if (length > PM3_MAX_PAYLOAD_SIZE) {
    return null;
  }
  return preambleSizeFor(magic) + length + PM3_POSTAMBLE_SIZE;
}
