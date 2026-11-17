// Markdown evidence report (port of usb-rea report.py, MIT, (c) 2026 Emir Mrkaljevic).
// render() returns the Markdown as a string; output matches the Python renderer byte for byte.
import { formula } from './infer.js';
import { XFER_NAMES } from './model.js';
import { fmt } from './states.js';
import { fromHex, hex } from './bytes.js';
import { dict_entries, dict_items, fmt_g, fmt_hex, fmt_pct } from './pyfmt.js';

const xname = (t) => XFER_NAMES[t] ?? 'None';
const j = (a, sep = ', ') => a.map(String).join(sep);
const hex2 = (n) => fmt_hex(n, 2);
const present = (v) => v !== null && v !== undefined;
const isTable = (t) => present(t);

function _requires(r) {
  if (r.source === 'reply') {
    const st = r.setter;
    const how = st
      ? `switches it with \`${st.command} ${fmt(st.value)}\` (the reply showed \`${fmt(r.value)}\` after it `
        + `each time, frames ${j(st.frames.slice(0, 8))}) and reads it again`
      : 'raises `StateError` when it reports another value (no command in the capture changed it)';
    return `- Only sent while the device reported \`${r.state} ${fmt(r.value)}\` (${r.reply} ${r.where}): `
      + `${r.count}x, the last reply before it in frame(s) ${j(r.reply_frames)}; other `
      + `commands were used while it reported ${r.other_values.map((v) => `\`${fmt(v)}\``).join(', ')}. The `
      + `driver reads it first and ${how}`;
  }
  return `- Only sent while \`${r.state} ${fmt_g(r.value)}\`: ${r.count}x, each after the \`${r.state}\` `
    + `command in frame(s) ${j(r.setter_frames)}; other commands were used with `
    + `\`${r.state}\` ${r.other_values.map((v) => fmt_g(v)).join(', ')}. The driver sets `
    + `\`${r.state} ${fmt_g(r.value)}\` first (or raises \`StateError\` with \`auto_state=False\`)`;
}

function _switch(sw) {
  const back = sw.restore === 'previous'
    ? `, then back to the value from before (${sw.restore_values.map((v) => fmt(v)).join(', ')}; frames `
      + `${j(sw.restore_frames.slice(0, 8))})`
    : present(sw.restore)
      ? `, then to \`${sw.state} ${fmt(sw.restore)}\` (frames ${j(sw.restore_frames.slice(0, 8))})`
      : ', and left it there';
  return `- Switches \`${sw.state}\` inside the action: ${sw.count}x the app sent \`${sw.state} `
    + `${fmt(sw.enter)}\` first (frames ${j(sw.enter_frames.slice(0, 8))})${back}. The rows below `
    + `are the action's own packets; the driver sends the \`${sw.state}\` command around them`;
}

