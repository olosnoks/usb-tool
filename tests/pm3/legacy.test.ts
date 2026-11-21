import { describe, it, expect } from 'vitest';
import {
  PM3_COMMANDS,
  PM3_LEGACY_COMMANDS,
  PM3_LEGACY_FRAME_SIZE,
  Pm3RingBuffer,
  packLegacyFrame,
  unpackLegacyFrame,
  looksLikeLegacyReply,
  legacyDebugText,
  packNgFrame,
  packResponseFrame,
  decodeChipId,
  parseIso14aSelect,
  parseIso14aReply,
  parseLegacyTuning,
  parseNgTuning,
  demodEm410x,
  decodeEm410x
} from '../../src/protocols/pm3';
import {
  ProxmarkDevice,
  parseLegacyVersion,
  parseVersionPayload,
  evaluateCompatibility,
  runProxmarkOp
} from '../../src/devices/proxmark';

const text = (s: string) => new TextEncoder().encode(s);
const debugFrame = (s: string) =>
  packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_DEBUG_PRINT_STRING, arg0: s.length, payload: text(s) });

// What a 2016 Proxmark3 Easy (AT91SAM7S512, factory firmware) really answers.
const EASY_CHIP_ID = 0x270b0a4f;
const EASY_VERSION_LINES = [
  'Prox/RFID mark3 RFID instrument',
  'bootrom: /-suspect 2016-11-09 00:59:56',
  'os: /-suspect 2016-11-14 03:06:26',
  'HF FPGA image built on 2015/03/09 at 08:41:42\n',
  '  Modify by Willok(willok@163.com)\n\n'
];

/** 125 kHz capture of an EM410x tag: Manchester, `clock` samples per bit, around mid-scale. */
function em410xCapture(idHex: string, clock = 64, total = 30000, lead = 37): Uint8Array {
  const frame = (decodeEm410x(idHex) as { frameBits: string }).frameBits;
  const out = new Uint8Array(total);
  let seed = 12345;
  for (let i = 0; i < total; i++) {
    const pos = i + lead;
    const bit = frame.charCodeAt(Math.floor(pos / clock) % 64) - 48;
    const firstHalf = pos % clock < clock / 2;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const noise = ((seed >>> 16) % 5) - 2;
    out[i] = 128 + ((bit === 1) === firstHalf ? 20 : -20) + noise;
  }
  return out;
}

describe('legacy (pre-NG) Proxmark3 framing', () => {
  it('round-trips a 544-byte frame', () => {
    const frame = packLegacyFrame({ cmd: 0x0385, arg0: 1, arg1: 0x1234, arg2: 0xdeadbeef, payload: [1, 2, 3] });
    expect(frame.byteLength).toBe(PM3_LEGACY_FRAME_SIZE);
    const packet = unpackLegacyFrame(frame);
    expect(packet.cmd).toBe(0x0385);
    expect([packet.arg0, packet.arg1, packet.arg2]).toEqual([1, 0x1234, 0xdeadbeef]);
    expect(Array.from(packet.payload.subarray(0, 4))).toEqual([1, 2, 3, 0]);
    expect(packet.ng).toBe(false);
  });

  it('recognises the "unknown command" answer to an NG frame, and nothing else', () => {
    expect(looksLikeLegacyReply(debugFrame('unknown command:: 0x61334d50'))).toBe(true);
    expect(looksLikeLegacyReply(debugFrame('unknown command:: 0x61334d50').subarray(0, 300))).toBe(false);
    expect(looksLikeLegacyReply(new Uint8Array(PM3_LEGACY_FRAME_SIZE))).toBe(false);
    const ng = new Uint8Array(PM3_LEGACY_FRAME_SIZE);
    ng.set(packResponseFrame({ cmd: PM3_COMMANDS.CMD_VERSION, payload: text('Iceman') }));
    expect(looksLikeLegacyReply(ng)).toBe(false);
  });

  it('ring buffer in legacy mode cuts fixed frames out of arbitrary chunks', () => {
    const ring = new Pm3RingBuffer();
    ring.mode = 'legacy';
    const stream = new Uint8Array(PM3_LEGACY_FRAME_SIZE * 2);
    stream.set(debugFrame('os: test'), 0);
    stream.set(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: 7 }), PM3_LEGACY_FRAME_SIZE);
    ring.append(stream.subarray(0, 100));
    expect(ring.nextPacket()).toBeNull();
    ring.append(stream.subarray(100, 900));
    const first = ring.nextPacket()!;
    expect(legacyDebugText(first)).toBe('os: test');
    expect(ring.nextPacket()).toBeNull();
    ring.append(stream.subarray(900));
    expect(ring.nextPacket()!.arg0).toBe(7);
  });
});

