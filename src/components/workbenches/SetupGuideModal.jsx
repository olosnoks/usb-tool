import React, { useState, useEffect } from 'react';
import { 
  X, 
  ExternalLink, 
  Download, 
  Cpu, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle,
  HelpCircle,
  HardDrive,
  RefreshCw
} from 'lucide-react';

export const LOCAL_STORAGE_KEY_DISMISS_GUIDE = 'alfa_wifi_hide_windows_setup_guide';

/**
 * Utility to check if the current client is running on Windows.
 * @returns {boolean}
 */
export function isWindowsPlatform() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.platform) {
    return /windows/i.test(navigator.userAgentData.platform);
  }
  return /win(dows|32|64)/i.test(navigator.userAgent || '');
}

/**
 * SetupGuideModal Component
 * Guides Windows users step-by-step through replacing the OS NDIS driver with WinUSB using Zadig.
 */
export default function SetupGuideModal({
  isOpen,
  onClose,
  initialError = null
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(LOCAL_STORAGE_KEY_DISMISS_GUIDE) === 'true';
      setDontShowAgain(dismissed);
    } catch (e) {
      // Ignore localStorage read errors
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCheckboxChange = (e) => {
    const checked = e.target.checked;
    setDontShowAgain(checked);
    try {
      if (checked) {
        localStorage.setItem(LOCAL_STORAGE_KEY_DISMISS_GUIDE, 'true');
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY_DISMISS_GUIDE);
      }
    } catch (err) {
      console.warn('Failed to update localStorage:', err);
    }
  };

  const steps = [
    {
      num: 1,
      title: 'Download Zadig Driver Utility',
      desc: 'Zadig is an open-source Windows application that installs generic USB drivers (such as WinUSB) onto USB peripherals.',
      actionUrl: 'https://zadig.akeo.ie/',
      actionLabel: 'Download Zadig from official site'
    },
    {
      num: 2,
      title: 'Plug In Your USB Wi-Fi Adapter',
      desc: 'Connect your Alfa AWUS036ACH (RTL8812AU) or MediaTek adapter directly to a high-speed USB 3.0 port.'
    },
    {
      num: 3,
      title: 'Enable "List All Devices" in Zadig',
      desc: 'Launch Zadig (run as Administrator). In the top navigation menu, open Options and check "List All Devices". By default, Windows hides active network devices.'
    },
    {
      num: 4,
      title: 'Select Adapter & Install WinUSB',
      desc: 'In the main dropdown, select your adapter (e.g., "Realtek 8812AU Wireless LAN 802.11ac USB NIC"). In the target driver box, choose "WinUSB (v6.1.7600.16385)" and click "Replace Driver" or "Install Driver". Wait ~30 seconds for Windows to bind the driver.'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#171920] border border-cyan-500/40 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>Windows WebUSB Driver Setup Guide</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  WinUSB
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Required for direct hardware monitor mode and raw packet capture on Windows
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-140px)] scrollbar-thin scrollbar-thumb-slate-800 text-xs">
          {/* Error Banner if triggered by failure */}
          {initialError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/50 rounded-xl flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-300">Connection Failed: Interface Claimed by OS</div>
                <div className="text-[11px] text-rose-200/80 mt-0.5">
                  {initialError}
                </div>
              </div>
            </div>
          )}

          {/* Architecture Context Banner */}
          <div className="p-3.5 bg-cyan-950/30 border border-cyan-500/30 rounded-xl text-slate-300 leading-relaxed">
            <span className="font-bold text-cyan-300">Why is this required? </span>
            Windows standard kernel drivers (<code className="px-1 py-0.5 rounded bg-slate-900 text-cyan-300 font-mono text-[10px]">wlanapi.dll</code>) 
            lock Wi-Fi adapters into managed station mode and block browser WebUSB endpoints. 
            Replacing the manufacturer driver with generic <span className="font-semibold text-white">WinUSB</span> grants 
            the WASM driver direct access to bulk RX/TX endpoints for raw 802.11 monitor mode.
          </div>

          {/* Step-by-Step Instructions */}
          <div className="space-y-3">
            {steps.map((step) => (
              <div 
                key={step.num}
                className={`p-3.5 rounded-xl border transition-all ${
                  activeStep === step.num 
                    ? 'bg-slate-900 border-cyan-500/50 shadow-md' 
                    : 'bg-slate-900/40 border-slate-800/80'
                }`}
                onClick={() => setActiveStep(step.num)}
              >
                <div className="flex items-start gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                    activeStep === step.num
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {step.num}
                  </span>
                  <div className="flex-1 space-y-1">
                    <div className="font-bold text-slate-200 text-xs">
                      {step.title}
                    </div>
                    <div className="text-slate-400 text-[11px] leading-relaxed">
                      {step.desc}
                    </div>
                    {step.actionUrl && (
                      <div className="pt-1.5">
                        <a
                          href={step.actionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-bold text-[11px] transition shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{step.actionLabel}</span>
                          <ExternalLink className="w-3 h-3 ml-0.5" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Operational Warning / Revert Instructions */}
          <div className="p-3.5 bg-amber-950/30 border border-amber-500/40 rounded-xl space-y-1.5 text-amber-200/90">
            <div className="flex items-center gap-2 font-bold text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4" />
              <span>Temporary Wi-Fi Functionality Notice</span>
            </div>
            <div className="text-[11px] leading-relaxed">
              While WinUSB is bound, Windows will <strong>not</strong> display this adapter in your regular system Wi-Fi tray. 
              The adapter is dedicated exclusively to monitor mode packet capture.
            </div>
            <div className="text-[10px] text-amber-300/70 pt-1">
              <strong>How to revert:</strong> Open Windows Device Manager &rarr; Right-click adapter under "Universal Serial Bus devices" &rarr; Select "Update driver" &rarr; "Search automatically for drivers".
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-900/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 text-slate-400 cursor-pointer hover:text-slate-200 transition">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={handleCheckboxChange}
              className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-cyan-500/40 w-4 h-4"
            />
            <span>Don't show this setup banner automatically</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition shadow-md"
            >
              I Understand / Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