export function render(proto, capture = '', sha256 = '') {
  const L = ['# usb-rea protocol report', ''];
  if (capture) L.push(`Capture: \`${capture}\`` + (sha256 ? ` (sha256 \`${sha256.slice(0, 16)}…\`)` : ''));
  const ids = present(proto.vid) ? `${fmt_hex(proto.vid, 4)}:${fmt_hex(proto.pid, 4)}` : 'unknown (no GET_DESCRIPTOR in capture)';
  L.push(`Device: \`${ids}\``, '',
    "Frame numbers match Wireshark's `frame.number`; open the capture and jump to them to verify each claim.", '');
  if (proto.handshake && proto.handshake.length) L.push(..._handshake(proto));
  if (proto.streams && proto.streams.length) L.push(..._streams(proto));
  const hid_by_cmd = new Map();
  for (const h of proto.hid || []) {
    if (h.commands) for (const [k, v] of dict_entries(h.commands)) hid_by_cmd.set(k, v);
  }
  const cmds = [];
  for (const c0 of proto.commands) { cmds.push(c0); for (const s of c0.steps || []) cmds.push(s); }
  for (const c of cmds) {
    let chan = `${xname(c.xfer_type)} EP 0x${hex2(c.endpoint)}`;
    if (c.setup && c.setup.length) chan += `, setup \`${hex(c.setup, ' ')}\``;
    L.push(`## \`${c.name}\``, '', `- Channel: ${chan}`, `- Length: ${c.length} bytes`,
      `- Confidence: ${fmt_pct(c.confidence)}`,
      ...(c.requires || []).map(_requires),
      ...(c.switch ? [_switch(c.switch)] : []),
      ...(hid_by_cmd.has(c.name) ? [`- HID: ${hid_by_cmd.get(c.name)}`] : []),
      '', '| Byte | Role | Encoding |', '|---|---|---|');
    for (const f of c.fields) L.push(`| ${f.offset} | ${f.kind} | \`${f.describe()}\` |`);
    L.push('', 'Evidence:', '', '| Action | Payload | Frame |', '|---|---|---|');
    for (const [label, hx, fr] of c.samples) L.push(`| ${label} | \`${hx}\` | ${fr} |`);
    for (const n of c.notes || []) L.push(`\n> Note: ${n}`);
    L.push('');
  }
  for (const h of proto.hid || []) {
    L.push(`## HID report descriptor, interface ${h.interface}`, '');
    if ('error' in h) {
      L.push(`Could not parse (${h.error}): \`${h.descriptor}\``, '');
      continue;
    }
    L.push(`Top level: ${(h.top_level && h.top_level.length ? j(h.top_level) : '?')}; ${h.length} bytes; `
      + `report IDs ${h.uses_report_ids ? 'used' : 'not used'}.`, '');
    for (const r of h.reports) {
      const rid = r.id ? `0x${fmt_hex(r.id, 2).toUpperCase()}` : 'none';
      L.push(`- ${r.type} report, id ${rid}, ${r.length} bytes` + (r.vendor ? ' (vendor-defined)' : ''));
      for (const f of r.fields) L.push(`  - ${f}`);
    }
    L.push('');
  }
  if (proto.background && proto.background.length) {
    L.push('## Background traffic (ignored)', '',
      'Host→device messages repeated on a steady rhythm, independent of your clicks '
      + '(status polls, keep-alives; `??` marks a sequence or checksum byte that changes '
      + 'every time). They were left out of the analysis.', '',
      '| Channel | Payload | Count | Every | First frames |', '|---|---|---|---|---|');
    for (const b of proto.background) {
      let chan = `${xname(b.xfer_type)} EP 0x${hex2(b.endpoint)}`;
      if (b.setup) chan += `, setup \`${b.setup}\``;
      L.push(`| ${chan} | \`${b.payload}\` | ${b.count} | ${fmt_g(b.period)} s | ${j(b.frames)} |`);
    }
    L.push('');
  }
  if (proto.responses && proto.responses.length) L.push(..._responses(proto));
  if (proto.observations && proto.observations.length) L.push(..._observations(proto));
  if (proto.unmatched && proto.unmatched.length) L.push('## Actions with no host→device data', '', ...proto.unmatched.map((u) => `- ${u}`), '');
  return L.join('\n');
}

