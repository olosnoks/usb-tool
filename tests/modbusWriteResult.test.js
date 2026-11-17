import { describe, it, expect } from 'vitest';
import { ModbusClient, buildModbusRtuRequest, calculateModbusCrc16, describeModbusException } from '../src/utils/modbusDriver';
import { formatWriteFeedback } from '../src/components/tools/ModbusWorkbench.jsx';

function frame(bytes) {
  const crc = calculateModbusCrc16(bytes);
  return Uint8Array.from([...bytes, crc & 0xff, crc >> 8]);
}
function client(resp) {
  const c = new ModbusClient(() => {});
  c.connectLive(async () => (resp instanceof Error ? Promise.reject(resp) : typeof resp === 'function' ? resp() : resp), 1, 9600);
  return c;
}

describe('Modbus write single register result', () => {
  it('succeeds only on a matching echo', async () => {
    const echo = buildModbusRtuRequest(1, 6, 0, 2300);
    const r = await client(echo).writeSingleRegisterDetailed(0, 2300);
    expect(r.ok).toBe(true);
    expect(formatWriteFeedback(r, 0, 2300)).toMatch(/successfully/);
  });
  it('fails on timeout', async () => {
    const r = await client(new Uint8Array(0)).writeSingleRegisterDetailed(0, 1);
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    expect(formatWriteFeedback(r, 0, 1)).toMatch(/FAILED.*timeout/);
  });
  it('decodes exception codes', async () => {
    const c = client(frame([1, 0x86, 0x02]));
    const r = await c.writeSingleRegisterDetailed(5, 1);
    expect(r).toMatchObject({ ok: false, reason: 'exception', exceptionCode: 2, exceptionName: 'Illegal Data Address' });
    expect(formatWriteFeedback(r, 5, 1)).toMatch(/Illegal Data Address/);
    expect(await c.writeSingleRegister(5, 1)).toBe(false);
    expect(describeModbusException(0x99)).toBe('Unknown');
  });
  it('rejects an echo that does not match the request', async () => {
    const r = await client(buildModbusRtuRequest(1, 6, 0, 999)).writeSingleRegisterDetailed(0, 2300);
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
  });
  it('reports transport errors', async () => {
    const r = await client(new Error('boom')).writeSingleRegisterDetailed(0, 1);
    expect(r).toMatchObject({ ok: false, reason: 'transport' });
  });
});
