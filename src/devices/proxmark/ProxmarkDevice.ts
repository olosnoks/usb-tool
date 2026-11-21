import { claimForTool, releasePort, closeSerialPort } from '../../utils/portManager';
import {
  PM3_COMMANDS,
  UART_USB_CLIENT_RX_TIMEOUT_MS,
  getCommandRisk,
  packNgFrame,
  Pm3Packet,
  Pm3RingBuffer,
  CreatePacketOptions,
  ISO14A,
  PM3_LEGACY_COMMANDS,
  PM3_LEGACY_FRAME_SIZE,
  packLegacyFrame,
  looksLikeLegacyReply,
  legacyDebugText,
  Iso14aCard,
  AntennaTuning,
  parseIso14aReply,
  parseLegacyTuning,
  parseNgTuning,
  demodEm410x,
  signalSwing
} from '../../protocols/pm3';
import {
  ProxmarkState,
  DeviceFirmwareIdentity,
  ProxmarkEventMap,
  ProxmarkEventListener
} from './types';
import { parseVersionPayload, parseLegacyVersion } from './version';
import {
  evaluateCompatibility,
  assertCanExecute,
  canExecute
} from './compatibility';

export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

interface PendingCommand {
  expectedCmd: number;
  resolve: (packet: Pm3Packet) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Sees every reply first; returning true consumes it and keeps waiting (multi-frame replies). */
  intermediate?: (packet: Pm3Packet) => boolean;
}

export interface LfEm410xRead {
  found: boolean;
  /** 5-byte tag ID as 10 hex digits. */
  cardId?: string;
  /** Samples per bit of the tag (64 = RF/64). */
  clock?: number;
  /** Peak-to-peak modulation seen on the antenna, in ADC counts (0..255). */
  swing: number;
  sampleCount: number;
}

