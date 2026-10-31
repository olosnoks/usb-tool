// "device" view of the Flipper Zero workbench (FlipperWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ArrowRight, Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cpu, HardDrive, Monitor, RefreshCw, RotateCcw, Vibrate } from 'lucide-react';
import flipperSvg from '../../../../assets/flipper/flipper.svg';
import { formatBytes } from '../../../../utils/flipperDriver';

export default function DeviceView({
  driver,
  formatKb,
  handleDpadPress,
  handleVibrateTest,
  miniCanvasRef,
  selectedChannel,
  setActiveView,
  setSelectedChannel,
  state,
  vibrating
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column (5 cols): Authentic Flipper Zero Device Silhouette & Screen */}
      <div className="lg:col-span-5 bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col items-center">
        {/* Header: Model & Edition */}
        <div className="w-full flex items-center justify-between pb-3 border-b border-[#232733] mb-5">
          <span className="text-xs font-bold text-[#fe8a2c] flex items-center gap-1.5 font-sans">
            <Bot className="w-4 h-4" />
            <span>FLIPPER ZERO // {state.hardwareModel || (state.isConnected ? 'Querying...' : 'F7')}</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {state.hardwareColor ? `${state.hardwareColor} Edition` : (state.isConnected ? 'Hardware Connected' : '')}
          </span>
        </div>

        {/* Interactive Flipper Zero Body with Live 128x64 LCD Screen */}
        <div className="relative w-full max-w-sm aspect-[360/156] mb-5 flex items-center justify-center group select-none">
          {/* Vector SVG Background Frame */}
          <img 
            src={flipperSvg} 
            alt="Flipper Zero Casing" 
            className="w-full h-full object-contain filter drop-shadow-[0_0_40px_rgba(254,138,44,0.15)]"
          />

          {/* 128x64 Live Monochrome LCD Canvas positioned on LCD cutout (88, 19, 136, 73) */}
          <div 
            onClick={() => setActiveView('screen')}
            className="absolute cursor-pointer rounded overflow-hidden shadow-inner border border-[#9e5823]/60 transition-transform group-hover:scale-[1.02] bg-[#fe8a2c]"
            style={{
              left: '24.4%',
              top: '12.2%',
              width: '37.8%',
              height: '46.8%',
            }}
            title="Click to open full Screen Stream"
          >
            <canvas 
              ref={miniCanvasRef}
              width={128} 
              height={64}
              className="w-full h-full object-fill"
              style={{ imageRendering: 'pixelated' }}
            />

            {/* Screen Stream Hover Cue */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-[9px] gap-1">
              <Monitor className="w-3 h-3 text-[#fe8a2c]" />
              <span>Live Stream</span>
            </div>
          </div>

          {/* Interactive D-Pad Hitboxes on the SVG */}
          {/* Up */}
          <div 
            onClick={() => handleDpadPress('up')}
            className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
            style={{ left: '73%', top: '20%', width: '12%', height: '22%' }}
            title="Press D-Pad Up"
          />
          {/* Down */}
          <div 
            onClick={() => handleDpadPress('down')}
            className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
            style={{ left: '73%', top: '56%', width: '12%', height: '22%' }}
            title="Press D-Pad Down"
          />
          {/* Left */}
          <div 
            onClick={() => handleDpadPress('left')}
            className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
            style={{ left: '64%', top: '38%', width: '10%', height: '22%' }}
            title="Press D-Pad Left"
          />
          {/* Right */}
          <div 
            onClick={() => handleDpadPress('right')}
            className="absolute cursor-pointer hover:bg-[#fe8a2c]/30 rounded-full transition"
            style={{ left: '84%', top: '38%', width: '10%', height: '22%' }}
            title="Press D-Pad Right"
          />
          {/* OK */}
          <div 
            onClick={() => handleDpadPress('ok')}
            className="absolute cursor-pointer hover:bg-[#ff9722]/40 rounded-full transition active:scale-90"
            style={{ left: '74%', top: '38%', width: '10%', height: '22%' }}
            title="Press D-Pad OK"
          />
          {/* Back */}
          <div 
            onClick={() => handleDpadPress('back')}
            className="absolute cursor-pointer hover:bg-[#fe8a2c]/40 rounded-full transition active:scale-90"
            style={{ left: '89%', top: '50%', width: '8%', height: '18%' }}
            title="Press Back Button"
          />
        </div>

        {/* Tactile D-Pad Controller (DirectionalKeypad.qml style) */}
        <div className="w-full bg-[#1e212b] border border-[#2b303c] rounded-2xl p-4 flex flex-col items-center gap-3">
          <div className="text-[10px] font-mono text-slate-400 tracking-wider">
            DIRECTIONAL KEYPAD (D-PAD)
          </div>

          <div className="flex items-center justify-around w-full">
            {/* Circular Dark Orange Ring Keypad */}
            <div className="relative w-32 h-32 rounded-full bg-[#491d00] border-2 border-[#ff9722] flex items-center justify-center shadow-lg">
              {/* Up */}
              <button
                onClick={() => handleDpadPress('up')}
                className="absolute top-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                title="D-Pad Up"
              >
                <ChevronUp className="w-6 h-6 stroke-[3]" />
              </button>

              {/* Left */}
              <button
                onClick={() => handleDpadPress('left')}
                className="absolute left-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                title="D-Pad Left"
              >
                <ChevronLeft className="w-6 h-6 stroke-[3]" />
              </button>

              {/* OK Center Button */}
              <button
                onClick={() => handleDpadPress('ok')}
                className="w-10 h-10 rounded-full bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold flex items-center justify-center shadow-md active:scale-90 transition text-xs font-mono"
                title="D-Pad OK"
              >
                OK
              </button>

              {/* Right */}
              <button
                onClick={() => handleDpadPress('right')}
                className="absolute right-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                title="D-Pad Right"
              >
                <ChevronRight className="w-6 h-6 stroke-[3]" />
              </button>

              {/* Down */}
              <button
                onClick={() => handleDpadPress('down')}
                className="absolute bottom-1.5 p-1.5 text-[#ff9722] hover:text-white hover:bg-white/10 rounded-full transition active:scale-90"
                title="D-Pad Down"
              >
                <ChevronDown className="w-6 h-6 stroke-[3]" />
              </button>
            </div>

            {/* Back Button & Vibration Motor */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => handleDpadPress('back')}
                className="px-4 py-2.5 bg-[#2a1708] hover:bg-[#3d220c] border border-[#ff9722]/50 text-[#ff9722] rounded-xl text-xs font-mono font-bold transition active:scale-95 shadow"
                title="Press Back Button"
              >
                ◀ BACK
              </button>

              <button
                onClick={handleVibrateTest}
                disabled={vibrating}
                className="px-3.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded-xl text-[10px] font-mono transition flex items-center gap-1.5"
                title="Test physical vibration motor"
              >
                <Vibrate className="w-3.5 h-3.5" />
                <span>{vibrating ? 'Buzzing...' : 'Vibrate'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column (7 cols): qFlipper Hardware, Storage & Firmware Overview */}
      <div className="lg:col-span-7 bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
        <div>
          {/* Top Bar: Device Name & Action */}
          <div className="flex items-center justify-between pb-4 border-b border-[#232733]">
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide font-sans">
                {state.deviceName || (state.isConnected ? 'Flipper Zero' : 'qFlipper Suite')}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Target: <span className="text-slate-200 font-semibold">{state.hardwareModel || (state.isConnected ? 'Querying Target...' : '--')}</span>
              </p>
            </div>

            <button
              onClick={() => setActiveView('screen')}
              className="px-4 py-2 bg-[#fe8a2c]/20 hover:bg-[#fe8a2c]/30 border border-[#fe8a2c]/50 text-[#fe8a2c] rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 shadow"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Screen Stream</span>
            </button>
          </div>

          {/* Firmware Section (qFlipper Style with Update / Reinstall Button) */}
          <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">FIRMWARE VERSION</span>
                <div className="text-base font-bold text-white mt-0.5 flex items-center gap-2">
                  <span>{state.firmwareVersion || (state.isConnected ? 'Reading Firmware...' : '--')}</span>
                  {state.firmwareVersion && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Active</span>
                  )}
                </div>
              </div>

              {/* Firmware Channel Selector */}
              <div className="flex items-center bg-[#171920] border border-[#2b303c] p-1 rounded-xl gap-1">
                {['Release', 'Release-Candidate', 'Dev'].map(ch => (
                  <button
                    key={ch}
                    onClick={() => setSelectedChannel(ch)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition ${
                      selectedChannel === ch 
                        ? 'bg-[#fe8a2c] text-slate-950 shadow' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#232733] text-xs">
              <span className="text-slate-400">Branch: <strong className="text-slate-200 font-mono text-[11px]">{state.firmwareBranch || (state.isConnected ? 'installed' : '--')}</strong></span>
              <button
                onClick={() => driver.refreshAllRealData()}
                className="px-4 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl text-xs font-sans transition shadow-lg shadow-[#fe8a2c]/25 flex items-center gap-1.5 active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>SYNC TELEMETRY</span>
              </button>
            </div>
          </div>

          {/* Storage Meters (qFlipper Style Progress Bars) */}
          <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">STORAGE CAPACITY</span>
              {state.isConnected && (
                <button
                  onClick={() => driver.refreshStorageInfo()}
                  className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
                  title="Re-query physical storage info"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
              )}
            </div>

            {/* MicroSD Card Progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-200 font-bold flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-[#fe8a2c]" />
                  <span>MicroSD Card (/ext)</span>
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  {state.sdMounted === true && (state.sdTotalBytes != null || state.sdTotalKb != null)
                    ? `${state.sdFreeBytes != null ? formatBytes(state.sdFreeBytes) : formatKb(state.sdFreeKb)} Free / ${state.sdTotalBytes != null ? formatBytes(state.sdTotalBytes) : formatKb(state.sdTotalKb)} Total` 
                    : (state.sdMounted === false 
                        ? 'No MicroSD Card Inserted' 
                        : (state.isConnected ? 'Reading MicroSD...' : '--'))}
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                <div 
                  className="h-full bg-gradient-to-r from-[#fe8a2c] to-[#ff9722] rounded-full transition-all duration-500"
                  style={{ 
                    width: (state.sdTotalBytes && state.sdFreeBytes != null)
                      ? `${Math.max(2, Math.min(100, ((Number(state.sdTotalBytes) - Number(state.sdFreeBytes)) / Number(state.sdTotalBytes)) * 100))}%`
                      : (state.sdTotalKb && state.sdFreeKb != null
                          ? `${Math.max(2, Math.min(100, ((state.sdTotalKb - state.sdFreeKb) / state.sdTotalKb) * 100))}%`
                          : '0%')
                  }}
                />
              </div>
            </div>

            {/* Internal Flash Memory Progress */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-200 font-bold flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-[#228cff]" />
                  <span>Internal Flash (/int)</span>
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  {(state.intTotalBytes != null || state.intTotalKb != null)
                    ? `${state.intFreeBytes != null ? formatBytes(state.intFreeBytes) : formatKb(state.intFreeKb)} Free / ${state.intTotalBytes != null ? formatBytes(state.intTotalBytes) : formatKb(state.intTotalKb)} Total` 
                    : (state.isConnected ? 'Not reported by firmware' : '--')}
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#171920] rounded-full overflow-hidden border border-[#2b303c]">
                <div 
                  className="h-full bg-[#228cff] rounded-full transition-all duration-500"
                  style={{ 
                    width: (state.intTotalBytes && state.intFreeBytes != null)
                      ? `${Math.max(2, Math.min(100, ((Number(state.intTotalBytes) - Number(state.intFreeBytes)) / Number(state.intTotalBytes)) * 100))}%`
                      : (state.intTotalKb && state.intFreeKb != null
                          ? `${Math.max(2, Math.min(100, ((state.intTotalKb - state.intFreeKb) / state.intTotalKb) * 100))}%`
                          : '0%')
                  }}
                />
              </div>
            </div>
          </div>

          {/* Battery & Power Info */}
          <div className="mt-5 p-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block font-sans">BATTERY HEALTH</span>
              <div className="text-base font-bold text-emerald-400 mt-0.5 flex items-center gap-2">
                <span>{state.batteryPercent !== null ? `${state.batteryPercent}%` : '--'}</span>
                <span className="text-xs text-slate-400 font-normal">{state.batteryVoltageMv ? `(${state.batteryVoltageMv} mV)` : ''}</span>
                {state.chargeState && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono capitalize">
                    {state.chargeState}
                  </span>
                )}
              </div>
            </div>

            <div className="text-right text-xs text-slate-400 space-y-0.5">
              <div>Temp: <strong className="text-slate-200">{state.batteryTempC !== null ? `${state.batteryTempC} °C` : '--'}</strong></div>
              <div>Health: <strong className="text-emerald-400">{state.batteryHealth !== null ? (typeof state.batteryHealth === 'number' || /^\d+$/.test(String(state.batteryHealth)) ? `${state.batteryHealth}%` : state.batteryHealth) : '--'}</strong></div>
            </div>
          </div>
        </div>

        {/* Bottom Hardware Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-[#232733]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => driver.reboot()}
              className="px-3.5 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#fe8a2c]" />
              <span>Reboot Flipper</span>
            </button>

            <button
              onClick={() => driver.dfu()}
              className="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 rounded-xl text-xs font-mono transition"
            >
              DFU Recovery
            </button>
          </div>

          <button
            onClick={() => setActiveView('files')}
            className="px-4 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-xl text-xs font-sans transition flex items-center gap-1.5 shadow-md shadow-[#fe8a2c]/20 active:scale-95"
          >
            <span>OPEN FILE MANAGER</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
