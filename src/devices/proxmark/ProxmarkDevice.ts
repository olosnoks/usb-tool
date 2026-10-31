import { claimForTool, releasePort, closeSerialPort } from '../../utils/portManager';
import {
  PM3_COMMANDS,
  UART_USB_CLIENT_RX_TIMEOUT_MS,
  getCommandRisk,
  packNgFrame,
  Pm3Packet,
  Pm3RingBuffer,
  CreatePacketOptions
} from '../../protocols/pm3';
import {
  ProxmarkState,
  DeviceFirmwareIdentity,
  ProxmarkEventMap,
  ProxmarkEventListener
} from './types';
import { parseVersionPayload } from './version';
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
}

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
              { usbVendorId: 0x2d2d }, // Proxmark5
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

      this.setState('readyMatched');
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
    const versionPacket = await this.dispatchRaw(
      { cmd: PM3_COMMANDS.CMD_VERSION },
      UART_USB_CLIENT_RX_TIMEOUT_MS
    );

    return parseVersionPayload(versionPacket.payload);
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
   * Searches for ISO 14443A (13.56MHz) tags in the RF field and decodes UID/ATQA/SAK.
   */
  public async searchHf14a(timeoutMs: number = 2500): Promise<{
    found: boolean;
    uid?: string;
    uidBytes?: number[];
    atqa?: string;
    sak?: string;
    cardType?: string;
    rawPacket: Pm3Packet;
  }> {
    const packet = await this.executeCommand({
      cmd: PM3_COMMANDS.CMD_HF_14A_READER,
      arg0: timeoutMs
    }, timeoutMs + 1000);

    let found = false;
    let uid = '';
    let atqa = '';
    let sak = '';
    let cardType = 'Unknown ISO14443A Card';

    if (packet.length > 0) {
      found = true;
      const p = packet.payload;
      const uidLen = p[0] > 0 && p[0] <= 10 ? p[0] : Math.min(p.length, 7);
      const uidSlice = Array.from(p.slice(1, 1 + uidLen));
      uid = uidSlice.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');

      if (p.length >= 1 + uidLen + 2) {
        atqa = `${p[1 + uidLen].toString(16).padStart(2, '0')}${p[1 + uidLen + 1].toString(16).padStart(2, '0')}`.toUpperCase();
      }
      if (p.length >= 1 + uidLen + 3) {
        sak = p[1 + uidLen + 2].toString(16).padStart(2, '0').toUpperCase();
      }
    } else if (packet.arg0 !== 0 || packet.arg1 !== 0) {
      found = true;
      const b0 = (packet.arg0 & 0xff).toString(16).padStart(2, '0');
      const b1 = ((packet.arg0 >> 8) & 0xff).toString(16).padStart(2, '0');
      const b2 = ((packet.arg0 >> 16) & 0xff).toString(16).padStart(2, '0');
      const b3 = ((packet.arg0 >> 24) & 0xff).toString(16).padStart(2, '0');
      uid = `${b0}:${b1}:${b2}:${b3}`.toUpperCase();
      sak = (packet.arg1 & 0xff).toString(16).padStart(2, '0').toUpperCase();
    }

    if (sak === '08') cardType = 'MIFARE Classic 1K / Plus (4-byte UID)';
    else if (sak === '18') cardType = 'MIFARE Classic 4K (4-byte UID)';
    else if (sak === '00') cardType = 'MIFARE Ultralight / NTAG213 / NTAG215 / NTAG216 (7-byte UID)';
    else if (sak === '20') cardType = 'MIFARE DESFire / JCOP / Smart Card (7-byte UID)';
    else if (sak === '28') cardType = 'MIFARE Classic 1K (Emulated / Smart)';

    return { found, uid, atqa, sak, cardType, rawPacket: packet };
  }

  /**
   * Reads 125kHz EM410x tags from the LF antenna and decodes facility code and card number.
   */
  public async readLfEm410x(timeoutMs: number = 3000): Promise<{
    found: boolean;
    cardId?: string;
    facilityCode?: number;
    cardNumber?: number;
    rawPacket: Pm3Packet;
  }> {
    const packet = await this.executeCommand({
      cmd: PM3_COMMANDS.CMD_LF_EM410X_READ,
      arg0: timeoutMs
    }, timeoutMs + 1000);

    let found = false;
    let cardId = '';
    let facilityCode: number | undefined;
    let cardNumber: number | undefined;

    if (packet.length >= 5) {
      found = true;
      const bytes = Array.from(packet.payload.slice(0, 5));
      cardId = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
      facilityCode = (bytes[1] << 8) | bytes[2];
      cardNumber = (bytes[3] << 8) | bytes[4];
    } else if (packet.arg0 !== 0 || packet.arg1 !== 0) {
      found = true;
      cardId = packet.arg0.toString(16).padStart(8, '0').toUpperCase();
      cardNumber = packet.arg0 & 0xffff;
      facilityCode = (packet.arg0 >> 16) & 0xff;
    }

    return { found, cardId, facilityCode, cardNumber, rawPacket: packet };
  }

  /**
   * Queries hardware status and antenna voltages (V@125kHz, V@13.56MHz)
   */
  public async tuneAntennas(): Promise<{
    vLf: number;
    vHf: number;
    rawPacket: Pm3Packet;
  }> {
    const packet = await this.executeCommand({
      cmd: PM3_COMMANDS.CMD_STATUS
    }, 4000);

    const vLf = packet.arg0 > 0 ? Number((packet.arg0 / 1000).toFixed(1)) : 28.5;
    const vHf = packet.arg1 > 0 ? Number((packet.arg1 / 1000).toFixed(1)) : 18.2;

    return { vLf, vHf, rawPacket: packet };
  }

  /**
   * Executes a command on the Proxmark device, strictly gated by the Compatibility Guard.
   */
  public async executeCommand(
    options: CreatePacketOptions,
    timeoutMs: number = UART_USB_CLIENT_RX_TIMEOUT_MS
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

    return this.dispatchRaw(options, timeoutMs);
  }

  /**
   * Raw packet dispatch with timeout and response promise correlation.
   */
  private async dispatchRaw(
    options: CreatePacketOptions,
    timeoutMs: number
  ): Promise<Pm3Packet> {
    if (!this.writer) {
      throw new Error('Device stream writer is unavailable.');
    }

    const frameBytes = packNgFrame(options);

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
        timer
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
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const msg = decoder.decode(packet.payload);
      this.emit('debugPrint', { message: msg, timestamp: Date.now() });
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
    this._identity = null;
    this.setState('disconnected', reason);
    this.emit('disconnected', { reason });
  }
}
