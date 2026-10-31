// "tx" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { RadioTower, Shield, ShieldCheck } from 'lucide-react';

export default function TxView({
  driver,
  isTransmitting,
  setIsTransmitting,
  setTxConfirmed,
  setTxMode,
  setTxText,
  setTxVga,
  state,
  txConfirmed,
  txMode,
  txText,
  txVga
}) {
  return (
    <div className="space-y-4 flex-1 flex flex-col font-mono text-xs">
      {!txConfirmed ? (
        <div className="bg-amber-950/60 border border-amber-500/50 rounded-xl p-5 text-amber-200 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
            <Shield className="w-5 h-5 text-amber-400" />
            <span>RF TRANSMIT SAFETY CONFIRMATION (RocketGod Protocol)</span>
          </div>
          <p className="text-xs text-amber-300/90 leading-relaxed">
            Do you have an antenna or dummy load connected? In accordance with RF regulations, 
            transmissions must only be operated on permitted amateur frequencies or into a 50Ω dummy load.
          </p>
          <button
            onClick={() => setTxConfirmed(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs transition flex items-center gap-2 shadow-lg"
          >
            <ShieldCheck className="w-4 h-4" />
            I Have an Antenna / Dummy Load Connected (Enable TX)
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-bold">TRANSMIT MODE</span>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded p-0.5 text-xs">
                {[
                  { id: 'tone', name: '1 kHz Tone' },
                  { id: 'cw', name: 'CW Carrier' },
                  { id: 'pocsag', name: 'POCSAG Pager' },
                  { id: 'adsb', name: 'ADS-B Burst' }
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setTxMode(m.id)}
                    className={`px-2.5 py-1 rounded transition ${txMode === m.id ? 'bg-rose-600 text-white font-bold' : 'text-slate-400'}`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>TX VGA GAIN</span>
                  <span className="text-rose-400 font-bold">{txVga} dB</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="47"
                  step="1"
                  value={txVga}
                  onChange={(e) => setTxVga(parseInt(e.target.value))}
                  className="w-full accent-rose-500"
                />
                <span className="text-[10px] text-slate-500">Range: 0 to 47 dB</span>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>TX AMP (+14 dB)</span>
                  <span className={state.amp > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}>
                    {state.amp > 0 ? 'ACTIVE' : 'BYPASS'}
                  </span>
                </div>
                <button
                  onClick={() => driver.sendCommand(`amp ${state.amp > 0 ? '0' : '1'}`)}
                  className={`w-full py-1 rounded border text-xs transition ${
                    state.amp > 0 ? 'bg-rose-600/30 border-rose-500 text-rose-300' : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {state.amp > 0 ? 'RF Pre-Amp Enabled (+14 dB)' : 'RF Pre-Amp Bypassed'}
                </button>
              </div>
            </div>

            {txMode === 'pocsag' && (
              <div className="pt-2">
                <label className="text-[10px] text-slate-400 block mb-1">PAGER ALPHANUMERIC MESSAGE</label>
                <input
                  type="text"
                  value={txText}
                  onChange={(e) => setTxText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-rose-300 font-mono"
                />
              </div>
            )}

            <div className="pt-2 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                Carrier: <span className="text-white font-bold">{(state.frequency / 1e6).toFixed(4)} MHz</span>
              </div>
              <button
                onClick={async () => {
                  setIsTransmitting(true);
                  driver.log(`[TX RocketGod] Emitting ${txMode.toUpperCase()} burst on ${(state.frequency / 1e6).toFixed(4)} MHz...`, 'warning');
                  setTimeout(() => {
                    setIsTransmitting(false);
                    driver.log(`[TX RocketGod] Transmission complete. Transceiver returned to RX mode.`, 'success');
                  }, 2500);
                }}
                disabled={isTransmitting}
                className={`px-5 py-2 rounded-lg font-bold transition flex items-center gap-2 shadow-lg ${
                  isTransmitting
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                }`}
              >
                <RadioTower className="w-4 h-4" />
                {isTransmitting ? 'TRANSMITTING RF...' : 'TRANSMIT BURST (PTT)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
