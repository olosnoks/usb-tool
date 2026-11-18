import React, { useState } from 'react';
import { Smartphone, Terminal } from 'lucide-react';
import AdbWorkbench from './AdbWorkbench';
import FastbootWorkbench from './FastbootWorkbench';

/**
 * Android — one tool for a single Android device over WebUSB in its two modes:
 * ADB (device booted, USB debugging) and Fastboot (bootloader). They are never
 * active at once on the same device, so only the selected mode is mounted; the
 * other unmounts and releases its WebUSB claim when you switch.
 */
export default function AndroidWorkbench({ initialMode = 'adb' }) {
  const [mode, setMode] = useState(initialMode === 'fastboot' ? 'fastboot' : 'adb');

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setMode(id)}
      className={`px-2.5 py-1 text-xs rounded-t border-b-2 inline-flex items-center gap-1.5 ${
        mode === id
          ? 'border-emerald-500 text-emerald-300 bg-slate-900'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="flex gap-1 border-b border-slate-800 pb-0 mb-2">
        <Tab id="adb" icon={Terminal} label="ADB" />
        <Tab id="fastboot" icon={Smartphone} label="Fastboot" />
      </div>
      {mode === 'adb' ? <AdbWorkbench /> : <FastbootWorkbench />}
    </div>
  );
}
