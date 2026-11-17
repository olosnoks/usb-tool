import React, { useState, useRef } from 'react';
import {
  Radio,
  ExternalLink,
  RotateCcw,
  HardDrive,
  Sparkles
} from 'lucide-react';
import HackRfFlasherWorkbench from './HackRfFlasherWorkbench';
import NativeReceiver from './portapack/NativeReceiver';

export default function PortapackWorkbench() {
  const [activeTab, setActiveTab] = useState('app'); // 'app' | 'receiver' | 'flasher'
  const [iframeKey, setIframeKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef(null);

  const handleReload = () => {
    setIsLoading(true);
    setIframeKey((prev) => prev + 1);
  };

  const handlePopOut = () => {
    window.open('./mayhem/index.html', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-[#0a0d13] text-slate-200 overflow-hidden font-mono select-none">
      {/* Top Cyber Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#0f141f] border-b border-purple-500/30 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-bold text-purple-300">
            <Radio className="w-4 h-4 text-purple-400 animate-pulse" />
            <span className="tracking-wider">PORTAPACK MAYHEM SDR</span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 hidden sm:inline">
            RocketGod Mayhem Mobile Port
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hidden md:inline">
            WebUSB HackRF & RTL-SDR
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-slate-900/90 p-0.5 border border-slate-800">
            <button
              onClick={() => setActiveTab('app')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'app'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Mayhem Mobile SDR</span>
            </button>
            <button
              onClick={() => setActiveTab('receiver')}
              title="Built-in WebUSB receiver: waterfall, demod, sweep, IQ capture, FREQMAN, ADS-B map"
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'receiver'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Built-in Receiver</span>
            </button>
            <button
              onClick={() => setActiveTab('flasher')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'flasher'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>SPI Flasher & Unbrick</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block" />

          {activeTab === 'app' && (
            <button
              onClick={handleReload}
              title="Reload Mayhem Mobile Suite"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-purple-300 border border-slate-800 text-xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={handlePopOut}
            title="Pop out into full tab / new window"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 text-xs transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pop Out</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative flex flex-col bg-[#0a0d13]">
        {activeTab === 'app' ? (
          <div className="relative w-full h-full flex flex-col min-h-0">
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0d13] text-purple-300 space-y-3 font-mono text-xs pointer-events-none">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <div className="tracking-wider">INITIALIZING ROCKETGOD MAYHEM MOBILE...</div>
                <div className="text-[10px] text-slate-500">Loading WebUSB libhackrf driver, DSP worker & AudioWorklet</div>
              </div>
            )}
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src="./mayhem/index.html"
              title="RocketGod Mayhem Mobile SDR"
              className="w-full flex-1 border-0 min-h-0 bg-[#0a0d13]"
              allow="usb; microphone; geolocation; hid"
              onLoad={() => setIsLoading(false)}
            />
            {/* GPL-3.0 §6: the app is served compiled, so offer its corresponding source from the same place */}
            <div className="shrink-0 px-3 py-1 text-[10px] font-mono text-slate-500 border-t border-slate-900 bg-[#070a10]">
              Mayhem Mobile is licensed under the GPL-3.0 (built from PortaPack Mayhem).{' '}
              <a href="./mayhem/mayhem-mobile-source.zip" className="text-purple-300 hover:underline" download>Source code</a>
              {' · '}
              <a href="./mayhem/LICENSE.txt" className="text-purple-300 hover:underline" target="_blank" rel="noreferrer">License</a>
            </div>
          </div>
        ) : activeTab === 'receiver' ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <NativeReceiver />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4 bg-slate-950">
            <HackRfFlasherWorkbench embedded />
          </div>
        )}
      </div>
    </div>
  );
}
