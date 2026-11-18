export default {
  id: 'input-tester',
  toolId: 'input-tester',
  category: 'utilities',
  title: 'Gamepad & Mouse Tester — stick drift, circularity, polling rate, clicks and DPI',
  summary: 'Reads a connected gamepad through the Gamepad API and measures stick drift, circularity, trigger response and report rate. Tests the mouse for event rate, double-click and chatter, wheel deltas and DPI. Optional WebHID view of raw DualSense and DualShock 4 USB reports. All in the browser.',
  tags: ['Gamepad', 'Controller', 'Joystick', 'Stick drift', 'Circularity', 'Gamepad API', 'Polling rate', 'Mouse', 'DPI', 'Chatter', 'Double click', 'DualSense', 'DualShock 4', 'WebHID', 'Rumble', 'Input Tester'],
  readTime: '8 min read',
  content: `
# Gamepad & Mouse Tester

The **Gamepad & Mouse Tester** checks the input hardware you already own: game controllers and mice. It reads real input from the browser and shows what the device is sending. Nothing is simulated, and nothing is uploaded. The page only reads state that the browser already exposes to it.

The tool has two tabs, **Gamepad** and **Mouse**. A third section, **Raw HID reports**, sits at the bottom of the Gamepad tab.

## Browser requirements

- **Chromium-based browser** (Chrome, Edge, Opera). The Gamepad API, pointer lock with unadjusted movement, and WebHID are not available in Firefox or Safari.
- A **secure context**: HTTPS or \`localhost\`.
- **Gamepads:** Chromium only lists a pad after you press a button on it. Plug the pad in, then press any button. The list refreshes once a second and also on connect and disconnect events.
- **Raw HID:** WebHID needs a user click to pick the device. If the device cannot be opened, another controller utility may be holding it; close that utility and connect again.

## Gamepad tab

### Connected gamepads and buttons

Each detected pad shows its index, its ID string, and its mapping. A pad with mapping \`standard\` uses the W3C standard button layout, so the buttons have names such as A / Cross and LB / L1. Other pads show generic \`Button N\` labels.

Every button is listed with its analog value from 0 to 1 and a bar. A pressed button is highlighted. The axes are listed as raw numbers below the buttons.

Each button tile also shows whether it has been **tested** (pressed at least once since the last reset), how many times it was pressed, and a **chatter** count. A press that comes less than 50 ms after the previous press of the same button counts as chatter, which usually means a bouncing or worn switch (the shortest gap is shown as a tooltip). The header shows totals: buttons tested out of the total, presses, and chatter. The reset button clears the counts and the axis ranges.

Below the axes, **Range seen** lists the minimum and maximum reached by each axis since the last reset. Sweep each stick fully; an axis that has reached both -0.95 and +0.95 is marked \`ok\`. An axis that never gets there may point to a worn gate or a pad that needs calibration.

### Session report

The copy button puts a short text report on the clipboard, and the download button saves the same data as \`gamepad-report.json\`. The report holds the pad ID and mapping, the last drift result with its suggested deadzone, the circularity result if one was captured, the report rate, button totals and axis ranges. Nothing is sent anywhere.

### Sticks and deadzone

The two sticks are drawn on circular plots. A fading trail shows the last 90 frames. The dashed amber ring is the **deadzone**, and you set it with the slider from 0 to 0.5. A green dot is outside the deadzone, a grey dot is inside it.

Below each plot the tool shows the raw x and y values and the value **after deadzone**. The deadzone is radial: inside the ring the stick reads zero, and outside the ring the magnitude is rescaled so full deflection still reads 1. The direction is kept.

### Drift at rest (3 second capture)

Release both sticks, pick the stick under test (**left** or **right**), and press **Measure rest**. The tool samples the stick every frame for 3 seconds and reports:

- **avg**: the mean distance from zero, as a percentage of full deflection.
- **max**: the largest distance from zero in the capture, as a percentage.
- the centre offset on x and y.

Keep your hands off the stick during the capture. Any movement is counted as drift.

After a capture the tool shows a **suggested deadzone**: the worst resting distance plus 2 %, rounded up to the next 1 %, with a minimum of 0.05 and a maximum of 0.50. **Apply** sets the deadzone slider to that value. It is a starting point, not a calibration; the pad itself is not changed.

### Circularity

Press **Start**, then rotate the stick slowly through full deflection in one turn. The tool keeps the largest radius reached in each of 360 one-degree angle bins. That gives a max-extent polygon, drawn in cyan. Press **Stop** when you are done.

The results are:

- **Coverage:** the share of the 360 bins the stick has reached. Low coverage means part of the rotation was not made.
- **Error vs perfect circle:** the average of |r - mean radius| / mean radius over the visited bins, in percent. The mean radius is the average of the visited bins, so a perfect circle of the same average size scores 0 %. A square gate scores roughly 11 %.
- **Mean, min and max radius.** The dashed amber circle on the plot is the mean radius.

Circularity uses raw values, not the deadzoned ones. Unvisited bins are left out of the error figure, so check the coverage first.

### Triggers

L2 (cyan) and R2 (purple) are plotted as a rolling trace from the standard buttons 6 and 7. Next to the trace, a response curve shows the **low** and **high** remap thresholds. The low and high sliders only change the mapped value; the raw readings are not altered. This is a way to see where the trigger starts and stops responding.

### Report rate

The tool counts changes in the Gamepad \`timestamp\` field and reports the average, minimum and maximum rate, plus the jitter (standard deviation of the gaps). This is an **estimate**. Chromium advances the timestamp when the pad sends new state, so the number depends on how much the pad is moving. Move the sticks while it runs. It is not a USB poll-rate measurement.

### Rumble

**Test rumble** plays a 600 ms \`dual-rumble\` effect through \`vibrationActuator.playEffect\` on the selected pad. Pads or browsers without a vibration actuator report that rumble is not available.

## Raw HID reports (DualSense and DualShock 4)

Press **Connect Sony controller (WebHID)**, then choose your controller in the browser dialog. The tool filters for Sony's vendor ID (0x054C) and opens the device. Then it:

- reads the **last input report** and shows its ID, length and the first 64 bytes as a hex dump;
- for **report 0x01** from a DS4 (product IDs 0x05C4 and 0x09CC) or a DualSense (0x0CE6 and 0x0DF2), decodes the sticks, triggers, d-pad, buttons, the sensor timestamp, and the gyroscope and accelerometer;
- lists the byte offsets it used, in a collapsible section.

Gyro and accelerometer values are shown as **raw signed 16-bit numbers** and as an **approximate** conversion (raw / 1024 deg/s and raw / 8192 g). The conversion is uncalibrated, so treat it as relative. Other report IDs, including the Bluetooth reports 0x11 and 0x31, are shown as raw bytes only.

The offsets come from community driver documentation (the Linux hid-sony and hid-playstation drivers). They have not been checked against every firmware revision, so the decode is labelled best-effort. Use the hex dump to verify a field against what you see on the controller.

## Mouse tab

### Pointer surface and polling rate

Move the mouse over the grey surface. The rate counts pointer events in a trailing one-second window, using \`pointerrawupdate\` where the browser supports it and \`pointermove\` where it does not. The panel shows the current, minimum, average and maximum rate, the jitter of the gaps between events, and a histogram of those gaps in 0.25 ms bins.

Read the rate as **the event rate the browser delivers**, not the hardware polling rate. Browsers can coalesce events, so the number can come out lower than the mouse's real rate. Mice that report at 1000 Hz or more are the ones where this difference matters most.

### Clicks, double-click and chatter

Buttons 0 to 4 (Left, Middle, Right, Back, Forward) light up while held and are counted on each press. For every press after the first press of the same button, the tool measures the interval and classifies it:

- **chatter**: under the chatter threshold (default 50 ms). This is usually a worn or bouncing switch, or an accidental double press.
- **double**: between the chatter threshold and the double-click window (default 500 ms).
- **separate**: longer than the double-click window.

Both thresholds are editable. Back and Forward can trigger browser history navigation on some mice, so use them with care.

### Scroll wheel

Scroll over the surface. Each wheel event is logged with its horizontal and vertical delta in pixels. Line-based and page-based deltas are converted to pixels. Totals for up, down, left and right are kept for the last 5000 events. The page does not scroll while the pointer is over the surface.

### DPI estimator

The DPI estimator measures how many counts the mouse sends for a known physical distance:

1. Enter the distance you will move, in **cm** or **in**, and choose the axis: **X** or **Y** for a straight move along a ruler, or **Path** for a curved move.
2. Turn off **Enhance pointer precision** in Windows mouse settings. Acceleration makes the count per inch depend on speed.
3. Press **Start**. The tool requests pointer lock, using **unadjusted movement** where the browser allows it. Unadjusted movement bypasses the OS pointer speed and acceleration settings, so the counts are closer to the sensor's raw output.
4. Push the mouse exactly the known distance along a ruler, then press **Stop** or **Esc**.

The count is the sum of absolute movement on the chosen axis (or the length of each step for Path). The result is counts divided by inches. The estimate is only as good as the distance you moved. A hand-guided move is less precise than a fixed rig, so repeat the move over a longer distance and compare the results.

If unadjusted movement is not available, the tool says so, and the result may include the effect of OS acceleration.

## Limits and what the tool does not do

- It does not read the mouse's actual USB polling rate or the controller's hardware timestamps. Both are estimates from what the browser exposes.
- It does not calibrate gyroscopes or accelerometers, and it does not check stick hardware beyond drift and circularity.
- It does not decode Bluetooth HID reports for DualSense or DualShock 4. It does not send output reports or set lights.
- Only the standard mapping has known button names. Other pads show generic labels.
- The WebHID decode has not been verified against hardware in this build. Treat it as a starting point.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No gamepad detected" after plugging in | Chromium lists a pad only after a button press | Press any button, then wait a second for the list to refresh |
| Gamepad API unavailable message | Firefox, Safari, or an insecure page | Use Chrome or Edge over HTTPS or localhost |
| Drift looks large but the stick feels fine | Residual motion during the 3 s capture | Repeat with the controller on a flat surface and both hands off |
| Circularity coverage stays low | The stick was not rotated through full deflection | Rotate slowly and reach the edge in every direction |
| Rumble says not available | The pad or browser exposes no vibration actuator | Try a different browser or a pad that reports rumble support |
| WebHID connect does nothing | The browser dialog was cancelled, or the device is not a Sony product | Choose the controller in the dialog; only Sony vendor 0x054C devices are listed |
| DPI result far from the labelled DPI | Pointer acceleration applied, or the distance was not exact | Turn off enhance pointer precision, mark the ruler carefully, and repeat |
| Polling rate reads lower than the spec sheet | Browser coalescing and frame timing | Treat the figure as the browser event rate; compare between mice rather than with the spec |

## Similar tools

Features were compared with gamepad-tester.com (now hardwaretester.com), Gamepadla, TestMyGamePad and similar online testers, and with the controller calibration screens in Steam and Windows. This tool does not write calibration to the pad, and it does not measure true USB polling rate or input latency.

## Related tools in this app

- **HID Inspector** works with HID devices through WebHID and is the place for descriptor-level detail.
- **USB Descriptor Explorer** reads USB descriptors through WebUSB.
`,
};
