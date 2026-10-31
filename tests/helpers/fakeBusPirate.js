import { FakeSerialPort } from '../../src/utils/serialLink';

const enc = new TextEncoder();

// Bus Pirate v3 firmware model: text console -> BBIO -> I2C / SPI.
export function fakeBusPirate({ devices = { 0x68: { 0x75: 0x68, 0x6b: 0x40 } }, zerosNeeded = 3 } = {}) {
  const st = { mode: 'console', zeros: 0, i2c: { started: false, addr: null, reading: false, ptr: 0 }, spiCs: false, periph: 0, log: [] };
  const port = new FakeSerialPort((bytes, p) => {
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i++];
      st.log.push(c);
      if (st.mode === 'console') {
        if (c === 0x00 && ++st.zeros >= zerosNeeded) { st.mode = 'bbio'; p.feed(enc.encode('BBIO1')); }
        continue;
      }
      if (c === 0x00) { st.mode = 'bbio'; p.feed(enc.encode('BBIO1')); continue; }
      if (st.mode === 'bbio') {
        if (c === 0x02) { st.mode = 'i2c'; p.feed(enc.encode('I2C1')); }
        else if (c === 0x01) { st.mode = 'spi'; p.feed(enc.encode('SPI1')); }
        else if (c === 0x0f) { st.mode = 'console'; st.zeros = 0; p.feed([0x01]); }
        continue;
      }
      if ((c & 0xf0) === 0x40) { st.periph = c & 0x0f; p.feed([0x01]); continue; }
      if ((c & 0xf8) === 0x60) { p.feed([0x01]); continue; }
      if (st.mode === 'i2c') {
        const t = st.i2c;
        if (c === 0x02) { t.started = true; t.addr = null; p.feed([0x01]); }
        else if (c === 0x03) { t.started = false; p.feed([0x01]); }
        else if (c === 0x06 || c === 0x07) p.feed([0x01]);
        else if (c === 0x04) { const dev = devices[t.addr] || {}; p.feed([dev[t.ptr] ?? 0]); t.ptr++; }
        else if ((c & 0xf0) === 0x10) {
          const n = (c & 0x0f) + 1;
          const data = bytes.slice(i, i + n); i += n;
          const acks = [];
          let first = t.addr === null || !t.reading;
          data.forEach((b, k) => {
            if (k === 0 && (t.addr === null || first)) {
              const a = b >> 1;
              const ack = a in devices;
              if (ack) { t.addr = a; t.reading = (b & 1) === 1; }
              acks.push(ack ? 0 : 1);
              first = false;
              t.regNext = !t.reading;
            } else if (t.regNext) { t.ptr = b; t.regNext = false; acks.push(0); }
            else { devices[t.addr][t.ptr++] = b; acks.push(0); }
          });
          p.feed([0x01, ...acks]);
        }
        continue;
      }
      if (st.mode === 'spi') {
        if (c === 0x02) { st.spiCs = true; st.spiBuf = []; p.feed([0x01]); }
        else if (c === 0x03) { st.spiCs = false; p.feed([0x01]); }
        else if ((c & 0xf0) === 0x80) p.feed([0x01]);
        else if ((c & 0xf0) === 0x10) {
          const n = (c & 0x0f) + 1;
          const data = Array.from(bytes.slice(i, i + n)); i += n;
          const out = data.map(() => 0xff);
          st.spiBuf.push(...data);
          if (st.spiBuf[0] === 0x9f) {
            const id = [0xff, 0xef, 0x40, 0x17];
            const base = st.spiBuf.length - data.length;
            for (let k = 0; k < data.length; k++) out[k] = id[base + k] ?? 0xff;
          }
          p.feed([0x01, ...out]);
        }
      }
    }
  });
  return { port, st, devices };
}

