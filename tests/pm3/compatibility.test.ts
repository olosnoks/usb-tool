import { describe, it, expect } from 'vitest';
import {
  parseVersionPayload,
  evaluateCompatibility,
  canExecute,
  assertCanExecute,
  CompatibilityError,
  DeviceLockedError,
  DEFAULT_CLIENT_BUILD,
  DeviceFirmwareIdentity,
  ProxmarkDevice
} from '../../src/devices/proxmark';
import { PM3_COMMANDS, packNgFrame } from '../../src/protocols/pm3';

describe('Proxmark3 Version Parsing & Compatibility Guard', () => {
  const sampleRdv4Banner = `
[ ARM ]
  bootrom: master/v4.18962-clean 2024-05-10 12:00:00
  os: master/v4.18962-clean 2024-05-10 12:00:00
  commit: b4a8e21976a1c5d9
  target: RDV4
  `;

  const sampleSuspectBanner = `
v4.18962-suspect (RDV4) commit: b4a8e21 2024-04-01
  `;

  const samplePm5Banner = `
PM5 / PROXMARK5 v5.0.1 commit 99aabbcc clean
  `;

  describe('parseVersionPayload', () => {
    it('correctly extracts git hash, target, cleanliness, and build date from banner', () => {
      const payload = new TextEncoder().encode(sampleRdv4Banner);
      const identity = parseVersionPayload(payload);

      expect(identity.hardwareTarget).toBe('PM3RDV4');
      expect(identity.gitHash).toBe('b4a8e21976a1c5d9');
      expect(identity.isClean).toBe(true);
      expect(identity.buildDate).toBe('2024-05-10 12:00:00');
    });

    it('identifies suspect/dirty builds', () => {
      const payload = new TextEncoder().encode(sampleSuspectBanner);
      const identity = parseVersionPayload(payload);

      expect(identity.hardwareTarget).toBe('PM3RDV4');
      expect(identity.gitHash).toBe('b4a8e21');
      expect(identity.isClean).toBe(false);
    });

    it('identifies Proxmark5 hardware target', () => {
      const payload = new TextEncoder().encode(samplePm5Banner);
      const identity = parseVersionPayload(payload);

      expect(identity.hardwareTarget).toBe('PM5');
      expect(identity.gitHash).toBe('99aabbcc');
    });

    it('gracefully handles empty or unparseable payloads', () => {
      const identity = parseVersionPayload(new Uint8Array(0));
      expect(identity.hardwareTarget).toBe('UNKNOWN');
      expect(identity.gitHash).toBe('unknown');
      expect(identity.isClean).toBe(false);
    });
  });

  describe('evaluateCompatibility (Tri-State)', () => {
    it('returns "matched" when git hashes and targets align', () => {
      const firmware: DeviceFirmwareIdentity = {
        rawVersionString: 'matched build',
        gitHash: 'b4a8e21976', // Starts with DEFAULT_CLIENT_BUILD.gitHash ('b4a8e21')
        isClean: true,
        hardwareTarget: 'PM3RDV4'
      };

      const level = evaluateCompatibility(firmware, DEFAULT_CLIENT_BUILD);
      expect(level).toBe('matched');
    });

    it('returns "compatible" when target is known NG device but git hash differs', () => {
      const firmware: DeviceFirmwareIdentity = {
        rawVersionString: 'compatible build',
        gitHash: 'c9f8d7e6a5', // Different commit
        isClean: true,
        hardwareTarget: 'PM3RDV4'
      };

      const level = evaluateCompatibility(firmware, DEFAULT_CLIENT_BUILD);
      expect(level).toBe('compatible');
    });

    it('returns "unsupported" when target is unknown or corrupted', () => {
      const firmware: DeviceFirmwareIdentity = {
        rawVersionString: 'corrupted',
        gitHash: 'unknown',
        isClean: false,
        hardwareTarget: 'UNKNOWN'
      };

      const level = evaluateCompatibility(firmware, DEFAULT_CLIENT_BUILD);
      expect(level).toBe('unsupported');
    });
  });

  describe('canExecute & assertCanExecute Guardrails', () => {
    it('authorizes all command risks on "matched" firmware', () => {
      const context = { compatibilityLevel: 'matched' as const };
      expect(canExecute('diagnostic', context)).toBe(true);
      expect(canExecute('read', context)).toBe(true);
      expect(canExecute('write', context)).toBe(true);
      expect(canExecute('magic', context)).toBe(true);
      expect(canExecute('raw', context)).toBe(true);
    });

    it('allows diagnostic and read-only commands on "compatible" firmware, locking write/magic/raw without override', () => {
      const context = { compatibilityLevel: 'compatible' as const, allowRiskOverrides: false };

      expect(canExecute('diagnostic', context)).toBe(true);
      expect(canExecute('read', context)).toBe(true);
      expect(canExecute('write', context)).toBe(false);
      expect(canExecute('magic', context)).toBe(false);
      expect(canExecute('raw', context)).toBe(false);

      expect(() => assertCanExecute('write', context, 'CMD_FLASH')).toThrow(
        CompatibilityError
      );
    });

    it('unlocks write/magic/raw on "compatible" firmware when allowRiskOverrides is true', () => {
      const context = { compatibilityLevel: 'compatible' as const, allowRiskOverrides: true };

      expect(canExecute('write', context)).toBe(true);
      expect(canExecute('magic', context)).toBe(true);
      expect(canExecute('raw', context)).toBe(true);
      expect(() => assertCanExecute('write', context, 'CMD_FLASH')).not.toThrow();
    });

    it('strictly locks ALL command risks on "unsupported" firmware', () => {
      const context = { compatibilityLevel: 'unsupported' as const, allowRiskOverrides: true };

      expect(canExecute('diagnostic', context)).toBe(false);
      expect(canExecute('read', context)).toBe(false);
      expect(canExecute('write', context)).toBe(false);
      expect(canExecute('magic', context)).toBe(false);
      expect(canExecute('raw', context)).toBe(false);

      expect(() => assertCanExecute('diagnostic', context)).toThrow(DeviceLockedError);
    });
  });

  describe('ProxmarkDevice Integration with Simulated Port', () => {
    function createMockPort(responses: Uint8Array[]) {
      let readIndex = 0;
      let writtenData: Uint8Array[] = [];

      const readable = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (readIndex < responses.length) {
            controller.enqueue(responses[readIndex++]);
          } else {
            // Keep stream open
          }
        }
      });

      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          writtenData.push(chunk);
        }
      });

      return {
        port: {
          readable,
          writable,
          open: async () => {},
          close: async () => {}
        },
        getWritten: () => writtenData
      };
    }

    it('successfully connects, completes handshake interrogation, and transitions to readyMatched', async () => {
      const device = new ProxmarkDevice();

      const versionPayload = new TextEncoder().encode(sampleRdv4Banner);
      const versionResponseFrame = packNgFrame({
        cmd: PM3_COMMANDS.CMD_VERSION,
        payload: versionPayload
      });

      const mock = createMockPort([versionResponseFrame]);
      const identity = await device.connect(mock.port);

      expect(identity.hardwareTarget).toBe('PM3RDV4');
      expect(device.state).toBe('readyMatched');
      expect(device.isConnected).toBe(true);

      // Verify we can execute a diagnostic command
      const pingResponse = packNgFrame({ cmd: PM3_COMMANDS.CMD_PING, arg0: 0x123 });
      // Simulate reply
      setTimeout(() => {
        (device as any).handleIncomingPacket({
          magic: 0x43334d50,
          cmd: PM3_COMMANDS.CMD_PING,
          length: 0,
          flags: 0,
          arg0: 0x123,
          arg1: 0,
          arg2: 0,
          payload: new Uint8Array(0)
        });
      }, 10);

      const res = await device.executeCommand({ cmd: PM3_COMMANDS.CMD_PING });
      expect(res.arg0).toBe(0x123);

      await device.disconnect();
      expect(device.state).toBe('disconnected');
    });

    it('isolates unsolicited debug print frames from pending command responses', async () => {
      const device = new ProxmarkDevice();
      const debugLogs: string[] = [];
      device.on('debugPrint', (e) => debugLogs.push(e.message));

      // Simulate incoming debug print packet directly
      const debugPacket = packNgFrame({
        cmd: PM3_COMMANDS.CMD_DEBUG_PRINT,
        payload: new TextEncoder().encode('#db# Antenna tuned to 13.56 MHz')
      });

      (device as any).ringBuffer.append(debugPacket);
      (device as any).processPacketsFromBuffer();

      expect(debugLogs.length).toBe(1);
      expect(debugLogs[0]).toContain('Antenna tuned to 13.56 MHz');
    });
  });
});
