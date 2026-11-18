import React, { useState } from 'react';
import { FileSearch, ShieldAlert } from 'lucide-react';
import { parseDescriptorHex } from '../../../utils/hidInspector';
import { parse, dump } from '../../../utils/usbrea/hid';

/**
 * Decode a HID report descriptor pasted as hex (space, comma, 0x, C-array or `usbhid-dump` / `lsusb -v` style
 * lines). Pure client-side: nothing is sent to a device.
 */
export function decodeDescriptorText(text) {
  const bytes = parseDescriptorHex(text);
  const desc = parse(bytes);
  return { bytes, desc, listing: dump(desc) };
}

export default function HidDescriptorDecoder() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const run = () => {
    setError('');
    setResult(null);
    try {
      setResult(decodeDescriptorText(text));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2 @lg:col-span-2">
      <span className="font-bold text-slate-200 flex items-center gap-2">
        <FileSearch className="w-4 h-4 text-cyan-400" /> DESCRIPTOR DECODER
      </span>
      <p className="text-[11px] text-slate-500">
        Paste a HID report descriptor as hex (for example from <code>usbhid-dump</code>, <code>lsusb -v</code>, a datasheet or a C array) to see its items,
        report layouts and fields. Nothing is sent to any device.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="05 01 09 06 A1 01 05 07 19 E0 29 E7 15 00 25 01 75 01 95 08 81 02 ... C0"
        aria-label="HID report descriptor hex"
        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-cyan-200 outline-none"
      />
      <button onClick={run} disabled={!text.trim()} className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40">
        DECODE
      </button>
      {error && (
        <div role="alert" className="flex items-start gap-2 p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
          <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {result && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-400">
            {result.bytes.length} bytes. Top-level: <span className="text-cyan-300">{result.desc.top_usages.join(', ') || 'none'}</span>
            {result.desc.uses_report_ids ? ' (uses report IDs)' : ''}
          </div>
          {result.desc.reports.map((r, i) => (
            <div key={i} className="border-l-2 border-slate-800 pl-2 text-[11px]">
              <div className="text-cyan-300 font-bold">{r.title()}</div>
              {r.fields.map((f, fi) => (
                <div key={fi} className="text-slate-400">{f.describe()}</div>
              ))}
            </div>
          ))}
          <pre className="max-h-64 overflow-auto bg-slate-950 border border-slate-800 rounded p-2 text-[10px] text-slate-300">{result.listing}</pre>
        </div>
      )}
    </div>
  );
}
