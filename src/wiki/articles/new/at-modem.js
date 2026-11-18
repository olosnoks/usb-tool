export default {
  id: 'at-modem',
  toolId: 'at-modem',
  category: 'utilities',
  title: 'AT Modem Console — cellular modules over AT commands',
  summary: 'Talk to SIMCom, Quectel and u-blox cellular modules over their AT port: identify the module and SIM, read signal and serving cell, check registration and APN, send and read SMS, get a GNSS fix, and use a raw console with an unsolicited-message log. Runs in Chromium over Web Serial.',
  tags: ['SMS PDU decoder', 'AT commands', 'Cellular modem', 'SIM7600', 'SIM800', 'Quectel EC25', 'BG96', 'u-blox SARA', 'CSQ', 'RSRP', 'SMS text mode', 'APN', 'GNSS'],
  readTime: '7 min read',
  content: `
# AT Modem Console

The **AT Modem Console** drives a cellular module through its AT command port. It is built for SIMCom (SIM7600, SIM800), Quectel (EC25, BG96) and u-blox (SARA) modules. It uses the shared serial port from the header, so connect the module's AT port there first.

Every value on screen is the modem's own reply to a command this tool sent. Nothing is estimated or simulated. If a command fails, the reason is shown: a CME or CMS error code, a plain ERROR, or "No response (timeout)".

## Requirements

- A Chromium-based browser (Chrome, Edge or Opera) on desktop or Android. Web Serial is not available in Firefox or Safari.
- The module's AT port. SIMCom and Quectel modules expose several USB serial ports; the AT port is usually one of them, and the vendor's documentation names it. Choose the right one when the browser asks for a port.
- The baud rate set in the header. SIMCom and Quectel modules default to 115200.
- The module must appear as a serial (COM) port. These modules normally use a USB serial driver rather than WinUSB, so the port is opened as a serial port; if the browser does not list it, install the vendor's USB serial driver first.
- A stable power supply. Modules draw bursts of current during registration and SMS, and a weak USB port can reset them mid-command.

## Engine behaviour

Commands go out one at a time. The engine waits for a final line (OK, ERROR, NO CARRIER, +CME ERROR, +CMS ERROR) and gives up after a timeout (5 seconds by default; 15 to 60 seconds for SMS reads, listings and sends). The echoed command is removed from the reply. Lines that look unsolicited (RING, +CMTI, +CREG changes and similar) go to the URC log instead of a reply.

## Tabs

**Identify.** ATI, AT+CGMI, AT+CGMM, AT+CGMR, AT+CGSN (IMEI), AT+CIMI (IMSI), AT+CCID or AT+QCCID (ICCID) and AT+CPIN?. The reply text is used to guess the family, and the Vendor selector follows the guess. **Init modem** sends ATE0 (echo off), ATV1 and AT+CMEE=1 so errors come back as numbers that the tool can decode.

**Signal.** AT+CSQ gives RSSI and converts it to dBm (index 0 is -113 dBm or lower, 31 is -51 dBm or higher). AT+CESQ gives LTE RSRP and RSRQ where the firmware supports it. The serving cell comes from AT+QENG="servingcell" on Quectel or AT+CPSI? on SIMCom. Polling every 2, 5, 10 or 30 seconds is off by default, and the chart shows the readings from this session. CSV downloads those readings (time, RSSI dBm, RSRP dBm; empty where the module gave no value).

**Network.** AT+CREG?, AT+CGREG? and AT+CEREG? decoded into the registration state, plus AT+COPS? for the current operator and access technology. Registration URCs update the panel as they arrive. This tab shows the current operator only; it does not scan for networks.

**APN / PDP.** AT+CGDCONT? lists the stored contexts. Set APN writes AT+CGDCONT=cid,"type","apn" after checking the context id (1 to 16), the PDP type and the APN text. Setting an APN does not attach to the network or bring data up. Use the Quick commands for AT+CGATT and AT+CGACT.

**SMS.** Text mode only (AT+CMGF=1). Load lists the storage with AT+CMGL="ALL". Open reads one message with AT+CMGR. Send uses AT+CMGS: the tool waits for the "> " prompt, sends the body and Ctrl-Z, and reports the message reference. Delete asks first. Text mode sends plain ASCII; accented characters, emoji and symbols are refused before anything is sent. The character counter shows how many 160-character parts the text needs; whether the module splits and sends a long message is up to its firmware, and a rejection is reported as the module's CMS error.

**GNSS.** The module's own receiver. SIMCom: AT+CGPS=1 to start, AT+CGPSINFO to read, AT+CGPS=0 to stop. Quectel: AT+QGPS=1, AT+QGPSLOC=2, AT+QGPSEND. Coordinates are shown as signed decimal degrees, so south and west are negative. Start the receiver, wait for a fix outdoors, then read it.

**PDU decode.** An offline decoder for SMS PDUs (hex), for modules or logs that use PDU mode (AT+CMGF=0). Paste the hex from AT+CMGR or AT+CMGL, or press Use last reply to take the latest hex line from the console log. It decodes SMS-DELIVER and SMS-SUBMIT: sender or recipient, SMSC, service centre time, alphabet (GSM 7-bit with the extension table, UCS-2 or 8-bit), multipart (concatenation) info and the text. Untick the SMSC box for a bare TPDU. Nothing is sent to the modem. Other message types (status reports, commands) are refused with a message, and the decoder does not reassemble multipart messages.

**Quick commands.** About twenty common read-only commands grouped by topic, plus your own list (one command per line, lines starting with # are comments). The list is kept in this browser's local storage and runs in order, stopping at the first failure.

**Console.** Every command and reply, with unsolicited lines marked URC. Enter sends, arrow keys recall earlier commands. Copy, Save (downloads the log as a .txt file) and Clear work on the log. The input offers autocomplete from a built-in list of about 40 common commands, and an AT command reference (collapsed by default) filters that list; clicking a row only fills the input and sends nothing.

## Commands that ask first

The tool asks for confirmation before sending commands that drop the radio or reset the module (AT+CFUN, AT+CFUN=1,1, AT+QPOWD, AT+QRST, AT&F), that send a SIM PIN or PUK (AT+CPIN=; a wrong code can lock the SIM), that change a lock or password (AT+CLCK, AT+CPWD), or that delete SMS (AT+CMGD). This applies to the console, the quick commands and your list.

## Limits and what is not included

- **Incoming SMS.** The tool does not set AT+CNMI, so the module reports new messages only if you configure it. Send AT+CNMI=2,1,0,0,0 from the console to have each new message stored and announced with +CMTI; the SMS tab then offers to read it. Direct delivery of the message body (+CMT) is not parsed.
- **No data sessions.** PPP or QMI data bring-up, AT+CGACT activation and AT+CGATT attach are not automated. Use the console for them.
- **No calls, USSD, phonebook or firmware update.**
- **Vendor coverage.** SIMCom and Quectel get the vendor-specific cell and GNSS commands. u-blox modules get the identify and common commands; their vendor-specific GNSS and cell commands are not wired in.
- **CPSI tail order.** For SIMCom LTE the tool reads the fields after the cell ID in the documented order (PCI, band, EARFCN, bandwidths, RSRP, RSRQ, RSSI). Firmware differs; if the numbers look wrong, compare with the raw reply shown in the console.
- **Signal words.** "Excellent" and "poor" are rough guides from the dBm value, not operator thresholds.
- **Hardware testing.** The parsers are covered by unit tests with reply strings taken from the vendors' documented formats. The UI has not been checked against a live module in this build, so confirm each tab on your module before relying on it.

## Troubleshooting

- **"Not connected" or no replies.** Check the port is the AT port, the baud rate matches, and the port is not open in another tool. Use the Console to send AT and expect OK.
- **Every command times out.** Echo may be on and the module may be waiting for input; press Init modem. Some modules need a moment after power-up before they answer.
- **+CME ERROR 10 or 11.** The SIM is missing or needs a PIN. Check Identify (SIM state). Entering a PIN is done from the console with AT+CPIN=, which asks first.
- **+CME ERROR 30 or CSQ 99.** No network service or no signal. Check the antenna and the SIM's data plan.
- **SMS send fails right after the prompt.** The text probably contains a character outside plain ASCII, or the destination format is wrong (use the international form such as +15551234567).
- **GNSS "No fix yet".** Keep the antenna in open sky. Cold starts can take several minutes.

## Similar tools

Quectel QNavigator and QCOM, Gammu and the Wammu PDU decoder, and picocom or minicom on a plain serial port. They offer vendor-specific panels, repeated command batches, and PDU decoding. This tool covers the common SIMCom and Quectel tasks in the browser, but it is not a replacement for the vendor tools for firmware update, data sessions or batch stress tests.

## Related tools

- **The header** (port, baud rate, connect and disconnect) and the **Terminal** for raw serial traffic outside the AT command set.
- **Modbus** for another serial protocol on the same kind of port.
`,
};
