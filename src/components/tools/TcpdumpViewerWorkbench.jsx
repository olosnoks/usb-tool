import React, { useState } from 'react';

/**
 * Minimal PCAP viewer.
 * Allows the user to upload a .pcap file and shows the first few bytes in hex.
 * Full packet parsing would require a library – this demo provides a quick preview.
 */
export default function TcpdumpViewerWorkbench({ onLogMessage }) {
  const [fileName, setFileName] = useState('');
  const [hexDump, setHexDump] = useState('');

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target.result;
      const bytes = new Uint8Array(buffer.slice(0, 64)); // first 64 bytes
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      setHexDump(hex);
      log(`Loaded ${file.name}, ${bytes.length} bytes preview`);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Tcpdump Viewer (demo)</h2>
      <p className="text-sm text-gray-400 mb-4">Upload a .pcap file to see a hex preview of the first bytes.</p>
      <input type="file" accept=".pcap" onChange={handleFile} className="mb-4" />
      {fileName && (
        <div className="mb-2 text-sm text-gray-200">
          <strong>File:</strong> {fileName}
        </div>
      )}
      {hexDump && (
        <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}}>{hexDump}</pre>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'20vh'}} />
    </div>
  );
}

