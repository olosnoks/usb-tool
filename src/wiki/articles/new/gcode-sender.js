export default {
  id: 'gcode-sender',
  toolId: 'gcode-sender',
  category: 'utilities',
  title: 'G-code Sender — Marlin 3D printers and GRBL 1.1 CNC',
  summary: 'Send G-code to a Marlin 3D printer or a GRBL 1.1 CNC controller over the shared serial port: detect the firmware, jog, home and set zero, watch temperatures or machine status, stream a .gcode file one acknowledged line at a time, or type commands in a console.',
  tags: ['G-code', 'Marlin', 'GRBL', '3D printer', 'CNC', 'Serial', 'Streaming', 'Jog', 'Temperature', 'Gcode sender'],
  readTime: '7 min read',
  content: `
# G-code Sender

The **G-code Sender** drives a **Marlin** 3D printer or a **GRBL 1.1** CNC controller (router, mill, laser) over the app's shared serial port. It runs entirely in your browser. Nothing is sent until you connect a device and press a control.

Klipper is not supported. Klipper runs its own host protocol, so it is not a serial G-code device in this sense.

## Requirements

- A **Chromium-based browser** (Chrome, Edge, Opera). Web Serial is not available in Firefox or Safari.
- The controller on a **USB serial** connection. Most Marlin boards use a USB-serial chip or native CDC. GRBL boards (Arduino Uno with a GRBL shield, many CNC controllers) use an Arduino-style USB-serial chip.
- The **baud rate** must match the firmware. GRBL and most printers use **115200**. Some Marlin boards are configured for **250000**. Set it in the header before you connect.
- If the port does not appear, the USB-serial chip may need its vendor's VCP driver (common for CH340 boards on Windows). Install it and reconnect the board.

## Connecting and firmware detection

1. Choose the baud rate in the header and press **CONNECT SERIAL**.
2. The tool sends \`$I\` (GRBL) and \`M115\` (Marlin) about half a second after connecting, and reads the reply.
   - Marlin answers with a \`FIRMWARE_NAME:\` line. The header then shows **FIRMWARE: MARLIN** and the version.
   - GRBL answers with \`[VER:...]\`, or its \`Grbl 1.1x\` banner appears. The header shows **GRBL 1.1**.
3. If nothing is detected, press **DETECT FIRMWARE** again. You can also pick the firmware from the **Firmware** selector. A manual choice is used as-is, even when the device does not reply.

The firmware-specific panels (temperatures for Marlin, status for GRBL) appear once the firmware is known or chosen.

## Marlin (3D printers)

**Temperature panel**

- **READ (M105)** asks for the current hotend and bed temperatures and shows them with their targets.
- **AUTO-REPORT (M155)** asks the printer to report temperatures every N seconds (the seconds box, default 2). **AUTO OFF** sets the interval to 0. Those reports appear as plain lines and are not treated as acknowledgements.
- The **chart** plots the last five minutes of real reports: hotend and bed in solid lines, their targets dashed. Nothing is plotted until a report arrives.
- **Hotend target** and **Bed target** set \`M104\` and \`M140\`. The tool refuses values above 400 C for the hotend or 150 C for the bed.
- **Fan** sets \`M106 S\` (0-255). **OFF** sends \`M107\`.
- **EXTRUDE** and **RETRACT** move the extruder by the length and feed you enter. They send \`M83\` (relative E), the move, then \`M82\` (absolute E) so the printer returns to its normal extrusion mode.

**Motion**

- **Jog** sends a relative move (\`G91\`, \`G1\`, \`G90\`) at the step size and feed you pick.
- **HOME ALL** sends \`G28\`.
- **ZERO X / Y / Z / ALL** sends \`G92\` to set the current position as zero. This is only a coordinate change until the next home, and the printer does not remember it after a reset.

## GRBL 1.1 (CNC)

**Status panel**

- The tool sends the realtime \`?\` request every 250 ms (turn this off with the checkbox). It reads the reply: the state (Idle, Run, Hold, Jog, Alarm and others), machine position (MPos) and work position (WPos), feed and spindle values, overrides, planner and RX buffer counts, and pin states.
- If the controller reports WCO (work coordinate offset) only now and then, the tool keeps the last one and derives whichever of MPos or WPos is missing.
- **FEED HOLD** (\`!\`) stops motion smoothly. **RESUME** (\`~\`) continues. **SOFT RESET** (Ctrl-X) stops everything and flushes the controller's buffer. It can leave the controller in an alarm state that needs an unlock. **UNLOCK** sends \`$X\`. **JOG CANCEL** cancels a jog in progress.
- **READ SETTINGS** sends \`$$\` and lists every setting it returns, with the description if the controller gives one.

**Motion**

- Jog uses GRBL's jog command (\`$J=G21G91...\`), in millimetres.
- **HOME ALL** sends \`$H\`. Homing has to be enabled in the controller's settings.
- **ZERO** sends \`G10 L20 P1\` to set the work offset of the current position on the chosen axes.

## Streaming a file

1. Press **LOAD .gcode** and pick a file (\`.gcode\`, \`.gc\`, \`.nc\`, \`.ngc\`, \`.tap\` or \`.txt\`). The file is read in your browser. Comments in \`;\` or \`( )\` form, blank lines and \`%\` delimiters are removed. A leading \`N\` line number or a trailing \`*checksum\` is also removed, so the tool can number the lines itself.
2. Press **START**. Progress shows the commands acknowledged so far, the percentage, elapsed time, an ETA that is estimated from the pace so far, the number of resends and of errors.
3. **PAUSE** stops sending new lines. On GRBL it also sends a feed hold, and **RESUME** sends a cycle start. On Marlin, the line already sent finishes, then nothing more is sent until you resume.
4. **STOP** stops sending. On GRBL it sends a feed hold. Use **SOFT RESET** to flush what is already buffered on the controller. On Marlin, the line already sent to the printer still finishes.

**How each firmware is streamed**

- **Marlin:** the stream opens with \`M110 N0\` and then sends \`N<n> <command>*<checksum>\` with the checksum as Marlin expects. Only **one line is in flight** at a time. The next line is sent after the printer's \`ok\`. This is slower than GRBL but keeps resend handling simple and correct. When Marlin answers \`Resend: N\`, the tool rewinds to line N and sends again from there. Line-number and checksum errors are shown as warnings because Marlin resends after them. Any other \`Error:\` from the printer stops the stream.
- **GRBL:** lines are sent with a newline, and the tool keeps up to **127 bytes** of unacknowledged lines in the controller's buffer (character counting). Each \`ok\` frees the oldest line, so the controller always has work queued. A line longer than 126 bytes cannot fit the buffer and is refused at start. On \`error:N\` or \`ALARM:N\` the stream stops. Lines already buffered on the controller still run unless you feed hold or soft reset.

## Console

The console shows every line the device sends and every line you or the stream sent. Type a command and press Enter. Manual lines are **disabled while a file is streaming**, because their replies would be counted as acknowledgements of the file. Feed hold, resume, soft reset and status polling stay available during a stream.

## What it does NOT do

- **Klipper** is not supported.
- **SD card printing** (\`M24\`, \`M23\`) and printer-side file listing are not implemented. Stream the file from this tool instead.
- **Bed mesh, probing, auto-home, filament, and other Marlin menus** are not implemented. Use the console to send their commands if you need them, and check the replies.
- **Press-and-hold jogging** is not implemented. Jog is one step per click.
- **Plotter, laser power and spindle speed controls** are not implemented. Send \`S\` and \`M3\`/\`M5\` from the console or put them in the file.
- **Hardware is not a safety system.** Keep an emergency stop within reach, and never leave a machine unattended while it is running a file.

## Troubleshooting

- **Nothing is detected.** Check the baud rate and that no other program has the port open. Press **DETECT FIRMWARE** again. A few controllers take a moment after the port opens, so wait a second before pressing it.
- **The stream stops with "Printer asked for line N".** That is normal. Marlin requested a resend, and the tool sent the line again. Repeated resends usually point to a noisy USB cable or a bad connector.
- **A line is refused as too long for GRBL.** The line is longer than the controller's 127-byte buffer allows. Split the move into shorter lines.
- **GRBL shows ALARM.** Read the alarm code in the console. Unlock with **UNLOCK** when it is safe (after homing if needed).
- **The temperature chart is empty.** Press READ or enable AUTO-REPORT. Marlin only reports when asked, and not every firmware supports M155.
- **The status panel shows "not reported" for a position.** The controller did not send that field in its last report. Some builds send only MPos.

## Related tools

- **Terminal & Console**, the raw serial monitor, for commands this tool does not offer.
- **Telemetry Gauges**, for plotting numeric values a device prints as text.
- **Crash & Panic Alerts Deck**, for watching serial output for error patterns while a machine runs.
- **Hash & HMAC Calculator**, if you want to check a downloaded G-code file against a published hash.
`,
};
