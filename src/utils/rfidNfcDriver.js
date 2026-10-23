/**
 * RFID / NFC Badge Deck & Proxmark3 Companion Driver
 * 
 * Supports:
 * - 125kHz Low Frequency (LF): EM4100, HID Prox 26-bit Wiegand, Indala
 * - 13.56MHz High Frequency (HF / NFC): Mifare Classic 1K/4K, NTAG213/215/216 (Amiibos)
 * - T5577 rewritable transponder encoder for badge cloning
 * - Mifare Classic 16-sector memory table with Key A/B and access bits
 */

export const SAMPLE_SCANNED_CARDS = {
  em4100: {
    band: '125 kHz (LF)',
    chipType: 'EM4100 / EM4200 (64-bit Manchester)',
    uidHex: '01 02 A3 B4 C5',
    wiegand: null,
    cloneableTo: 'T5577 / EM4305',
    desc: 'Standard unencrypted low-frequency building keyfob'
  },
  hidProx: {
    band: '125 kHz (LF)',
    chipType: 'HID ProxCard II (H10301 26-bit)',
    uidHex: '1F 80 4A 22',
    wiegand: {
      facilityCode: 124,
      cardNumber: 42109,
      format: '26-bit H10301'
    },
    cloneableTo: 'T5577 (Block 0: 0x20042001)',
    desc: 'Corporate office access badge'
  },
  mifare1k: {
    band: '13.56 MHz (HF / NFC)',
    chipType: 'Mifare Classic 1K (S50)',
    uidHex: '8A 3B 21 F0',
    atqa: '0x0004',
    sak: '0x08',
    sectors: 16,
    desc: 'Metro transit card, hotel door card, campus ID'
  },
  ntag215: {
    band: '13.56 MHz (HF / NFC)',
    chipType: 'NTAG215 (504 Bytes User R/W)',
    uidHex: '04 8A 12 3B 99 21 80',
    atqa: '0x0044',
    sak: '0x00',
    desc: 'Nintendo Amiibo figure or standard NDEF smart poster'
  }
};

export class RfidNfcClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.isSimulated = false;
    this.activeCard = null;
    this.activeBand = '125khz'; // '125khz' | '13mhz'
    this.mifareSectors = [];
  }

  connectSimulation() {
    this.isConnected = true;
    this.isSimulated = true;
    this.logger('[RFID/NFC] Virtual Proxmark3 RDV4 / CCID Reader online.');
    return true;
  }

  disconnect() {
    this.isConnected = false;
    this.isSimulated = false;
    this.activeCard = null;
    this.mifareSectors = [];
    this.logger('[RFID/NFC] Disconnected.');
  }

  // Scan Low-Frequency (125kHz) Badge
  async scan125Khz() {
    if (!this.isConnected) return null;

    this.logger('[RFID LF] Tuned antenna to 125 kHz carrier frequency. Listening for Manchester modulated backscatter...');
    await new Promise(r => setTimeout(r, 250));

    this.activeCard = SAMPLE_SCANNED_CARDS.hidProx;
    this.logger(`[RFID LF] TAG DETECTED: ${this.activeCard.chipType}`);
    this.logger(`[RFID LF] Raw UID: ${this.activeCard.uidHex} (Facility Code: ${this.activeCard.wiegand.facilityCode}, Card #${this.activeCard.wiegand.cardNumber})`);
    return this.activeCard;
  }

  // Scan High-Frequency (13.56MHz) NFC Card
  async scan13Mhz() {
    if (!this.isConnected) return null;

    this.logger('[NFC HF] Emitting 13.56 MHz RF field (ISO/IEC 14443-A anticollision)...');
    await new Promise(r => setTimeout(r, 250));

    this.activeCard = SAMPLE_SCANNED_CARDS.mifare1k;
    this.generateMifareSectors();
    this.logger(`[NFC HF] CARD FOUND: ${this.activeCard.chipType} (UID: ${this.activeCard.uidHex})`);
    return this.activeCard;
  }

  generateMifareSectors() {
    this.mifareSectors = [];
    for (let s = 0; s < 16; s++) {
      this.mifareSectors.push({
        sector: s,
        keyA: 'FF FF FF FF FF FF',
        keyB: s === 0 ? 'A0 A1 A2 A3 A4 A5' : 'FF FF FF FF FF FF',
        accessBits: 'FF 07 80 69',
        dataBlocks: [
          s === 0 ? '8A 3B 21 F0 4E 08 04 00 01 02 03 04 05 06 07 08' : '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
          '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
          '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'
        ]
      });
    }
  }

  // Clone 125kHz badge to T5577 rewritable chip
  async cloneToT5577(tagData) {
    this.logger(`[RFID LF] Programming T5577 Block 0/1/2 with UID ${tagData.uidHex}...`);
    await new Promise(r => setTimeout(r, 300));
    this.logger('[RFID LF] Write verified OK! Tag clone ready for use.');
    return true;
  }
}
