export default {
  id: 'power-profiler',
  toolId: 'power-profiler',
  category: 'programmers',
  title: 'Power Profiler (PPK2) — source meter, ampere meter and live current capture',
  summary: 'Drive a Nordic Power Profiler Kit II over its own Web Serial port: supply a DUT as a source meter or measure current as an ampere meter, watch a live min/max current envelope with D0–D7 logic lanes, get charge and energy stats for any selected range, estimate battery life, analyse active bursts, and export CSV.',
  tags: ['PPK2', 'Power Profiler Kit II', 'Nordic', 'nRF', 'current measurement', 'power analysis', 'source meter', 'ampere meter', 'energy', 'battery life', 'Web Serial'],
  readTime: '6 min read',
  content: `
# Power Profiler (PPK2)

The **Power Profiler** tool talks to a **Nordic Semiconductor Power Profiler Kit II (PPK2)** directly from the browser. It uses its own serial port, separate from the shared serial port the rest of the app uses, because the PPK2 streams binary samples at 100 000 per second.

The protocol follows the open-source [ppk2-api-python](https://github.com/IRNAS/ppk2-api-python) library, which matches the nRF Connect Power Profiler app. The tool does not contain any simulated data. Every number on screen comes from the PPK2 you connected.

## Supported hardware

- **Nordic PPK2** (USB vendor ID 0x1915, product ID 0xC00A). The PPK2 appears to the computer as a USB serial device.
- The original PPK1 and other Nordic boards are not supported.

## Browser requirements

- **Chrome or Edge on desktop** (Chromium). Web Serial is not available in Firefox or Safari.
- The page must be served from a secure context (https or localhost), which is the case for the hosted app.
- Connecting requires a click, because the browser asks you to pick the PPK2 in its port chooser.
- If the port chooser does not list the PPK2, check the cable (it must carry data, not only power) and that no other program, such as the nRF Connect app, has the port open.

## Step by step

1. **Connect PPK2.** Pick the PPK2 in the port chooser. The tool reads the factory calibration from the device before it enables anything. If the calibration is incomplete, the tool says which keys are missing, hides the currents and keeps Start disabled.
2. **Choose a mode.**
   - **Source meter** supplies the target (DUT) at the voltage you enter, from 800 to 5000 mV. Enter the value and press **Apply** if you change it while connected. Use **DUT power** to switch the supply on or off.
   - **Ampere meter** measures current flowing into the PPK2 from an external supply. DUT power is switched off in this mode.
   - Change modes only while not measuring. Stop first.
3. **Start.** The tool sends the mode and voltage to the PPK2, then starts averaging. Each Start clears the previous capture.
4. **Read the chart.** The top line is the current. The chart shows, for every pixel column, the minimum and maximum current in that slice of time as a cyan band, and the average as a green line. The window selector sets 1, 2, 5, 10, 30 or 60 seconds of history. **Log Y** switches the current axis to a logarithmic scale from 0.1 µA up, so a µA sleep current and an mA burst are both readable.
5. **Use the digital lanes.** The PPK2 samples eight digital inputs (D0 to D7) along with the current. They are drawn as amber lanes under the chart. A solid high or low line means the input was constant in that slice. A filled block means it toggled inside that slice.
6. **Select a range.** Drag across the chart to select a time range. The Selection card then shows its stats. A single click clears the selection.
7. **Pause view** freezes the chart and the window stats so you can read them. Capture continues in the background, so **Resume view** jumps back to live.
8. **Stop** ends averaging. The capture remains on screen so you can select and export it.

## Panels and stats

- **Current readout.** The mean of the last 2 ms of samples.
- **Last N s.** Average, minimum and maximum current, total charge, energy and duration for the visible window.
- **Selection.** The same figures for the range you dragged.
- **Charge** is the integral of current over time. Each sample is 10 µs, so the total in µC is the sum of the samples in µA multiplied by 10 µs. 1 mAh is 3.6 × 10⁶ µC.
- **Energy** is the charge multiplied by the supply voltage. The voltage comes from the mV field. In ampere mode, set this field to your real supply voltage. The tool does not read it from the device.
- **Battery life.** Enter a battery capacity in mAh and a margin in percent. The tool divides capacity × (1 − margin) by the average current of your selection, or of the visible window if nothing is selected, and shows the runtime in minutes, hours, days or years. This is the simple average-current method. It does not model battery chemistry, voltage cutoff or pulse loads, so treat it as a first estimate. It is only meaningful if the captured period is representative of real use. The margin is clamped to 0 to 90 percent.
- **Copy stats** copies the window stats (and the selection stats, if any) to the clipboard as plain text.
- **Activity analysis** (collapsed by default, calculated only while it is open). Set a threshold in µA. For the selection or window it shows standard deviation, peak-to-peak current, the share of time above the threshold, the number of separate bursts above it, and the average current while active and while idle. A burst is one run of consecutive samples above the threshold. Use it to find the duty cycle of a device that sleeps and wakes.
- **Device** (collapsed) shows the hardware revision, the VDD value from the metadata, the device's own mode and whether the calibration is complete.

## CSV export

**CSV** saves one row per sample: time in seconds from the start of the capture, the current in µA, and D0 to D7 as 0 or 1. If you have a selection, the export covers only that selection. Otherwise it covers the whole capture, which holds up to the last 60 seconds. Sixty seconds is 6 million rows and a large file, so use a selection when you can.

## Limits

- The capture buffer holds **60 seconds** of raw samples. Older samples are overwritten.
- The chart and stats are computed in the browser. The chart is decimated, so very short spikes are visible in the envelope but are not reported one by one.
- The **spike filter** and rolling average that ppk2-api-python applies on top of the calibration formula are **not** implemented. Currents here are the raw calibrated values.
- The **counter bits** in each sample (bits 17 to 23) are not decoded. ppk2-api-python does not use them either.
- In ampere mode the calibration includes a voltage term, which uses the voltage field. If the device's calibration needs a different value there, the reading will be off by that term.
- Calibration values are only as good as the device's stored metadata. A missing or zero value is reported in the Device panel.
- The PPK2 is not reset when you disconnect. Stop capture before disconnecting.

## Troubleshooting

- **No calibration metadata.** The PPK2 did not answer the metadata request within 3 seconds. Unplug and replug it, then connect again. Make sure no other tool holds the port.
- **Calibration incomplete.** Some per-range calibration keys were missing from the device, so currents are not shown. The calibration has to come from the device; this tool cannot repair it.
- **Rate well below 100 kS/s.** The browser or the USB hub may be too slow for the stream. Connect the PPK2 directly to the computer and close other heavy tabs.
- **Port does not appear.** Check the cable (use a data cable, not a charge-only one) and the PPK2 power LED.

## Similar tools

This tool was compared with the nRF Connect Power Profiler app (CSV and .ppk2 save, trigger, digital channels), the Joulescope UI (statistics such as standard deviation and peak-to-peak, charge and energy, dual markers) and the Otii battery life estimator (average-current estimate with a safety margin). Not implemented here: hardware trigger, saving or loading .ppk2 files, and discharge-curve based battery modelling.

## Related tools

- The PPK2 runs on its own serial port, so it does not share the app's serial connection with other tools.
- The **Logic Analyzer** tool is a separate capture path for digital signals and is not linked to this tool.

## Verification status

The protocol is taken from the ppk2-api-python source. The decoding and calibration math are covered by unit tests with fixed byte vectors. This build has not yet been checked against a physical PPK2, so treat the first measurements as something to cross-check with the official nRF Connect Power Profiler app.
`,
};
