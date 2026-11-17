// Runs the usb-rea analysis off the main thread so the UI stays responsive on big captures.
// Messages in:  { type: 'analyze', id, bytes, name, markers, labels, device, markerOffset }
// Messages out: { type: 'progress', id, stage, fraction } | { type: 'result', id, outputs } | { type: 'error', id, message }
// `run_job` is exported (and has no Worker dependency) so tests can drive it directly.
import { analyze, sha256 } from './pipeline.js';
import { render as renderReport } from './report.js';
import { generate as generateScaffold } from './scaffold.js';
import { generate as generateDissector } from './dissector.js';

export function protocol_json(proto) {
  return JSON.stringify(
    proto.to_dict ? proto.to_dict() : proto,
    (k, v) => (v instanceof Uint8Array ? Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('') : v === Infinity ? null : v),
    1,
  );
}

export async function run_job(msg, post) {
  const { id, bytes, name, markers = null, labels = null, device = null, markerOffset = 0 } = msg;
  try {
    const proto = analyze(bytes, markers, device, labels, {
      markerOffset,
      onProgress: (stage, fraction) => post({ type: 'progress', id, stage, fraction }),
    });
    post({ type: 'progress', id, stage: 'Rendering outputs', fraction: 0.9 });
    const digest = await sha256(bytes);
    const base = (name || 'device').replace(/\.(gz)$/i, '').replace(/\.(pcapng|pcap)$/i, '').replace(/[^\w.-]+/g, '_') || 'device';
    post({
      type: 'result',
      id,
      outputs: {
        base,
        commands: proto.commands.length,
        report: renderReport(proto, name, digest),
        scaffold: generateScaffold(proto),
        dissector: generateDissector(proto, base),
        json: protocol_json(proto),
      },
    });
  } catch (err) {
    post({ type: 'error', id, message: (err && err.message) || String(err) });
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    if (e.data && e.data.type === 'analyze') run_job(e.data, (m) => self.postMessage(m));
  };
}
