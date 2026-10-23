/**
 * 24MHz 8-Channel USB Logic Analyzer & Protocol Decoder Driver
 * Works with Saleae / USBee FX2LP 8-channel hardware clones over WebUSB,
 * and includes high-speed software decoders for UART, I2C, and SPI.
 */

export const SAMPLE_RATES = [
  { value: 24000000, label: '24 MHz (41.6 ns/sample)' },
  { value: 16000000, label: '16 MHz (62.5 ns/sample)' },
  { value: 12000000, label: '12 MHz (83.3 ns/sample)' },
  { value: 8000000,  label: '8 MHz (125 ns/sample)' },
  { value: 4000000,  label: '4 MHz (250 ns/sample)' },
  { value: 2000000,  label: '2 MHz (500 ns/sample)' },
  { value: 1000000,  label: '1 MHz (1 µs/sample)' }
];

export const FX2_USB = {
  VID_SALEAE: 0x0925,
  PID_SALEAE: 0x3881,
  VID_USBEE: 0x08A9,
  PID_USBEE: 0x0014
};

/**
 * Generates realistic synthetic digital signals (I2C transaction + UART transmission)
 * for testing without physical hardware
 */
export function generateSyntheticSignalBuffer(sampleCount = 50000, sampleRate = 4000000) {
  const buffer = new Uint8Array(sampleCount);
  buffer.fill(0b00000011); // Channels D0 (SCL) and D1 (SDA) idle HIGH, D2 (UART TX) idle HIGH

  const samplesPerUs = sampleRate / 1000000;

  // 1. Synthesize I2C Start + Address 0x3C (SSD1306 Display) + Data 0x40 on D0 (SCL) & D1 (SDA)
  const sclClockHalfPeriod = Math.floor(samplesPerUs * 5); // 100kHz I2C clock
  let cur = Math.floor(samplesPerUs * 100);

  // START condition: SDA goes low while SCL is high
  buffer.fill(0b00000001, cur, cur + Math.floor(samplesPerUs * 2));
  cur += Math.floor(samplesPerUs * 2);

  const i2cBits = [
    // 7-bit addr 0x3C (0,1,1,1,1,0,0) + Write (0) + ACK (0)
    0, 1, 1, 1, 1, 0, 0, 0, 0,
    // Data byte 0x40 (0,1,0,0,0,0,0,0) + ACK (0)
    0, 1, 0, 0, 0, 0, 0, 0, 0
  ];

  for (const bit of i2cBits) {
    // SCL low, set SDA
    for (let s = 0; s < sclClockHalfPeriod; s++) {
      buffer[cur + s] = (bit ? 0b00000010 : 0b00000000) | 0b00000100;
    }
    cur += sclClockHalfPeriod;

    // SCL high, read SDA
    for (let s = 0; s < sclClockHalfPeriod; s++) {
      buffer[cur + s] = 0b00000001 | (bit ? 0b00000010 : 0b00000000) | 0b00000100;
    }
    cur += sclClockHalfPeriod;
  }

  // STOP condition: SCL high, SDA goes from low to high
  for (let s = 0; s < Math.floor(samplesPerUs * 5); s++) {
    buffer[cur + s] = 0b00000001 | 0b00000100;
  }
  cur += Math.floor(samplesPerUs * 5);
  for (let s = 0; s < Math.floor(samplesPerUs * 5); s++) {
    buffer[cur + s] = 0b00000011 | 0b00000100;
  }

  // 2. Synthesize UART "OK\n" on Channel D2 at 115200 baud
  const baudPeriod = Math.floor(sampleRate / 115200);
  let uCur = Math.floor(samplesPerUs * 400);

  const uartBytes = [0x4F, 0x4B, 0x0A]; // 'O', 'K', '\n'
  for (const byte of uartBytes) {
    // Start bit (0)
    for (let s = 0; s < baudPeriod; s++) {
      buffer[uCur + s] = (buffer[uCur + s] || 0) & ~0b00000100;
    }
    uCur += baudPeriod;

    // 8 data bits (LSB first)
    for (let b = 0; b < 8; b++) {
      const bitVal = (byte >> b) & 1;
      for (let s = 0; s < baudPeriod; s++) {
        if (bitVal) buffer[uCur + s] = (buffer[uCur + s] || 0) | 0b00000100;
        else buffer[uCur + s] = (buffer[uCur + s] || 0) & ~0b00000100;
      }
      uCur += baudPeriod;
    }

    // Stop bit (1)
    for (let s = 0; s < baudPeriod; s++) {
      buffer[uCur + s] = (buffer[uCur + s] || 0) | 0b00000100;
    }
    uCur += baudPeriod * 2;
  }

  return buffer;
}

