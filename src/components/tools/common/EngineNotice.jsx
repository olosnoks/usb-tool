import React from 'react';

/**
 * Honest status panel for tools that depend on a native engine (WASM) which may
 * not be present in the build. Shows what is required instead of faking output.
 */
export default function EngineNotice({ title, state, error, buildHint, contract }) {
  if (state === 'loading') {
    return <div className="p-3 border border-slate-800 rounded bg-slate-900/50 text-sm text-gray-400">Loading {title} engine…</div>;
  }
  if (state === 'ready') {
    return <div className="p-2 border border-green-900 rounded bg-green-950/30 text-xs text-green-400">{title} engine loaded.</div>;
  }
  return (
    <div className="p-3 border border-yellow-900 rounded bg-yellow-950/20 text-sm">
      <div className="text-yellow-400 font-semibold mb-1">{title} engine not available</div>
      <div className="text-gray-300 text-xs mb-2">{error}</div>
      {buildHint && <div className="text-gray-400 text-xs mb-2 whitespace-pre-wrap">{buildHint}</div>}
      {contract && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer text-gray-300">Expected engine interface</summary>
          <pre className="mt-1 bg-slate-900 p-2 rounded overflow-auto">{contract}</pre>
        </details>
      )}
    </div>
  );
}
