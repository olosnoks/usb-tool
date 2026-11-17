// RX accumulation and "wait for expected text" for the Test Runner.

export function createRxBuffer() {
  let text = '';
  return {
    append(chunk) { text += chunk; },
    clear() { text = ''; },
    get text() { return text; },
  };
}

/**
 * Poll `buffer` until it contains `expected` or the timeout elapses.
 * Resolves true on match. `isActive` lets an abort end the wait early.
 */
export async function waitForExpect(buffer, expected, timeoutMs, {
  isActive = () => true,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = 50,
} = {}) {
  const deadline = now() + timeoutMs;
  while (isActive()) {
    if (buffer.text.includes(expected)) return true;
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
  return false;
}
