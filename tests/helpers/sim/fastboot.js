// Test-only simulated Fastboot bootloader transport. Recovered from
// fastbootDriver.js (commit f695098^); models getvar, the download handshake,
// flash/erase (unlock-gated), slots, sparse apply and reboot, so the real
// Fastboot protocol code can be tested without a device. Not imported by app code.
import { isSparse, parseSparse, LOGICAL_PARTITIONS } from '../../../src/utils/fastbootTools.js';

const td = new TextDecoder();
const te = new TextEncoder();

/**
 * A simulated bootloader transport, so the workbench can demonstrate the flow
 * with no device. Opt-in only; the UI labels everything it produces as
 * simulated. It models getvar, the download DATA handshake, flash/erase (gated
 * on unlock), reboot and the unlock confirmation.
 */
export function createSimulatedFastboot() {
  const state = {
    simulated: true,
    unlocked: 'no',
    partitions: {},
    flashLog: [],
    userspace: false,
    superUpdated: null,
    erased: [],
    rebooted: null,
    activeSlot: 'a',
    maxDownload: 0x8000000,
    vars: {
      product: 'virtual-pixel', variant: 'DEMO', 'version-bootloader': 'sim-1.0',
      'version-baseband': 'none', serialno: 'SIMULATED0000', secure: 'yes',
      unlocked: 'no', 'current-slot': 'a', 'slot-count': '2',
      'has-slot:boot': 'yes', 'has-slot:bootloader': 'yes', 'has-slot:radio': 'yes', 'has-slot:system': 'yes', 'has-slot:vendor': 'yes',
      'has-slot:vbmeta': 'yes', 'has-slot:dtbo': 'yes', 'has-slot:userdata': 'no',
      'partition-type:boot': 'raw', 'partition-type:system': 'ext4', 'partition-type:userdata': 'f2fs'
    }
  };
  let dlBuf = null; let dlGot = 0;
  const queue = [];
  const push = (s) => queue.push(s);
  const handle = (cmd) => {
    if (cmd.startsWith('getvar:')) {
      const name = cmd.slice(7);
      state.vars.unlocked = state.unlocked;
      state.vars['max-download-size'] = '0x' + state.maxDownload.toString(16);
      state.vars['is-userspace'] = state.userspace ? 'yes' : 'no';
      state.vars['current-slot'] = state.activeSlot;
      if (name === 'all') { for (const [k, v] of Object.entries(state.vars)) push(`INFO${k}:${v}`); push('OKAY'); }
      else if (name in state.vars) push(`OKAY${state.vars[name]}`);
      else push('FAILunknown variable');
    } else if (cmd.startsWith('download:')) {
      const size = parseInt(cmd.slice(9), 16);
      dlBuf = new Uint8Array(size); dlGot = 0;
      push(`DATA${size.toString(16).padStart(8, '0')}`);
      if (size === 0) push('OKAY');
    } else if (cmd.startsWith('flash:')) {
      if (state.unlocked !== 'yes') return push('FAILdevice is locked');
      const name = cmd.slice(6);
      const isLogical = LOGICAL_PARTITIONS.includes(name.replace(/_(a|b)$/, ''));
      if (isLogical && !state.userspace) return push('FAILlogical partitions can only be flashed from fastbootd');
      const data = dlBuf ? dlBuf.slice() : new Uint8Array();
      state.flashLog.push({ partition: name, bytes: data.length, sparse: isSparse(data) });
      if (isSparse(data)) {
        // Apply the sparse pieces onto the partition, like the bootloader would.
        const sp = parseSparse(data);
        const cur = state.partitions[name] && state.partitions[name].length === sp.rawSize ? state.partitions[name] : new Uint8Array(sp.rawSize);
        for (const c of sp.chunks) {
          const at = c.startBlock * sp.blockSize;
          if (c.type === 0xcac1) cur.set(data.subarray(c.offset, c.offset + c.blocks * sp.blockSize), at);
          else if (c.type === 0xcac2) for (let i = 0; i < c.blocks * sp.blockSize; i += 4) cur.set(data.subarray(c.offset, c.offset + 4), at + i);
        }
        state.partitions[name] = cur;
      } else state.partitions[name] = data;
      push('INFOWriting...'); push('OKAY');
    } else if (cmd.startsWith('update-super:')) {
      if (!state.userspace) return push('FAILupdate-super needs fastbootd');
      state.superUpdated = cmd.slice(13); push('OKAY');
    } else if (cmd.startsWith('resize-logical-partition:')) {
      if (!state.userspace) return push('FAILneeds fastbootd');
      push('OKAY');
    } else if (cmd.startsWith('erase:')) {
      if (state.unlocked !== 'yes') return push('FAILdevice is locked');
      state.erased.push(cmd.slice(6)); push('OKAY');
    } else if (cmd === 'flashing unlock' || cmd === 'oem unlock') {
      state.unlocked = 'yes'; push('INFOSimulated: unlocking erases user data. On a real phone, confirm with the volume keys.'); push('OKAY');
    } else if (cmd === 'flashing lock' || cmd === 'oem lock') { state.unlocked = 'no'; push('OKAY'); }
    else if (cmd.startsWith('set_active:')) { state.activeSlot = cmd.slice(11); push('OKAY'); }
    else if (cmd === 'boot') { push('OKAY'); }
    else if (cmd === 'reboot' || cmd.startsWith('reboot-')) {
      state.rebooted = cmd;
      if (cmd === 'reboot-fastboot') state.userspace = true;
      if (cmd === 'reboot-bootloader') state.userspace = false;
      push('OKAY');
    }
    else push('FAILunknown command');
  };
  return {
    state,
    async open() {},
    async close() {},
    async write(bytes) {
      if (dlBuf && dlGot < dlBuf.length) {
        dlBuf.set(bytes, dlGot); dlGot += bytes.length;
        if (dlGot >= dlBuf.length) push('OKAY');
        return;
      }
      handle(td.decode(bytes));
    },
    async read() { return queue.length ? te.encode(queue.shift()) : new Uint8Array(); }
  };
}
