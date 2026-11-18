import { I2C_DEVICES, formatAddress, reservedMeaning } from './i2cAddressDb.js';

/**
 * Pure planning helpers for the I2C address reference. They only use the addresses in the
 * database; nothing here touches a bus.
 */

/** Addresses a normal device may use (0x08 to 0x77, not reserved) that are not in `used`. */
export function freeAddresses(used) {
  const taken = new Set((used || []).filter((a) => Number.isInteger(a)));
  const out = [];
  for (let a = 0x08; a <= 0x77; a++) {
    if (!reservedMeaning(a) && !taken.has(a)) out.push(a);
  }
  return out;
}

// Repeated ids mean several identical parts on the same bus.
function pickDevices(ids) {
  return (ids || []).map((id) => I2C_DEVICES.find((x) => x.id === id)).filter(Boolean);
}

/**
 * Try to give every chosen part its own address on ONE bus, using each part's alternate
 * addresses (pins / jumpers). Exact backtracking search, fewest-options-first.
 * Returns { ok, assignment: [{ id, part, address, hex }] } (assignment empty when ok is false).
 */
export function assignSingleBus(ids) {
  const devs = pickDevices(ids).sort((a, b) => a.addr.length - b.addr.length);
  const used = new Set();
  const chosen = new Array(devs.length);
  let steps = 0;
  const solve = (i) => {
    if (i === devs.length) return true;
    if (++steps > 200000) return false;
    for (const a of devs[i].addr) {
      if (used.has(a)) continue;
      used.add(a);
      chosen[i] = a;
      if (solve(i + 1)) return true;
      used.delete(a);
    }
    return false;
  };
  const ok = solve(0);
  const assignment = ok
    ? devs.map((d, i) => ({ id: d.id, part: d.part, address: chosen[i], hex: formatAddress(chosen[i]) })).sort((a, b) => a.address - b.address)
    : [];
  return { ok, assignment };
}

/**
 * Split the chosen parts over several buses (for example the channels of an I2C multiplexer)
 * so that no bus has two parts on the same address. Greedy first-fit, most constrained part
 * first, so the bus count is small but not guaranteed minimal.
 * Returns { buses: [[{ id, part, address, hex }]], busCount }.
 */
export function planBuses(ids) {
  const devs = pickDevices(ids).sort((a, b) => a.addr.length - b.addr.length);
  const buses = [];
  for (const d of devs) {
    let placed = false;
    for (const bus of buses) {
      const free = d.addr.find((a) => !bus.used.has(a));
      if (free !== undefined) {
        bus.used.add(free);
        bus.items.push({ id: d.id, part: d.part, address: free, hex: formatAddress(free) });
        placed = true;
        break;
      }
    }
    if (!placed) {
      buses.push({ used: new Set([d.addr[0]]), items: [{ id: d.id, part: d.part, address: d.addr[0], hex: formatAddress(d.addr[0]) }] });
    }
  }
  return {
    buses: buses.map((b) => b.items.sort((x, y) => x.address - y.address)),
    busCount: buses.length,
  };
}

/** Which multiplexer parts from the database have enough channels for `busCount` buses. */
export function muxOptions(busCount) {
  const channels = { tca9548a: 8, pca9548a: 8, tca9546a: 4 };
  return Object.entries(channels)
    .filter(([id, n]) => n >= busCount && I2C_DEVICES.some((d) => d.id === id))
    .map(([id, n]) => ({ id, part: I2C_DEVICES.find((d) => d.id === id).part, channels: n }));
}

/** Plain-text export of a plan (single bus or per-channel), for copying into notes. */
export function planToText(single, multi) {
  if (single && single.ok) {
    return single.assignment.map((a) => `${a.hex}\t${a.part}`).join('\n');
  }
  if (!multi) return '';
  return multi.buses
    .map((bus, i) => `Bus/channel ${i}\n${bus.map((a) => `  ${a.hex}\t${a.part}`).join('\n')}`)
    .join('\n');
}
