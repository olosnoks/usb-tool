// "capture" view of the PortaPack workbench: record the real HackRF IQ stream.
// Saves HackRF-native .c8 (int8 I/Q, hackrf_transfer compatible) or Mayhem's
// .C16 + .TXT pair (int16 I/Q plus sample_rate / center_frequency metadata)
// for the PortaPack Replay app. The same REC button lives on the receiver tab;
// a recording started there can be saved here and vice versa.
import { Disc } from 'lucide-react';
import { RecordControls, CaptureResultCard, CAPTURE_LIMITS_MB } from './IqRecorder';

export default function CaptureView({ driver, state }) {
  const canCapture = state.connectionType === 'webusb';
  const recording = !!state.capturing;
  const maxMb = CAPTURE_LIMITS_MB[CAPTURE_LIMITS_MB.length - 1];

  return (
    <div className="space-y-4 flex-1 font-mono text-xs">
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold text-slate-200 flex items-center gap-2">
              <Disc className={`w-4 h-4 ${recording ? 'text-rose-400 animate-pulse' : 'text-purple-400'}`} />
              RAW IQ RECORDER
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Records the live 8-bit IQ exactly as the HackRF streams it
              {canCapture ? ` — ${(state.frequency / 1e6).toFixed(4)} MHz at ${state.sampleRate / 1e6} Msps (${(state.sampleRate * 2 / 1048576).toFixed(1)} MB/s).` : '. Connect over WebUSB (HackRF mode) to record.'}
            </div>
          </div>
          <RecordControls driver={driver} state={state} />
        </div>
        <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2">
          Up to {maxMb} MB per recording, held in browser memory. At 20 Msps that is about {Math.round(maxMb * 1048576 / (20e6 * 2))} s; at 2 Msps about {Math.round(maxMb * 1048576 / (2e6 * 2))} s.
        </div>
      </div>

      <CaptureResultCard driver={driver} state={state} />
    </div>
  );
}
