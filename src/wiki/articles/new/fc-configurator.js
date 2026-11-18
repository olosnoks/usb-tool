export default {
  id: 'fc-configurator',
  toolId: 'fc-configurator',
  category: 'utilities',
  title: 'Flight Controller Configurator — MSP identify, live telemetry and CLI',
  summary: 'Connects to a Betaflight or INAV flight controller over its USB serial port using the MultiWii Serial Protocol (MSP) at 115200 bps. Reads identity, status, attitude, raw IMU, receiver, battery and motor values, and gives you a CLI tab for typed commands and diff/dump capture. It never arms, tests motors or writes settings on its own.',
  tags: ['Flight Controller', 'Betaflight', 'INAV', 'MSP', 'MultiWii', 'FC', 'Drone', 'CLI', 'diff all', 'IMU', 'Telemetry', 'Flight Controller Configurator'],
  readTime: '6 min read',
  content: `
# Flight Controller Configurator

The **Flight Controller Configurator** talks to a Betaflight or INAV flight controller (FC) over its USB serial port. It speaks the **MultiWii Serial Protocol (MSP)** for read-only status and telemetry, and it has a **CLI** tab for the text command line that Betaflight and INAV expose on the same port.

Everything runs in your browser over Web Serial. Nothing is uploaded.

## Supported hardware and firmware

- Flight controllers running **Betaflight** or **INAV** (or another firmware that answers MSP at 115200 bps on its USB serial port).
- The tool reads the firmware variant from the board (\`MSP_FC_VARIANT\`) and shows the name it reports. Unknown variants are labelled as unknown rather than guessed.
- The board does not need to be armed, and it does not need to be flying.

## Browser requirements

- A **Chromium-based browser** (Chrome, Edge, Opera) on desktop. Web Serial is not available in Firefox or Safari.
- The page must be opened over HTTPS or on localhost, as with the rest of the app.
- The FC's USB virtual COM port is a serial device. On Windows 10 and 11 it normally works without extra drivers; older Windows may need the board maker's virtual COM port driver. Pick the port that appears when you press **Connect serial port**.

## Connecting

1. Plug the flight controller in with USB and wait for the port to appear.
2. Press **Connect serial port** and choose the FC's port. The tool opens it at **115200 bps**. If the console is set to a different baud, the tool shows a warning and a **Set 115200** button (only while disconnected).
3. The header shows CONNECTED and MSP MODE. Nothing is displayed until the board answers. If it does not, the Live tab explains what to check.

## Tabs

### Identify

**Read identity** sends five read-only requests in order:

| Request | What it shows |
|---|---|
| MSP_API_VERSION (1) | Protocol and MSP API version |
| MSP_FC_VARIANT (2) | Four-letter variant id and the name (Betaflight, INAV) |
| MSP_FC_VERSION (3) | Firmware version |
| MSP_BOARD_INFO (4) | Board identifier, hardware revision, target and board names when the firmware sends them |
| MSP_BUILD_INFO (5) | Build date, build time and short git revision |

Each card shows an error instead of a value when the firmware does not support that request or does not reply.

### Status

While this tab is open, it continuously polls **MSP_STATUS_EX (150)**. It shows:

- cycle time in microseconds and the matching loop rate in Hz
- the I2C error count
- which sensors report present (ACC, BARO, MAG, GPS, SONAR)
- the PID profile index when the firmware sends it
- the raw mode-flag word

**Arming-disabled reasons are not decoded.** Their bit layout differs between Betaflight and INAV, so this version shows the raw word and does not translate it.

### Live

Polls these read-only requests in turn while the tab is open:

- **Attitude (MSP_ATTITUDE 108):** roll, pitch and yaw. The horizon drawing is a simple indicator for orientation, not a calibrated display. Roll and pitch arrive in tenths of a degree and are shown in degrees.
- **Raw IMU (MSP_RAW_IMU 102):** accelerometer, gyroscope and magnetometer values as raw signed counts. No unit conversion is applied. The chart plots the last few hundred gyro samples.
- **Receiver (MSP_RC 105):** one bar per channel on a 1000 to 2000 scale.
- **Battery (MSP_ANALOG 110):** voltage (0.1 V steps), current, mAh used and the raw RSSI value the firmware reports.
- **Motors (MSP_MOTOR 104):** readout only. The tool never spins or tests a motor.

Use **Polling: on/off** in the tab bar to pause the requests. The footer counts requests, replies, timeouts, unsupported replies and bad frames, which helps when a link is noisy.

### CLI

- **Enter CLI (#)** sends the single byte \`#\`, which Betaflight and INAV use to switch from MSP to the text CLI. MSP polling pauses while the CLI is active.
- Type a command and press Enter. Commands are sent only when you type them. The tool does not send \`set\`, \`save\` or any other command on its own.
- **Capture diff all** and **Capture dump** send \`diff all\` or \`dump\` and collect the output until the \`#\` prompt returns. Use **Download** to save the capture as a text file.
- Typing \`exit\` opens a confirmation first. Exiting **reboots the flight controller**. Anything not saved with \`save\` is lost, and the USB serial port may drop and need reconnecting.

## What it does NOT do

- It does **not** arm the flight controller, run a motor test, or spin any motor.
- It does **not** write settings over MSP. Settings change only through commands you type in the CLI, such as \`set\` followed by \`save\`.
- It does not decode arming-disabled reasons from STATUS_EX.
- It does not implement MSP v1 "jumbo" frames (payloads over 255 bytes). The requests it sends are all small.
- It does not flash firmware, read blackbox logs, or upload configurations. Use the official Betaflight or INAV configurator for those.

## Troubleshooting

- **Nothing shows after connecting.** Check that the port is the flight controller's own USB serial port, that the port is at 115200 bps, and that the board is powered. A board stuck in the CLI will not answer MSP. Disconnect, reconnect, and try again.
- **Some cards say "not supported".** The firmware rejected that request. Older or unusual builds may not implement every command.
- **Bad frames in the footer.** Usually line noise or a bad cable or hub. Try a direct USB port and a data-capable cable.
- **The CLI shows nothing after Enter CLI.** Check that the board is still answering on this port and that no other tool holds it. Then disconnect and reconnect.
- **A capture says it stopped before the prompt returned.** The board sent no output for a long time, or it left the CLI. The file may be incomplete.
- **Values look wrong.** Raw IMU and RC values are raw counts. Check the units above before comparing with the official configurator's graphs.

## Related tools in this app

- The main **serial console** is the place for free-form serial traffic and baud changes.
- The **USB Inspector** (descriptors tab) shows what the flight controller's USB interfaces declare, when you need the device side rather than the MSP side.
`,
};
