// "files" view of the Flipper Zero workbench (FlipperWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ArrowUp, Download, FileCode, Folder, FolderOpen, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import React from 'react';

export default function FilesView({
  currentDir,
  dirItems,
  fileContent,
  fileUploadInputRef,
  handleCreateFolder,
  handleDeleteItem,
  handleGoUp,
  handleSelectFile,
  handleUploadFile,
  isLoadingFiles,
  loadDirectory,
  selectedFile,
  setCurrentDir
}) {
  return (
    <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col space-y-4">
      {/* Hidden file upload input */}
      <input 
        type="file" 
        ref={fileUploadInputRef} 
        onChange={handleUploadFile} 
        className="hidden" 
      />

      {/* Path, Breadcrumbs and Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#232733]">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleGoUp}
            disabled={currentDir === '/' || currentDir === '/ext'}
            className="p-1.5 rounded-lg bg-[#1e212b] border border-[#2e3444] text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Up one level (..)"
          >
            <ArrowUp className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1.5 bg-[#13151c] px-3 py-1.5 rounded-xl border border-[#282d38] text-xs font-mono">
            <FolderOpen className="w-4 h-4 text-[#fe8a2c] shrink-0" />
            <button
              onClick={() => { setCurrentDir('/ext'); loadDirectory('/ext'); }}
              className="text-slate-400 hover:text-[#fe8a2c] font-bold"
            >
              /ext
            </button>
            {currentDir.replace(/^\/ext/, '').split('/').filter(Boolean).map((part, idx, arr) => {
              const subPath = '/ext/' + arr.slice(0, idx + 1).join('/');
              const isLast = idx === arr.length - 1;
              return (
                <React.Fragment key={subPath}>
                  <span className="text-slate-600">/</span>
                  <button
                    onClick={() => { setCurrentDir(subPath); loadDirectory(subPath); }}
                    className={`font-semibold hover:underline ${isLast ? 'text-white font-bold' : 'text-slate-400 hover:text-[#fe8a2c]'}`}
                  >
                    {part}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <button
            onClick={() => loadDirectory(currentDir)}
            disabled={isLoadingFiles}
            className="p-1.5 rounded-lg bg-[#1e212b] border border-[#2e3444] text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 transition disabled:opacity-50"
            title="Reload directory"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
          </button>

          {isLoadingFiles && (
            <span className="text-[#fe8a2c] text-[11px] animate-pulse font-mono flex items-center gap-1">
              <span>Reading Flipper Storage...</span>
            </span>
          )}
        </div>

        {/* File Operations: New Folder, Upload */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateFolder}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5 active:scale-95"
            title="Create new folder"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Folder</span>
          </button>

          <button
            onClick={() => fileUploadInputRef.current?.click()}
            className="px-3 py-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-200 border border-[#2e3444] rounded-xl text-xs font-mono transition flex items-center gap-1.5 active:scale-95"
            title="Upload file to Flipper SD card"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      {/* Quick Jump Directory Bar (qFlipper shortcuts) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
        <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mr-1">Quick Jump:</span>
        {['/ext', '/ext/subghz', '/ext/nfc', '/ext/rfid', '/ext/badusb', '/ext/infrared', '/ext/ibutton', '/ext/apps', '/int'].map(p => (
          <button
            key={p}
            onClick={() => {
              setCurrentDir(p);
              loadDirectory(p);
            }}
            className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap ${
              currentDir === p 
                ? 'bg-[#fe8a2c] text-slate-950 font-bold shadow' 
                : 'bg-[#1e212b] text-slate-400 border border-[#2e3444] hover:text-white'
            }`}
          >
            {p.split('/').pop() || 'ext'}
          </button>
        ))}
      </div>

      {/* Two-Pane Tree & Inspector */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* File List Table */}
        <div className="md:col-span-5 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-3 max-h-[460px] overflow-y-auto space-y-1">
          {/* Up One Level row */}
          {currentDir !== '/' && currentDir !== '/ext' && (
            <div
              onClick={handleGoUp}
              className="p-2.5 rounded-xl border border-transparent hover:border-[#2e3444] hover:bg-[#171920] text-slate-400 cursor-pointer transition flex items-center gap-2"
            >
              <Folder className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold">.. (Parent Directory)</span>
            </div>
          )}

          {dirItems.length === 0 && !isLoadingFiles && (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              <Folder className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>No files or folders found in {currentDir}</div>
              <div className="text-[10px] text-slate-600 mt-1">Click "Reload" or "New Folder" to create one.</div>
            </div>
          )}

          {dirItems.map(item => (
            <div
              key={item.path}
              onClick={() => handleSelectFile(item)}
              className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between group ${
                selectedFile?.path === item.path
                  ? 'bg-[#fe8a2c]/20 border-[#fe8a2c]/60 text-[#fe8a2c] font-bold shadow'
                  : 'bg-[#171920]/80 border-[#282d38] text-slate-300 hover:bg-[#212530]'
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0 mr-2">
                {item.isDir ? (
                  <Folder className="w-4 h-4 text-[#fe8a2c] shrink-0" />
                ) : (
                  <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                )}
                <span className="truncate text-xs">{item.name}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!item.isDir && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {item.size ? (item.size.endsWith('b') || item.size.endsWith('B') ? item.size : `${item.size} B`) : ''}
                  </span>
                )}
                <button
                  onClick={(e) => handleDeleteItem(item, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition rounded"
                  title={`Delete ${item.name} from Flipper`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* File Viewer & Content */}
        <div className="md:col-span-7 bg-[#1e212b] border border-[#2b303c] rounded-2xl p-4 flex flex-col justify-between min-h-[460px]">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#2b303c] mb-3">
              <div className="truncate mr-2">
                <span className="font-bold text-white text-xs truncate block">
                  {selectedFile ? selectedFile.path : 'Select a file to inspect'}
                </span>
                {selectedFile && (
                  <span className="text-[10px] text-slate-400">
                    {selectedFile.size ? `${selectedFile.size}` : ''}
                  </span>
                )}
              </div>

              {selectedFile && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      const blob = new Blob([fileContent || ''], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = selectedFile.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-3 py-1 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-bold rounded-lg text-xs font-mono transition flex items-center gap-1.5 shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Export
                  </button>

                  <button
                    onClick={(e) => handleDeleteItem(selectedFile, e)}
                    className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-mono transition flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>

            <pre className="text-[11px] font-mono text-[#fe8a2c] whitespace-pre-wrap max-h-[380px] overflow-y-auto bg-[#171920] p-4 rounded-xl border border-[#232733] select-text">
              {fileContent || '// Select a file on your Flipper to inspect contents'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
