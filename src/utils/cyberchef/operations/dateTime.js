/**
 * Date/Time Operations
 * From UNIX Timestamp, To UNIX Timestamp, Parse DateTime
 */

import { Operation } from '../core/Operation.js';

export class FromUnixTimestampOperation extends Operation {
  constructor() {
    super({
      name: 'From UNIX Timestamp',
      id: 'from_unix_timestamp',
      module: 'Date / Time',
      description: 'Converts a UNIX epoch timestamp (seconds or milliseconds) into human-readable date formats.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'unit', label: 'Units', type: 'select', options: ['Seconds (s)', 'Milliseconds (ms)', 'Auto-detect'], default: 'Auto-detect' },
        { name: 'format', label: 'Format', type: 'select', options: ['ISO 8601 (UTC)', 'UTC String', 'Local String'], default: 'ISO 8601 (UTC)' }
      ]
    });
  }

  async run(input, { unit = 'Auto-detect', format = 'ISO 8601 (UTC)' } = {}) {
    if (!input || !input.trim()) return '';
    const clean = input.trim();
    let num = Number(clean);
    if (isNaN(num)) throw new Error(`Invalid numeric timestamp: "${clean}"`);

    let ms = num;
    if (unit === 'Seconds (s)') {
      ms = num * 1000;
    } else if (unit === 'Milliseconds (ms)') {
      ms = num;
    } else {
      if (num < 10000000000) {
        ms = num * 1000;
      }
    }

    const date = new Date(ms);
    if (isNaN(date.getTime())) throw new Error(`Invalid timestamp value: ${num}`);

    if (format === 'UTC String') return date.toUTCString();
    if (format === 'Local String') return date.toString();
    return date.toISOString();
  }
}

export class ToUnixTimestampOperation extends Operation {
  constructor() {
    super({
      name: 'To UNIX Timestamp',
      id: 'to_unix_timestamp',
      module: 'Date / Time',
      description: 'Parses standard date/time strings into integer UNIX epoch timestamps.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'unit', label: 'Units', type: 'select', options: ['Seconds (s)', 'Milliseconds (ms)'], default: 'Seconds (s)' }
      ]
    });
  }

  async run(input, { unit = 'Seconds (s)' } = {}) {
    if (!input || !input.trim()) return '';
    const date = new Date(input.trim());
    if (isNaN(date.getTime())) throw new Error(`Could not parse date string: "${input}"`);

    const ms = date.getTime();
    if (unit === 'Milliseconds (ms)') {
      return String(ms);
    }
    return String(Math.floor(ms / 1000));
  }
}

export class ParseDateTimeOperation extends Operation {
  constructor() {
    super({
      name: 'Parse DateTime',
      id: 'parse_date_time',
      module: 'Date / Time',
      description: 'Parses human date/time formats and normalizes into ISO 8601 or RFC 2822.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'outputFormat', label: 'Output Format', type: 'select', options: ['ISO 8601', 'UTC String', 'Epoch Seconds', 'Epoch Milliseconds'], default: 'ISO 8601' }
      ]
    });
  }

  async run(input, { outputFormat = 'ISO 8601' } = {}) {
    if (!input || !input.trim()) return '';
    const date = new Date(input.trim());
    if (isNaN(date.getTime())) throw new Error(`Unparseable DateTime string: "${input}"`);

    if (outputFormat === 'UTC String') return date.toUTCString();
    if (outputFormat === 'Epoch Seconds') return String(Math.floor(date.getTime() / 1000));
    if (outputFormat === 'Epoch Milliseconds') return String(date.getTime());
    return date.toISOString();
  }
}

export const dateTimeOperations = [
  new FromUnixTimestampOperation(),
  new ToUnixTimestampOperation(),
  new ParseDateTimeOperation()
];
