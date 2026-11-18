export default {
  id: 'i2c-address-ref',
  toolId: 'i2c-address-ref',
  category: 'reference',
  title: 'I2C Address Reference & Scan Identifier — offline address map, part lookup and scan decoder',
  summary: 'An offline lookup for I2C addresses: a 0x00 to 0x7F map, about 190 common parts with their addresses and ID registers, a decoder for pasted scan output (i2cdetect, Arduino scanner or a hex list), a 7-bit / 8-bit converter and a conflict checker with an address planner. It never touches a bus.',
  tags: ['I2C', 'I2C address', 'i2cdetect', 'scan', 'address map', '7-bit', '8-bit', 'conflict', 'datasheet', 'reference'],
  readTime: '7 min read',
  content: `
# I2C Address Reference & Scan Identifier

The **I2C Address Reference** answers two questions: "what is at this address?" and "which part is that scan result?". It is a reference tool. It runs entirely in the browser and never opens a serial, USB or I2C connection, so it works without any hardware attached.

Use it when you have a scan result and want to know which parts could be on the bus, when you are designing a board and want to avoid two parts on the same address, or when you need to convert between the 7-bit address used in code and the 8-bit read/write byte shown in datasheets.

## Where the data comes from

The address list is based on the **Adafruit I2C Addresses** list (https://learn.adafruit.com/i2c-addresses/the-list, data kept at https://github.com/adafruit/I2C_Addresses). Parts that Adafruit does not list come from their vendor datasheets. Each entry is marked with its source in the tool.

The **ID register values** (for example BME280 register 0xD0 = 0x60) come from vendor datasheets and are **not checked against hardware by this app**. Treat them as "the value to expect", and confirm on a real part before you rely on one. Some parts have no simple ID register, and for those the tool says so instead of guessing.

## The four tabs

### 1. Address map and parts

- A grid of all 128 addresses, 0x00 to 0x7F. Cyan cells have at least one known part; grey cells have none; amber cells are reserved by the I2C specification.
- Reserved addresses are labelled with their meaning: 0x00 general call, 0x01 CBUS compatibility, 0x02 and 0x03 reserved, 0x04 to 0x07 high-speed mode codes, 0x78 to 0x7B the 10-bit addressing prefix, and 0x7C to 0x7F reserved for future use.
- Click an address to see every part that uses it, with its manufacturer, function, alternate addresses and ID check.
- The search box filters the parts table by name, manufacturer, category, function, or address text such as "0x3c" or "3c".

Some addresses are shared by many parts (for example 0x68 is used by most real-time clocks and several IMUs). For these, the ID check is the only way to tell them apart.

### 2. Paste scan result

Paste the output of a scan and press **Analyze**. The format is detected automatically:

- **i2cdetect grid** from Linux i2c-tools (the 16-column table with rows 00:, 10:, and so on). Blank cells are "not probed", "--" is no response and "UU" means a kernel driver already owns the address.
- **Arduino I2C scanner** output: lines reading "I2C device found at address 0x3C". Scanner errors ("Unknown error at address ...") are listed separately.
- **Plain hex list** such as "0x3C, 0x68, 0x77". Tokens that are not 7-bit addresses are listed as ignored rather than dropped silently.

For each address found, the tool lists the candidate parts, flags reserved addresses, and gives the **ID register to read** and the value to expect where one exists. To check a part on a real bus, use the **I2C & SPI Bus Explorer** tool in this app to read that register, then compare the value with the expected one.

**Copy table** puts the address, candidate names and suggestion on the clipboard as tab-separated text.

Below the results, a collapsible **Free addresses on this bus** list shows every usable 7-bit address (0x08 to 0x77, reserved ones excluded) that did not answer in the pasted scan. It is only a guide: a device that is unpowered or unplugged will not appear in a scan.

### 3. 7-bit / 8-bit converter

- Enter a 7-bit address (for example 0x3C) to see its write byte (0x78) and read byte (0x79). The 7-bit value is the address used in code and by i2cdetect; the write byte is that value shifted left one bit with the read/write bit cleared.
- Enter an 8-bit byte from a datasheet (for example 0x78) to get the 7-bit address (0x3C) and whether it is a read or write.

Many datasheets list the 8-bit write address. Mixing the two up is a common reason an address appears "wrong" by one bit position.

### 4. Conflict checker

Pick the parts you plan to put on one bus. The tool reports each address that two or more chosen parts claim, marks which parts have alternate addresses (set by pins or solder jumpers), and lists the alternates that no other chosen part uses. Parts with a fixed address are marked as not movable.

When two or more parts are selected, a **Suggested addressing** card appears. It runs an exact search for a way to give every part its own address on one bus using each part's alternate addresses, and lists the address to set for each part. If no such assignment exists (for example two parts with the same fixed address), it splits the parts over several buses with a greedy first-fit, such as the channels of an I2C multiplexer, and names the multiplexers in the database with enough channels (TCA9548A and PCA9548A have 8, TCA9546A has 4). The bus count is small but not guaranteed minimal. **Copy** puts the plan on the clipboard as text.

## What it does not do

- It does not read, write or detect devices. Nothing in this tool sends bytes to a bus.
- It does not know about every part. Unlisted parts show as "not in this database" and need their datasheet.
- Alternate addresses and ID values can differ between revisions and variants. The database follows the Adafruit list and datasheets, and a few entries are marked to be verified against the datasheet (for example the Adafruit list prints 0x66 for the IS31FL3731, which is probably a typo for 0x76).
- The conflict checker only sees the addresses in this database. Custom firmware, multiplexed buses (TCA9548A channels can hold identical addresses) and cloned parts can break the assumption.

## Browser requirements

Any modern browser. No Web Serial, WebUSB or other hardware API is needed. The tool is useful on a phone or in Firefox as well.

## Troubleshooting

- **A scan address shows no candidates.** The part is not in the database, or the scan picked up something unexpected. Read the datasheet or probe its ID register with the I2C & SPI Bus Explorer.
- **Several parts share an address and no ID check is listed.** Use the board silkscreen, the part marking or the datasheet to identify the chip.
- **"Ignored tokens" appears after pasting.** The text contained something that is not a 1 or 2 digit hex address (for example the decimal 104 is not a valid token, and 0x80 and above are outside the 7-bit range). Write addresses in hex, with or without the 0x prefix.
- **An amber (reserved) address answers on the bus.** This is unusual. Check the wiring, pull-ups and whether a device is mis-addressing; reserved addresses are not used by normal parts.

## Similar tools

The feature set was compared with the Adafruit I2C Addresses list, i2cdevices.org, vendor address tables such as Seeed's, and the TCA9548A multiplexer guides from Adafruit, SparkFun and TI. Those are static tables; the scan decoder, ID-register hints, address planner and multiplexer split are what this tool adds on top.

## Related tools

- **I2C & SPI Bus Explorer** scans a real bus through a Bus Pirate and reads registers, so it is the place to confirm an ID register.
`,
};
