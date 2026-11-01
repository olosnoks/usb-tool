// HackRF / PortaPack first-time setup and firmware flasher.
// 1. Pick the firmware (Mayhem or stock HackRF release from GitHub, or a local file).
// 2. Connect the board over WebUSB: a HackRF (any firmware / PortaPack in HackRF mode)
//    is flashed directly; a board in the LPC43xx DFU bootloader first gets the
//    stock RAM image; a PortaPack still in Mayhem serial mode is told what to do.
// 3. Erase, write, verify, reset.
// 4. Copy the Mayhem SD-card folder onto the card with the File System Access API.
import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Zap, Download, HardDrive, Usb, CheckCircle2, AlertTriangle, RefreshCw, FolderOpen, Cpu, ExternalLink, ShieldCheck
} from 'lucide-react';
import {
  HackRfSpiFlasher, dfuBootRamImage, classifyUsbDevice, validateSpiImage, fetchGithubReleases,
  pickReleaseAssets, pickImagesFromZip, copyZipToDirectory, sdcardEntryPaths, FIRMWARE_SOURCES
} from '../../utils/hackrfFlasher';
import { downloadFirmwareBinary } from '../../services/firmwareCatalogService';
import StatusBadge from '../common/StatusBadge';

const fmtKb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`);

export default function HackRfFlasherWorkbench() {
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const log = (text, type = 'info') => setLogs((p) => [...p.slice(-250), { time: new Date().toLocaleTimeString(), text, type }]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  // Step 1: firmware
  const [source, setSource] = useState('mayhem');
  const [releases, setReleases] = useState([]);
  const [releaseTag, setReleaseTag] = useState('');
  const [releasesBusy, setReleasesBusy] = useState(false);
  const [fetchMsg, setFetchMsg] = useState('');
  const [image, setImage] = useState(null);        // { name, bytes, from }
  const [dfuImage, setDfuImage] = useState(null);  // { name, bytes }
  const [sdZip, setSdZip] = useState(null);        // { name, zip, files }
  const [allowOdd, setAllowOdd] = useState(false);
  const release = releases.find((r) => r.tag === releaseTag) || null;
  const assets = release ? pickReleaseAssets(release.assets) : { firmwareZip: null, sdcardZip: null, ppfw: null };

  // Step 2/3: device + flash
  const [device, setDevice] = useState(null);
  const [kind, setKind] = useState(null);           // 'hackrf' | 'lpc-dfu' | 'mayhem-serial' | 'unknown'
  const [identity, setIdentity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // { phase, done, total }
  const [flashResult, setFlashResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  // Step 4: SD card
  const [sdProgress, setSdProgress] = useState(null);
  const [sdResult, setSdResult] = useState(null);

  const loadReleases = async (src = source) => {
    setReleasesBusy(true); setReleases([]); setReleaseTag('');
    try {
      const list = await fetchGithubReleases(FIRMWARE_SOURCES[src].repo);
      setReleases(list);
      const first = list.find((r) => !r.prerelease) || list[0];
      if (first) setReleaseTag(first.tag);
      log(`${list.length} ${FIRMWARE_SOURCES[src].label} releases listed from GitHub.`);
    } catch (e) { log(`Could not list releases: ${e.message}`, 'error'); }
    finally { setReleasesBusy(false); }
  };
  useEffect(() => { loadReleases('mayhem'); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const downloadAsset = async (asset) => {
    setFetchMsg(`Downloading ${asset.name}…`);
    const { data } = await downloadFirmwareBinary(asset.url, (m) => setFetchMsg(m));
    setFetchMsg('');
    return data;
  };

  const fetchFirmware = async () => {
    if (!assets.firmwareZip) { log('This release has no firmware zip.', 'warning'); return; }
    setBusy(true);
    try {
      const bytes = await downloadAsset(assets.firmwareZip);
      const zip = await JSZip.loadAsync(bytes);
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      const picked = pickImagesFromZip(names);
      if (!picked.bin) throw new Error(`No .bin found in ${assets.firmwareZip.name} (entries: ${names.slice(0, 6).join(', ')}…)`);
      const bin = await zip.file(picked.bin).async('uint8array');
      setImage({ name: picked.bin.split('/').pop(), bytes: bin, from: `${FIRMWARE_SOURCES[source].label} ${release.tag}` });
      log(`Firmware image ${picked.bin} (${fmtKb(bin.length)}) from ${assets.firmwareZip.name}.`, 'success');
      if (picked.dfu) {
        const dfu = await zip.file(picked.dfu).async('uint8array');
        setDfuImage({ name: picked.dfu.split('/').pop(), bytes: dfu });
        log(`RAM image ${picked.dfu.split('/').pop()} (${fmtKb(dfu.length)}) for the DFU bootloader step.`);
      }
      const v = validateSpiImage(bin);
      v.warnings.forEach((w) => log(w, 'warning'));
    } catch (e) { log(`Firmware download failed: ${e.message}`, 'error'); setFetchMsg(''); }
    finally { setBusy(false); }
  };

  const fetchStockDfu = async () => {
    setBusy(true);
    try {
      const list = await fetchGithubReleases(FIRMWARE_SOURCES.hackrf.repo, { perPage: 3 });
      const rel = list.find((r) => pickReleaseAssets(r.assets).firmwareZip);
      if (!rel) throw new Error('no stock HackRF release zip found');
      const bytes = await downloadAsset(pickReleaseAssets(rel.assets).firmwareZip);
      const zip = await JSZip.loadAsync(bytes);
      const picked = pickImagesFromZip(Object.keys(zip.files));
      if (!picked.dfu) throw new Error('hackrf_one_usb.dfu not in the release zip');
      const dfu = await zip.file(picked.dfu).async('uint8array');
      setDfuImage({ name: picked.dfu.split('/').pop(), bytes: dfu });
      log(`Stock RAM image ${picked.dfu.split('/').pop()} from HackRF ${rel.tag}.`, 'success');
    } catch (e) { log(`Could not get the stock .dfu: ${e.message}`, 'error'); }
    finally { setBusy(false); }
  };

  const fetchSdZip = async () => {
    if (!assets.sdcardZip) { log('This release has no COPY_TO_SDCARD zip.', 'warning'); return; }
    setBusy(true);
    try {
      const bytes = await downloadAsset(assets.sdcardZip);
      const zip = await JSZip.loadAsync(bytes);
      const files = sdcardEntryPaths(Object.keys(zip.files)).length;
      setSdZip({ name: assets.sdcardZip.name, zip, files });
      log(`${assets.sdcardZip.name}: ${files} files ready to copy to the SD card.`, 'success');
    } catch (e) { log(`SD card zip download failed: ${e.message}`, 'error'); setFetchMsg(''); }
    finally { setBusy(false); }
  };

  const onLocalFile = async (e, which) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (which === 'bin') {
      setImage({ name: f.name, bytes, from: 'local file' });
      const v = validateSpiImage(bytes);
      v.errors.forEach((w) => log(w, 'error'));
      v.warnings.forEach((w) => log(w, 'warning'));
      log(`Local image ${f.name} (${fmtKb(bytes.length)}).`);
    } else if (which === 'dfu') {
      setDfuImage({ name: f.name, bytes });
      log(`Local RAM image ${f.name} (${fmtKb(bytes.length)}).`);
    } else {
      try {
        const zip = await JSZip.loadAsync(bytes);
        setSdZip({ name: f.name, zip, files: sdcardEntryPaths(Object.keys(zip.files)).length });
        log(`Local SD zip ${f.name} loaded.`);
      } catch (err) { log(`Not a zip: ${err.message}`, 'error'); }
    }
    e.target.value = '';
  };

  const connect = async () => {
    if (!navigator.usb) { log('WebUSB is not available in this browser. Use Chrome or Edge.', 'error'); return; }
    try {
      const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1d50 }, { vendorId: 0x1fc9, productId: 0x000c }] });
      const k = classifyUsbDevice(dev.vendorId, dev.productId);
      setDevice(dev); setKind(k); setIdentity(null); setFlashResult(null);
      log(`Selected ${dev.productName || 'USB device'} ${dev.vendorId.toString(16).padStart(4, '0')}:${dev.productId.toString(16).padStart(4, '0')} → ${k}.`);
      if (k === 'hackrf') {
        await dev.open();
        if (!dev.configuration) await dev.selectConfiguration(1);
        try { await dev.claimInterface(0); } catch (_) {}
        const id = await new HackRfSpiFlasher(dev, { log }).identify();
        setIdentity(id);
        log(`Board: ${id.boardName || 'unknown'} · firmware: ${id.firmwareVersion || 'unknown'}.`, 'success');
      } else if (k === 'mayhem-serial') {
        log('This PortaPack is in Mayhem (serial) mode. On its screen open the menu and pick "HackRF" mode, then connect again. Or flash from the SD card with Mayhem\'s own Flash utility (.ppfw.tar).', 'warning');
      } else if (k === 'lpc-dfu') {
        log('LPC43xx DFU bootloader found. Load the stock RAM image below; the board will come back as a HackRF and you connect again to write the flash.', 'info');
      }
    } catch (e) { if (e.name !== 'NotFoundError') log(`Connect failed: ${e.message}`, 'error'); }
  };

  const disconnect = async () => { try { await device?.close(); } catch (_) {} setDevice(null); setKind(null); setIdentity(null); setConfirmed(false); };

  const runDfu = async () => {
    if (!device || !dfuImage) return;
    setBusy(true); setProgress({ phase: 'dfu', done: 0, total: dfuImage.bytes.length });
    try {
      await dfuBootRamImage(device, dfuImage.bytes, { log, onProgress: ({ written, total }) => setProgress({ phase: 'dfu', done: written, total }) });
      log('RAM image sent. Wait ~2 s for the board to re-enumerate as a HackRF, then click Connect and pick it to write the flash.', 'success');
      setDevice(null); setKind(null);
    } catch (e) { log(`DFU failed: ${e.message}`, 'error'); }
    finally { setBusy(false); setProgress(null); }
  };

  const runFlash = async () => {
    if (!device || !image) return;
    setBusy(true); setFlashResult(null);
    const t0 = performance.now();
    try {
      const f = new HackRfSpiFlasher(device, { log });
      const r = await f.flash(image.bytes, { verify: true, allowUnrecognised: allowOdd, onProgress: setProgress });
      setFlashResult({ ok: true, ...r, seconds: (performance.now() - t0) / 1000 });
      log(`Flashed and verified ${fmtKb(r.bytes)} in ${((performance.now() - t0) / 1000).toFixed(1)} s. The board is rebooting into ${image.name}.`, 'success');
      try { await device.close(); } catch (_) {}
      setDevice(null); setKind(null); setIdentity(null); setConfirmed(false);
    } catch (e) {
      setFlashResult({ ok: false, error: e.message });
      log(`Flash failed: ${e.message}`, 'error');
    } finally { setBusy(false); }
  };

  const runSdCopy = async () => {
    if (!sdZip) return;
    if (!window.showDirectoryPicker) { log('This browser cannot write folders (File System Access API). Use Chrome or Edge, or unzip the file onto the card yourself.', 'error'); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'portapack-sd', mode: 'readwrite' }); }
    catch (e) { if (e.name !== 'AbortError') log(`Folder pick failed: ${e.message}`, 'error'); return; }
    setBusy(true); setSdResult(null);
    try {
      const r = await copyZipToDirectory(sdZip.zip, dir, { onProgress: setSdProgress });
      setSdResult(r);
      log(`Copied ${r.files} files (${fmtKb(r.bytes)}) to "${dir.name}". Eject the card safely before putting it in the PortaPack.`, 'success');
    } catch (e) { log(`SD copy failed: ${e.message}`, 'error'); }
    finally { setBusy(false); setSdProgress(null); }
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const card = 'bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3';
  const btn = (extra = '') => `px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition disabled:opacity-40 flex items-center gap-1.5 ${extra}`;

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl px-4 py-2.5 shadow-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-400"><Zap className="w-4 h-4" /></div>
          <div>
            <div className="text-sm font-bold text-white tracking-wide">HACKRF / PORTAPACK FLASHER &amp; FIRST-TIME SETUP</div>
            <div className="text-[11px] text-slate-400">Writes the 1 MiB SPI flash over WebUSB exactly like hackrf_spiflash, boots a bricked board through the LPC43xx DFU ROM, and copies the Mayhem SD-card files.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={device ? 'success' : 'warning'} label={device ? (kind || 'device').toUpperCase() : 'NO DEVICE'} />
          <a href="https://github.com/portapack-mayhem/mayhem-firmware/wiki/Firmware-update-procedure" target="_blank" rel="noopener noreferrer" className="text-purple-300 underline flex items-center gap-1">Mayhem update guide <ExternalLink className="w-3 h-3" /></a>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Step 1 */}
        <div className={card}>
          <div className="font-bold text-slate-200 flex items-center gap-2"><Download className="w-4 h-4 text-cyan-400" /> 1 · FIRMWARE</div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={source} onChange={(e) => { setSource(e.target.value); loadReleases(e.target.value); }} className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1">
              {Object.values(FIRMWARE_SOURCES).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={releaseTag} onChange={(e) => setReleaseTag(e.target.value)} disabled={!releases.length} className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1 min-w-[12rem]">
              {releases.map((r) => <option key={r.tag} value={r.tag}>{r.tag}{r.prerelease ? ' (pre-release)' : ''}</option>)}
            </select>
            <button onClick={() => loadReleases()} disabled={releasesBusy} className={btn('bg-slate-800 border border-slate-700 text-slate-300')}><RefreshCw className={`w-3.5 h-3.5 ${releasesBusy ? 'animate-spin' : ''}`} /></button>
            <button onClick={fetchFirmware} disabled={busy || !assets.firmwareZip} className={btn('bg-cyan-600 hover:bg-cyan-500 text-slate-950')}><Download className="w-3.5 h-3.5" /> Get firmware{assets.firmwareZip ? ` (${fmtKb(assets.firmwareZip.size)})` : ''}</button>
            {source === 'mayhem' && <button onClick={fetchSdZip} disabled={busy || !assets.sdcardZip} className={btn('bg-emerald-600/30 border border-emerald-500/40 text-emerald-200')}><HardDrive className="w-3.5 h-3.5" /> Get SD-card files{assets.sdcardZip ? ` (${fmtKb(assets.sdcardZip.size)})` : ''}</button>}
          </div>
          {fetchMsg && <div className="text-[11px] text-slate-400">{fetchMsg}</div>}
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            <label className="cursor-pointer text-slate-300 hover:text-white">Local .bin <input type="file" accept=".bin" className="hidden" onChange={(e) => onLocalFile(e, 'bin')} /></label>
            <label className="cursor-pointer text-slate-300 hover:text-white">Local .dfu <input type="file" accept=".dfu" className="hidden" onChange={(e) => onLocalFile(e, 'dfu')} /></label>
            <label className="cursor-pointer text-slate-300 hover:text-white">Local SD zip <input type="file" accept=".zip" className="hidden" onChange={(e) => onLocalFile(e, 'zip')} /></label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
            <div className="bg-slate-900/70 rounded p-2"><div className="text-slate-500">SPI image (.bin)</div><div className={image ? 'text-cyan-300 font-bold' : 'text-slate-600'}>{image ? `${image.name} · ${fmtKb(image.bytes.length)}` : 'none yet'}</div>{image && <div className="text-slate-500">{image.from}</div>}</div>
            <div className="bg-slate-900/70 rounded p-2"><div className="text-slate-500">RAM image (.dfu, DFU rescue)</div><div className={dfuImage ? 'text-cyan-300 font-bold' : 'text-slate-600'}>{dfuImage ? `${dfuImage.name} · ${fmtKb(dfuImage.bytes.length)}` : 'none yet'}</div></div>
            <div className="bg-slate-900/70 rounded p-2"><div className="text-slate-500">SD-card zip</div><div className={sdZip ? 'text-emerald-300 font-bold' : 'text-slate-600'}>{sdZip ? `${sdZip.name} · ${sdZip.files} files` : 'none yet'}</div></div>
          </div>
        </div>

        {/* Step 2 */}
        <div className={card}>
          <div className="font-bold text-slate-200 flex items-center gap-2"><Usb className="w-4 h-4 text-purple-400" /> 2 · BOARD</div>
          <div className="text-[11px] text-slate-400 space-y-1">
            <div><strong className="text-slate-300">New or stock HackRF:</strong> plug it in and Connect; it shows as HackRF One.</div>
            <div><strong className="text-slate-300">PortaPack already on Mayhem:</strong> on its screen choose <em>HackRF</em> mode first (or use Mayhem's SD-card Flash utility with the .ppfw.tar).</div>
            <div><strong className="text-slate-300">Bricked / blank flash:</strong> hold <em>DFU</em> while plugging in. It enumerates as the LPC43xx bootloader (1fc9:000c); load the stock RAM image, then Connect again to flash. Windows may need the WinUSB driver (Zadig) on both ids.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {device ? (
              <button onClick={disconnect} disabled={busy} className={btn('bg-rose-600/20 border border-rose-500/30 text-rose-300')}>Disconnect</button>
            ) : (
              <button onClick={connect} disabled={busy} className={btn('bg-purple-600 hover:bg-purple-500 text-white')}><Usb className="w-3.5 h-3.5" /> Connect WebUSB</button>
            )}
            {identity && <span className="text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5 inline" /> {identity.boardName || 'HackRF'} · fw {identity.firmwareVersion || '?'}</span>}
            {kind === 'mayhem-serial' && <span className="text-amber-300"><AlertTriangle className="w-3.5 h-3.5 inline" /> switch the PortaPack to HackRF mode</span>}
          </div>
          {kind === 'lpc-dfu' && (
            <div className="border-t border-slate-800 pt-2 flex flex-wrap items-center gap-2">
              <span className="text-slate-300">DFU bootloader:</span>
              {!dfuImage && <button onClick={fetchStockDfu} disabled={busy} className={btn('bg-slate-800 border border-slate-700 text-slate-300')}><Download className="w-3.5 h-3.5" /> Get stock hackrf_one_usb.dfu</button>}
              <button onClick={runDfu} disabled={busy || !dfuImage} className={btn('bg-cyan-600 hover:bg-cyan-500 text-slate-950')}><Cpu className="w-3.5 h-3.5" /> Load RAM image</button>
            </div>
          )}
        </div>

        {/* Step 3 */}
        <div className={card}>
          <div className="font-bold text-slate-200 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> 3 · WRITE THE SPI FLASH</div>
          {!confirmed ? (
            <div className="bg-amber-950/50 border border-amber-500/40 rounded-lg p-3 text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-bold"><ShieldCheck className="w-4 h-4" /> Before flashing</div>
              <ul className="list-disc ml-4 text-[11px] space-y-0.5 text-amber-200/90">
                <li>Use a data USB cable straight into the computer (no hub). Do not unplug during the write.</li>
                <li>Flash the image for your hardware: Mayhem's <em>portapack-h1_h2-mayhem.bin</em> for a PortaPack, <em>hackrf_one_usb.bin</em> for a bare HackRF.</li>
                <li>If the write is interrupted, the board is recoverable through the DFU button (step 2).</li>
              </ul>
              <button onClick={() => setConfirmed(true)} className={btn('bg-amber-600 hover:bg-amber-500 text-slate-950')}>I understand, enable flashing</button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={runFlash} disabled={busy || !device || kind !== 'hackrf' || !image} className={btn('bg-rose-600 hover:bg-rose-500 text-white')}><Zap className="w-3.5 h-3.5" /> ERASE, WRITE &amp; VERIFY</button>
                <label className="flex items-center gap-1.5 text-slate-400"><input type="checkbox" checked={allowOdd} onChange={(e) => setAllowOdd(e.target.checked)} /> flash even if the image lacks the LPC43xx header</label>
              </div>
              {!image && <div className="text-slate-500 text-[11px]">Pick a firmware image in step 1 first.</div>}
              {device && kind !== 'hackrf' && <div className="text-slate-500 text-[11px]">The connected device is not running HackRF firmware yet.</div>}
            </>
          )}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300"><span>{progress.phase.toUpperCase()}</span><span>{fmtKb(progress.done)} / {fmtKb(progress.total)} · {pct}%</span></div>
              <div className="h-2 bg-slate-800 rounded overflow-hidden"><div className={`h-full ${progress.phase === 'verify' ? 'bg-emerald-500' : progress.phase === 'erase' ? 'bg-amber-500 animate-pulse' : 'bg-cyan-500'}`} style={{ width: `${progress.phase === 'erase' ? 100 : pct}%` }} /></div>
            </div>
          )}
          {flashResult && (flashResult.ok
            ? <div className="text-emerald-300"><CheckCircle2 className="w-4 h-4 inline" /> Verified {fmtKb(flashResult.bytes)} in {flashResult.seconds.toFixed(1)} s. The board rebooted; a PortaPack will offer a CPLD update on first boot — accept it.</div>
            : <div className="text-rose-300"><AlertTriangle className="w-4 h-4 inline" /> {flashResult.error}</div>)}
        </div>

        {/* Step 4 */}
        <div className={card}>
          <div className="font-bold text-slate-200 flex items-center gap-2"><HardDrive className="w-4 h-4 text-emerald-400" /> 4 · SD CARD (MAYHEM)</div>
          <div className="text-[11px] text-slate-400">Format the microSD as <strong className="text-slate-300">FAT32</strong>, put it in a reader, get the SD-card files in step 1, then pick the card's root folder. Existing files with the same names are replaced (that is how Mayhem updates work).</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runSdCopy} disabled={busy || !sdZip} className={btn('bg-emerald-600 hover:bg-emerald-500 text-white')}><FolderOpen className="w-3.5 h-3.5" /> Pick the SD card &amp; copy {sdZip ? `${sdZip.files} files` : ''}</button>
          </div>
          {sdProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300"><span className="truncate">{sdProgress.path}</span><span>{sdProgress.done} / {sdProgress.total}</span></div>
              <div className="h-2 bg-slate-800 rounded overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((sdProgress.done / sdProgress.total) * 100)}%` }} /></div>
            </div>
          )}
          {sdResult && <div className="text-emerald-300"><CheckCircle2 className="w-4 h-4 inline" /> {sdResult.files} files written ({fmtKb(sdResult.bytes)}). Eject the card, insert it in the PortaPack, power on.</div>}
          <div className="text-[11px] text-slate-500 border-t border-slate-800 pt-2">
            First boot: accept the CPLD update if asked, calibrate the touchscreen (Settings → Display), set the clock, and come back to the <strong>PortaPack Mayhem SDR</strong> tool to receive.
          </div>
        </div>
      </div>

      {/* Log */}
      <div ref={logRef} className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-56 overflow-y-auto space-y-0.5">
        {logs.length === 0 ? <div className="text-slate-500 text-center py-4">Pick a release or a local file to start.</div>
          : logs.map((l, i) => (
            <div key={i} className={l.type === 'error' ? 'text-rose-400' : l.type === 'warning' ? 'text-amber-300' : l.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}>
              <span className="text-slate-600 mr-2">[{l.time}]</span>{l.text}
            </div>
          ))}
      </div>
    </div>
  );
}
