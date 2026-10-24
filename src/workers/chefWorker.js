/**
 * chefWorker.js
 * Dedicated Web Worker for CyberChef pipeline execution.
 * Offloads compute-heavy cryptographic hashing, compression, decryption, and multi-step recipe baking.
 */

import { Chef, Dish } from '../utils/cyberchef/index.js';

const chef = new Chef();

self.onmessage = async function (event) {
  const data = event.data;
  if (!data) return;

  const id = data.id || Date.now();
  const startTime = performance.now();

  try {
    const input = data.input !== undefined ? data.input : '';
    const recipeConfig = Array.isArray(data.recipe) ? data.recipe : [];
    const options = data.options || {};

    const outputDish = await chef.bake(input, recipeConfig, options);
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

    self.postMessage({
      id,
      success: true,
      result: outputDish.toString(),
      hex: outputDish.toHex(' '),
      base64: outputDish.toBase64(),
      hexdump: outputDish.toHexdump ? outputDish.toHexdump() : '',
      type: outputDish.type,
      length: outputDish.length,
      paused: !!outputDish.paused,
      pausedStepIndex: outputDish.pausedStepIndex !== undefined ? outputDish.pausedStepIndex : null,
      pausedStepOp: outputDish.pausedStepOp || null,
      durationMs
    });
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: err && err.message ? err.message : String(err),
      durationMs: Math.round((performance.now() - startTime) * 100) / 100
    });
  }
};