function _streams(proto) {
  const L = [];
  for (const s of proto.streams) {
    const eps = s.endpoints && s.endpoints.length ? s.endpoints : [s.endpoint];
    const chan = `${xname(s.xfer_type)} EP ` + eps.map((e) => `0x${hex2(e)}`).join(' + ');
    let intro;
    if (s.raw) {
      intro = `Raw ${s.format.toUpperCase()} pixels sent continuously (a picture or video for a screen, no `
        + 'image file format): runs of large packets with no pause between them whose payload is '
        + 'exactly a common screen size' + (
          s.header_inline ? ' plus the command at their start, which names the screen region'
            : s.region ? ' or the screen region the command packet before them names' : '') + '. ';
    } else {
      intro = `${s.format.toUpperCase()} images sent continuously (a picture or video for a screen): each `
        + "frame starts with a packet that holds the image's start marker and runs until its end "
        + 'marker. ';
    }
    L.push(`## Image stream on ${chan} (kept out of the commands)`, '',
      intro + 'These packets (and the device\'s per-frame ack) were left out of the action diff, so the '
      + 'commands below come from the remaining traffic. The generated driver has `send_image()`.', '',
      `- Frames: ${s.frames} (${s.packets_per_frame[0]} to ${s.packets_per_frame[1]} packets each, `
      + `${s.packets} packets in all` + (s.partial ? `, ${s.partial} of them from a frame cut off by the capture` : '') + ')',
      `- First frames start at: ${j(s.first_frames)}`);
    if (eps.length > 1) {
      const how = {
        alternate: 'the packets alternate between them in this order',
        blocks: 'the first part of each frame goes to the first one, the rest to the next',
        mixed: 'in no fixed order; send_image() writes them all to the first one, check on the device',
      };
      L.push(`- Endpoints: each frame is spread over EP ${eps.map((e) => `0x${hex2(e)}`).join(', ')}; ` + how[s.endpoint_layout]);
    }
    if (present(s.header_endpoint)) {
      L.push(`- The command before each frame goes to EP 0x${hex2(s.header_endpoint)}, the pixels to `
        + eps.map((e) => `EP 0x${hex2(e)}`).join(', '));
    }
    if (s.size && s.size.length && s.raw) {
      const bpp = { rgb565: 2, rgb888: 3 }[s.format];
      L.push(`- Screen: ${s.size[0]}x${s.size[1]} ${s.format.toUpperCase()}, ${s.frame_bytes} bytes `
        + `(${bpp} per pixel) per full frame` + (
          s.size_alternatives && s.size_alternatives.length
            ? ` (the same byte count fits ${j(s.size_alternatives)}; check on the device)` : ''));
      if (s.format === 'rgb565') {
        const why = s.channel_order && (s.channel_evidence || {}).byteorder
          ? 'the test card frames only read right that way' : 'neighbouring pixels are smooth that way';
        L.push('- Pixel byte order: ' + (s.byteorder ? `${s.byteorder}-endian (${why})`
          : 'not clear from the pixels; try little-endian first'));
      }
      const ev = s.channel_evidence;
      if (s.channel_order) {
        L.push(`- Channel order: ${s.channel_order.toUpperCase()} (the usb-rea test card shows in `
          + `${ev.frames_matched} of ${ev.frames_checked} full frames checked, read as ${s.channel_order.toUpperCase()}`
          + (ev.byteorder ? ` ${ev.byteorder}-endian` : '')
          + ` in ${ev.agree} of them, confidence ${fmt_pct(ev.confidence)}, first frames `
          + `${j(ev.frames)}); send_image() converts to it`);
      } else {
        L.push('- Channel order: unknown' + (
          ev ? ` (test card frames disagree: ${ev.agree} of ${ev.frames_matched} one way, confidence `
            + `${fmt_pct(ev.confidence)})` : ' (pixels alone do not tell RGB from BGR)')
          + '; send_image() assumes RGB. To settle it, show the picture from `usb-rea testcard` '
          + 'on the screen for a few seconds while capturing');
      }
      if (s.region) {
        const rg = s.region;
        const what = {
          xywh: 'x, y, width, height as 16-bit', box: 'x0, y0, x1, y1 (inclusive) as 16-bit',
          wh: 'width, height as 16-bit', box10: 'x0, y0, x1, y1 as four 10-bit fields packed into 5 bytes',
        };
        L.push(`- Region: the command gives ${what[rg.layout]}` + (
          rg.layout !== 'box10' ? ` ${rg.endian}-endian` : '') + ` fields from byte ${rg.offset}; `
          + `${s.regions} of ${s.frames} frames redraw only part of the screen`);
      }
    } else if (s.size && s.size.length) {
      L.push(`- Image size: ${s.size[0]}x${s.size[1]}` + (
        s.image_bytes && s.image_bytes.length ? `, ${s.image_bytes[0]} to ${s.image_bytes[1]} bytes` : ''));
    }
    if (s.fps) L.push(`- Rate: about ${fmt_g(s.fps)} frames per second`);
    L.push(`- Chunk: ${s.chunk} bytes per packet` + (s.padded ? ', the last one padded' : ''));
    if (s.header_len) {
      L.push(`- Header (${s.header_len} bytes): first packet \`${s.first_header}\`` + (
        s.next_header ? `, then \`${s.next_header}\`` : '') + ' (`nn` = packets in the frame, '
        + '`ii` = packet index in the frame, doubled for a 16-bit field, `??` = varies without a pattern)');
      const wide = ['count', 'index'].filter((r) => s[r + '_width'] === 2).map((r) => `packet ${r} ${s[r + '_endian'] ?? 'None'}-endian`);
      if (wide.length) L.push(`- 16-bit header fields: ${wide.join(', ')}`);
    } else {
      L.push('- No per-packet header: the image bytes are sent as they are');
    }
    if (s.header_packet) {
      const lf = s.length_field;
      const where = s.header_inline
        ? `- Command at the start of each frame's first packet (${s.header_packet.split(/\s+/).filter(Boolean).length} bytes, `
          + 'the pixels follow in the same packet)'
        : '- Command packet before each frame';
      L.push(`${where}: \`${s.header_packet}\` (\`xx\`/\`yy\` = position, \`ww\`/\`hh\` = `
        + 'size, `ex`/`ey` = end position, `rr` = packed region, `ll` = byte count' + (
          lf ? ` as ${8 * lf.width}-bit ${lf.endian}-endian` : '') + ', `??` = varies)');
    }
    if (s.ack) {
      const a = s.ack;
      L.push(`- Ack: \`${a.payload}\` on EP 0x${hex2(a.endpoint)}, ${a.count}x `
        + `(frames ${j(a.frames)})`);
    }
    L.push('');
  }
  return L;
}

