export default {
  id: 'keyboard-tester',
  toolId: 'keyboard-tester',
  category: 'utilities',
  title: 'Keyboard Tester & VIA Configurator — key events, rollover, chatter and VIA keymaps',
  summary: 'Test any keyboard in the browser with no hardware: see which keys register, log events, check rollover and chatter. With a VIA-enabled keyboard over WebHID, read and edit its keymap and run a live switch-matrix test.',
  tags: ['keyboard', 'keyboard tester', 'VIA', 'QMK', 'WebHID', 'keymap', 'rollover', 'NKRO', '6KRO', 'chatter', 'key matrix', 'keycode'],
  readTime: '6 min read',
  content: `
# Keyboard Tester & VIA Configurator

The **Keyboard Tester** is two tools in one window.

1. **Key tester.** Runs entirely in the browser. It shows which keys your browser receives. It needs no device and no permission prompt.
2. **VIA panel.** Talks to a VIA-enabled keyboard over **WebHID**. It reads and writes the keymap, decodes QMK keycodes and polls the switch matrix.

Nothing is simulated. The key tester only reports events you press. The VIA panel only shows bytes the keyboard sends back.

## Key tester

Click the grey test area to focus it, then press keys. The area captures every key, including Tab, so click outside it to stop. Browser and OS shortcuts (for example Ctrl+W or Alt+F4) may never reach the page at all.

- **Board.** An ANSI 104-key layout by default. Tick **TKL (no numpad)** for 87 keys. Tick **ISO layout** to add the ISO keys (IntlBackslash and the ISO hash key). The ISO shape is simplified: the key codes are correct, but the Enter key is not drawn tall.
- **Colours.** Cyan means held now. Green means pressed at least once. Rose means a chatter flag. The small number on a key is its press count, and hovering a key shows the count too.
- **Held now.** The keys currently down, in the order they were pressed.
- **Event log.** The newest 150 of up to 300 events: type (down or up), \`code\` (the physical key, for example \`KeyA\` or \`NumpadEnter\`), \`key\` (the character or name the layout produced), location (standard, left, right or numpad), repeat (auto-repeat while held), and a timestamp in milliseconds from the page clock.
- **Press counts.** Each real press is counted once. Auto-repeat is logged but never counted.

### Rollover

The rollover figure is the most keys the browser reported as held at the same time. Hold 6 or more keys together to test it.

- Fewer than 6 keys: the test is not conclusive yet.
- Exactly 6: at least 6-key rollover (6KRO).
- 7 or more: more than 6KRO, which is consistent with NKRO (N-key rollover).

This test sees what the browser receives. A 6KRO board that ghosts (drops a key in a bad combination) looks the same as a dropped key here. Use the VIA matrix test below to look at the switch matrix directly.

### Chatter

Chatter is flagged when a key goes down again within the **chatter window** (default 20 ms, adjustable from 1 to 200 ms) of its own release. Flagged events show the gap in the log.

This is measured from browser key events, not from the electrical signal, so it is an approximation. A genuinely fast double tap can be flagged if the window is set too wide. Keep the window small (5 to 15 ms) when hunting for real bounce.

Press **RESET** to clear everything: pressed state, counts, chatter, rollover and the log.

## VIA panel

### Requirements

- Chrome or Edge (Chromium) over HTTPS or localhost. WebHID is not available in Firefox or Safari.
- A keyboard running **VIA-enabled QMK firmware** with the VIA raw HID interface (usage page \`0xFF60\`, usage \`0x61\`). Keyboards without VIA are not listed in the device picker.
- Click **OPEN VIA KEYBOARD** and choose the keyboard. The browser only lists devices from a click.

### What it reads on connect

- **VIA protocol version**, as a number (VIA protocol 13 is \`0x000D\`).
- **Layer count** (\`dynamic_keymap_get_layer_count\`).
- **Uptime** (\`get_keyboard_value\` with \`uptime\`), from the QMK timer in milliseconds. Use refresh to read it again.
- **Layout options** (\`get_keyboard_value\` with \`layout_options\`), as a raw 32-bit value.

### Keymap

Enter **rows** and **columns** (columns up to 32), or paste a VIA keyboard definition JSON and click **use matrix from definition**. Only \`matrix.rows\` and \`matrix.cols\` are read. The grid is drawn by matrix position, not by physical key shape.

**READ KEYMAP** reads every layer in 28-byte chunks (\`dynamic_keymap_get_buffer\`) and shows a byte progress count. Each cell shows the decoded label and the 16-bit hex code.

Decoded keycodes:

- Basic keys: \`KC_A\`..\`KC_Z\`, \`KC_1\`..\`KC_0\`, \`KC_F1\`..\`KC_F24\`, editing and navigation keys, keypad keys, and modifiers \`KC_LCTL\`..\`KC_RGUI\`.
- Modifier combinations on a basic key, such as \`LCTL(KC_A)\` or \`LCTL|LSFT(KC_A)\` (range \`0x0100\`-\`0x1FFF\`).
- Mod-tap, \`MT(LSFT, KC_A)\` (range \`0x2000\`-\`0x3FFF\`).
- Layer-tap, \`LT(2, KC_ENT)\` (range \`0x4000\`-\`0x4FFF\`).
- Layer keys: \`MO(n)\`, \`DF(n)\`, \`TG(n)\`, \`OSL(n)\` and \`TT(n)\`.

Any other code (for example swap-hands, tap-dance or unicode keycodes) is shown as its hex value only, with no guessed name.

Select a cell to see its full label, its kind and its hex value. **Read this key from keyboard** reads that single key again.

### Writing a key

Type a new keycode as a name (\`KC_A\`), hex (\`0x0004\`), or a layer key (\`MO(1)\`). The field shows what it means before you write.

**Write to keyboard** asks you to confirm first, because the keyboard saves the change. After the write, the tool reads the key back from the keyboard and reports the value it got. A mismatch is shown as a warning. The set command's own reply only echoes what was sent, so it is not treated as proof.

### Live matrix test

**start polling** reads the switch matrix state about every 150 ms and lights each switch position that is pressed now. Dark green cells were pressed at least once since the last **clear seen**.

The matrix is read per row, in chunks sized by the column count. If the keyboard has locked its matrix readout (the secure lock in some firmware builds), it reports nothing pressed. A silent matrix on a locked board is not a dead switch.

## Limits

- The key tester cannot see the physical matrix, only the browser's key events.
- The keymap is grid-based. Physical key shapes from a VIA layout are not drawn.
- Only the basic, modifier, mod-tap, layer-tap and layer keycodes above are decoded. Anything else shows hex.
- The keymap storage order used for reads and writes (layer, then row, then column, 16-bit big-endian) follows the VIA convention. Check one known key after the first read.
- Writes change the keyboard's saved keymap. Undo means writing the old value back. There is no bulk write or save-to-file yet.
- Tested without hardware: the packet and parsing logic is unit-tested against a simulated keyboard that follows the firmware's byte layout. Real keyboards have not been exercised from this build.

## Troubleshooting

- **No VIA device in the picker.** The keyboard is not running VIA firmware, or another app has the raw HID interface open. Close other VIA or Vial tabs, then try again.
- **"No VIA reply (timeout)".** The keyboard is not answering on the VIA interface. Reconnect the cable and reopen the device.
- **"unhandled".** The firmware does not support that command, or VIA is disabled in the build.
- **Keys missing in the key tester.** The page did not have focus, or the OS or a shortcut took the key first.

## Related tools

- **HID Inspector**: decodes any HID device's raw reports and descriptors.
- **USB Descriptor Explorer**: shows the descriptors of the same keyboard.
- **Logic Analyzer**: for checking matrix scan signals on a bench.
`,
};
