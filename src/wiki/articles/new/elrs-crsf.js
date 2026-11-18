export default {
  id: 'elrs-crsf',
  toolId: 'elrs-crsf',
  category: 'rf',
  title: 'ExpressLRS / CRSF Tool — Crossfire telemetry, link stats and device parameters',
  summary: 'Decode the Crossfire (CRSF) serial protocol used by ExpressLRS TX modules and receivers: live link statistics, RC channels, battery, GPS and attitude, plus a device parameter browser that can read and write settings after confirmation.',
  tags: ['ExpressLRS', 'ELRS', 'CRSF', 'Crossfire', 'TBS', 'RC link', 'LQ', 'RSSI', 'TX module', 'telemetry', 'parameters', 'UART'],
  readTime: '8 min read',
  content: `
# ExpressLRS / CRSF Tool

The **ELRS / CRSF Tool** talks the Crossfire (CRSF) serial protocol over the app's shared serial port. CRSF is the wire format that ExpressLRS (ELRS) TX modules, receivers and many flight controllers use to exchange RC channels and telemetry. The tool decodes what it hears, and it can ping devices and read or change their parameters. Everything runs in your browser, and nothing is sent unless you press a button.

## Hardware and wiring

- A serial link carrying CRSF: typically an ELRS TX module, an ELRS or Crossfire receiver, or a flight controller's CRSF UART, reached through a USB-UART adapter.
- Connect the adapter's RX to the device's CRSF TX line, the adapter's TX to the device's CRSF RX line (for pings and parameter access), and share GND. Check the logic level first: most CRSF lines are 3.3 V, and a 5 V adapter can damage them.
- Some modules use a single bidirectional wire. A plain USB-UART cannot drive that directly, so you will only see incoming frames until you wire a separate transmit path.
- Baud rate: 420000 is the ELRS default. The selector also offers 115200, 400000, 416666 and 921600. Use the rate your device is configured for. Not every USB-UART adapter supports non-standard rates, so confirm yours does.

## Browser requirements

- A Chromium browser (Chrome, Edge or Opera) on desktop with Web Serial enabled. Firefox and Safari do not provide Web Serial.
- Click **CONNECT PORT** and choose the adapter. The port is the shared one used by the rest of the app, so only one tool can hold it at a time.

## Live telemetry tab

- **Link statistics (0x14):** uplink RSSI for both antennas in dBm, uplink link quality (LQ) in percent, uplink SNR, active antenna, RF mode index, TX power in mW from the power index, and the downlink RSSI, LQ and SNR.
- **LQ / RSSI trend:** the last 120 link frames, plotted as LQ (green), uplink antenna 1 RSSI (cyan) and antenna 2 RSSI (violet).
- **Link badge:** a rule-of-thumb verdict on the latest link frame: LINK OK, WARN or BAD. It flags uplink LQ under 80% (warn) or 50% (bad), best-antenna RSSI at or below -95 dBm (warn) or -105 dBm (bad), and negative uplink SNR. These thresholds are general guidance and not part of the CRSF spec. Hover the badge for the reasons.
- **Statistics table:** min, average and max of uplink LQ, RSSI on each antenna, uplink SNR and downlink LQ over the last 120 frames, plus the number of dropouts (LQ falling from 50% or more to under 50%).
- **REC and CSV:** REC records every link frame (up to 20000) while connected. CSV downloads the recording, or the last 120 frames if nothing was recorded, with time in ms from the first sample, RSSI, LQ, SNR, antenna, RF mode index, TX power and the downlink values. The RF mode is shown as the raw index because its meaning depends on band and firmware.
- **RC channels (0x16):** 16 channels of 11 bits, unpacked and shown as microseconds (988 to 2012 µs for the full range, 1500 µs at centre).
- **Battery (0x08), GPS (0x02), attitude (0x1E) and flight mode (0x21):** the latest value of each. GPS latitude and longitude are shown to five decimals.
- **Frames seen:** a count and a rate in Hz (over the last 2 seconds) per frame type, plus valid frames, frames rejected for a bad CRC and bytes skipped while resynchronising.

Values only appear when frames arrive. Panels with no data show a dash, not an example.

## Device parameters tab

1. Choose the **host sync** byte: 0xEE for a TX module (the default), 0xC8 for a flight controller, or 0xEC for a receiver. This sets the sync byte on frames the tool sends.
2. Press **PING DEVICES**. Each device that answers with a device info frame is listed with its name, address, parameter count and parameter version.
3. Press **USE** on a device, then **READ ALL PARAMETERS**. Parameters are requested one at a time. Each request times out after about 800 ms and is retried twice before it is reported as an error. **STOP** ends the read after the current parameter.
4. The table shows each parameter's number, name, type, parent folder, current value, range and unit. Hidden parameters are off by default; tick **show hidden** to list them.

Types decoded: UINT8, INT8, UINT16, INT16, UINT32, INT32, FLOAT (with decimal places), TEXT SELECT, STRING, FOLDER, INFO and COMMAND. 64-bit integers are listed with their raw bytes.

**Writing a value:** edit the value, then press **WRITE** (or **RUN** for a command). The tool checks the value against the parameter's range, asks you to confirm, sends the write, and then reads the parameter back. The value shown after a write is what the device reports, not what you typed. Strings, folders and info entries are read-only here.

Writes change the device's configuration and can change how the link behaves. Read a parameter's current value before you change it, and note the old value so you can restore it.

## Raw frames tab

Every frame that passed the CRC check is listed with its time, direction (RX from the device, TX sent by this tool), frame type and full hex. Tick **hide RC channel frames** to reduce noise, which is useful because RC frames arrive many times per second. **DOWNLOAD .TXT** saves the list, and **CLEAR** empties it. The list keeps the last 300 entries.

## Protocol notes

- Frame layout: sync byte, length (type, payload and CRC), type, payload, and a CRC-8 with polynomial 0xD5 over the type and payload.
- Multi-byte telemetry fields are big-endian. Extended frames (type 0x28 and above) begin with destination and origin addresses.
- Device pings go to the broadcast address 0x00. Parameter requests use the device address found in its device info frame.

## Limits and what the tool does not do

- It does not flash firmware, bind a receiver, or run the ELRS Lua scripts. Use the ELRS configurator for those.
- It does not generate RC channel data. It only decodes frames that arrive.
- Parameter field layouts for FLOAT, TEXT SELECT and COMMAND follow the CRSF specification as implemented here. Test a write on a non-critical parameter first, on your own hardware.
- Parameter numbering and folder structure come from each device. Two devices may use different numbers for the same setting.
- Frames are only decoded at the baud rate the port is open at. Changing the baud rate reopens the port.

## Troubleshooting

- **No frames at all:** check the baud rate, that GND is shared, that RX and TX are not swapped, and the logic level.
- **Frames counted as bad CRC, nothing decoded:** the baud rate is almost always wrong. Try 420000 and 400000 first.
- **Device info never arrives after a ping:** the host sync byte may not match the device, or the device may not be powered or on the wire. Try each sync option.
- **A parameter times out:** some parameters do not answer until the device has finished booting. Read again, or stop and read only the parameters you need.
- **Write rejected:** the value is outside the device's range or the parameter is read-only. The message says which.

## Similar tools

Compared while designing this view: the ExpressLRS Lua script and Configurator (setup and flashing, which this tool does not do), EdgeTX telemetry screens (1RSS, 2RSS, RQly, RSNR, RFMD, TPWR sensors), and the link statistics views in Betaflight and INAV. The CRSF link statistics frame (0x14) carries the same values they show.

## Related tools

The shared serial console in the main app shows the same bytes as hex and text, and is useful for checking that the adapter and baud rate are correct before you use this tool.
`,
};