const LEGACY_UNKNOWN_COMMAND = /^unknown command:: 0x([0-9a-f]+)/i;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ProxmarkDevice {
  private _state: ProxmarkState = 'disconnected';
  private _identity: DeviceFirmwareIdentity | null = null;
  private _allowRiskOverrides: boolean = false;

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;
  private portOwner: { name: string; release: () => Promise<void> } | null = null;
  private ringBuffer: Pm3RingBuffer;
  private isReading: boolean = false;

  private pendingCommands: PendingCommand[] = [];
  private _protocol: 'ng' | 'legacy' = 'ng';
  /** Raw bytes seen while the NG version request is outstanding, to spot legacy firmware. */
  private legacyProbe: { chunks: Uint8Array[]; size: number; detected: () => void } | null = null;
  private debugTap: ((message: string) => void) | null = null;
  /** How this NG firmware wants its 14443A reader request framed, once known. */
  private hf14aFraming: 'ng' | 'mix' | null = null;
  private listeners: Map<keyof ProxmarkEventMap, Set<Function>> = new Map();

  constructor() {
    this.ringBuffer = new Pm3RingBuffer();
  }

  // State Getters
  public get state(): ProxmarkState {
    return this._state;
  }

  public get identity(): DeviceFirmwareIdentity | null {
    return this._identity;
  }

  /** Wire protocol in use: NG (Iceman firmware) or the legacy 544-byte frames. */
  public get protocol(): 'ng' | 'legacy' {
    return this._protocol;
  }

  public get allowRiskOverrides(): boolean {
    return this._allowRiskOverrides;
  }

  public set allowRiskOverrides(allow: boolean) {
    this._allowRiskOverrides = allow;
  }

  public get isConnected(): boolean {
    return (
      this._state === 'readyMatched' ||
      this._state === 'readyCompatible' ||
      this._state === 'lockedUnsupported' ||
      this._state === 'bootloader'
    );
  }

  public get compatibilityLevel() {
    if (!this._identity) return 'unsupported';
    return evaluateCompatibility(this._identity);
  }

  /**
   * Evaluates if a given command risk level is authorized under the active device state.
   */
  public canExecute(cmdOrRisk: number | 'diagnostic' | 'read' | 'write' | 'magic' | 'raw'): boolean {
    if (!this.isConnected && this._state !== 'interrogating') {
      return false;
    }
    const risk = typeof cmdOrRisk === 'number' ? getCommandRisk(cmdOrRisk) : cmdOrRisk;
    return canExecute(risk, {
      compatibilityLevel: this.compatibilityLevel,
      allowRiskOverrides: this._allowRiskOverrides
    });
  }

  // Event Subscription
  public on<K extends keyof ProxmarkEventMap>(event: K, listener: ProxmarkEventListener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  public off<K extends keyof ProxmarkEventMap>(event: K, listener: ProxmarkEventListener<K>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit<K extends keyof ProxmarkEventMap>(event: K, payload: ProxmarkEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(payload);
        } catch (e) {
          console.error(`Error in ProxmarkDevice listener for event "${String(event)}":`, e);
        }
      });
    }
  }

  private setState(to: ProxmarkState, reason?: string): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    this.emit('stateChanged', { from, to, reason });
  }

  /**
   * Connects to a Proxmark device over Web Serial and performs identity handshake.
   */
  public async connect(
    customPort?: SerialPortLike,
    baudRate: number = 115200,
    unfiltered: boolean = false
  ): Promise<DeviceFirmwareIdentity> {
    if (this.isConnected) {
      throw new Error('Device is already connected');
    }

    let portToOpen: SerialPortLike;

    if (customPort) {
      portToOpen = customPort;
    } else {
      if (typeof navigator === 'undefined' || !('serial' in navigator)) {
        throw new Error(
          'Web Serial API is not supported in this browser. Please use a Chromium-based browser (Chrome, Edge).'
        );
      }
      try {
        if (unfiltered) {
          portToOpen = await (navigator as any).serial.requestPort();
        } else {
          portToOpen = await (navigator as any).serial.requestPort({
            filters: [
              { usbVendorId: 0x9ac4 }, // Proxmark3 RDV4 / Generic / Easy
              { usbVendorId: 0x2d2d }, // Proxmark3 on older / factory firmware (proxmark.org ID)
              { usbVendorId: 0x1d50 }, // Openmoko Proxmark3
              { usbVendorId: 0x1a86 }, // CH340 clones
              { usbVendorId: 0x10c4 }, // CP2102 clones
              { usbVendorId: 0x0403 }  // FTDI clones
            ]
          });
        }
      } catch (err: any) {
        if (err.name === 'NotFoundError') {
          // If filtered device was not selected, offer unfiltered picker
          try {
            portToOpen = await (navigator as any).serial.requestPort();
          } catch (e2: any) {
            this.setState('error', e2.message);
            throw e2;
          }
        } else {
          this.setState('error', err.message);
          throw err;
        }
      }
    }

    // One owner per device: asks before taking the port from another tool.
    if (!this.portOwner) this.portOwner = { name: 'Proxmark3 Suite', release: () => this.disconnect('Taken over by another tool') };
    try {
      await claimForTool(portToOpen, this.portOwner);
    } catch (err: any) {
      this.setState('error', err.message);
      throw err;
    }

    this.port = portToOpen;
    this.ringBuffer.clear();
    this.setState('connecting');

    try {
      await this.port.open({ baudRate, bufferSize: 64 * 1024 });

      // Assert DTR and RTS so hardware knows serial host is active
      if ((this.port as any).setSignals) {
        try {
          await (this.port as any).setSignals({ dataTerminalReady: true, requestToSend: true });
        } catch {
          // Ignore if unsupported by driver
        }
      }

      if (!this.port.readable || !this.port.writable) {
        throw new Error('Port opened successfully but readable/writable streams are missing.');
      }

      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();

      // Start continuous stream reception (kept so disconnect can wait for it)
      this.readLoop = this.startReadLoop();

      // Perform Handshake Interrogation
      this.setState('interrogating');
      let identity: DeviceFirmwareIdentity;
      try {
        identity = await this.interrogateDevice();
      } catch {
        // No answer to the binary version request (CLI-only firmware, a
        // different device, or a busy port). Report that honestly: an UNKNOWN
        // target is rated 'unsupported', so nothing (e.g. the flasher) acts on
        // a guessed hardware profile.
        identity = {
          rawVersionString: 'No answer to the version request (not a Proxmark3, or firmware without the NG protocol)',
          gitHash: 'unknown',
          isClean: false,
          hardwareTarget: 'UNKNOWN',
          buildDate: ''
        };
      }
      this._identity = identity;

      const level = evaluateCompatibility(identity);
      this.emit('compatibilityResolved', { level, identity });

      this.setState(
        level === 'matched' ? 'readyMatched' : level === 'compatible' ? 'readyCompatible' : 'lockedUnsupported'
      );
      return identity;
    } catch (err: any) {
      await this.disconnect(err.message);
      this.setState('error', err.message);
      throw err;
    }
  }

  /**
   * Sends an identity interrogation packet (CMD_VERSION) and parses the response.
   */
  private async interrogateDevice(): Promise<DeviceFirmwareIdentity> {
    // Legacy firmware answers an NG frame with a 544-byte "unknown command"
    // debug frame. Watch the raw bytes for that while the NG request is out.
    const legacySeen = new Promise<'legacy'>((resolve) => {
      this.legacyProbe = { chunks: [], size: 0, detected: () => resolve('legacy') };
    });
    const ngReply = this.dispatchRaw({ cmd: PM3_COMMANDS.CMD_VERSION }, UART_USB_CLIENT_RX_TIMEOUT_MS);
    ngReply.catch(() => {});

    let first: Pm3Packet | 'legacy';
    try {
      first = await Promise.race([ngReply, legacySeen]);
    } finally {
      this.legacyProbe = null;
    }
    if (first !== 'legacy') {
      return parseVersionPayload(first.payload);
    }

    // Drop the NG request and switch the stream to legacy framing.
    for (const pending of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Superseded by the legacy protocol handshake'));
    }
    this.pendingCommands = [];
    await sleep(60);
    this._protocol = 'legacy';
    this.ringBuffer.mode = 'legacy';
    this.ringBuffer.clear();
    return this.interrogateLegacy();
  }

  /**
   * Legacy CMD_VERSION: older builds print "bootrom: ..." / "os: ..." debug
   * strings and then ACK with the chip ID; later ones put the text in the ACK.
   */
  private async interrogateLegacy(): Promise<DeviceFirmwareIdentity> {
    const lines: string[] = [];
    this.debugTap = (message) => lines.push(message);
    let ack: Pm3Packet;
    try {
      ack = await this.dispatchRaw({ cmd: PM3_LEGACY_COMMANDS.CMD_VERSION }, UART_USB_CLIENT_RX_TIMEOUT_MS);
    } finally {
      this.debugTap = null;
    }
    if (lines.length === 0) {
      const end = ack.payload.indexOf(0);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(
        ack.payload.subarray(0, end === -1 ? ack.payload.byteLength : end)
      );
      lines.push(...text.split('\n'));
    }
    return parseLegacyVersion(lines, ack.arg0);
  }

  /**
   * Transmits raw ASCII command text (e.g. "hw tune\r\n", "hf search\r\n") over Web Serial
   */
  public async sendRawText(text: string): Promise<void> {
    if (!this.writer) {
      throw new Error('Device stream writer is unavailable.');
    }
    const encoder = new TextEncoder();
    const formatted = text.endsWith('\r') || text.endsWith('\n') ? text : `${text}\r\n`;
    await this.writer.write(encoder.encode(formatted));
    this.emit('debugPrint', { message: `[CLI TX] ${text.trim()}`, timestamp: Date.now() });
  }

  /**
   * Polls for an ISO 14443A (13.56 MHz) card: anticollision + select, then the
   * field is dropped again. Returns UID, ATQA, SAK and (for 14443-4 cards) ATS.
   */
  public async searchHf14a(timeoutMs: number = 2500): Promise<Iso14aCard & { rawPacket: Pm3Packet }> {
    const cmd = PM3_COMMANDS.CMD_HF_ISO14443A_READER;
    const done = (packet: Pm3Packet) => ({ ...parseIso14aReply(packet), rawPacket: packet });

    // Legacy and older NG firmware: flags in arg0, card struct back in CMD_ACK.
    const viaArgs = () => this.executeCommand({ cmd, arg0: ISO14A.CONNECT, arg1: 0, arg2: 0 }, timeoutMs);
    if (this._protocol === 'legacy' || this.hf14aFraming === 'mix') {
      return done(await viaArgs());
    }

    // Current NG firmware: iso14a_raw_cmd_t { u32 flags, u32 timeout, u32 wait_us, u16 len, u16 lenbits }.
    const request = new Uint8Array(16);
    new DataView(request.buffer).setUint32(0, ISO14A.CONNECT, true);
    try {
      const packet = await this.executeCommand({ cmd, mix: false, payload: request }, timeoutMs);
      this.hf14aFraming = 'ng';
      return done(packet);
    } catch (err: any) {
      if (this.hf14aFraming === 'ng' || !/^Timeout/.test(err?.message ?? '')) throw err;
    }
    // No answer to the NG form: firmware from before that change, which takes args.
    const packet = await viaArgs();
    this.hf14aFraming = 'mix';
    return done(packet);
  }

  /**
   * Captures the 125 kHz antenna signal and looks for an EM410x tag in it.
   * Legacy firmware only: sample with `lf read`, download the buffer, demodulate here.
   */
  public async readLfEm410x(): Promise<LfEm410xRead> {
    if (this._protocol !== 'legacy') {
      throw new Error('LF reads are only implemented for legacy (pre-NG) firmware so far.');
    }

    const acquired = await this.executeCommand(
      { cmd: PM3_LEGACY_COMMANDS.CMD_ACQUIRE_RAW_ADC_SAMPLES_125K, arg0: 1 },
      6000
    );
    // arg0 = bits captured (8 per sample); the default buffer is 30000 samples.
    const sampleCount = Math.min(40000, acquired.arg0 >= 8 ? Math.floor(acquired.arg0 / 8) : 30000);

    const samples = new Uint8Array(sampleCount);
    await this.executeCommand(
      { cmd: PM3_LEGACY_COMMANDS.CMD_DOWNLOAD_RAW_ADC_SAMPLES_125K, arg0: 0, arg1: sampleCount },
      15000,
      (packet) => {
        if (packet.cmd !== PM3_LEGACY_COMMANDS.CMD_DOWNLOADED_RAW_ADC_SAMPLES_125K) return false;
        const offset = packet.arg0;
        const length = Math.min(packet.arg1, packet.payload.byteLength, sampleCount - offset);
        if (length > 0) samples.set(packet.payload.subarray(0, length), offset);
        return true;
      }
    );

    const tag = demodEm410x(samples);
    return tag
      ? { found: true, cardId: tag.idHex, clock: tag.clock, swing: tag.swing, sampleCount }
      : { found: false, swing: signalSwing(samples), sampleCount };
  }

  /**
   * Measures the antenna voltages (`hw tune`): LF at 125 and 134 kHz, the LF
   * peak, and HF at 13.56 MHz. Takes several seconds.
   */
  public async tuneAntennas(): Promise<AntennaTuning & { rawPacket: Pm3Packet }> {
    if (this._protocol === 'legacy') {
      // arg0 = 3 asks for both antennas on builds that take a selector.
      const packet = await this.executeCommand(
        { cmd: PM3_LEGACY_COMMANDS.CMD_MEASURE_ANTENNA_TUNING, arg0: 3 },
        20000
      );
      if (packet.cmd !== PM3_LEGACY_COMMANDS.CMD_MEASURED_ANTENNA_TUNING) {
        throw new Error(`Unexpected reply 0x${packet.cmd.toString(16)} to the antenna tuning request`);
      }
      return { ...parseLegacyTuning(packet), rawPacket: packet };
    }
    const packet = await this.executeCommand(
      { cmd: PM3_COMMANDS.CMD_MEASURE_ANTENNA_TUNING, mix: false },
      20000
    );
    return { ...parseNgTuning(packet), rawPacket: packet };
  }

  /**
   * Executes a command on the Proxmark device, strictly gated by the Compatibility Guard.
   */
  public async executeCommand(
    options: CreatePacketOptions,
    timeoutMs: number = UART_USB_CLIENT_RX_TIMEOUT_MS,
    intermediate?: (packet: Pm3Packet) => boolean
  ): Promise<Pm3Packet> {
    if (!this.isConnected && this._state !== 'interrogating') {
      throw new Error(`Cannot execute command in state '${this._state}'. Device not connected.`);
    }

    const risk = getCommandRisk(options.cmd);
    assertCanExecute(
      risk,
      {
        compatibilityLevel: this.compatibilityLevel,
        allowRiskOverrides: this._allowRiskOverrides
      },
      `0x${options.cmd.toString(16)}`
    );

    return this.dispatchRaw(options, timeoutMs, intermediate);
  }

  /**
   * Raw packet dispatch with timeout and response promise correlation.
   */
  private async dispatchRaw(
    options: CreatePacketOptions,
    timeoutMs: number,
    intermediate?: (packet: Pm3Packet) => boolean
  ): Promise<Pm3Packet> {
    if (!this.writer) {
      throw new Error('Device stream writer is unavailable.');
    }

    const frameBytes = this._protocol === 'legacy' ? packLegacyFrame(options) : packNgFrame(options);

    return new Promise<Pm3Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from pending
        this.pendingCommands = this.pendingCommands.filter((p) => p !== pending);
        reject(
          new Error(
            `Timeout waiting for response to command 0x${options.cmd.toString(16)} after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      const pending: PendingCommand = {
        expectedCmd: options.cmd,
        resolve,
        reject,
        timer,
        intermediate
      };

      this.pendingCommands.push(pending);

      this.writer!.write(frameBytes)
        .then(() => {
          this.emit('packetSent', {
            packet: {
              magic: 0x43334d50,
              cmd: options.cmd,
              status: 0,
              ng: true,
              length: options.payload ? options.payload.length : 0,
              flags: options.flags ?? 0,
              arg0: options.arg0 ?? 0,
              arg1: options.arg1 ?? 0,
              arg2: options.arg2 ?? 0,
              payload: options.payload ? new Uint8Array(options.payload) : new Uint8Array(0)
            }
          });
        })
        .catch((err) => {
          clearTimeout(timer);
          this.pendingCommands = this.pendingCommands.filter((p) => p !== pending);
          reject(err);
        });
    });
  }

  /**
   * Continuously reads byte chunks from the Serial port stream.
   */
  private async startReadLoop(): Promise<void> {
    this.isReading = true;

    try {
      while (this.isReading && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          const probe = this.legacyProbe;
          if (probe) {
            probe.chunks.push(value);
            probe.size += value.byteLength;
            if (probe.size >= PM3_LEGACY_FRAME_SIZE) {
              const seen = new Uint8Array(probe.size);
              let at = 0;
              for (const chunk of probe.chunks) {
                seen.set(chunk, at);
                at += chunk.byteLength;
              }
              if (looksLikeLegacyReply(seen)) probe.detected();
            }
          }
          this.ringBuffer.append(value);
          this.processPacketsFromBuffer();
        }
      }
    } catch (err: any) {
      if (this.isReading) {
        this.emit('error', { error: err });
      }
    } finally {
      this.isReading = false;
    }
  }

  /**
   * Extracts available packets from the ring buffer and routes them.
   */
  private processPacketsFromBuffer(): void {
    let packet: Pm3Packet | null = null;
    while ((packet = this.ringBuffer.nextPacket()) !== null) {
      this.handleIncomingPacket(packet);
    }
  }

  /**
   * Handles a parsed incoming NG packet:
   * 1. If CMD_DEBUG_PRINT: isolates debug text and emits debugPrint event.
   * 2. Otherwise matches against pending command queue.
   */
  private handleIncomingPacket(packet: Pm3Packet): void {
    this.emit('packetReceived', { packet });

    // Handle unsolicited debug print frames
    if (packet.cmd === PM3_COMMANDS.CMD_DEBUG_PRINT) {
      const msg =
        this._protocol === 'legacy'
          ? legacyDebugText(packet)
          : new TextDecoder('utf-8', { fatal: false }).decode(packet.payload);
      this.debugTap?.(msg);
      this.emit('debugPrint', { message: msg, timestamp: Date.now() });

      // Legacy firmware has no error reply: an opcode it lacks is only reported this way.
      const unknown = this._protocol === 'legacy' ? LEGACY_UNKNOWN_COMMAND.exec(msg) : null;
      if (unknown && this.pendingCommands.length > 0) {
        const pending = this.pendingCommands.shift()!;
        clearTimeout(pending.timer);
        pending.reject(new Error(`This firmware does not implement command 0x${unknown[1].padStart(4, '0')}.`));
      }
      return;
    }

    // Multi-frame replies (e.g. buffer downloads) are fed to the waiting command first.
    const waiting = this.pendingCommands[0];
    if (waiting?.intermediate && waiting.intermediate(packet)) {
      return;
    }

    // Correlate with pending command
    // Match by command opcode or resolve first pending if opcode matches
    const matchIndex = this.pendingCommands.findIndex(
      (p) => p.expectedCmd === packet.cmd
    );

    if (matchIndex !== -1) {
      const [matched] = this.pendingCommands.splice(matchIndex, 1);
      clearTimeout(matched.timer);
      matched.resolve(packet);
      return;
    }

    // Fallback: if pending exists, resolve earliest pending command
    if (this.pendingCommands.length > 0) {
      const matched = this.pendingCommands.shift()!;
      clearTimeout(matched.timer);
      matched.resolve(packet);
    }
  }

  /**
   * Gracefully tears down serial connection and releases port locks.
   */
  public async disconnect(reason?: string): Promise<void> {
    this.isReading = false;

    // Fail all pending commands
    for (const pending of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Device disconnected: ${reason || 'Manual teardown'}`));
    }
    this.pendingCommands = [];

    // Ordered teardown with timeouts (shared with every other serial tool):
    // cancel reader -> wait for the read loop -> release locks -> close.
    const port = this.port, reader = this.reader, writer = this.writer, readLoop = this.readLoop;
    this.port = null; this.reader = null; this.writer = null; this.readLoop = null;
    if (port) {
      await closeSerialPort(port as any, { reader, readLoop, writer });
      releasePort(port, this.portOwner);
    }

    this.ringBuffer.clear();
    this.ringBuffer.mode = 'ng';
    this._protocol = 'ng';
    this.legacyProbe = null;
    this.debugTap = null;
    this.hf14aFraming = null;
    this._identity = null;
    this.setState('disconnected', reason);
    this.emit('disconnected', { reason });
  }
}
