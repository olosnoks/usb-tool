// "screen" view of the Flipper Zero workbench (FlipperWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Keyboard, Monitor } from 'lucide-react';

export default function ScreenView({
  driver,
  handleDpadPress,
  handleScreenshot,
  keyboardNavEnabled,
  screenCanvasRef,
  setKeyboardNavEnabled,
  setState,
  state
}) {
  return (
    <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center">
      {/* Screen Stream Toolbar */}
      <div className="w-full flex items-center justify-between pb-4 border-b border-[#232733] mb-6">
        <div className="flex items-center gap-2 font-sans">
          <Monitor className="w-4 h-4 text-[#fe8a2c]" />
          <span className="font-bold text-white text-sm">SCREEN STREAMING // 128x64 LCD</span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">LIVE</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (driver.isScreenStreaming) {
                await driver.stopScreenStream();
              } else {
                await driver.startScreenStream();
              }
              setState({ ...driver.state });
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 ${
              driver.isScreenStreaming 
                ? 'bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30' 
                : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30'
            }`}
            title={driver.isScreenStreaming ? "Pause Live Screen Streaming" : "Start Live Screen Streaming"}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>{driver.isScreenStreaming ? 'Pause Stream' : 'Start Stream'}</span>
          </button>

          <button
            onClick={() => setKeyboardNavEnabled(!keyboardNavEnabled)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition flex items-center gap-1.5 ${
              keyboardNavEnabled 
                ? 'bg-[#fe8a2c]/20 text-[#fe8a2c] border border-[#fe8a2c]/50 font-bold' 
                : 'bg-[#1e212b] text-slate-400 border border-[#2e3444]'
            }`}
            title="Control Flipper using your PC keyboard arrow keys + Enter + Esc"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Keyboard Remote: {keyboardNavEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={handleScreenshot}
            className="px-3.5 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5"
            title="Save current screen as PNG"
          >
            <Camera className="w-3.5 h-3.5 text-cyan-400" />
            <span>Screenshot</span>
          </button>
        </div>
      </div>

      {/* Large Screen Frame (Scaled 128x64 Monochrome Orange Display) */}
      <div className="relative p-6 bg-[#1e212b] border-4 border-[#9e5823] rounded-3xl shadow-[0_0_60px_rgba(254,138,44,0.25)] max-w-xl w-full flex flex-col items-center">
        <div className="w-full aspect-[2/1] bg-[#fe8a2c] rounded-2xl overflow-hidden shadow-inner border border-[#ce5300] relative flex items-center justify-center p-2">
          <canvas 
            ref={screenCanvasRef}
            width={128} 
            height={64}
            className="w-full h-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between w-full px-2 text-[10px] text-amber-500/80 font-bold uppercase tracking-widest font-mono">
          <span>FLIPPER ZERO // 128x64 ST7567 LCD</span>
          <span className={driver.isScreenStreaming ? 'text-emerald-400 font-mono flex items-center gap-1.5' : 'text-slate-400 font-mono flex items-center gap-1.5'}>
            {driver.isScreenStreaming && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>}
            {driver.isScreenStreaming 
              ? `STREAMING REAL HARDWARE LCD ${state.screenFrameCount ? `(${state.screenFrameCount} frames)` : ''}` 
              : 'STREAM STANDBY'}
          </span>
        </div>
      </div>

      {/* Directional Keypad Controls */}
      <div className="mt-8 flex items-center justify-center gap-6">
        <button
          onClick={() => handleDpadPress('left')}
          className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
          title="Left Arrow"
        >
          <ChevronLeft className="w-5 h-5 text-[#fe8a2c]" />
        </button>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleDpadPress('up')}
            className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
            title="Up Arrow"
          >
            <ChevronUp className="w-5 h-5 text-[#fe8a2c]" />
          </button>

          <button
            onClick={() => handleDpadPress('ok')}
            className="px-6 py-3 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl active:scale-95 transition shadow-lg shadow-[#fe8a2c]/30 text-sm font-mono"
            title="Enter / OK"
          >
            OK
          </button>

          <button
            onClick={() => handleDpadPress('down')}
            className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
            title="Down Arrow"
          >
            <ChevronDown className="w-5 h-5 text-[#fe8a2c]" />
          </button>
        </div>

        <button
          onClick={() => handleDpadPress('right')}
          className="p-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-white rounded-xl active:scale-95 transition"
          title="Right Arrow"
        >
          <ChevronRight className="w-5 h-5 text-[#fe8a2c]" />
        </button>

        <button
          onClick={() => handleDpadPress('back')}
          className="px-4 py-3 bg-[#1e212b] hover:bg-[#fe8a2c]/30 border border-[#2e3444] text-[#fe8a2c] rounded-xl active:scale-95 transition font-bold text-xs"
          title="Escape / Back"
        >
          ◀ BACK
        </button>
      </div>

      <p className="mt-4 text-[11px] text-slate-500 font-mono">
        Tip: Use your computer's <strong>Arrow keys</strong>, <strong>Enter</strong> (OK), and <strong>Esc / Backspace</strong> (Back) to navigate your Flipper!
      </p>
    </div>
  );
}
