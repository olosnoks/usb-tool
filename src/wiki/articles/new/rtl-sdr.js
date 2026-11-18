export default {
  id: 'rtl-sdr',
  toolId: 'rtl-sdr',
  category: 'rf',
  title: 'RTL-SDR Receiver — RTL2832U and R820T over WebUSB',
  summary: 'Receive with a cheap RTL-SDR dongle straight from the browser: tune, see the spectrum and waterfall, listen to WFM, NFM or AM, decode 1090 MHz ADS-B, record raw IQ as .cu8, and keep bookmarks, peak hold and CSV or PNG snapshots.',
  tags: ['RTL-SDR', 'SDR', 'RTL2832U', 'R820T', 'R828D', 'WebUSB', 'Zadig', 'WinUSB', 'Spectrum', 'Waterfall', 'FM', 'AM', 'ADS-B', 'cu8', 'IQ'],
  readTime: '9 min read',
  content: `
# RTL-SDR Receiver

The **RTL-SDR Receiver** drives an RTL-SDR dongle (an RTL2832U USB demodulator with a Rafael Micro R820T, R820T2 or R828D tuner) directly from the browser through WebUSB. It is a software-defined radio: the dongle digitises a slice of the radio spectrum, and the page does the rest in JavaScript. Nothing is sent to a server; the samples stay on your machine.

## What the hardware does

| Part | Role |
|---|---|
| **R820T / R820T2 / R828D** | Tuner. Covers roughly 24 MHz to 1766 MHz, and mixes the chosen frequency down to a 3.57 MHz intermediate frequency (IF). |
| **RTL2832U** | Demodulator and USB bridge. Digitises the IF at the selected sample rate and streams unsigned 8-bit interleaved I/Q over bulk endpoint 0x81. |

Recognised USB IDs are VID \`0x0BDA\` with PID \`0x2838\` or \`0x2832\`. Any RTL-SDR-branded dongle using these chips should be listed by the browser's device picker.

## Requirements

- **Browser:** a Chromium browser (Chrome, Edge or Opera) on \`https://\` or \`localhost\`. Firefox and Safari do not implement WebUSB.
- **Windows:** the stock driver for these dongles (the DVB-T driver) is not usable by WebUSB. Install the **WinUSB** driver for the dongle with **Zadig**: run Zadig, choose the RTL2832U device (it may appear as "Bulk-In, Interface (Interface 0)" or the dongle name), pick **WinUSB** as the target driver and click **Replace Driver**. Unplug and reconnect afterwards. Note that this replaces the driver for that device only, so other software that uses the dongle's DVB-T stack will no longer see it.
- **Linux:** the browser may need a udev rule that grants your user access to the device. Without it the connect step fails with an access error.
- **Other tools:** only one program can own the dongle at a time. Close other SDR software before connecting here.

## Step by step

1. Click **CONNECT RTL-SDR (WEBUSB)** and pick the dongle in the browser dialog. The header shows the product name once the receiver is up. The page reads the tuner's chip-ID register and reports whether it returns the R82xx value (0x69).
2. Set the **frequency** in MHz and press **TUNE**, or click a point on the spectrum to tune there. The tuner is retuned, and the spectrum is re-centred on the new frequency.
3. Choose a **sample rate**. The displayed span is the sample rate: 2.048 MS/s shows about 2 MHz at once. Higher rates show more spectrum but use more CPU and USB bandwidth.
4. Press **START** to begin streaming. The spectrum (cyan line) and waterfall update continuously. Brighter colours are stronger signals.
5. Pick a **mode** and turn **AUDIO ON** to listen (see below). Set **Volume** and **Squelch** to taste.
6. **RECORD IQ (.CU8)** starts capturing the raw samples. Press it again to stop; the browser downloads the file.

## Controls

| Control | What it does |
|---|---|
| **Frequency / TUNE** | Sets the tuner LO to the requested frequency (the tuner adds its 3.57 MHz IF internally). Accepts 24 to 1766 MHz. |
| **Mode** | WFM (broadcast FM, with 75 us de-emphasis), NFM (narrow FM), AM, and ADS-B 1090. |
| **Sample rate** | 1.024, 1.2, 2.048, 2.4, 2.56 or 3.2 MS/s. The RTL2832U accepts 225 to 300 kS/s and 900 kS/s to 3.2 MS/s. |
| **Tuner AGC** | When ticked, the R820T adjusts its own LNA and mixer gain automatically. |
| **Gain** | Manual total gain, 0 to 49 dB, set in steps of the tuner's LNA and mixer tables. Turn off Tuner AGC to use it. |
| **RTL2832U digital AGC** | Enables the demodulator's own digital gain control. Useful for strong, varying signals; it changes what the spectrum level means. |
| **PPM** | Frequency correction for crystal error. Applied by scaling the reference crystal in the tuner and IF maths. Enter the measured error of your dongle. |
| **Squelch** | Opens the audio only when the channel power is above the threshold (dBFS). At the far left, squelch is off. |
| **Volume** | Output gain for the audio. |
| **Step buttons and step size** | The left and right arrow buttons, or the Up and Down keys in the frequency box, move the frequency by the chosen step (1 kHz to 1 MHz). |
| **Presets / bookmarks** | A drop-down of fixed band references (FM broadcast, airband guard, marine ch16, NOAA weather, 2 m and 70 cm calling frequencies, ADS-B 1090) plus your own bookmarks. Choosing one tunes and sets the mode. The star button saves the current frequency and mode under the name you typed. Bookmarks are kept in this browser's local storage and can be deleted under "Manage bookmarks". |
| **Peak hold / Average** | Optional traces on the spectrum: amber is the maximum seen per bin, violet is a smoothed average. Both reset when you retune, change the sample rate, or press RESET. |
| **Hover read-out** | Moving the mouse over the spectrum shows the frequency and level under the pointer. |
| **Strongest** | Up to three local maxima more than 10 dB above the noise floor; click one to tune to it (rounded to 1 kHz). |
| **CSV** | Saves the current spectrum as one row in the layout used by \`rtl_power\` (date, time, low Hz, high Hz, bin step, sample count, then one value per bin). Values are this tool's uncalibrated FFT dBFS, not dBm, and it is a single snapshot, not a swept survey. |
| **PNG** | Saves the waterfall canvas as an image. |
| **Spectrum** | Hann-windowed FFT averaged over every sample between display frames. The line shows dBFS; the grey lines are graticule marks. |
| **Waterfall** | Scrolling history of the spectrum, one row per display frame. |

## Modes and what they demodulate

- **WFM** uses a 240 kHz intermediate rate, an FM discriminator and 75 us de-emphasis. It is meant for ~200 kHz wide broadcast stations.
- **NFM** uses a 6.5 kHz channel low-pass (4th-order Butterworth) and an FM discriminator. It is meant for narrow-band voice radio.
- **AM** uses a 5 kHz channel low-pass and an envelope detector with a DC blocker.
- **ADS-B 1090** switches the tuner to 1090 MHz and the sample rate to 2.0 MS/s. The audio chain is turned off, and the bulk data is passed to the shared Mode-S decoder. Aircraft that send position, altitude, velocity or callsign frames appear in the table.

Audio is produced by the shared demodulator in \`src/utils/hackrfDemod.js\`, the same one the HackRF receiver uses. Its output rate is set by the decimation chain (for example 51.2 kHz for WFM at 2.048 MS/s) and the browser resamples it.

## Recording: the .cu8 format

Recordings are raw **unsigned 8-bit interleaved I/Q** (I, Q, I, Q …; a zero level of 127.5). This is the same format as \`rtl_sdr\` writes, so the file can be read by GNU Radio, inspectrum and similar tools. The file name carries the centre frequency and sample rate. Recording stops at 1 GiB; the panel reports when a capture was capped. A 2.048 MS/s stream is about 4.1 MB/s, so 1 GiB lasts roughly four and a half minutes.

## ADS-B limits

- The decoder works on each USB bulk chunk separately. A frame that spans two chunks is missed, so the receive rate is below 100 percent. A 1090 MHz antenna (a quarter-wave whip is about 6.9 cm) helps reception; the tuner gain and the RTL2832U AGC are not tuned for ADS-B.
- The shared decoder does **not** check the 24-bit CRC of the Mode-S frames. Corrupt frames may be shown as aircraft. Treat the table as a quick look, not as a verified feed.
- Positions are shown only when the aircraft sent its own position frames (the trail). The decoder otherwise falls back to a default receiver location, which is never displayed here as an aircraft position.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Unable to claim interface" or "Access denied" when connecting | The dongle still uses its default Windows driver, or another program has it open. | Install WinUSB with Zadig; close other SDR software. |
| No devices in the picker | Missing USB ID, or the browser cannot see the device. | Check the dongle is an RTL2832U; try another USB port. |
| "PLL did not lock" on tune | The LO is outside the synthesiser range or the reference is far from 28.8 MHz. | Try a different frequency; check the PPM value. |
| Spectrum is flat or very noisy | Gain too low or too high, or the antenna is wrong. | Try Tuner AGC, then adjust Gain manually. |
| Audio stutters | The main thread is busy (very wide span, many tabs). | Lower the sample rate; close other heavy pages. |
| Tuner chip-ID is not 0x69 | Not an R820T/R828D-family tuner (for example an E4000 or FC0013 dongle). | This driver only targets the R82xx tuners. |

## What this tool does NOT do

- No bias-tee power, no direct sampling (HF without an upconverter), no RTL-SDR Blog V4 HF path or input switching. The generic R820T/R828D path is the only one implemented.
- No E4000, FC0012, FC0013 or R820T-clone-specific code beyond the R82xx family.
- No transmit, no decoding of digital protocols beyond the ADS-B path, and no recording of demodulated audio.
- The DSP runs on the page's main thread, unlike the HackRF receiver which uses a worker.
- Nothing here has been run against a real dongle yet (see below).

## Attribution and licensing

The tuner and demodulator register sequences are ported from:

- **librtlsdr** (\`src/tuner_r82xx.c\` and \`src/librtlsdr.c\`), GPL-2.0-or-later, Copyright (C) 2012-2013 Steve Markgraf, Hoernchen, Mauro Carvalho Chehab and contributors. The R820T tables, frequency ranges, gain tables, PLL, mux, filter calibration and AGC sequences come from \`src/utils/rtlSdr/r820t.js\`.
- **webrtlsdr** by Jacobo Tarrio (\`src/rtlsdr/rtl2832u.ts\`), Apache License 2.0. The RTL2832U baseband initialisation list and the IF and resampler maths come from \`src/utils/rtlSdr/rtl2832u.js\`.
- The spectrum, demodulator and ADS-B decoder are the project's own shared modules (\`hackrfDsp.js\`, \`hackrfDemod.js\`, \`adsbDecoder.js\`).

## Testing status

The register sequences, PLL values, IF and resampler maths, gain selection, IQ conversions, the recorder and the demodulator (on synthetic FM, NFM and AM tones) are covered by unit tests. **None of this has been verified on a physical dongle.** The first hardware run should confirm that the tuner locks across the band and that the spectrum sits where the tuned frequency says it should. Treat the output as untested until that has been done.

## Similar tools

Compared against SDR#, Gqrx, SDR++ and \`rtl_power\`. Those programs add a frequency manager or bookmarks, peak hold, and (rtl_power) wideband sweeps with CSV output; the first three are covered above. Not implemented here: wideband sweeping beyond the current span, IQ playback, scanning, digital voice decoding and bias-tee control.

## Related tools

- **HackRF Receiver** (the RF tab): the same spectrum, waterfall and demodulation chain, for HackRF One hardware.
- **USB Inspector** and **Device Descriptor Explorer**: confirm the dongle's VID and PID before connecting.
- **Packet Analyzer**: the other capture and decode tools in the RF section.
`,
};
