/**
 * Hardware Output (Write) Endpoint Diagnostic Utility
 * Verifies USB OUT endpoint data transmission via the WASM/WebUSB driver.
 */

/**
 * Generate a generic 32-byte test payload.
 * @returns {Uint8Array} 32-byte array filled with 0xAA
 */
export function getDummyTestPayload() {
  const payload = new Uint8Array(32);
  payload.fill(0xAA);
  return payload;
}

/**
 * Execute an output endpoint write test against the radio/device hardware instance.
 * @param {Object} radioInstance - Realtek WebUSB or mock radio driver instance
 * @returns {Promise<boolean>} True if the write succeeded, false on error
 */
export async function runOutputTest(radioInstance) {
  try {
    if (!radioInstance) {
      throw new Error('No active hardware radio instance available');
    }

    const payload = getDummyTestPayload();

    // Check common write methods on WASM/WebUSB driver
    if (typeof radioInstance.write === 'function') {
      await radioInstance.write(payload);
      return true;
    }

    if (typeof radioInstance.sendPacket === 'function') {
      await radioInstance.sendPacket(payload, 36);
      return true;
    }

    if (typeof radioInstance.txFrame === 'function') {
      await radioInstance.txFrame(payload);
      return true;
    }

    // Direct WebUSB device transferOut
    if (typeof radioInstance.transferOut === 'function') {
      const ep = typeof radioInstance.bulkOutEndpoint === 'function' ? radioInstance.bulkOutEndpoint() : 2;
      await radioInstance.transferOut(ep, payload);
      return true;
    }

    if (radioInstance.device && typeof radioInstance.device.transferOut === 'function') {
      const ep = typeof radioInstance.bulkOutEndpoint === 'function' ? radioInstance.bulkOutEndpoint() : 2;
      await radioInstance.device.transferOut(ep, payload);
      return true;
    }

    throw new Error('Device instance lacks an output write endpoint method');
  } catch (err) {
    console.warn('Hardware write endpoint test failed:', err?.message || err);
    return false;
  }
}