describe('Proxmark3 reply decoders', () => {
  it('decodes the SAM7S chip ID', () => {
    expect(decodeChipId(EASY_CHIP_ID)).toEqual({ chipId: EASY_CHIP_ID, chipName: 'AT91SAM7S512', flashKb: 512 });
    expect(decodeChipId(0x270b0940).chipName).toBe('AT91SAM7S256');
    expect(decodeChipId(0x12345678).chipName).toMatch(/Unknown MCU/);
  });

  it('identifies a legacy Proxmark3 Easy from its version reply', () => {
    const identity = parseLegacyVersion(EASY_VERSION_LINES, EASY_CHIP_ID);
    expect(identity.protocol).toBe('legacy');
    expect(identity.hardwareTarget).toBe('PM3');
    expect(identity.chipName).toBe('AT91SAM7S512');
    expect(identity.flashKb).toBe(512);
    expect(identity.osVersion).toBe('/-suspect 2016-11-14 03:06:26');
    expect(identity.bootromVersion).toBe('/-suspect 2016-11-09 00:59:56');
    expect(identity.buildDate).toBe('2016-11-14 03:06:26');
    expect(identity.gitHash).toBe('unknown');
    expect(identity.isClean).toBe(false);
    // Reads and diagnostics allowed, writes behind the override.
    expect(evaluateCompatibility(identity)).toBe('compatible');
  });

  it('parses the NG version structure (chip id, section size, string length, string)', () => {
    const str = text(' [ ARM ]\n  Bootrom.... Iceman/master/v4.20728 2025-09-01 10:00:00 abcdef123\n  OS......... Iceman/master/v4.20728 2025-09-01 10:00:05 abcdef123\n\0');
    const payload = new Uint8Array(12 + str.length + 4);
    const view = new DataView(payload.buffer);
    view.setUint32(0, EASY_CHIP_ID, true);
    view.setUint32(4, 300000, true);
    view.setUint32(8, str.length, true);
    payload.set(str, 12);
    view.setUint32(12 + str.length, 512 * 1024, true);
    const identity = parseVersionPayload(payload);
    expect(identity.protocol).toBe('ng');
    expect(identity.chipName).toBe('AT91SAM7S512');
    expect(identity.hardwareTarget).toBe('PM3');
    expect(identity.osVersion).toMatch(/^Iceman\/master\/v4\.20728/);
    expect(evaluateCompatibility(identity)).not.toBe('unsupported');
  });

  it('parses a 14443A card select (MIFARE Classic 1K, 4-byte UID)', () => {
    const data = new Uint8Array(512);
    data.set([0xde, 0xad, 0xbe, 0xef], 0);
    data[10] = 4; // uidlen
    data.set([0x04, 0x00], 11); // ATQA as received, low byte first
    data[13] = 0x08; // SAK
    const card = parseIso14aSelect(2, data);
    expect(card).toMatchObject({ found: true, uid: 'DEADBEEF', atqa: '0004', sak: '08', ats: '' });
    expect(card.cardType).toBe('MIFARE Classic 1K');
    expect(parseIso14aSelect(0, data).found).toBe(false);
  });

  it('parses both NG and legacy/MIX forms of the 14443A reply', () => {
    const select = new Uint8Array(271);
    select.set([0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 0);
    select[10] = 7;
    select.set([0x44, 0x03], 11);
    select[13] = 0x20;
    select[14] = 3;
    select.set([0x06, 0x75, 0x77], 15);

    const ngPayload = new Uint8Array(4 + select.length);
    new DataView(ngPayload.buffer).setUint16(0, select.length, true);
    ngPayload[2] = 1; // select status
    ngPayload.set(select, 4);
    const ng = parseIso14aReply({
      magic: 0, cmd: 0x0385, length: ngPayload.length, flags: 0, arg0: 0, arg1: 0, arg2: 0, status: 0, ng: true,
      payload: ngPayload
    });
    expect(ng).toMatchObject({ found: true, uid: '04112233445566', atqa: '0344', sak: '20', ats: '067577' });

    const legacy = parseIso14aReply(
      unpackLegacyFrame(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: 1, arg1: 7, payload: select }))
    );
    expect(legacy.uid).toBe('04112233445566');
    expect(legacy.ats).toBe('067577');
  });

  it('parses legacy antenna tuning exactly as the device reported it', () => {
    // Captured from the Proxmark3 Easy: arg0/arg1/arg2 of CMD_MEASURED_ANTENNA_TUNING.
    const packet = unpackLegacyFrame(
      packLegacyFrame({ cmd: 0x0410, arg0: 0x40745d75, arg1: 0x8dc, arg2: 0x67a90063 })
    );
    const tuning = parseLegacyTuning(packet);
    expect(tuning.lf125mV).toBe(23925);
    expect(tuning.lf134mV).toBe(16500);
    expect(tuning.hfmV).toBe(2268);
    expect(tuning.peakmV).toBe(26537);
    expect(tuning.peakKhz).toBe(120);
    expect(tuning.sweep.byteLength).toBe(256);
  });

  it('parses NG antenna tuning', () => {
    const payload = new Uint8Array(28 + 256);
    const view = new DataView(payload.buffer);
    [16000, 24000, 24000, 9000, 26000, 99].forEach((v, i) => view.setUint32(i * 4, v, true));
    const tuning = parseNgTuning({
      magic: 0, cmd: 0x0400, length: payload.length, flags: 0, arg0: 0, arg1: 0, arg2: 0, status: 0, ng: true, payload
    });
    expect(tuning).toMatchObject({ lf134mV: 16000, lf125mV: 24000, hfmV: 9000, peakmV: 26000, peakKhz: 120 });
  });
});

