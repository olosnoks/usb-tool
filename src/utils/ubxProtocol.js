/**
 * u-blox UBX Binary Protocol Encoder & Checksum Engine
 * Generates binary command frames for configuring u-blox GPS modules (NEO-6M/7M/8M/9M/M10)
 */

export const UBX_SYNC_1 = 0xB5;
export const UBX_SYNC_2 = 0x62;

export const UBX_CLASSES = {
  NAV: 0x01,
  RXM: 0x02,
  INF: 0x04,
  ACK: 0x05,
  CFG: 0x06,
  UPD: 0x09,
  MON: 0x0A,
  AID: 0x0B,
  TIM: 0x0D,
  ESF: 0x10,
  MGA: 0x13,
  LOG: 0x21,
  SEC: 0x27,
  HNR: 0x28
};

/**
 * 8-Bit Fletcher Checksum over UBX Class, ID, Length, and Payload
 */
export function calculateUbxChecksum(buffer) {
  let ckA = 0;
  let ckB = 0;
  for (let i = 0; i < buffer.length; i++) {
    ckA = (ckA + buffer[i]) & 0xFF;
    ckB = (ckB + ckA) & 0xFF;
  }
  return { ckA, ckB };
}

/**
 * Wrap Class, ID, and Payload into a complete UBX frame with Sync Chars & Checksum
 */
export function buildUbxPacket(msgClass, msgId, payload = []) {
  const payloadArray = payload instanceof Uint8Array ? Array.from(payload) : payload;
  const length = payloadArray.length;

  const headerAndPayload = [
    msgClass,
    msgId,
    length & 0xFF,
    (length >> 8) & 0xFF,
    ...payloadArray
  ];

  const { ckA, ckB } = calculateUbxChecksum(headerAndPayload);

  return new Uint8Array([
    UBX_SYNC_1,
    UBX_SYNC_2,
    ...headerAndPayload,
    ckA,
    ckB
  ]);
}

/**
 * UBX-CFG-RATE (0x06 0x08): Navigation Update Rate
 * @param {number} measRateMs - measurement period in milliseconds (e.g. 100 for 10Hz, 200 for 5Hz, 1000 for 1Hz)
 * @param {number} navRate - navigation cycles per measurement (default 1)
 * @param {number} timeRef - 0: UTC, 1: GPS (default 1)
 */
export function buildCfgRate(measRateMs = 100, navRate = 1, timeRef = 1) {
  const payload = [
    measRateMs & 0xFF,
    (measRateMs >> 8) & 0xFF,
    navRate & 0xFF,
    (navRate >> 8) & 0xFF,
    timeRef & 0xFF,
    (timeRef >> 8) & 0xFF
  ];
  return buildUbxPacket(UBX_CLASSES.CFG, 0x08, payload);
}

/**
 * UBX-CFG-PRT (0x06 0x00): Configure UART1 Baud Rate
 * @param {number} baudRate - 9600, 38400, 57600, 115200, 230400, 460800, 921600
 */
export function buildCfgPrtUart(baudRate = 115200) {
  const payload = [
    0x01,       // portID: 1 (UART1)
    0x00,       // reserved0
    0x00, 0x00, // txReady: 0
    // mode: 8N1 (0x08D0 = 8 data bits, no parity, 1 stop bit)
    0xD0, 0x08, 0x00, 0x00,
    // baudRate (4 bytes, little-endian)
    baudRate & 0xFF,
    (baudRate >> 8) & 0xFF,
    (baudRate >> 16) & 0xFF,
    (baudRate >> 24) & 0xFF,
    // inProtoMask: 0x0007 (UBX, NMEA, RTCM)
    0x07, 0x00,
    // outProtoMask: 0x0003 (UBX, NMEA)
    0x03, 0x00,
    // flags: 0
    0x00, 0x00,
    // reserved1: 0
    0x00, 0x00
  ];
  return buildUbxPacket(UBX_CLASSES.CFG, 0x00, payload);
}

/**
 * UBX-CFG-CFG (0x06 0x09): Save / Clear / Revert Configuration
 * Saves all current settings to Battery-Backed RAM (BBR) and SPI Flash / EEPROM
 */
export function buildCfgSave() {
  const saveMask = 0x0000001F; // Save ioPort, msgConf, infMsg, navConf, rxmConf
  const payload = [
    0x00, 0x00, 0x00, 0x00, // clearMask
    saveMask & 0xFF, (saveMask >> 8) & 0xFF, (saveMask >> 16) & 0xFF, (saveMask >> 24) & 0xFF, // saveMask
    0x00, 0x00, 0x00, 0x00, // loadMask
    0x17                    // deviceMask: 0x17 = devBBR | devFlash | devEEPROM | devSpiFlash
  ];
  return buildUbxPacket(UBX_CLASSES.CFG, 0x09, payload);
}

/**
 * UBX-CFG-NAV5 (0x06 0x24): Dynamic Platform Model (Airborne, Pedestrian, Automotive)
 * @param {number} dynModel - 0: Portable, 2: Stationary, 3: Pedestrian, 4: Automotive, 6: Airborne <1g, 7: Airborne <2g, 8: Airborne <4g
 */
export function buildCfgNav5(dynModel = 4) {
  const mask = 0x0001; // Apply dynModel
  const payload = new Array(36).fill(0);
  payload[0] = mask & 0xFF;
  payload[1] = (mask >> 8) & 0xFF;
  payload[2] = dynModel & 0xFF;
  payload[3] = 0x03; // 3D fix mode
  return buildUbxPacket(UBX_CLASSES.CFG, 0x24, payload);
}

/**
 * UBX-CFG-MSG (0x06 0x01): Enable/Disable specific NMEA message
 * @param {number} nmeaMsgId - 0x00: GGA, 0x01: GLL, 0x02: GSA, 0x03: GSV, 0x04: RMC, 0x05: VTG
 * @param {number} rate - 1 to output every cycle, 0 to disable
 */
export function buildCfgNmeaMsg(nmeaMsgId, rate = 1) {
  const payload = [
    0xF0, // NMEA Class
    nmeaMsgId,
    rate & 0xFF
  ];
  return buildUbxPacket(UBX_CLASSES.CFG, 0x01, payload);
}

/**
 * Helper to check if incoming bytes contain UBX-ACK-ACK or UBX-ACK-NAK
 */
export function checkUbxAck(bytes) {
  for (let i = 0; i <= bytes.length - 10; i++) {
    if (bytes[i] === UBX_SYNC_1 && bytes[i + 1] === UBX_SYNC_2) {
      const cls = bytes[i + 2];
      const id = bytes[i + 3];
      if (cls === UBX_CLASSES.ACK) {
        if (id === 0x01) {
          return { isAck: true, ackCls: bytes[i + 6], ackId: bytes[i + 7] };
        } else if (id === 0x00) {
          return { isNak: true, ackCls: bytes[i + 6], ackId: bytes[i + 7] };
        }
      }
    }
  }
  return null;
}