function _handshake(proto) {
  const L = ['## Handshake (sent once, before the first action)', '',
    'Host→device messages captured before your first action marker that are not background polls '
    + 'and are never sent again later: what the vendor app sends when it opens the device. The '
    + 'generated driver replays them in this order in `open()` and checks each reply against '
    + '*Expected* (`??` bytes are a session token or a checksum and are not compared; a checksum is '
    + 'verified instead). Each message was seen once, so a byte that changes from session to session '
    + 'but is never reused looks constant here: pass `check=False` if a replay is refused.', '',
    '| Step | Channel | Request | Frame | Reply | Frame | Expected |', '|---|---|---|---|---|---|---|'];
  for (const s of proto.handshake) {
    const chan = _chan(s.endpoint, s.xfer_type, s.setup ? fromHex(s.setup) : null);
    const req = s.read ? '(control read)' : `\`${s.request}\``;
    const rep = s.reply ? [`\`${s.reply}\``, s.reply_frame, `\`${s.expect}\``] : ['none', '-', '-'];
    L.push(`| ${s.step} | ${chan} | ${req} | ${s.frame} | ${rep[0]} | ${rep[1]} | ${rep[2]} |`);
  }
  L.push('');
  for (const s of proto.handshake) {
    if (s.retries && s.retries.length) {
      const got = s.retries.map((r) => `frame ${r.frame} (${r.reply ? 'reply `' + r.reply + '`' : 'no reply'})`).join(', ');
      L.push(`- Step ${s.step} was sent ${s.retries.length + 1} times in a row: ${got}, then answered `
        + `in frame ${s.reply ? s.reply_frame : '-'}. The driver resends it up to `
        + `${s.retries.length + 1} times when the reply times out or differs from *Expected*.`);
    }
    if (s.step === 1 && s.reopens && s.reopens.length) {
      const at = s.reopens.map((r) => `frame ${r.frame} (${r.time} s)`).join(', ');
      L.push(`- The app sent the whole handshake again later, starting at ${at}: it reopened the `
        + 'session (the device woke up or reconnected). Those messages are left out of the actions; '
        + 'call `open()` again when the device stops answering after sleep or a replug.');
    }
    if (s.branches && (s.branches.cases instanceof Map ? s.branches.cases.size : Object.keys(s.branches.cases).length)) {
      L.push(..._branch_lines(s));
    }
    for (const u of s.uses) {
      L.push(`- Step ${s.step} request bytes ${u.offset}-${u.offset + u.width - 1} repeat `
        + `bytes ${u.reply_offset}-${u.reply_offset + u.width - 1} of the reply to step `
        + `${u.step}: a session token or device id; the driver copies them from the live reply.`);
    }
    for (const t of s.tokens) {
      for (const u of t.used_by.filter((x) => 'command' in x)) {
        const pk = u.packet ? ` (packet ${u.packet + 1})` : '';
        L.push(`- Command \`${u.command}\`${pk} bytes ${u.offset}-${u.offset + t.width - 1} `
          + `repeat bytes ${t.reply_offset}-${t.reply_offset + t.width - 1} of the reply `
          + `to step ${s.step}; the driver fills them in from the live reply.`);
      }
    }
    for (const e of s.echoes) {
      L.push(`- Step ${s.step} reply bytes ${e.offset}-${e.offset + e.width - 1} echo request `
        + `bytes ${e.query_offset}-${e.query_offset + e.width - 1}.`);
    }
  }
  // set of (kind, algo, covers) tuples, insertion order kept
  const cks = [];
  const seenCk = new Set();
  for (const s of proto.handshake) {
    for (const [k, c] of [['request', s.request_checksum], ['reply', s.reply_checksum]]) {
      if (!c) continue;
      const key = `${k}|${c.algo}|${c.covers[0]},${c.covers[1]}`;
      if (!seenCk.has(key)) { seenCk.add(key); cks.push([k, c.algo, c.covers]); }
    }
  }
  for (const kind of ['request', 'reply']) {
    const algos = [...new Set(cks.filter(([k]) => k === kind).map(([, a]) => a))].sort();
    for (const a of algos) {
      L.push(`- Every handshake ${kind} ends in \`${a}\` of the bytes before it`
        + (cks.some(([k, x, c]) => k === kind && x === a && c[0]) ? ' (from byte 1)' : '')
        + (kind === 'request' ? '; the driver recomputes it.' : '; the driver checks it.'));
    }
  }
  L.push('');
  return L;
}

