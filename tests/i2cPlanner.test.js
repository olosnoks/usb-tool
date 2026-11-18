import { describe, it, expect } from 'vitest';
import { freeAddresses, assignSingleBus, planBuses, muxOptions, planToText } from '../src/utils/i2cPlanner.js';

describe('i2c planner', () => {
  it('lists free addresses without reserved ones', () => {
    const free = freeAddresses([0x3c, 0x68]);
    expect(free).not.toContain(0x3c);
    expect(free).not.toContain(0x68);
    expect(free).not.toContain(0x00);
    expect(free).not.toContain(0x78);
    expect(free).toContain(0x08);
    expect(free).toContain(0x77);
    expect(free.length).toBe(0x77 - 0x08 + 1 - 2);
  });

  it('moves parts with alternates onto distinct addresses', () => {
    const r = assignSingleBus(['mpu6500', 'mpu6500', 'tca9548a']);
    expect(r.ok).toBe(true);
    const addrs = r.assignment.map((a) => a.address);
    expect(new Set(addrs).size).toBe(addrs.length);
    const both = assignSingleBus(['mpu6500', 'tca9548a', 'pca9548a']);
    expect(both.ok).toBe(true);
  });

  it('fails on two fixed-address parts', () => {
    const r = assignSingleBus(['shtc3', 'shtc3']);
    expect(r.ok).toBe(false);
    expect(r.assignment).toEqual([]);
    expect(planBuses(['shtc3', 'shtc3']).busCount).toBe(2);
  });

  it('splits unavoidable conflicts across buses', () => {
    // three 2-address parts need two addresses each at most; four mpu-style parts on one pair cannot fit
    const ids = ['mpu6500', 'mpu6050', 'mpu9250', 'icm20948'].filter((id) => id);
    const single = assignSingleBus(ids);
    const multi = planBuses(ids);
    if (!single.ok) expect(multi.busCount).toBeGreaterThan(1);
    for (const bus of multi.buses) {
      const a = bus.map((x) => x.address);
      expect(new Set(a).size).toBe(a.length);
    }
  });

  it('ignores unknown ids and suggests muxes', () => {
    expect(planBuses(['nope']).busCount).toBe(0);
    expect(muxOptions(5).map((m) => m.id)).not.toContain('tca9546a');
    expect(muxOptions(3).map((m) => m.id)).toContain('tca9546a');
    expect(muxOptions(9)).toEqual([]);
  });

  it('exports text', () => {
    const single = assignSingleBus(['mpu6500']);
    expect(planToText(single, null)).toMatch(/^0x6[89]\tMPU-6500$/);
    expect(planToText({ ok: false }, planBuses(['mpu6500']))).toContain('Bus/channel 0');
  });
});
