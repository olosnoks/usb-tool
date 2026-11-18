export default {
  id: 'electronics-calc',
  toolId: 'electronics-calc',
  category: 'reference',
  title: 'Electronics Calculators — UART baud, I2C pull-ups, resistors, RC/RLC, 555 timer, regulator feedback, battery, PCB traces, ADC',
  summary: 'Offline engineering calculators: UART baud-rate error for AVR, STM32, ESP32 and generic dividers, I2C pull-up sizing per NXP UM10204, resistor divider/LED/colour-code/E-series tools, RC and RLC, reactance, 555 timer and adjustable-regulator resistor design, battery runtime, IPC-2221 trace width, Ohm’s law and ADC LSB maths. Nothing is sent anywhere and no hardware is needed.',
  tags: ['Calculator', 'UART', 'Baud rate', 'I2C', 'Pull-up', 'Resistor', 'Colour code', 'E-series', 'RC', 'RLC', '555 timer', 'Regulator', 'Reactance', 'Battery life', 'IPC-2221', 'Trace width', 'ADC', 'LSB', 'Ohm'],
  readTime: '8 min read',
  content: `
# Electronics Calculators

The **Electronics Calculators** tool is a set of small, offline calculators for the sums you do on the bench or at the desk: is my baud rate accurate enough, what pull-up do I need on this I2C bus, which resistor gives 3.3 V from 5 V, how long will this battery last. It has no connection to any device. Every result is computed in your browser from the numbers you type, so it works without a serial port, a USB permission, or an internet connection.

Values accept SI suffixes anywhere a number is expected: \`4.7k\` = 4700, \`100n\` = 100 nF, \`10u\` = 10 µ, \`2M2\` = 2.2 M, \`1e3\` = 1000. Results are shown with a suitable prefix.

## Tabs

The tool has eight tabs across the top of the window.

### 1. UART baud

Enter the MCU clock and the target baud rate. The tool computes the register value and the actual baud rate for each method, then shows the error as a percentage of the target:

- **AVR USART, normal**: UBRR = fosc / (16 × baud) − 1. Rounded to the nearest integer and checked against the 12-bit range 0 to 4095.
- **AVR USART, U2X**: UBRR = fosc / (8 × baud) − 1, the double-speed mode.
- **STM32 USART**: USARTDIV = fck / (oversample × baud). The BRR value is shown in hex as mantissa and fraction. Choose 16× (OVER8 = 0) or 8× (OVER8 = 1). The fraction is rounded, and a round-up carries into the mantissa.
- **ESP32 UART**: the divider is the APB clock divided by CLKDIV + FRAG/16. The APB clock defaults to 80 MHz and has its own field.
- **Generic integer divider**: divider = round(fclk / (oversample × baud)) for 16×, 8×, 4× or 1× sampling.

Each result is colour-coded. Green means within ±2 %, amber means within ±3.5 %, and red means worse than ±3.5 %. These thresholds are a common rule of thumb for UART timing. The receiving device's own tolerance is what finally matters, so check its datasheet.

Under the calculators is a **standard baud table** (300 to 921600) with every method side by side. Unreachable cells show n/a. **Copy table as CSV** puts the table on the clipboard.

### 2. I2C pull-up

Enter Vdd and the bus capacitance Cb, then pick the mode (100 kHz, 400 kHz or 1 MHz). The tool uses the NXP UM10204 I2C-bus specification:

- **Rp min** = (Vdd − VOL) / IOL. This keeps the current a device sinks when it pulls the line low within its limit. The defaults are VOL = 0.4 V with IOL = 3 mA for standard and fast mode, and 20 mA for Fast-mode Plus.
- **Rp max** = tr / (0.8473 × Cb). This keeps the 30 % to 70 % rise time within the mode's limit (1000 ns, 300 ns and 120 ns respectively).

The tool reports whether a window exists, picks the E24 value closest to the middle of the window, and warns if Cb is above the bus limit (400 pF for 100 kHz and 400 kHz, 550 pF for 1 MHz). VOL and IOL can be overridden if your devices specify other values.

### 3. Resistors

Five sub-tools:

- **Voltage divider**: Vout = Vin × R2 / (R1 + R2). Leave exactly one of Vin, R1, R2 or Vout blank and it is solved. Leave both R1 and R2 blank with Vin and Vout filled in and the tool lists the best E-series pairs (E6 to E48 selectable) with their error. When all four boxes are filled, a **worst-case tolerance** check shows the lowest and highest Vout for a resistor tolerance you enter (default 1 %), taking R1 and R2 at opposite extremes.
- **LED series resistor**: R = (Vs − Vf) / I, rounded up to the next standard value so the current does not exceed the target. It reports the actual current, the power in the resistor, and a suggested power rating with a 2× margin.
- **Colour code**: decode 4, 5 or 6 bands by choosing each band's colour, or encode a resistance into bands. Encoding reports when the value needs rounding for the band count.
- **E-series**: the nearest standard value in E6, E12, E24, E48, E96 or E192, with the next value above and below.
- **Series / parallel**: totals for a list of values you enter, and a search for one or two standard values in series or parallel that land near a target.

### 4. RC / RLC

- **RC low-pass**: τ = RC, cutoff fc = 1 / (2πRC), and 5τ.
- **Charge to a percentage**: time for a capacitor to charge from 0 to a chosen percentage of the source, t = −RC ln(1 − p). 63.2 % is one time constant and 99.3 % is about 4.96 τ.
- **LC resonance**: f0 = 1 / (2π√(LC)), ω0 and characteristic impedance √(L/C).
- **Series RLC**: damping ratio ζ = (R/2)√(C/L), with underdamped, critically damped or overdamped classification, and the damped ringing frequency when underdamped.

**Reactance at a frequency** (in the same tab) uses the R, C and L fields above plus a frequency. It shows Xc = 1/(2πfC), Xl = 2πfL, and the magnitude and phase of R in series with C and of R in series with L (|Z| = √(R² + X²)).

### 5. 555 / Reg

- **555 timer** uses the ideal NE555 equations. Astable: f = 1 / (ln2 × (R1 + 2R2) × C), high time = ln2 × (R1 + R2) × C, low time = ln2 × R2 × C, so the duty cycle is always above 50 %. Monostable: pulse width = ln3 × R × C (about 1.1 RC). The **design** row takes a target frequency, a duty cycle above 50 % and a capacitor value, then gives the ideal R1 and R2, the nearest E24 pair, and the frequency and duty those standard values actually give. CMOS 555 parts (TLC555, LMC555) and real tolerances shift the result a little.
- **Adjustable regulator feedback** solves a two-resistor feedback divider: Vout = Vref × (1 + Rtop/Rbot) + Iadj × Rtop. Rtop goes from the output to the feedback pin, Rbot from the feedback pin to ground. Presets fill Vref and the adjust-pin current for LM317 / LM1117-ADJ (1.25 V, 50 µA), TL431 (2.495 V), and 0.8 V or 0.6 V buck feedback pins; you can edit both. Pick a target Vout and series (E6 to E96) and the tool lists the best Rtop/Rbot pairs with their error. A check row computes Vout for any two resistors you enter. Adjust-pin current varies between parts, so confirm Vref and Iadj in the datasheet.

### 6. Battery

Enter the capacity in mAh, the active and sleep currents in amps (use the m or u suffix for milliamps and microamps), the duty cycle as the percentage of time active, and a derating percentage. The average current is I = d × I_active + (1 − d) × I_sleep. The usable capacity is the capacity less the derating, and the runtime is that usable capacity divided by the average current.

The model is a simple duty-cycle calculation. It does not model self-discharge, temperature curves, Peukert effect or voltage cut-off, so use the derating field to allow for those.

### 7. PCB & Ohm

**Trace width (IPC-2221)** solves for one of three things:

- the minimum **width** for a current and allowed temperature rise,
- the **maximum current** for a given width and rise, or
- the **temperature rise** for a given current and width.

The equation is I = k × ΔT^0.44 × A^0.725, with the area A in square mils. k is 0.048 for outer layers and 0.024 for inner layers. Copper weight is 0.5, 1, 2 or 3 oz, using 1.37 mil per oz. This is the closed form of the IPC-2221 sizing equation. Real boards also depend on plane adjacency, trace length and ambient temperature, so use the result as a starting point and confirm it against your fabricator's guidance.

**Ohm's law and power** takes any two of V, I, R and P and solves the other two using V = IR, P = VI, P = I²R and P = V²/R. Fill exactly two boxes.

### 8. ADC

- **LSB** = Vref / 2^N. The full-scale code is 2^N − 1. The tool reports the LSB, the number of levels and the quantisation error, which is ±LSB/2 for rounding or up to 1 LSB for truncation.
- **Voltage → code** uses floor(V / LSB), the ideal truncating converter, clamped to the valid code range.
- **Code → voltage** returns the bottom of the bin, and the centre of the bin is shown as well.
- **Divider-scaled input** computes the voltage at the ADC pin for an input through a divider (R1 on top, R2 to ground), the code it produces, and the full-scale input that just reaches Vref. A warning appears if the input would clip.

Actual ADCs have offset, gain error and noise, so the ideal values here are a lower bound on the error budget, not a full datasheet model.

## Limits and what it does not do

- **No hardware access.** The tool does not connect to a serial port, USB, or any device. Nothing is read from a board, and no results are stored or uploaded.
- **Ideal maths.** The UART and ADC results are calculated from the register equations. They do not measure the real clock, so a crystal's tolerance or temperature drift is not included unless you enter the actual frequency.
- **E192 is generated.** E48, E96 and E192 are produced from the IEC 60063 geometric rule (rounded to three significant figures). Check any E192 value against a catalogue before ordering.
- **Trace width is the IPC-2221 closed form.** It does not model layer stackup, plane heat sinking or the newer IPC-2152 figures.
- **Battery runtime is a first-order duty-cycle estimate** as described above.

## Similar tools

The feature set was compared with Digi-Key's online calculators (Ohm's law, divider, 555 timer, time constant), the KiCad PCB Calculator (E-series, regulator and colour-code tools), and Saturn PCB Toolkit (trace width, reactance, Ohm's law). This tool has no field solver or impedance calculators for PCB stackups, so use Saturn or KiCad for those.

## Browser requirements

Any modern browser runs the tool, including Firefox and Safari. It does not need Chromium, WebUSB, or Web Serial. The clipboard buttons need a secure page (HTTPS or localhost) because they use the Clipboard API.

## Troubleshooting

- **A field says "Enter a valid value".** The field must start with a number. \`4.7k\`, \`100n\`, \`2M2\` and \`1e3\` are valid; text with no leading number, such as \`k4.7\`, is not.
- **Ohm's law says "Fill exactly two".** Clear any extra box. The solver needs exactly two of V, I, R and P, not one or three.
- **The divider says "Leave exactly one blank".** Solve mode needs three filled boxes. To search E-series pairs, leave R1 and R2 both blank and fill Vin and Vout.
- **A UART cell reads n/a.** The divider falls outside the register's range at that clock and baud rate. Try a different clock or a lower baud.
- **The I2C window is not feasible.** Lower Cb, use a slower mode (which relaxes the rise-time limit), or use a device with a stronger pull-down. A higher Vdd raises Rp min and can close the window.

## Related tools in this app

- **IP calculator** is the same kind of offline calculator, for network subnets.
- **Reference articles** in this wiki cover driver setup and board pinouts, which are where you find the clock and voltage figures used here.
`,
};
