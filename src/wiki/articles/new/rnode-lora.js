export default {
  id: 'rnode-lora',
  toolId: 'rnode-lora',
  category: 'rf',
  title: 'RNode & LoRa — RNode KISS control, radio settings and an offline LoRa calculator',
  summary: 'Talks the RNode KISS command protocol over the shared serial port at 115200 baud: detect the device, read firmware/platform/EEPROM, set frequency, bandwidth, SF, CR and TX power, switch the radio, and watch RSSI/SNR. A second tab is an offline LoRa calculator for time-on-air, sensitivity, link budget and duty cycle.',
  tags: ['RNode', 'Reticulum', 'LoRa', 'KISS', 'SX1276', 'time on air', 'Semtech AN1200.13', 'duty cycle', 'EU868', 'RSSI', 'SNR', 'link budget'],
  readTime: '7 min read',
  content: `
# RNode & LoRa

The **RNode & LoRa** tool has two tabs:

1. **RNode (Reticulum)**: a live control panel for an RNode LoRa modem over the app's shared serial port.
2. **LoRa calculator**: an offline calculator for LoRa time-on-air, bit rate, sensitivity, link budget and duty-cycle limits. It does not need hardware.

## What you need

- A Chromium-based browser (Chrome, Edge, Opera) with Web Serial. Firefox and Safari do not have it.
- An RNode running RNode firmware, or a board flashed with it (for example a LilyGO T-Beam, Heltec, RAK4631 or similar).
- The board connected through the app's serial connection (use the **Connect serial port** button in this tool). RNode firmware runs at **115200 baud**. If the shared port is at another rate, the tool offers a **Set 115200 baud** button.
- A Reticulum install is not required. The tool speaks the same wire protocol that Reticulum's \`RNodeInterface\` uses, but it does not run a Reticulum stack.

## RNode tab

### Detect and device info

- **Detect RNode** sends the RNode detect request. A device that answers with the detect response is shown as **RNode**. No answer usually means the board is not an RNode, or the baud rate is wrong.
- **Read device info** asks for the firmware version, platform (AVR, ESP32 or nRF52), MCU and board code. The board code is shown as a raw number.

### EEPROM (read only)

- **Read EEPROM** asks the device for its EEPROM image and decodes the provisioned fields: product, model, hardware revision, serial (raw bytes), made field (raw bytes), and whether the stored checksum matches. The checksum is the MD5 of the product, model, hardware revision, serial and made bytes, the same check the Reticulum tooling does.
- The stored radio configuration (frequency, bandwidth, SF, CR and TX power) is shown too, when the config block is valid.
- The 128-byte signature block is reported as present or blank. **It is not verified here.** Verification needs the trusted public keys that the Reticulum tooling ships with.

### Radio parameters

Set frequency (MHz), bandwidth, spreading factor, coding rate and TX power, then press **Apply to device**. The tool checks each value first:

| Setting | Allowed |
|---|---|
| Frequency | 137 to 1020 MHz |
| Bandwidth | 7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250 or 500 kHz |
| Spreading factor | SF5 to SF12 |
| Coding rate | 4/5 to 4/8 |
| TX power | 0 to 22 dBm |

### Regulatory region check

A **Regulatory region** selector sits next to the TX power field. The default is EU 863-870 MHz. Other choices are EU 433 MHz, US 902-928 MHz, AU 915-928 MHz, and "Other / licensed (no check)". For a chosen region the tool finds the sub-band that contains your frequency and compares your TX power setting with its limit:

| Region | Limits used |
|---|---|
| EU 863-870 | 863-865 and 865-868 and 868-868.6 MHz: 14 dBm (25 mW ERP), 1% duty (0.1% for 863-865). 868.7-869.2: 14 dBm, 0.1%. 869.4-869.65: 27 dBm (500 mW ERP), 10%. 869.7-870: 14 dBm, 1%. |
| EU 433 | 433.05-434.79 MHz: 10 dBm (10 mW ERP), 10% |
| US 902-928 | 30 dBm conducted (antenna up to 6 dBi), no duty cycle |
| AU 915-928 | 30 dBm, no duty cycle |

If the frequency is outside every sub-band, or the power is above the limit, a warning is shown and **Apply to device is blocked**. Choose "Other / licensed" only if you hold the right licence (for example amateur radio). The check is a simplification: it compares the module setting only and ignores antenna gain, cable loss and local rules. You are responsible for operating legally.

### Export for rnodeconf / Reticulum

Under the radio parameters, an **Export** section builds text from the current form values: an \`rnodeconf <port> --freq ... --bw ... --txp ... --sf ... --cr ...\` command and a Reticulum \`[[RNode LoRa Interface]]\` config block. You can edit the port name used in the text. This tool does **not** run these; copy them and use them with the command-line tools yourself.

Invalid values are rejected before anything is sent. The tool sends frequency, bandwidth, TX power, SF and CR in that order, the same order Reticulum uses. It does not change the radio state.

The panel shows two things separately: **Last applied by this tool** (what this tool sent) and **Echoed by device** (values the device sent back, if it does). Do not treat the first as proof that the radio is running those values.

### Radio on and off

- **Radio on** and **Radio off** send the radio-state command. The state reply, when the device sends one, updates the Radio indicator.
- Reticulum normally sets the parameters first and turns the radio on last. Do the same here.

### Live statistics

- **RSSI** (dBm) and **SNR** (dB) arrive from the device with each received packet. The tool shows the last value, plus the min, average and max over the last 60 samples, and a small trend line for each. RSSI uses the RNode offset of 157.
- **Data frames** counts the packets the device received. The packet contents are not decoded.
- **Poll channel stats** asks the device for its channel report (airtime, channel load, noise floor, interference). The reply format comes from the RNode and Reticulum sources. Counter and channel-stats replies are **not yet verified on hardware**.

### Protocol log

Every transmitted frame and every decoded reply is listed as hex with a timestamp. Use it to check what was sent if the device does not respond.

## What this tool does not do

- It does **not** provision EEPROM, write the product or serial, or sign anything.
- It does **not** flash firmware. Use the app's **Firmware Flasher** for that.
- It does **not** decode Reticulum packets. Data frames are counted and their length is shown.
- It does **not** read back the live frequency, bandwidth or SF from the radio. Only what the device chooses to echo is shown.

## LoRa calculator tab

The calculator works offline. Set the modulation, payload and header options on the left, and the link budget and duty cycle options below them.

### Time on air

Time on air follows the Semtech AN1200.13 formula:

- Symbol time = 2^SF / bandwidth
- Preamble time = (preamble symbols + 4.25) × symbol time
- Payload symbols = 8 + max(ceil((8·PL − 4·SF + 28 + 16·CRC − 20·IH) / (4·(SF − 2·DE))) × (CR + 4), 0)

where PL is the payload in bytes, CRC is 1 when the payload CRC is on, IH is 1 for an implicit header, and DE is the low-data-rate optimisation (LDRO) flag.

**Check value:** SF7, 125 kHz, CR 4/5, 20-byte payload, 8-symbol preamble, explicit header, CRC on gives **56.6 ms**.

LDRO can be set to auto, on or off. Auto turns it on when the symbol time is above 16 ms (for example SF11 or SF12 at 125 kHz).

### Other outputs

- **Bit rate**: SF × 4/(4+CR) × bandwidth / 2^SF.
- **Sensitivity (estimate)**: −174 + 10·log10(bandwidth) + noise figure + SNR limit for the SF. The SNR limits are −7.5 dB at SF7 down to −20 dB at SF12. This is an estimate, not a datasheet value.
- **Link budget**: maximum path loss = TX power + antenna gains − cable loss − sensitivity − fade margin. The range is the free-space distance for that loss. **Free-space range is an upper bound.** Terrain, buildings and foliage reduce it, often by a lot.
- **Duty cycle**: the allowance per rolling hour, the maximum number of messages per hour at the chosen duty cycle, and the minimum off time after each message. EU868 is 1% (36 seconds per hour). The 869.4 to 869.65 MHz sub-band allows 10%, and some sub-bands allow 0.1%.
- **Longest payload at the duty limit**: given a message interval in seconds (default 60) and the chosen duty cycle, the largest payload (0 to 255 bytes) whose time on air fits the allowed airtime for that interval. It shows "none fits" when even an empty packet is too long, and is not shown for "no limit".
- **Time on air by SF** shows SF7 to SF12 side by side, which is useful when choosing a spreading factor for a given message size.

## Troubleshooting

- **"Detect" gets no reply.** Check the baud rate (it must be 115200), that the board is running RNode firmware, and that no other tool holds the port.
- **Detect reply is not RNode.** The board answered, but not with the detect response. It is probably another firmware or a different device.
- **EEPROM says "ROM read returned N bytes".** The device did not send a full EEPROM image. Try again, then check the log.
- **The checksum shows MISMATCH.** The stored product, model, hardware revision, serial or made bytes do not match the stored checksum. Do not ignore this on a device you intend to use on a real network.
- **Apply to device does nothing.** Check the error text under the form. Out-of-range values are blocked, and the port must be connected.

## Similar tools

This tool was compared with \`rnodeconf\` (the Reticulum command-line configuration tool), browser RNode flashers such as liamcottle's rnode-flasher, and web LoRa airtime calculators such as The Things Network's. Unlike rnodeconf it does not flash or provision; unlike the calculators it can also talk to a device.

## Related tools

- **Firmware Flasher**: flashing RNode firmware and any other firmware update.
`,
};