describe('EM410x demodulation from raw 125 kHz samples', () => {
  it('recovers the tag ID at RF/64 and RF/32', () => {
    expect(demodEm410x(em410xCapture('0F0368568B'))).toMatchObject({ idHex: '0F0368568B', clock: 64 });
    expect(demodEm410x(em410xCapture('1A2B3C4D5E', 32, 30000, 5))).toMatchObject({ idHex: '1A2B3C4D5E', clock: 32 });
    expect(demodEm410x(em410xCapture('0000000001'))!.idHex).toBe('0000000001');
  });

  it('finds nothing in an idle antenna or in noise', () => {
    const idle = new Uint8Array(30000).fill(0x80);
    for (let i = 0; i < idle.length; i += 3) idle[i] = 0x7f;
    expect(demodEm410x(idle)).toBeNull();

    const noise = new Uint8Array(30000);
    let seed = 99;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      noise[i] = 100 + ((seed >>> 16) % 56);
    }
    expect(demodEm410x(noise)).toBeNull();
  });
});

describe('ProxmarkDevice with a simulated legacy-firmware port', () => {
  /** Answers like the 2016 Easy firmware: one USB write is one command. */
  function createLegacyPort(capture: Uint8Array) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const sent: number[] = [];
    const send = (frame: Uint8Array) => controller.enqueue(frame);
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const cmd = view.getUint32(0, true);
        sent.push(cmd);
        if (cmd === PM3_LEGACY_COMMANDS.CMD_VERSION) {
          EASY_VERSION_LINES.forEach((l) => send(debugFrame(l)));
          send(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: EASY_CHIP_ID }));
        } else if (cmd === PM3_LEGACY_COMMANDS.CMD_MEASURE_ANTENNA_TUNING) {
          send(packLegacyFrame({ cmd: 0x0410, arg0: 0x40745d75, arg1: 0x8dc, arg2: 0x67a90063 }));
        } else if (cmd === PM3_LEGACY_COMMANDS.CMD_READER_ISO_14443a) {
          send(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: 0 }));
        } else if (cmd === PM3_LEGACY_COMMANDS.CMD_ACQUIRE_RAW_ADC_SAMPLES_125K) {
          send(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: capture.length * 8 }));
        } else if (cmd === PM3_LEGACY_COMMANDS.CMD_DOWNLOAD_RAW_ADC_SAMPLES_125K) {
          const total = view.getUint32(16, true);
          for (let offset = 0; offset < total; offset += 512) {
            const len = Math.min(512, total - offset);
            send(packLegacyFrame({
              cmd: PM3_LEGACY_COMMANDS.CMD_DOWNLOADED_RAW_ADC_SAMPLES_125K,
              arg0: offset, arg1: len, payload: capture.subarray(offset, offset + len)
            }));
          }
          send(packLegacyFrame({ cmd: PM3_LEGACY_COMMANDS.CMD_ACK, arg0: 1 }));
        } else {
          // NG frames and unimplemented opcodes all land here
          send(debugFrame(`unknown command:: 0x${cmd.toString(16).padStart(4, '0')}`));
        }
      }
    });
    const port: any = {
      readable: null,
      writable: null,
      open: async () => { port.readable = readable; port.writable = writable; },
      close: async () => { port.readable = null; port.writable = null; }
    };
    return { port, sent };
  }

  it('detects legacy firmware on connect and identifies the board', async () => {
    const { port, sent } = createLegacyPort(new Uint8Array(0));
    const device = new ProxmarkDevice();
    const identity = await device.connect(port);

    expect(device.protocol).toBe('legacy');
    expect(identity.protocol).toBe('legacy');
    expect(identity.chipName).toBe('AT91SAM7S512');
    expect(identity.osVersion).toContain('2016-11-14');
    expect(device.state).toBe('readyCompatible');
    expect(device.canExecute('read')).toBe(true);
    expect(device.canExecute('write')).toBe(false);
    // NG version probe (magic 'PM3a'), then the legacy version request
    expect(sent).toEqual([0x61334d50, PM3_LEGACY_COMMANDS.CMD_VERSION]);

    await device.disconnect('test done');
    expect(device.protocol).toBe('ng');
  });

  it('runs tune, 14a reader and EM410x read, and reports unimplemented commands', async () => {
    const { port } = createLegacyPort(em410xCapture('0F0368568B'));
    const device = new ProxmarkDevice();
    await device.connect(port);

    const tune = await runProxmarkOp(device, 'tune');
    expect(tune.rows[0]).toEqual(['LF antenna @ 125.00 kHz', '23.93 V (ok)']);
    expect(tune.rows[3]).toEqual(['HF antenna @ 13.56 MHz', '2.27 V (marginal)']);

    const card = await runProxmarkOp(device, 'hf14aReader');
    expect(card.ok).toBe(false);
    expect(card.note).toMatch(/No ISO 14443A card/);

    const tag = await runProxmarkOp(device, 'lfEm410x');
    expect(tag.ok).toBe(true);
    expect(tag.rows[0]).toEqual(['Tag ID', '0F0368568B']);

    await expect(device.executeCommand({ cmd: PM3_COMMANDS.CMD_PING })).rejects.toThrow(
      /does not implement command 0x0109/
    );

    await device.disconnect('test done');
  });

  it('still treats a silent device as unknown and locked', async () => {
    const port: any = {
      readable: null,
      writable: null,
      open: async () => {
        port.readable = new ReadableStream({ pull() {} });
        port.writable = new WritableStream({ write() {} });
      },
      close: async () => { port.readable = null; port.writable = null; }
    };
    const device = new ProxmarkDevice();
    const identity = await device.connect(port);
    expect(identity.hardwareTarget).toBe('UNKNOWN');
    expect(device.state).toBe('lockedUnsupported');
    expect(device.canExecute('diagnostic')).toBe(false);
    await device.disconnect('test done');
  }, 10000);

  it('keeps speaking NG to NG firmware', async () => {
    const device = new ProxmarkDevice();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const port: any = {
      readable: null,
      writable: null,
      open: async () => {
        port.readable = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
        port.writable = new WritableStream<Uint8Array>({
          write() {
            controller.enqueue(packNgFrame({ cmd: PM3_COMMANDS.CMD_VERSION, payload: text('os: v4 commit: b4a8e21 target: RDV4') }));
          }
        });
      },
      close: async () => { port.readable = null; port.writable = null; }
    };
    const identity = await device.connect(port);
    expect(device.protocol).toBe('ng');
    expect(identity.hardwareTarget).toBe('PM3RDV4');
    expect(device.state).toBe('readyMatched');
    await device.disconnect('test done');
  });
});
