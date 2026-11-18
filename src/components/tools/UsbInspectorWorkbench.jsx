import React, { useState } from 'react';
import { Usb, FileSearch } from 'lucide-react';
import UsbReconDeck from '../UsbReconDeck';
import UsbDescriptorExplorer from './UsbDescriptorExplorer';

/**
 * USB Explorer & Autopsy — one place to interrogate a USB device. Two views:
 * "Recon & Autopsy" (mystery-chip analysis, baud hunting, serial-assisted recon)
 * and "Descriptor Explorer" (lsusb -v in the browser). Both panes stay mounted so
 * neither loses its connected device when you switch tabs.
 */
export default function UsbInspectorWorkbench({ initialTab = 'recon', ...reconProps }) {
  const [tab, setTab] = useState(initialTab === 'descriptors' ? 'descriptors' : 'recon');

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-2.5 py-1 text-xs rounded-t border-b-2 inline-flex items-center gap-1.5 ${
        tab === id ? 'border-amber-500 text-amber-300 bg-slate-900' : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="w-full min-w-0 max-w-full space-y-0">
      <div className="flex flex-wrap gap-1 border-b border-slate-800 mb-2">
        <Tab id="recon" icon={Usb} label="Recon & Autopsy" />
        <Tab id="descriptors" icon={FileSearch} label="Descriptor Explorer" />
      </div>
      <div className={tab === 'recon' ? '' : 'hidden'}><UsbReconDeck {...reconProps} /></div>
      <div className={tab === 'descriptors' ? '' : 'hidden'}><UsbDescriptorExplorer /></div>
    </div>
  );
}
