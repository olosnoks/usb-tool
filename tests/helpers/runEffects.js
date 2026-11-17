// Server rendering never runs effects. This helper makes useEffect run synchronously during
// render so a component's subscribeRx wiring can be driven with a fake serial source in the
// node test environment (no DOM available). Use via:
//   vi.mock('react', async (orig) => (await import('./helpers/runEffects.js')).mockReactEffects(await orig()));
export const cleanups = [];

export function mockReactEffects(actual) {
  const useEffect = (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c); };
  return { ...actual, useEffect, useLayoutEffect: useEffect, default: { ...actual.default, useEffect, useLayoutEffect: useEffect } };
}

export function makeFakeSerial() {
  const listeners = new Set();
  return {
    subscribeRx: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: (s) => { const b = typeof s === 'string' ? new TextEncoder().encode(s) : s; for (const l of [...listeners]) l(b, 'board-1'); },
    count: () => listeners.size
  };
}