function _branch_lines(s) {
  const br = s.branches;
  const off = br.offset;
  const def = br.default;
  const L = [`- Step ${s.step} branches on reply byte ${off}: what the app sent next depended on it.`];
  for (const [v, c] of dict_entries(br.cases)) {
    const seen = `seen ${c.count}x (reply frame${c.frames.length > 1 ? 's' : ''} ` + j(c.frames) + ')';
    const then = c.main ? 'the steps after it in the table'
      : c.steps.map((x) => `\`${x.request}\` (frame ${x.frame}, reply \`${x.expect || 'none'}\`)`).join(', then ');
    L.push(`  - \`${v}\`, ${seen}: ${then}`);
  }
  L.push(`  The driver reads byte ${off} of the live reply and takes the matching branch; a value the `
    + `capture never showed falls back to the most common one (\`${def}\`). The byte is \`??\` in `
    + '*Expected*, since it is the answer the app checks, not a fixed byte.');
  return L;
}

function _observations(proto) {
  const obs = proto.observations;
  const hit = obs.filter((o) => o.matched && o.matched.length).length;
  const L = ['## Observations (what the vendor app showed)', '',
    '`seen` markers note a value the vendor app displayed; times are seconds after the first captured '
    + `packet (Wireshark's \`frame.time_relative\`). ${hit} of ${obs.length} matched a reply byte. A reading is `
    + 'only named when every observation of that name near one of its replies fits the same formula; '
    + 'an unmatched one had no reply within 1 s, or fits no reading (or several).', '',
    '| Marker | At | Name | Value | Matched |', '|---|---|---|---|---|'];
  for (const o of obs) {
    L.push(`| ${o.label} | ${fmt_g(o.time)} s | ${o.name} | ${_shown(o.value)} | `
      + `${o.matched && o.matched.length ? o.matched.join(', ') : 'no'} |`);
  }
  L.push('');
  return L;
}

const sameObs = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Up to 8 observations; for a mode, the first of every label is always among them. */
function _evidence(f) {
  if (!isTable(f.table)) return f.observed.slice(0, 8);
  const first = new Map();
  for (const x of f.observed) if (!first.has(x[0])) first.set(x[0], x);
  const firsts = [...first.values()];
  const keep = firsts.concat(f.observed.filter((x) => !firsts.some((y) => sameObs(x, y))));
  return keep.slice(0, Math.max(8, first.size)).sort((a, b) => a[3] - b[3]);
}

function _shown(v) {
  return typeof v === 'string' ? v : fmt_g(v);
}

function _chan(endpoint, xfer_type, setup = null) {
  const c = `${xname(xfer_type)} EP 0x${hex2(endpoint)}`;
  return c + (setup && setup.length ? `, setup \`${hex(setup, ' ')}\`` : '');
}

