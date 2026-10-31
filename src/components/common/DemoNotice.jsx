import React from 'react';
import { FlaskConical } from 'lucide-react';

// One way to say "this is not from hardware", used by every tool.
//
//  <DemoBadge />                small chip next to a title or status
//  <DemoBanner>…</DemoBanner>   full-width notice above simulated output
//
// Rules the tools follow:
//  - simulated data is opt-in (never the default when hardware is supported);
//  - while it is on, a DemoBanner is visible above the data;
//  - tools with no hardware path at all say so (`demoOnly`).

export function DemoBadge({ label = 'SIMULATED', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/40 ${className}`}
      title="Simulated data: nothing shown here comes from hardware"
    >
      <FlaskConical className="w-3 h-3" />
      {label}
    </span>
  );
}

export function DemoBanner({ demoOnly = false, children, className = '' }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 ${className}`}
    >
      <FlaskConical className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
      <div className="space-y-0.5">
        <b className="block text-amber-300">
          {demoOnly ? 'Demo only: this tool has no hardware support yet.' : 'Simulated data.'}
        </b>
        <span className="block text-amber-200/80">
          {children || 'Nothing shown here comes from a connected device.'}
        </span>
      </div>
    </div>
  );
}

export default DemoBanner;
