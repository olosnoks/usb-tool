export default {
  id: 'usb-power-meter',
  toolId: 'usb-power-meter',
  category: 'programmers',
  title: 'USB Power Meter Logger — RuiDeng and FNIRSI live V/A/W, mAh and CSV',
  summary: 'Live voltage, current, power and temperature from RuiDeng UM24C/UM25C/UM34C and FNIRSI FNB48/FNB58/C1 USB testers, with the meter\'s own accumulated mAh/mWh, computed totals, session min/max, a live chart, limit alarms, averages and peaks, a battery runtime estimate and CSV export.',
  tags: ['USB power meter', 'USB tester', 'RuiDeng', 'UM25C', 'UM34C', 'FNIRSI', 'FNB58', 'C1', 'WebHID', 'Web Serial', 'mAh', 'mWh', 'USB-C charger'],
  readTime: '6 min read',
  content: `
# USB Power Meter Logger

The **USB Power Meter Logger** reads live measurements from two families of inexpensive USB testers and logs them in your browser. Each reading comes from the meter. Nothing is simulated, and no data is uploaded.

## Supported meters

| Family | Models | Link | Browser API |
|---|---|---|---|
| RuiDeng | UM24C, UM25C, UM34C | Bluetooth SPP, which Windows shows as a serial (COM) port | Web Serial, 9600 baud |
| FNIRSI | FNB48, FNB58, C1 (also FNB48S) | USB HID | WebHID |

Models outside this list are not supported. The tool does not guess. A RuiDeng dump with an unknown model ID is rejected, and a FNIRSI HID device that is not in the table is refused.

## Protocols

**RuiDeng.** The host sends one byte, **0xF0**, and the meter answers with a **130-byte status dump**. All multi-byte fields are big-endian. The first two bytes are the model ID: **0x0963** UM24C, **0x09c9** UM25C, **0x0d4c** UM34C. The UM25C reports volts in mV and current in 0.1 mA units. The UM24C and UM34C report centivolts and milliamps. Each dump carries the live V, A and W, temperature (°C and °F), D+/D- voltages, the charging-mode index, resistance, the recording threshold and ten data groups. Each group holds mAh and mWh, stored as 1/1000 units.

The tool polls once a second. Before each request it discards stale bytes, so a dump is never read out of alignment.

**FNIRSI.** The host sends 64-byte HID reports. Each one starts with **0xAA**, then a command byte, zero padding, and a **CRC-8** in the last byte. The CRC uses polynomial 0x39, initial value 0x42, no reflection. The tool runs an init sequence (0x81, 0x82, then 0x82 or 0x83 depending on the model) and sends a keepalive 0xAA 0x83 once a second. The meter streams sample packets (type 0x04). Each packet holds four 15-byte little-endian samples at 100 samples per second with volts, amps, D+, D- and temperature. Packets whose CRC does not match are dropped, and the drop count is shown.

## Using it

1. Pick the family at the top.
2. Press **Choose ... and connect**.
   - **RuiDeng:** pair the meter in Windows Bluetooth settings first. It then appears as a COM port in the Chrome or Edge port picker. Choose it.
   - **FNIRSI:** choose the meter in the HID picker.
3. Live tiles show voltage, current, power and temperature. For RuiDeng, D+/D-, the charging mode and the meter's resistance appear too.
4. A strip of small readouts shows **Elapsed** time, **Load V/I** (volts divided by amps, blank below 1 mA), the time-weighted **Avg** power and current for the session, and the **Peak** power and current.
5. **Device-reported** mAh and mWh show the data group the meter has selected. Only RuiDeng reports these in the verified layout.
6. **Computed this session** integrates the samples over time with the trapezoid rule. It starts when you connect or press **Clear session**. Gaps longer than 5 seconds are not integrated, and they are also left out of the averages.
7. The chart keeps the last 600 samples. Choose a **Window** of 100, 300 or 600 samples, and tick or untick the voltage, current and power lines. Each line is scaled to its own range, and the legend shows the range. **Pause chart** freezes the picture. Logging, totals and CSV rows keep going while it is paused.
8. **Limit alarms** (collapsed section): enter an upper limit for current, power or temperature and a lower limit for voltage. Leave a field blank to turn it off. While a sample breaks a limit, a red banner shows. Each time a limit goes from fine to exceeded, one event is counted for that limit. This only warns on screen. It does not cut power or control the meter.
9. **Battery runtime estimate** (collapsed section): enter a battery capacity in mAh, the cell voltage and a converter efficiency. The tool computes watt-hours and divides by the session average power. It is a rough guide, not a measurement.
10. **Session min / max** (collapsed section) tracks the extremes for V, A, W and temperature, and the sample count.
11. **Export CSV** saves every sample with an ISO timestamp, elapsed seconds, the device and computed totals. Up to 200,000 rows are kept.

## Browser requirements

- Chrome or Edge (Chromium). Firefox and Safari do not have Web Serial or WebHID.
- A secure context: HTTPS or localhost.
- Connect requires a click, because both APIs need a user gesture for the device picker.
- RuiDeng: the meter must be paired as a Bluetooth serial port. If Windows does not show a COM port for it, the tool cannot see it.
- FNIRSI: the device must be visible to WebHID. The tool asks Chrome for access through the picker.

## What it does not do

- It does not write to the meter. Screen, brightness, threshold and group-clear commands are not implemented.
- It does not use the meter's own accumulated totals for FNIRSI. The verified FNIRSI packet has no mAh/mWh field, so those totals are computed.
- It does not record without a browser tab. If the tab is closed, logging stops.
- It does not decode the RuiDeng header markers or the UM34C checksum. The sources disagree or do not give those values, so the dump is accepted by length and model ID.
- The RuiDeng temperature field is read as unsigned. A sub-zero reading may appear as a large number.

## Status and limits

**None of this has been run against real hardware yet.** The decoders are tested with byte vectors built from the documented offsets, and the FNIRSI CRC is checked against the published command checksums. Before you rely on a reading, compare it with the meter's own display.

Known gaps:
- FNB48, C1 and FNB48S use the FNB58 keepalive rate of once per second. The source logger used a different interval for them, and this was not confirmed.
- The RuiDeng Bluetooth SPP link is assumed to run at 9600 baud, as the sources state for the meter's internal board link. The host-side setting is not stated in the sources. Windows usually ignores the baud rate on a Bluetooth COM port.

## Troubleshooting

- **No COM port for the RuiDeng meter:** pair it in Windows Bluetooth settings first, then reload the page.
- **"Unknown RuiDeng model id":** the device replied with something other than a dump, often because a different Bluetooth device was chosen. Choose the meter again.
- **FNIRSI connected but no readings:** check that the meter is on and sending. The CRC-rejected count tells you whether packets arrive but fail the checksum.
- **Values jump after a gap:** the computed totals skip intervals longer than 5 seconds. A pause in polling does not add charge.

## Sources

- RuiDeng command table and 130-byte layout: [smandon/rdumtool](https://github.com/smandon/rdumtool) (\`rdum/__init__.py\`, \`rdum/tool.py\`), [Black-FX/rdserialtool](https://github.com/Black-FX/rdserialtool) (\`rdserial/um/__init__.py\`), and the [sigrok RDTech UM24C page](https://sigrok.org/wiki/RDTech_UM24C), which describes the model IDs, 0xF0 response and 9600 8-N-1 board link.
- FNIRSI HID framing, init and keepalive commands, CRC-8 and sample layout: [yeckel/OpenFNB58](https://github.com/yeckel/OpenFNB58) (\`fnb58.py\`, FNB58 PID 2E3C:5558) and [baryluk/fnirsi-usb-power-data-logger](https://github.com/baryluk/fnirsi-usb-power-data-logger) (\`fnirsi_logger.py\`, FNB48 0483:003A, C1 0483:003B, FNB48S 2E3C:0049).

## Similar tools

The feature set was compared with [rdserialtool](https://github.com/Black-FX/rdserialtool) and rdumtool (RuiDeng command line tools), the FNIRSI UsbMeter PC software, and sigrok's supported energy meters. Those tools talk to the same meters. This one adds browser-only convenience (no install) and does not write settings to the meter.

## Related tools

- **USB PD workbench** for USB-C Power Delivery negotiation.
- **USB Descriptor Explorer** for the descriptors of a connected USB device.
- **HID Inspector** for raw HID reports from any device, including a FNIRSI meter.
`,
};