function _responses(proto) {
  const L = ['## Device responses', '',
    'Device→host data that answers a host query: the reply to a command, to a background poll, or '
    + 'to a control read such as GET_REPORT. Each reply is the IN transfer that follows its query '
    + '(after the typical delay for that query); `= query byte N` means the reply repeats that byte '
    + 'of the query, and a *reading* varies on its own: only its observed range is claimed.', ''];
  for (const r of proto.responses) {
    const what = { command: 'command', background: 'background poll', 'control read': 'control read' }[r.source];
    L.push(`### Reply to \`${r.query}\` (${what})`, '');
    if (r.query_payload) {
      L.push(`- Query: ${_chan(r.query_endpoint, r.query_xfer_type, r.query_setup)}, \`${r.query_payload}\``
        + (r.packet ? ` (packet ${r.packet + 1} of the transaction)` : ''));
    } else {
      L.push(`- Query: ${_chan(r.query_endpoint, r.query_xfer_type, r.query_setup)}`);
    }
    L.push(`- Reply: ${_chan(r.endpoint, r.xfer_type)}, ${r.length} bytes, typically ${fmt_g(r.latency_ms)} ms after the query`,
      `- Answered: ${r.answered} of ${r.queries} queries`,
      `- Explained: ${r.explained} of ${r.length} bytes` + (r.explained === r.length ? '' : ' (the rest are readings)'),
      '', '| Byte | Role | Encoding |', '|---|---|---|');
    const fields = [...r.fields];
    while (fields.length) {
      const f = fields.shift();
      const run = [f];
      while (f.kind === 'reading' && f.width === 1 && fields.length && fields[0].kind === 'reading'
        && fields[0].width === 1 && fields[0].offset === run[run.length - 1].offset + 1) {
        run.push(fields.shift());
      }
      if (run.length >= 4) { // a block of independent byte readings: one row
        const lo = Math.min(...run.map((x) => x.limits[0]));
        const hi = Math.max(...run.map((x) => x.limits[1]));
        L.push(`| ${f.offset}-${run[run.length - 1].offset} | reading | \`u8 readings, seen ${lo}..${hi}\` |`);
        continue;
      }
      for (const g of run) {
        const span = g.width > 1 ? `${g.offset}-${g.offset + g.width - 1}` : `${g.offset}`;
        L.push(`| ${span} | ${g.kind} | \`${g.describe()}\` |`);
      }
    }
    for (const f of r.fields.filter((x) => x.name)) {
      const span = f.width > 1 ? `bytes ${f.offset}-${f.offset + f.width - 1}` : `byte ${f.offset}`;
      const kind = `${f.signed ? 'i' : 'u'}${8 * f.width}` + (f.width > 1 ? f.endian : '');
      let what2;
      if (isTable(f.table)) {
        const bits = f.bit_width ? `, bits ${f.bit_offset}-${f.bit_offset + f.bit_width - 1}` : '';
        what2 = `(byte ${f.offset}${bits}) is a mode, one raw value per label the app showed: \``
          + dict_items(f.table).map(([k, v]) => `0x${hex2(k)} = ${v}`).join(', ') + '`';
      } else if (f.bit_width === 1) {
        what2 = `(byte ${f.offset}, bit ${f.bit_offset}) is on when the bit is 1`;
      } else if (f.bit_width) {
        what2 = `(byte ${f.offset}, bits ${f.bit_offset}-${f.bit_offset + f.bit_width - 1}) is the number itself`;
      } else {
        what2 = `(${span}, ${kind}) = \`${formula(f.scale, f.bias)}\``;
      }
      L.push('', `\`${f.name}\` ${what2}, from ${f.observed.length} observation(s) of the vendor app's display:`, '',
        '| App showed | Marker at | Raw | Reply frame |', '|---|---|---|---|');
      for (const [v, raw, fr, t] of _evidence(f)) {
        const shown = f.bit_width === 1 ? ['off', 'on'][Number(v)] : _shown(v);
        L.push(`| ${f.name} ${shown} | ${fmt_g(t)} s | ${isTable(f.table) ? `0x${hex2(raw)}` : raw} | ${fr} |`);
      }
    }
    const shown = r.samples.slice(0, 8);
    L.push('', 'Evidence' + (r.answered > shown.length ? ` (first ${shown.length} of ${r.answered}):` : ':'), '',
      '| Action | Query frame | Reply | Reply frame |', '|---|---|---|---|');
    for (const [label, qf, hx, rf] of shown) L.push(`| ${label || '-'} | ${qf} | \`${hx}\` | ${rf} |`);
    for (const n of r.notes || []) L.push(`\n> Note: ${n}`);
    L.push('');
  }
  return L;
}