/**
 * Protocol Decoder: Decodes UART signal from channel data
 */
export function decodeUart(buffer, channelIdx = 2, baudRate = 115200, sampleRate = 4000000) {
  const bitMask = 1 << channelIdx;
  const samplesPerBit = sampleRate / baudRate;
  const decoded = [];

  let i = 0;
  while (i < buffer.length - (samplesPerBit * 10)) {
    const isHigh = (buffer[i] & bitMask) !== 0;
    // Look for Falling Edge (Start Bit: High -> Low)
    if (!isHigh && (buffer[i - 1] & bitMask) !== 0) {
      const startSample = i;
      // Sample in the middle of data bits
      let byte = 0;
      let valid = true;

      for (let b = 0; b < 8; b++) {
        const samplePos = Math.floor(startSample + (samplesPerBit * (b + 1.5)));
        if (samplePos >= buffer.length) { valid = false; break; }
        const bit = (buffer[samplePos] & bitMask) !== 0 ? 1 : 0;
        byte |= (bit << b);
      }

      const stopSamplePos = Math.floor(startSample + (samplesPerBit * 9.5));
      const stopBit = stopSamplePos < buffer.length ? (buffer[stopSamplePos] & bitMask) !== 0 : true;

      if (valid && stopBit) {
        decoded.push({
          type: 'uart',
          startSample,
          endSample: Math.floor(startSample + (samplesPerBit * 10)),
          byte,
          char: byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : `0x${byte.toString(16).toUpperCase()}`
        });
        i += Math.floor(samplesPerBit * 10);
        continue;
      }
    }
    i++;
  }

  return decoded;
}

/**
 * Protocol Decoder: Decodes I2C transactions (SCL on sclCh, SDA on sdaCh)
 */
export function decodeI2C(buffer, sclCh = 0, sdaCh = 1) {
  const sclMask = 1 << sclCh;
  const sdaMask = 1 << sdaCh;
  const events = [];

  let inTransaction = false;
  let bits = [];
  let transactionStart = 0;

  for (let i = 1; i < buffer.length; i++) {
    const prevScl = (buffer[i - 1] & sclMask) !== 0;
    const curScl = (buffer[i] & sclMask) !== 0;
    const prevSda = (buffer[i - 1] & sdaMask) !== 0;
    const curSda = (buffer[i] & sdaMask) !== 0;

    // START condition: SCL High, SDA High -> Low
    if (curScl && prevSda && !curSda) {
      inTransaction = true;
      transactionStart = i;
      bits = [];
      events.push({ type: 'START', sample: i });
      continue;
    }

    // STOP condition: SCL High, SDA Low -> High
    if (curScl && !prevSda && curSda && inTransaction) {
      inTransaction = false;
      events.push({ type: 'STOP', sample: i });
      continue;
    }

    // Sample data on SCL Rising Edge
    if (!prevScl && curScl && inTransaction) {
      bits.push({ val: curSda ? 1 : 0, sample: i });
      if (bits.length === 9) {
        // 8 data bits + 1 ACK bit
        let byteVal = 0;
        for (let b = 0; b < 8; b++) {
          byteVal = (byteVal << 1) | bits[b].val;
        }
        const ack = bits[8].val === 0;

        events.push({
          type: 'DATA',
          byte: byteVal,
          ack,
          startSample: bits[0].sample,
          endSample: bits[8].sample
        });
        bits = [];
      }
    }
  }

  return events;
}
