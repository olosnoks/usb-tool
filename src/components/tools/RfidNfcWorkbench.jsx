import React, { useState } from 'react';
import { 
  Radio, 
  Layers, 
  RotateCcw, 
  Copy, 
  Check, 
  Sparkles, 
  ShieldCheck, 
  AlertTriangle, 
  Key, 
  Lock, 
  Search,
  CheckCircle2
} from 'lucide-react';
import { 
  RfidNfcClient, 
  SAMPLE_SCANNED_CARDS 
} from '../../utils/rfidNfcDriver';
import StatusBadge from '../common/StatusBadge';

export default function RfidNfcWorkbench() {
  const [client] = useState(() => new RfidNfcClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);

  const [activeBand, setActiveBand] = useState('125khz'); // '125khz' | '13mhz'
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCard, setScannedCard] = useState(null);
  const [cloneStatus, setCloneStatus] = useState('');

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    handleScanTag('125khz');
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setScannedCard(null);
    setCloneStatus('');
  };

  const handleScanTag = async (band = activeBand) => {
    if (!isConnected) return;
    setIsScanning(true);
    setCloneStatus('');

    let card = null;
    if (band === '125khz') {
      card = await client.scan125Khz();
    } else {
      card = await client.scan13Mhz();
    }

    setScannedCard(card);
    setIsScanning(false);
  };

  const handleCloneT5577 = async () => {
    if (!isConnected || !scannedCard) return;
    setCloneStatus('Programming T5577 card...');
    await client.cloneToT5577(scannedCard);
    setCloneStatus('SUCCESS: Tag cloned to T5577! Verified ready for door entry.');
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-400" />
              <span>RFID / NFC BADGE DECK & PROXMARK3 COMPANION</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Read, decode, and clone 125kHz LF badges (EM4100, HID Prox) and 13.56MHz NFC smart cards (Mifare Classic 1K, NTAG215).
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnectSimulation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/50 hover:bg-purple-500/30 text-xs font-bold transition-all shadow-purple-glow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>CONNECT PROXMARK3 (DEMO)</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Band Selector & Scan Button */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => { setActiveBand('125khz'); handleScanTag('125khz'); }}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  activeBand === '125khz' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-purple-glow' : 'text-slate-400'
                }`}
              >
                125 kHz (Low Frequency)
              </button>
              <button
                onClick={() => { setActiveBand('13mhz'); handleScanTag('13mhz'); }}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  activeBand === '13mhz' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-cyan-glow' : 'text-slate-400'
                }`}
              >
                13.56 MHz (NFC / High Frequency)
              </button>
            </div>

            <button
              onClick={() => handleScanTag()}
              disabled={!isConnected || isScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-purple-glow transition-all disabled:opacity-40"
            >
              <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SEARCHING FIELD...' : 'SCAN PROXIMITY CARD'}</span>
            </button>
          </div>

          <span className="text-[10px] text-slate-500">
            Hardware: <strong className="text-cyan-400">Proxmark3 RDV4 / USB CDC</strong>
          </span>
        </div>
      </div>

      {/* Scanned Tag Results */}
      {scannedCard && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Tag Metadata & Card Art */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>DECODED TAG METADATA</span>
              </span>
              <span className="text-[10px] text-purple-400 font-bold">{scannedCard.band}</span>
            </div>

            {/* Virtual Card Preview Graphic */}
            <div className="relative h-28 bg-gradient-to-tr from-slate-900 via-indigo-950 to-purple-950 rounded-xl p-3 border border-purple-500/30 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider">SKON ACCESS DECK</span>
                <Radio className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <span className="text-lg font-mono font-black text-white tracking-widest block">
                  {scannedCard.uidHex}
                </span>
                <span className="text-[9px] text-purple-300 font-bold">{scannedCard.chipType}</span>
              </div>
            </div>

            <div className="space-y-2 pt-2 text-[11px]">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Card Technology</span>
                <span className="font-bold text-slate-200">{scannedCard.chipType}</span>
              </div>

              {scannedCard.wiegand && (
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-amber-400 uppercase font-bold block">HID Wiegand Protocol</span>
                  <div>Facility Code: <strong className="text-cyan-300">{scannedCard.wiegand.facilityCode}</strong></div>
                  <div>Card Number: <strong className="text-emerald-300">{scannedCard.wiegand.cardNumber}</strong></div>
                </div>
              )}

              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Description</span>
                <p className="text-slate-400 text-[10px]">{scannedCard.desc}</p>
              </div>
            </div>

            {/* Clone Button */}
            {scannedCard.cloneableTo && (
              <div className="pt-2">
                <button
                  onClick={handleCloneT5577}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all"
                >
                  CLONE BADGE TO T5577 TRANSPONDER
                </button>
                {cloneStatus && (
                  <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
                    {cloneStatus}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Mifare Sector Dump (13.56MHz) */}
          <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>MIFARE CLASSIC 1K MEMORY SECTORS (16 SECTORS)</span>
              </span>
              <span className="text-[10px] text-slate-500">Key A/B & Access Bits</span>
            </div>

            {client.mifareSectors.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                {client.mifareSectors.map((sec) => (
                  <div key={sec.sector} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[11px]">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-850">
                      <span className="font-bold text-cyan-400">SECTOR {sec.sector}</span>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span>Key A: <strong className="text-amber-300">{sec.keyA}</strong></span>
                        <span>Key B: <strong className="text-emerald-300">{sec.keyB}</strong></span>
                      </div>
                    </div>

                    <div className="pt-1.5 space-y-1 font-mono text-[10px] text-slate-300">
                      {sec.dataBlocks.map((blk, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-slate-900/60 px-2 py-0.5 rounded">
                          <span className="text-slate-500">Block {sec.sector * 4 + idx}:</span>
                          <span className="text-slate-300">{blk}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-center py-12 text-xs">
                Scan a 13.56 MHz Mifare card to inspect all 16 memory sectors and cryptographic keys.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
