import { describe, it, expect } from 'vitest';
import { Dish } from '../../src/utils/cyberchef/index.js';
import {
  ParseDnsQueryOperation,
  ParseTcpHeaderOperation,
  ParseUdpHeaderOperation,
  ParseHttpOperation
} from '../../src/utils/cyberchef/operations/NetworkParsers.js';

describe('CyberChef Network Payload Parsers (NetworkParsers.js)', () => {
  describe('Parse DNS Query Operation', () => {
    it('extracts transaction ID, flags, question count, and domain name from raw DNS wire payload', async () => {
      // DNS Query wire bytes for "example.com" Type A, Class IN, TxID 0x1234
      // Header: 12 34 (ID) 01 00 (Flags: Standard query, RD=1) 00 01 (QD) 00 00 (AN) 00 00 (NS) 00 00 (AR)
      // Question: 07 65 78 61 6d 70 6c 65 (example) 03 63 6f 6d (com) 00 (root) 00 01 (Type A) 00 01 (Class IN)
      const dnsHex = '123401000001000000000000076578616d706c6503636f6d0000010001';
      const dish = Dish.fromHex(dnsHex);
      const op = new ParseDnsQueryOperation();

      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);

      expect(res.protocol).toBe('DNS');
      expect(res.transactionId).toBe('0x1234');
      expect(res.messageType).toBe('Standard Query');
      expect(res.flags.recursionDesired).toBe(true);
      expect(res.counts.questions).toBe(1);
      expect(res.questions.length).toBe(1);
      expect(res.questions[0].name).toBe('example.com');
      expect(res.questions[0].type).toBe('A');
      expect(res.questions[0].class).toContain('IN');
    });

    it('gracefully handles payload shorter than 12-byte DNS header', async () => {
      const dish = Dish.fromHex('1234');
      const op = new ParseDnsQueryOperation();
      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);
      expect(res.error).toBeDefined();
    });
  });

  describe('Parse TCP Header Operation', () => {
    it('extracts source/destination ports, sequence number, flags (SYN), and payload offset', async () => {
      // TCP SYN packet to port 80
      // Source port: 44321 (0xAD21)
      // Destination port: 80 (0x0050)
      // Seq: 1000 (0x000003E8)
      // Ack: 0 (0x00000000)
      // Data Offset: 5 words = 20 bytes (0x50), Flags: SYN = 0x02
      // Window: 65535 (0xFFFF)
      // Checksum: 0x1A2B
      // Urgent: 0x0000
      const tcpHex = 'AD210050000003E8000000005002FFFF1A2B0000';
      const dish = Dish.fromHex(tcpHex);
      const op = new ParseTcpHeaderOperation();

      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);

      expect(res.protocol).toBe('TCP');
      expect(res.ports.source).toBe(44321);
      expect(res.ports.destination).toBe(80);
      expect(res.ports.destinationService).toBe('HTTP');
      expect(res.sequenceNumber).toBe(1000);
      expect(res.headerLength).toBe(20);
      expect(res.flags.SYN).toBe(true);
      expect(res.flags.ACK).toBe(false);
      expect(res.flags.active).toContain('SYN');
      expect(res.payload.offset).toBe(20);
    });

    it('supports offset parameter to skip encapsulation headers', async () => {
      // 4 bytes dummy prefix + TCP header
      const prefix = 'AABBCCDD';
      const tcpHex = '001601BB000000010000000250122000BEEF0000'; // Port 22 -> 443, SYN+ACK
      const dish = Dish.fromHex(prefix + tcpHex);
      const op = new ParseTcpHeaderOperation();

      const resStr = await op.run(dish, { offset: 4 });
      const res = JSON.parse(resStr);

      expect(res.ports.source).toBe(22);
      expect(res.ports.sourceService).toBe('SSH');
      expect(res.ports.destination).toBe(443);
      expect(res.ports.destinationService).toBe('HTTPS');
      expect(res.flags.active).toContain('SYN');
      expect(res.flags.active).toContain('ACK');
      expect(res.payload.offset).toBe(24);
    });
  });

  describe('Parse UDP Header Operation', () => {
    it('extracts source/dest ports, datagram length, and checksum', async () => {
      // UDP Datagram: Source 5353 (0x14E9), Dest 5353 (0x14E9), Length 28 (0x001C), Checksum 0xABCD
      // Followed by 20 bytes dummy payload
      const udpHeader = '14E914E9001CABCD';
      const dummyPayload = '0102030405060708090A0B0C0D0E0F1011121314';
      const dish = Dish.fromHex(udpHeader + dummyPayload);
      const op = new ParseUdpHeaderOperation();

      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);

      expect(res.protocol).toBe('UDP');
      expect(res.ports.source).toBe(5353);
      expect(res.ports.destination).toBe(5353);
      expect(res.ports.destinationService).toBe('mDNS');
      expect(res.lengthField).toBe(28);
      expect(res.payload.offset).toBe(8);
      expect(res.payload.expectedLength).toBe(20);
      expect(res.payload.availableLength).toBe(20);
      expect(res.payload.isTruncated).toBe(false);
    });
  });

  describe('Parse HTTP Request/Response Operation', () => {
    it('parses Layer 7 HTTP/1.1 GET request headers and parameters', async () => {
      const rawHttp = 'GET /api/v2/telemetry?device=esp32 HTTP/1.1\r\nHost: 192.168.4.1\r\nUser-Agent: SkonsTool\r\nContent-Length: 17\r\n\r\n{"status":"alive"}';
      const dish = new Dish(rawHttp, 'string');
      const op = new ParseHttpOperation();

      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);

      expect(res.type).toBe('HTTP Request');
      expect(res.method).toBe('GET');
      expect(res.path).toBe('/api/v2/telemetry?device=esp32');
      expect(res.httpVersion).toBe('1.1');
      expect(res.headers.host).toBe('192.168.4.1');
      expect(res.headers['content-length']).toBe('17');
      expect(res.body.preview).toBe('{"status":"alive"}');
    });

    it('parses Layer 7 HTTP/1.1 200 OK server response', async () => {
      const rawHttp = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nServer: nginx\r\n\r\n{"token":"secret_abc123"}';
      const dish = new Dish(rawHttp, 'string');
      const op = new ParseHttpOperation();

      const resStr = await op.run(dish, { offset: 0 });
      const res = JSON.parse(resStr);

      expect(res.type).toBe('HTTP Response');
      expect(res.statusCode).toBe(200);
      expect(res.statusText).toBe('OK');
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers.server).toBe('nginx');
      expect(res.body.preview).toBe('{"token":"secret_abc123"}');
    });
  });

  describe('Archive Extraction: Untar Operation', () => {
    it('parses POSIX USTAR archive, listing contents and extracting specific files', async () => {
      const { UntarOperation } = await import('../../src/utils/cyberchef/operations/compression.js');
      // Create a mocked 512-byte TAR block
      const tarBlock = new Uint8Array(1536); // header + data + zero block
      // Filename at 0: "firmware.cfg"
      const fname = 'firmware.cfg';
      for (let i = 0; i < fname.length; i++) tarBlock[i] = fname.charCodeAt(i);
      // Size at 124: "00000000022 " (octal 22 = 18 bytes)
      const sizeStr = '00000000022 ';
      for (let i = 0; i < sizeStr.length; i++) tarBlock[124 + i] = sizeStr.charCodeAt(i);
      // USTAR magic at 257: "ustar\0"
      const magic = 'ustar\0';
      for (let i = 0; i < magic.length; i++) tarBlock[257 + i] = magic.charCodeAt(i);
      // Content at offset 512: "BAUD=115200;PORT=1" (18 bytes)
      const content = 'BAUD=115200;PORT=1';
      for (let i = 0; i < content.length; i++) tarBlock[512 + i] = content.charCodeAt(i);

      const op = new UntarOperation();

      // List files
      const listDish = await op.run(new Dish(tarBlock.buffer, 'ArrayBuffer'), { filename: '' });
      const list = JSON.parse(listDish.toString());
      expect(list.length).toBe(1);
      expect(list[0].path).toBe('firmware.cfg');
      expect(list[0].size).toBe(18);

      // Extract specific file
      const fileDish = await op.run(new Dish(tarBlock.buffer, 'ArrayBuffer'), { filename: 'firmware.cfg' });
      expect(fileDish.toString()).toBe('BAUD=115200;PORT=1');
    });
  });

  describe('Forensic Detect File Type (50+ signatures)', () => {
    it('identifies PNG, ELF, and SQLite 3 signatures and outputs formatted JSON', async () => {
      const { DetectFileTypeOperation } = await import('../../src/utils/cyberchef/operations/forensics.js');
      const op = new DetectFileTypeOperation();

      // 1. PNG
      const pngDish = Dish.fromHex('89504E470D0A1A0A0000000D49484452');
      const pngRes = JSON.parse(await op.run(pngDish));
      expect(pngRes.detected).toBe(true);
      expect(pngRes.fileType).toBe('PNG Image');
      expect(pngRes.mimeType).toBe('image/png');
      expect(pngRes.extension).toBe('png');

      // 2. ELF Binary
      const elfDish = Dish.fromHex('7F454C46020101000000000000000000');
      const elfRes = JSON.parse(await op.run(elfDish));
      expect(elfRes.detected).toBe(true);
      expect(elfRes.fileType).toContain('ELF');
      expect(elfRes.category).toBe('Executable');

      // 3. SQLite Database
      const sqliteDish = Dish.fromHex('53514C69746520666F726D6174203300');
      const sqliteRes = JSON.parse(await op.run(sqliteDish));
      expect(sqliteRes.detected).toBe(true);
      expect(sqliteRes.fileType).toContain('SQLite');
      expect(sqliteRes.category).toBe('Database');
    });
  });
});
