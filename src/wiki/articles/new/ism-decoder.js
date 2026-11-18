export default {
  id: 'ism-decoder',
  toolId: 'ism-decoder',
  category: 'rf',
  title: 'ISM Signal Decoder — 433 / 868 / 915 MHz IQ recordings, pulse analyzer and sensor decoders',
  summary: 'Offline decoder for 433, 868 and 915 MHz ISM captures in .cu8, .cs8, .cs16, .complex16u and .cf32 IQ files. It finds pulses, guesses the modulation the way rtl_433 -A does, and decodes several weather-sensor and remote frames with checksum checks. Nothing needs a radio attached.',
  tags: ['433 MHz', 'ISM band', 'rtl_433', 'OOK', 'IQ recording', 'pulse analyzer', 'weather sensor', 'EV1527', 'Manchester', 'PWM'],
  readTime: '8 min read',
  content: `
# ISM Signal Decoder

The **ISM Signal Decoder** reads a recorded IQ capture from a software-defined radio and looks for the short, unlicensed transmissions sent by weather stations, doorbells, remote controls and tyre sensors in the 433, 868 and 915 MHz ISM bands. It works **offline**: you record the spectrum with another tool (for example rtl_sdr, or the HackRF Receiver IQ recorder), then load the file here. No radio has to be connected to this app.

Everything runs in your browser. The file is read locally and is not uploaded.

## Supported files

| Extension | Sample format | Typical source |
|---|---|---|
| \`.cu8\` | unsigned 8-bit I/Q, centred on 127.5 | RTL-SDR raw unsigned 8-bit output (rtl_sdr, and the name rtl_433 uses) |
| \`.cs8\` | signed 8-bit I/Q | HackRF (hackrf_transfer -r, or the HackRF Receiver IQ recorder) |
| \`.cs16\` | signed 16-bit little-endian I/Q | many SDR tools |
| \`.complex16u\` | unsigned 16-bit little-endian I/Q, centred on 32768 | some GNU Radio and SoapySDR dumps |
| \`.cf32\` | 32-bit float little-endian I/Q | GNU Radio, SDR++ |

Files are limited to 64 MiB. Trim a longer capture or record at a lower sample rate. The analysis runs on the tab that loaded it, so a large file can take a few seconds to freeze the page.

## Loading a recording

1. Click **Load IQ recording** and choose the file.
2. If the name follows the rtl_433 convention, the frequency and sample rate are filled in for you. For example \`g001_433.92M_250k.cu8\` gives 433.92 MHz at 250 kS/s. The format is taken from the extension.
3. Check **Sample rate**. The presets are **250.0 kS/s** and **2.048 MS/s**; you can type any other rate. A wrong rate shifts every pulse width, so the decoders will reject frames.
4. Pick the **Format** if the extension is not what the file really contains.

## Choosing a demodulation

- **AM / OOK envelope** (default): the signal magnitude sqrt(I^2 + Q^2). Most ISM sensors and remotes are on-off keyed.
- **FSK (FM discriminator)**: the phase change between samples. Use it for frequency-shift keyed signals. The app shows the discriminator and the resulting runs; it does not decode FSK frames.

The **Threshold position** slider sets where between the noise floor and the peak the level switch happens (default 0.5). The noise floor and the peak are measured in chunks of about 50 ms, so the threshold follows fading and drift. The amber line on the waveform is that threshold.

**Min pulse** drops glitches shorter than the given number of microseconds (default 30 us).

## The waveform

After **Analyze**, the waveform shows:

- the envelope (cyan), drawn as the min and max per pixel,
- the adaptive threshold (amber),
- the detected mark pulses along the top (green).

Use the zoom buttons and the position slider to move around. The status line shows the time window and samples per pixel.

## Pulse analyzer

The analyzer follows the idea of rtl_433's \`-A\` option:

- **Histograms** of mark widths, gap widths and periods (mark + gap), grouped into clusters with a count and a min-max range.
- **Modulation guess**:
  - **OOK PWM**: the mark width carries the bit, and the period or the gap is fixed.
  - **OOK PPM**: the gap width carries the bit, and the mark is fixed.
  - **OOK Manchester**: every duration is a small multiple of one half-bit clock.
  - **FSK PCM**: shown for FSK mode, as NRZ bits at the shortest run length.
- **Limits**: the short and long widths, the slicing threshold, the half-bit clock and an estimate of the packet reset gap.
- **Bit rows** in hex, one per packet, sliced with the guessed modulation.

Treat the guess as a starting point. Look at the histogram: a clean PWM or PPM signal has two or three tight clusters.

## Device decoders

Each decoder slices the pulses with its own timing and then searches the bit row for its frame. A frame is reported only when its checks pass, and each result lists every check. Identical repeats of one frame are counted (\`x3 repeat(s)\`).

| Decoder | Modulation | Checks |
|---|---|---|
| Acurite 592TXR / Tower (message type 0x04) | PWM, 612 us period | byte sum of bytes 0 to 5, humidity range |
| Ambient Weather F007TH | Manchester, 500 us half-bit | preamble 0x01 0x45, LFSR digest, humidity and temperature range |
| Fine Offset WH2 / WH2A | PWM, 0xFF preamble | CRC-8 poly 0x31, type nibble |
| Nexus / Rubicson temperature | PPM, 36-bit frame | constant nibble, humidity range, CRC-8 false-positive filter |
| Prologue temperature / humidity | PPM, 36-bit frame | type nibble, humidity range |
| EV1527 / PT2262 24-bit remote | PWM, 1280 us period, sync gap | none in the chip; reported as unverified |

The fields table lists the decoded values: sensor ID, channel, battery state, temperature and humidity where the protocol carries them.

Nexus, Prologue and EV1527 have no checksum in the protocol, so their results are structural or unverified, and the card says so.

## Export

**Export JSON** saves the analyzer output, the bit rows, every decoded device with its checks, and the pulse list (start time, mark and gap in microseconds, up to the first 50,000 pulses).

## What it does not do

- It does not transmit, and it does not control any radio.
- It does not decode LaCrosse TX141x or Oregon Scientific v2.1 frames. Those rtl_433 decoders were not ported.
- It does not decode FSK frames; FSK mode shows the discriminator and the bit runs only.
- The decoders were tested against frames built from the same bit layouts, not against captures from real sensors. A specific sensor may need a polarity or timing adjustment. The checks are there so a wrong decode is rejected rather than shown as valid.
- It does not read the hardware directly. Capture with another tool first.

## Troubleshooting

- **No pulses found**: lower the threshold slider, check the sample rate, and confirm the centre frequency matches the transmitter.
- **Pulses found but no decodes**: look at the analyzer guess. If it says unknown, the timing may not match a supported protocol. Compare the widths with the decoder notes in the table above.
- **Garbage bit rows**: the rate is probably wrong. A 2 MS/s capture loaded as 250 kS/s stretches every pulse by eight times.
- **Very large file error**: the 64 MiB limit is there to keep the tab responsive. Capture a shorter window.
- **Firefox or Safari**: the analysis is plain JavaScript and should work there. Recording the signal is a separate step with SDR software.

## Related tools in this app

- **HackRF Receiver** and the other HackRF panels can show the spectrum live and record IQ for later analysis.
- **Packet Analyzer** and **Protocol Packet Lab** decode framed bytes from a serial or network source.
- **Logic Analyzer** samples digital lines directly if you want to look at the raw demodulated signal.
`,
};
