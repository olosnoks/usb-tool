import React, { useState, useMemo } from 'react';
import { 
  Send, 
  Binary, 
  CheckCircle, 
  HelpCircle, 
  BookmarkPlus, 
  Trash2, 
  Cpu, 
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { 
  parseHexInput, 
  formatBytesToHex, 
  calculateModbusCRC16, 
  calculateSum8, 
  calculateTwoComplementSum8, 
  calculateXOR,
  calculateCRC16CCITT
} from '../utils/checksums';

const PRESET_FRAMES = [
  {
    name: 'Modbus RTU: Read Holding Registers (Reg 0x0000, Count 2)',
    payload: '01 03 00 00 00 02',
    algorithm: 'modbus-le'
  },
  {
    name: 'Modbus RTU: Read Input Status (Coils 0x0000, Count 8)',
    payload: '01 02 00 00 00 08',
    algorithm: 'modbus-le'
  },
  {
    name: 'Modbus RTU: Write Single Register (Reg 0x0001, Val 0x0064)',
    payload: '01 06 00 01 00 64',
    algorithm: 'modbus-le'
  },
  {
    name: 'ESP ROM Bootloader Sync Frame (0x08)',
    payload: '08 00 00 00 00 00 00 00',
    algorithm: 'none'
  },
  {
    name: 'Standard Hardware Ping Frame (0x55 0xAA 0x01)',
    payload: '55 AA 01 00',
    algorithm: 'xor'
  }
];

export default function FrameInjector({
  isConnected,
  onSendRawBytes,
  onLogMessage
}) {
  const [hexInput, setHexInput] = useState('01 03 00 00 00 02');
  const [algorithm, setAlgorithm] = useState('modbus-le'); // 'modbus-le' | 'modbus-be' | 'sum8' | 'twos-sum8' | 'xor' | 'ccitt' | 'none'
  const [savedPresets, setSavedPresets] = useState(() => {
    try {
      const stored = localStorage.getItem('skon_saved_frames');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Calculate parsed bytes and checksum
  const calculation = useMemo(() => {
    try {
      const payloadBytes = parseHexInput(hexInput);
      if (payloadBytes.length === 0) {
        return { valid: false, error: 'Empty input', payloadBytes: new Uint8Array(0), checksumBytes: new Uint8Array(0), finalFrame: new Uint8Array(0) };
      }

      let checksumBytes = new Uint8Array(0);
      let checksumDesc = '';

      if (algorithm === 'modbus-le') {
        const { lowByte, highByte, hexLE } = calculateModbusCRC16(payloadBytes);
        checksumBytes = new Uint8Array([lowByte, highByte]);
        checksumDesc = `Modbus CRC-16 (LE): 0x${hexLE}`;
      } else if (algorithm === 'modbus-be') {
        const { lowByte, highByte, hexBE } = calculateModbusCRC16(payloadBytes);
        checksumBytes = new Uint8Array([highByte, lowByte]);
        checksumDesc = `Modbus CRC-16 (BE): 0x${hexBE}`;
      } else if (algorithm === 'sum8') {
        const { sum, hex } = calculateSum8(payloadBytes);
        checksumBytes = new Uint8Array([sum]);
        checksumDesc = `Sum8 (Mod 256): 0x${hex}`;
      } else if (algorithm === 'twos-sum8') {
        const { sum, hex } = calculateTwoComplementSum8(payloadBytes);
        checksumBytes = new Uint8Array([sum]);
        checksumDesc = `Two's Complement Sum8: 0x${hex}`;
      } else if (algorithm === 'xor') {
        const { xor, hex } = calculateXOR(payloadBytes);
        checksumBytes = new Uint8Array([xor]);
        checksumDesc = `XOR Checksum (LRC): 0x${hex}`;
      } else if (algorithm === 'ccitt') {
        const { crc } = calculateCRC16CCITT(payloadBytes);
        checksumBytes = new Uint8Array([(crc >> 8) & 0xff, crc & 0xff]);
        checksumDesc = `CRC-16 CCITT: 0x${crc.toString(16).padStart(4, '0').toUpperCase()}`;
      }

      // Combine payload + checksum
      const finalFrame = new Uint8Array(payloadBytes.length + checksumBytes.length);
      finalFrame.set(payloadBytes, 0);
      if (checksumBytes.length > 0) {
        finalFrame.set(checksumBytes, payloadBytes.length);
      }

      return {
        valid: true,
        error: null,
        payloadBytes,
        checksumBytes,
        checksumDesc,
        finalFrame,
        payloadHex: formatBytesToHex(payloadBytes),
        checksumHex: formatBytesToHex(checksumBytes),
        finalHex: formatBytesToHex(finalFrame)
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message,
        payloadBytes: new Uint8Array(0),
        checksumBytes: new Uint8Array(0),
        finalFrame: new Uint8Array(0)
      };
    }
  }, [hexInput, algorithm]);

  const handleTransmit = async () => {
    if (!calculation.valid || calculation.finalFrame.length === 0) return;
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    try {
      await onSendRawBytes(calculation.finalFrame);
      onLogMessage?.(`[FRAME INJECTED] Transmitted ${calculation.finalFrame.length} bytes: ${calculation.finalHex}`, 'tx');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[INJECT ERROR] ${err.message}`, 'sys');
    }
  };

  const handleSavePreset = () => {
    if (!calculation.valid) return;
    const name = prompt('Enter a label for this frame preset:', `Frame ${calculation.finalHex.slice(0, 12)}...`);
    if (!name) return;

    const newPreset = {
      name,
      payload: calculation.payloadHex,
      algorithm
    };

    const updated = [newPreset, ...savedPresets.slice(0, 19)];
    setSavedPresets(updated);
    try {
      localStorage.setItem('skon_saved_frames', JSON.stringify(updated));
    } catch (e) {}
  };

  const handleDeleteSavedPreset = (idx) => {
    const updated = savedPresets.filter((_, i) => i !== idx);
    setSavedPresets(updated);
    try {
      localStorage.setItem('skon_saved_frames', JSON.stringify(updated));
    } catch (e) {}
  };

  const applyPreset = (preset) => {
    setHexInput(preset.payload);
    setAlgorithm(preset.algorithm);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Binary className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">IN-LINE HEX FRAME INJECTOR</h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-cyber-cyan border border-slate-800">
          AUTO-CHECKSUM ENGINE
        </span>
      </div>

      {/* Input & Checksum Algo Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Hex Input */}
        <div className="md:col-span-2 space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
            Payload Bytes (Hex / \x / Comma)
          </label>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            placeholder="01 03 00 00 00 02"
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-3 py-2 text-cyber-amber font-mono font-bold outline-none focus:border-cyber-amber transition-all text-sm tracking-widest"
          />
          {calculation.error && (
            <p className="text-[10px] text-rose-400 font-semibold">{calculation.error}</p>
          )}
        </div>

        {/* Algorithm Selection */}
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
            Checksum / CRC Engine
          </label>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value)}
            className="w-full bg-[#030712] border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 outline-none focus:border-cyber-cyan cursor-pointer text-xs"
          >
            <option value="modbus-le">Modbus CRC-16 (Little Endian)</option>
            <option value="modbus-be">Modbus CRC-16 (Big Endian)</option>
            <option value="sum8">Sum8 (Additive Modulo 256)</option>
            <option value="twos-sum8">Two's Complement Sum8</option>
            <option value="xor">XOR Checksum (LRC)</option>
            <option value="ccitt">CRC-16 CCITT (XMODEM)</option>
            <option value="none">None (Raw Payload Only)</option>
          </select>
        </div>
      </div>

      {/* Real-time Computed Frame Preview */}
      <div className="bg-[#030712] border border-slate-800 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>FRAME TELEMETRY BREAKDOWN:</span>
          <span>
            Payload: <strong className="text-slate-200">{calculation.payloadBytes.length} B</strong> | 
            Checksum: <strong className="text-cyber-cyan">{calculation.checksumBytes.length} B</strong> | 
            Total: <strong className="text-cyber-amber">{calculation.finalFrame.length} B</strong>
          </span>
        </div>

        {/* Final Packet Stream with Checksum Highlight */}
        <div className="bg-slate-950 p-2.5 rounded border border-slate-900 font-mono text-xs flex flex-wrap items-center gap-1.5 min-h-[38px]">
          {calculation.valid ? (
            <>
              {/* Payload Bytes */}
              <span className="text-cyber-amber font-semibold tracking-wider">
                {calculation.payloadHex}
              </span>

              {/* Checksum Bytes Highlighted */}
              {calculation.checksumHex && (
                <span className="bg-cyan-500/20 text-cyber-cyan border border-cyan-500/40 px-1.5 py-0.5 rounded font-bold shadow-cyan-glow" title={calculation.checksumDesc}>
                  {calculation.checksumHex}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-600 italic">Enter valid hexadecimal bytes to inspect frame</span>
          )}
        </div>

        {calculation.checksumDesc && (
          <p className="text-[10px] text-cyber-cyan/90 font-mono">
            &#10148; {calculation.checksumDesc}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleTransmit}
          disabled={!calculation.valid || !isConnected}
          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 py-2 rounded-lg font-bold text-xs tracking-wider uppercase transition-all shadow-cyan-glow disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-3.5 h-3.5" />
          <span>INJECT HEX FRAME TO SERIAL BUS</span>
        </button>

        <button
          onClick={handleSavePreset}
          disabled={!calculation.valid}
          title="Save as custom preset"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <BookmarkPlus className="w-3.5 h-3.5 text-cyber-amber" />
          <span>SAVE</span>
        </button>
      </div>

      {/* Frame Presets Bank */}
      <div className="border-t border-slate-900 pt-2 space-y-1.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
          HARDWARE FRAME PRESETS
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_FRAMES.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(preset)}
              className="text-[11px] bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyber-amber px-2.5 py-1 rounded transition-colors"
            >
              {preset.name}
            </button>
          ))}
          {savedPresets.map((preset, idx) => (
            <div key={`custom-${idx}`} className="flex items-center bg-slate-900 border border-amber-500/30 rounded text-[11px]">
              <button
                onClick={() => applyPreset(preset)}
                className="px-2 py-1 text-cyber-amber hover:text-amber-200 font-semibold"
              >
                {preset.name}
              </button>
              <button
                onClick={() => handleDeleteSavedPreset(idx)}
                className="px-1.5 py-1 text-slate-500 hover:text-rose-400 border-l border-slate-800"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
