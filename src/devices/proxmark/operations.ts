import type { ProxmarkDevice } from './ProxmarkDevice';

export type ProxmarkOp = 'hf14aReader' | 'lfEm410x' | 'tune';

/** A decoded operation result, ready to show as label / value rows. */
export interface ProxmarkOpResult {
  title: string;
  /** false when the operation ran but found nothing (no card, no tag). */
  ok: boolean;
  rows: Array<[label: string, value: string]>;
  note?: string;
}

const volts = (mV: number): string => `${(mV / 1000).toFixed(2)} V`;

/** Same thresholds the Proxmark3 client uses for `hw tune`. */
function antennaVerdict(mV: number, marginalBelow: number): string {
  if (mV < 2000) return 'unusable';
  if (mV < marginalBelow) return 'marginal';
  return 'ok';
}

const spaced = (hex: string): string => hex.replace(/(..)(?=.)/g, '$1 ');

/** Runs one decoded operation on a connected device and formats what came back. */
export async function runProxmarkOp(device: ProxmarkDevice, op: ProxmarkOp): Promise<ProxmarkOpResult> {
  if (op === 'hf14aReader') {
    const card = await device.searchHf14a();
    if (!card.found) {
      return {
        title: 'ISO 14443A card',
        ok: false,
        rows: [],
        note: 'No ISO 14443A card answered. Hold the card flat on the HF antenna and run it again.'
      };
    }
    const rows: ProxmarkOpResult['rows'] = [
      ['UID', `${spaced(card.uid)} (${card.uidBytes.length} bytes)`],
      ['ATQA', spaced(card.atqa)],
      ['SAK', card.sak],
      ['Card type (from SAK)', card.cardType]
    ];
    if (card.ats) rows.push(['ATS', spaced(card.ats)]);
    return { title: 'ISO 14443A card', ok: true, rows };
  }

  if (op === 'lfEm410x') {
    const read = await device.readLfEm410x();
    const captured = `${read.sampleCount} samples, ${read.swing} ADC counts peak-to-peak`;
    if (!read.found || !read.cardId) {
      return {
        title: 'EM410x tag',
        ok: false,
        rows: [['Capture', captured]],
        note:
          read.swing < 6
            ? 'No modulation on the 125 kHz antenna: no tag in range.'
            : 'The antenna sees a modulated signal, but it is not a valid EM410x frame (another LF tag type, or the tag is too far away).'
      };
    }
    const id = BigInt(`0x${read.cardId}`);
    return {
      title: 'EM410x tag',
      ok: true,
      rows: [
        ['Tag ID', read.cardId],
        ['DEZ 10 (low 32 bits)', (id & 0xffffffffn).toString(10).padStart(10, '0')],
        ['DEZ 8 (low 24 bits)', (id & 0xffffffn).toString(10).padStart(8, '0')],
        ['Bit rate', `RF/${read.clock}`],
        ['Capture', captured]
      ]
    };
  }

  const tuning = await device.tuneAntennas();
  return {
    title: 'Antenna tuning',
    ok: true,
    rows: [
      ['LF antenna @ 125.00 kHz', `${volts(tuning.lf125mV)} (${antennaVerdict(tuning.lf125mV, 10000)})`],
      ['LF antenna @ 134.00 kHz', volts(tuning.lf134mV)],
      ['LF optimum', `${volts(tuning.peakmV)} @ ${tuning.peakKhz.toFixed(2)} kHz`],
      ['HF antenna @ 13.56 MHz', `${volts(tuning.hfmV)} (${antennaVerdict(tuning.hfmV, 5000)})`]
    ],
    note: 'Measured with nothing on the antennas. A card or metal nearby lowers the reading.'
  };
}
