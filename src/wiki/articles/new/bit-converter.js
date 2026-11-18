export default {
  id: 'bit-converter',
  toolId: 'bit-converter',
  category: 'analysis',
  title: 'Bits & Numbers Converter — radix, two\'s complement, bit fields, IEEE floats, Q format, data inspector',
  summary: 'An offline calculator for firmware and register work: evaluate C-style integer expressions, convert numbers between hex, decimal, octal and binary at 8/16/32/64 bits, toggle bits, define named bitfields and generate C macros, decode IEEE half/bfloat16/single/double floats, convert Q-format fixed-point, inspect bytes like a hex editor, and run bitwise and rotate operations.',
  tags: ['Bits', 'Binary', 'Hex', 'Two\'s complement', 'Bitfield', 'Register', 'C macro', 'Float', 'IEEE 754', 'bfloat16', 'Fixed-point', 'Q15', 'Bitwise', 'Rotate', 'Data inspector', 'Endianness', 'Unix timestamp'],
  readTime: '8 min read',
  content: `
# Bits & Numbers Converter

The **Bits & Numbers Converter** is a set of small tools for the arithmetic you do while reading datasheets, register maps and firmware dumps. It runs entirely in your browser. Nothing you type is uploaded, and it does not need a device connected.

Every result is computed from your input. There are no sample readings and no connection state, so the page is useful without any hardware attached.

## Width selector

The **Width** control at the top right (8, 16, 32 or 64 bits) applies to the Calc, Number, Bits & fields and Bitwise tabs. Values are two's complement at that width. The Float, Fixed-point and Data view tabs have their own width rules.

## Tabs

### 1. Calc

Type a C-style integer expression, for example \`(0xF0 | 0x0F) & ~(1 << 3)\`. Supported operators, from highest to lowest precedence: unary \`-\` \`+\` \`~\`; \`*\` \`/\` \`%\`; \`+\` \`-\`; \`<<\` \`>>\`; \`&\`; \`^\`; \`|\`. Parentheses group. Literals use the same forms as the Number tab (\`0x\`, \`0b\`, \`0o\`, decimal, underscores).

The maths is exact (arbitrary-size integers) and the result is then wrapped to the chosen width, like C unsigned arithmetic. If wrapping changed the value, the tab shows the exact result as well. Division truncates toward zero. Division by zero, shift counts above 256, unbalanced parentheses and stray characters give an error message. The result is shown as hex, unsigned, signed, binary and octal. Press Enter to save an expression to a short history (the last 8); click a history item to load it again. History is kept only while the tool is open.

### 2. Number

Type one number. Accepted forms:

- \`0x\` hex, \`0b\` binary and \`0o\` octal prefixes, in either case.
- Plain decimal, with an optional leading \`-\` for negatives.
- Single underscores between digits, for example \`0xDEAD_BEEF\` or \`1_000_000\`.

The value must fit the 64-bit range from −2^63 to 2^64 − 1. Anything else is rejected with a message.

The tab then shows:

- **Radix** at the chosen width: hex, unsigned decimal, signed decimal, octal and binary.
- **Interpretations** at 8, 16, 32 and 64 bits, each as unsigned, signed and hex.
- **Byte order**: the big-endian and little-endian byte arrays, the byte-swapped value, the bit-reversed value (bit 0 becomes the top bit), and an ASCII view (non-printable bytes show as dots).
- **Bit counts**: population count (ones), bit length, leading zeros, trailing zeros, and the next power of two. The next power of two is flagged when it does not fit the width.

If the value does not fit the width, the tab warns you and shows the low bits.

### 3. Bits & fields

- **Bit grid**: click any bit to flip it. Bits are grouped by nibble and labelled with their index. The register value updates live in hex, decimal and signed decimal. **Clear** and **Set all** are provided.
- **Register value**: type a hex or decimal value to set the whole register.
- **Bitfields**: paste a C-style register description such as \`EN[0] MODE[3:1] DIV[11:4]\`. Each field can be written as \`NAME[bit]\`, \`NAME[msb:lsb]\` or \`NAME[msb..lsb]\`. Spaces and commas can separate the items.
  - The parser reports invalid tokens, a msb below lsb, a bit outside the width, duplicate names and overlapping fields. Valid fields are still shown.
  - Each field shows its bit range, its mask, its value and its hex value. Edit a field value to insert it into the register. The other bits are left alone.
- **C macros**: for every field the tab writes \`_MASK\`, \`_SHIFT\`, \`_SET(v)\` and \`_GET(r)\`. You can add a name prefix such as \`UART\`. Registers up to 32 bits use \`uint32_t\` and \`U\` suffixes. 64-bit registers use \`uint64_t\` and \`ULL\`. Include \`<stdint.h>\` in your C code.

### 4. Float

Choose one of four formats:

| Format | Sign | Exponent | Mantissa | Bias |
|---|---|---|---|---|
| IEEE 754 half (float16) | 1 | 5 | 10 | 15 |
| bfloat16 | 1 | 8 | 7 | 127 |
| IEEE 754 single (float32) | 1 | 8 | 23 | 127 |
| IEEE 754 double (float64) | 1 | 11 | 52 | 1023 |

There are three inputs: a decimal value, a bit pattern in hex, and a list of bytes with a little-endian or big-endian switch. Edit whichever one you want. That field drives the result.

- The **bit breakdown** is a row of clickable bits coloured by field (sign amber, exponent cyan, mantissa green). Click a bit to flip it; the pattern, value and class update.
- The **Neighbours** buttons load the next lower or next higher representable value (one step in the bit pattern). They are not shown for NaN, and not past infinity.
- A **decimal** is encoded to the nearest representable value, rounding to nearest with ties to even. The tab shows the stored value, whether it is exact, and the error as value minus input and as a relative error.
- A **bit pattern** or **byte list** is decoded exactly. The breakdown shows the sign, the exponent field with its unbiased value, the mantissa field, and the class: zero, subnormal, normal, infinity or NaN (quiet or signaling).
- The **Specials** buttons load the bit patterns of +0, −0, ±1, ±infinity, NaN, the largest finite value, the smallest normal and the smallest subnormal.

Decimal input is read as a JavaScript double first. For half and bfloat16 that is exact for all practical inputs. Halfway cases can in principle round differently from direct decimal-to-float conversion.

### 5. Fixed-point

Enter a format as \`Qm.n\` or \`UQm.n\`:

- **Qm.n** is signed. m counts integer bits including the sign bit, and n counts fraction bits. Q1.15 is the 16-bit Q15 format used in DSP work. Q16.16 is 32 bits.
- **UQm.n** is unsigned with no sign bit.
- **Qn** alone means Q1.n.

The tab shows the total width, the range and the resolution (one LSB). Convert in either direction:

- **Real value to raw**: rounding is nearest (ties to even) or truncate toward zero. Overflow is saturate or wrap. The result shows the raw integer in hex and decimal, and the error.
- **Raw to real value**: type the raw bit pattern in hex or decimal. For signed formats it is read as two's complement.

Worked examples in Q1.15: 0.5 is \`0x4000\`, −0.5 is \`0xC000\`, −1 is \`0x8000\`, and 1.0 saturates to \`0x7FFF\`.

### 6. Data view

Paste hex bytes. Spaces, commas, colons, dashes, underscores and \`0x\` prefixes are ignored. Set an offset in decimal or hex. The tab then shows the bytes at that offset interpreted as:

- int8 and uint8.
- int16, uint16, int32, uint32, int64 and uint64, each in little-endian and big-endian order.
- float16, bfloat16, float32 and float64, each in both byte orders.
- UTF-8 text and UTF-16 text (LE and BE). Text stops at the first NUL byte.
- Unix time: 32-bit and 64-bit values, each in seconds or milliseconds and in both byte orders, shown as UTC dates. Values outside the JavaScript date range show "out of range".

When there are not enough bytes left for a type, the row says how many it needs.

### 7. Bitwise

Choose an operation and two operands. Operands are reduced to the chosen width.

- **AND, OR, XOR** operate on A and B.
- **NOT A** inverts A within the width.
- **SHL** and **SHR** are logical left and right shifts. **SAR** is an arithmetic right shift that keeps the sign.
- **ROL** and **ROR** rotate A left or right by B bits, modulo the width.

For shifts and rotates, B is the count and must not be negative. A shift of the full width or more gives 0 (or all sign bits for SAR). Rotates wrap, so rotating an 8-bit value by 9 is the same as rotating it by 1.

## Limits and what it does not do

- It does not read or write hardware registers. It only converts numbers you type or paste.
- Integers are limited to 64 bits. Larger values are rejected.
- Fixed-point values are shown as JavaScript numbers. Formats with more than about 53 significant bits can lose precision in the displayed real value, though the raw integer stays exact.
- Floating-point input is parsed as a JavaScript number, so a decimal with more digits than a double can hold is first rounded to a double.
- The Calc tab is integer only: no floating-point maths, variables or functions. Use the Electronics Calculators tool for general arithmetic.

## Similar tools

Windows Calculator (programmer mode), float.exposed, BitwiseCmd and rapidtables-style converters cover parts of this. This tool combines the expression calculator, bit grid, bitfield and C macro generator, float bit editor, Q format and data inspector in one offline page.

## Troubleshooting

- **"Not a valid hex number"**: check the prefix. \`0x\` is hex, \`0b\` is binary and \`0o\` is octal. A bare \`0\` followed by digits is decimal, not octal.
- **A value is shown truncated**: it is wider than the selected width. Switch the width to 32 or 64 bits.
- **A field is rejected**: the value must fit the field width. For example a 3-bit MODE field takes 0 to 7.
- **Bitfield errors**: check for overlapping ranges and for bits at or beyond the register width. Parsing uses the current width, so narrowing the width can invalidate fields.
- **The clipboard button does nothing**: the browser blocked clipboard access. Select the text and copy it manually.

## Related tools in this app

- **Electronics Calculators** for resistor, UART baud and pull-up sums.
- **Hash & HMAC Calculator** for digests of the same bytes.
- **ELF Size** for section sizes of firmware images. Copy the bytes you want to inspect here.
`,
};
