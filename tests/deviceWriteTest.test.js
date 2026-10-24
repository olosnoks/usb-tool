import { describe, it, expect, vi } from 'vitest';
import { getDummyTestPayload, runOutputTest } from '../src/utils/deviceWriteTest';

describe('Hardware Output Endpoint Diagnostic Utility', () => {
  describe('getDummyTestPayload', () => {
    it('generates a valid 32-byte generic payload with 0xAA fill', () => {
      const payload = getDummyTestPayload();
      expect(payload).toBeInstanceOf(Uint8Array);
      expect(payload.byteLength).toBe(32);
      expect(Array.from(payload).every(b => b === 0xAA)).toBe(true);
    });
  });

  describe('runOutputTest', () => {
    it('successfully sends payload via radioInstance.write()', async () => {
      const mockWrite = vi.fn().mockResolvedValue(true);
      const mockRadio = { write: mockWrite };

      const result = await runOutputTest(mockRadio);
      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalledTimes(1);
      const passedBuffer = mockWrite.mock.calls[0][0];
      expect(passedBuffer.length).toBe(32);
      expect(passedBuffer[0]).toBe(0xAA);
    });

    it('successfully sends payload via radioInstance.sendPacket()', async () => {
      const mockSend = vi.fn().mockResolvedValue(32);
      const mockRadio = { sendPacket: mockSend };

      const result = await runOutputTest(mockRadio);
      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Uint8Array), 36);
    });

    it('successfully sends payload via radioInstance.txFrame()', async () => {
      const mockTx = vi.fn().mockResolvedValue(true);
      const mockRadio = { txFrame: mockTx };

      const result = await runOutputTest(mockRadio);
      expect(result).toBe(true);
      expect(mockTx).toHaveBeenCalledTimes(1);
    });

    it('successfully sends payload via device.transferOut() WebUSB fallback', async () => {
      const mockTransferOut = vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 32 });
      const mockRadio = {
        bulkOutEndpoint: () => 4,
        device: { transferOut: mockTransferOut }
      };

      const result = await runOutputTest(mockRadio);
      expect(result).toBe(true);
      expect(mockTransferOut).toHaveBeenCalledWith(4, expect.any(Uint8Array));
    });

    it('returns false gracefully when radioInstance write throws an error', async () => {
      const mockErrorWrite = vi.fn().mockRejectedValue(new Error('USB Transfer Timeout'));
      const mockRadio = { write: mockErrorWrite };

      const result = await runOutputTest(mockRadio);
      expect(result).toBe(false);
      expect(mockErrorWrite).toHaveBeenCalled();
    });

    it('returns false gracefully when radioInstance is null, undefined, or missing write method', async () => {
      expect(await runOutputTest(null)).toBe(false);
      expect(await runOutputTest(undefined)).toBe(false);
      expect(await runOutputTest({})).toBe(false);
    });
  });
});
