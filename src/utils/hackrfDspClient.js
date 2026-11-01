/**
 * hackrfDspClient.js — one API over the DSP whether it runs in a Web Worker
 * (browser) or inline (tests, or browsers without Worker).
 *
 *   const dsp = createHackRfDsp();
 *   dsp.onSpectrum = (f) => …;   // { spec, peakDb, floorDb, rmsCounts, sampleRate }
 *   dsp.onAudio = (a) => …;      // { samples, rate, channelDb, open }
 *   dsp.configure({ mode: 'NFM', audioOn: true, offsetHz: 25000 });
 *   dsp.push(arrayBuffer);        // takes ownership of the buffer
 *   dsp.terminate();
 */
import { DspCore } from './hackrfDsp.js';

class InlineDsp {
  constructor(config) { this.core = new DspCore(config); this.onSpectrum = null; this.onAudio = null; this.kind = 'inline'; }
  configure(partial) { this.core.configure(partial); }
  push(buf) {
    const r = this.core.process(new Int8Array(buf));
    if (r.spectrum && this.onSpectrum) this.onSpectrum(r.spectrum);
    if (r.audio && this.onAudio) this.onAudio(r.audio);
  }
  terminate() { this.onSpectrum = null; this.onAudio = null; }
}

class WorkerDsp {
  constructor(worker, config) {
    this.worker = worker;
    this.onSpectrum = null; this.onAudio = null; this.kind = 'worker';
    worker.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'spectrum' && this.onSpectrum) this.onSpectrum(m);
      else if (m.type === 'audio' && this.onAudio) this.onAudio(m);
    };
    if (config) this.configure(config);
  }
  configure(partial) { this.worker.postMessage({ type: 'config', ...partial }); }
  push(buf) { this.worker.postMessage({ type: 'iq', buf }, [buf]); }
  terminate() { this.onSpectrum = null; this.onAudio = null; try { this.worker.terminate(); } catch (_) {} }
}

export function createHackRfDsp(config = {}) {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    try {
      const worker = new Worker(new URL('../workers/hackrfDspWorker.js', import.meta.url), { type: 'module' });
      return new WorkerDsp(worker, config);
    } catch (_) { /* fall through to inline */ }
  }
  return new InlineDsp(config);
}
