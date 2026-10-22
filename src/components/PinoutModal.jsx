import React, { useState } from 'react';
import { Cpu, X, Zap, Layers, AlertTriangle, ShieldCheck } from 'lucide-react';

export default function PinoutModal({ isOpen, onClose }) {
  const [selectedBoard, setSelectedBoard] = useState('esp32'); // 'esp32' | 'esp32-s3' | 'rp2040' | 'ftdi' | 'shifter'

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-4 space-y-3 font-mono text-xs shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyber-amber" />
            <h3 className="font-bold text-slate-100 tracking-wider">HARDWARE PINOUT & SAFETY CHEAT SHEET</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-base font-bold">&times;</button>
        </div>

        {/* Board Tabs */}
        <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
          {[
            { id: 'esp32', label: 'ESP32-WROOM' },
            { id: 'esp32-s3', label: 'ESP32-S3' },
            { id: 'rp2040', label: 'Raspberry Pi Pico' },
            { id: 'ftdi', label: 'FTDI / CP2102 6-Pin' },
            { id: 'shifter', label: '5V → 3.3V Divider' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedBoard(tab.id)}
              className={`px-2.5 py-1 rounded font-bold transition-all ${
                selectedBoard === tab.id ? 'bg-amber-500/20 text-cyber-amber border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: ESP32-WROOM-32 */}
        {selectedBoard === 'esp32' && (
          <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyber-amber">ESP32-WROOM-32 (38-Pin DevKit)</span>
              <span className="text-[10px] text-emerald-400">Operating: 3.0V - 3.6V (3.3V Logic)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1">
                <span className="text-slate-500 block uppercase text-[9px] font-bold">UART0 Flashing Pins</span>
                <div>TXD0: <strong className="text-cyber-amber">GPIO1</strong> (Connect to Programmer RX)</div>
                <div>RXD0: <strong className="text-cyber-cyan">GPIO3</strong> (Connect to Programmer TX)</div>
                <div>GND: <strong className="text-slate-400">Common Ground</strong> (Essential!)</div>
              </div>

              <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1">
                <span className="text-slate-500 block uppercase text-[9px] font-bold">Boot Strapping Pins</span>
                <div>EN (Chip Enable): <strong className="text-rose-400">Pin 3</strong> (Pulled Low to Reset)</div>
                <div>IO0 (Boot Mode): <strong className="text-purple-400">GPIO0</strong> (Hold Low on Boot for ROM)</div>
                <div>IO2: Leave floating or pull low during boot</div>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 italic">
              * Note: Many ESP32 boards have an auto-reset circuit using two NPN transistors where DTR controls IO0 and RTS controls EN.
            </p>
          </div>
        )}

        {/* Tab 2: ESP32-S3 */}
        {selectedBoard === 'esp32-s3' && (
          <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800">
            <span className="font-bold text-cyber-cyan">ESP32-S3 Dual-Port Architecture</span>
            <div className="space-y-1.5 text-[11px]">
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <strong className="text-cyber-emerald">Native USB Serial/JTAG (Direct USB-C)</strong>
                <p className="text-slate-400 text-[10px] mt-0.5">D+ (GPIO20) / D- (GPIO19). Connects directly to PC without a bridge chip!</p>
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <strong className="text-cyber-amber">Hardware UART0</strong>
                <p className="text-slate-400 text-[10px] mt-0.5">TX (GPIO43) / RX (GPIO44). Used on dual-USB devkits.</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Raspberry Pi Pico */}
        {selectedBoard === 'rp2040' && (
          <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800">
            <span className="font-bold text-cyber-emerald">Raspberry Pi Pico (RP2040) Pinout</span>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <strong className="text-cyber-cyan">UART0 Default</strong>
                <div>TX: <strong className="text-slate-200">GP0 (Pin 1)</strong></div>
                <div>RX: <strong className="text-slate-200">GP1 (Pin 2)</strong></div>
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <strong className="text-cyber-amber">UART1 Default</strong>
                <div>TX: <strong className="text-slate-200">GP4 (Pin 6)</strong></div>
                <div>RX: <strong className="text-slate-200">GP5 (Pin 7)</strong></div>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Touch baud 1200 bps will automatically trigger Pico into USB BOOTSEL mass-storage mode.</p>
          </div>
        )}

        {/* Tab 4: FTDI / CP2102 Header */}
        {selectedBoard === 'ftdi' && (
          <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800">
            <span className="font-bold text-slate-200">Standard 6-Pin FTDI / CP2102 Programmer Header</span>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-center">
              <div className="grid grid-cols-6 gap-1 text-[10px] text-slate-400 pb-1 border-b border-slate-800">
                <span>PIN 1</span><span>PIN 2</span><span>PIN 3</span><span>PIN 4</span><span>PIN 5</span><span>PIN 6</span>
              </div>
              <div className="grid grid-cols-6 gap-1 text-xs font-bold pt-1.5">
                <span className="text-slate-400">GND</span>
                <span className="text-emerald-400">CTS</span>
                <span className="text-rose-400">VCC</span>
                <span className="text-cyber-amber">TXD</span>
                <span className="text-cyber-cyan">RXD</span>
                <span className="text-purple-400">DTR</span>
              </div>
            </div>
            <div className="text-[10px] text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Verify that VCC is set to 3.3V (NOT 5V) before connecting to ESP32 or modern ARM chips!</span>
            </div>
          </div>
        )}

        {/* Tab 5: Level Shifter Voltage Divider */}
        {selectedBoard === 'shifter' && (
          <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800">
            <span className="font-bold text-cyber-amber">5V → 3.3V Resistor Voltage Divider</span>
            <p className="text-slate-400 text-[10px]">
              If your target operates at 5V (e.g. Arduino Uno 5V TX pin) and you are connecting to a 3.3V RX pin (ESP32 / Raspberry Pi), use two resistors:
            </p>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-[11px] leading-relaxed">
              <div>5V TX Pin ───[ 1 kΩ (R1) ]───┬─── 3.3V Target RX</div>
              <div>                                 │</div>
              <div>                           [ 2 kΩ (R2) ]</div>
              <div>                                 │</div>
              <div>                                GND</div>
            </div>
            <div className="text-[10px] text-emerald-400">
              Formula: Vout = Vin × (R2 / (R1 + R2)) = 5V × (2000 / 3000) = <strong>3.33 Volts</strong>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
        >
          Close Cheat Sheet
        </button>
      </div>
    </div>
  );
}
