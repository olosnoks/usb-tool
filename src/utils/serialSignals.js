/**
 * Serial Hardware Strapping and Signal Timing Controls
 * Eliminates browser-event-loop jitter when entering bootloader mode
 * and controls DTR/RTS strapping pins with millisecond precision.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Triggers ESP32 / ESP8266 ROM bootloader mode using RTS/DTR strapping pins
 * @param {SerialPort} port - Web Serial port instance
 * @param {number} resetDurationMs - Duration to hold EN/Reset low (50ms - 500ms, default 150ms)
 * @param {number} bootHoldDurationMs - Duration to hold GPIO0 low after EN is released (20ms - 250ms, default 50ms)
 */
export async function triggerEspBootloader(
  port,
  resetDurationMs = 150,
  bootHoldDurationMs = 50
) {
  if (!port || !port.setSignals) {
    throw new Error('Port does not support setSignals()');
  }

  // Step 1: Pull EN low, IO0 low
  // In typical auto-program circuits: RTS=true pulls EN low, DTR=false keeps IO0 low
  await port.setSignals({ dataTerminalReady: false, requestToSend: true });
  await sleep(resetDurationMs);

  // Step 2: Release EN high while IO0 remains low
  await port.setSignals({ dataTerminalReady: true, requestToSend: false });
  await sleep(bootHoldDurationMs);

  // Step 3: Release both to idle state
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
}

/**
 * Triggers a normal hard reboot of the microcontroller into application code
 * @param {SerialPort} port - Web Serial port instance
 * @param {number} resetDurationMs - Duration to hold EN low in ms (default 120ms)
 */
export async function triggerEspNormalReset(port, resetDurationMs = 120) {
  if (!port || !port.setSignals) {
    throw new Error('Port does not support setSignals()');
  }

  // Assert Reset (EN low)
  await port.setSignals({ requestToSend: true, dataTerminalReady: false });
  await sleep(resetDurationMs);

  // Release Reset (EN high) with DTR idle so chip boots application
  await port.setSignals({ requestToSend: false, dataTerminalReady: false });
  await sleep(50);
}

/**
 * Asserts a sustained UART line break
 * @param {SerialPort} port - Web Serial port instance
 * @param {number} durationMs - Break duration in ms (default 250ms)
 */
export async function assertUartBreak(port, durationMs = 250) {
  if (!port || !port.setSignals) {
    throw new Error('Port does not support setSignals()');
  }

  await port.setSignals({ break: true });
  await sleep(durationMs);
  await port.setSignals({ break: false });
}

/**
 * Manually sets DTR and RTS pin states
 * @param {SerialPort} port - Web Serial port instance
 * @param {{ dtr?: boolean, rts?: boolean }} signals
 */
export async function setManualSignals(port, { dtr, rts }) {
  if (!port || !port.setSignals) {
    throw new Error('Port does not support setSignals()');
  }

  const payload = {};
  if (dtr !== undefined) payload.dataTerminalReady = !!dtr;
  if (rts !== undefined) payload.requestToSend = !!rts;

  await port.setSignals(payload);
}
