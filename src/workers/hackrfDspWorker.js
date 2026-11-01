// Web Worker: HackRF receive DSP off the main thread.
// Messages in:  { type: 'config', ...partial }   { type: 'iq', buf: ArrayBuffer }
// Messages out: { type: 'spectrum', spec, peakDb, floorDb, rmsCounts, sampleRate }
//               { type: 'audio', samples, rate, channelDb, open }
import { DspCore } from '../utils/hackrfDsp.js';

const core = new DspCore();

self.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  if (m.type === 'config') {
    const { type, ...partial } = m;
    core.configure(partial);
    return;
  }
  if (m.type === 'iq' && m.buf) {
    const r = core.process(new Int8Array(m.buf));
    if (r.spectrum) self.postMessage({ type: 'spectrum', ...r.spectrum }, [r.spectrum.spec.buffer]);
    if (r.audio) self.postMessage({ type: 'audio', ...r.audio }, [r.audio.samples.buffer]);
  }
};
