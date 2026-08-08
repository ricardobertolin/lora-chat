// Parses the serial lines lora_chat prints. Kept free of browser APIs so it can
// be unit-tested under node (see test/protocol.test.mjs).
//
// The firmware emits:
//   === LoRa chat - this board is "8424" ===
//   on 915.0 MHz, SF9. Type a message and press Enter.
//   >> hello there
//   << 3D2C: hi back  (RSSI -23.0 dBm, SNR 11.5 dB)
//   !! send failed, code -706

const BANNER_RE = /^===\s*LoRa chat - this board is "(.+)"\s*===$/;
const RADIO_RE = /^on\s+([\d.]+)\s+MHz,\s+SF(\d+)\./;
// Greedy payload plus an anchored tail, so a message containing "  (RSSI" of
// its own still splits at the real suffix the firmware appended.
const RECV_RE = /^<<\s(.*)\s{2}\(RSSI\s(-?[\d.]+)\sdBm,\sSNR\s(-?[\d.]+)\sdB\)$/;
const SENT_RE = /^>>\s(.*)$/;
const ERROR_RE = /^!!\s(.*)$/;

export function parseLine(raw) {
  const line = String(raw).replace(/\r/g, '').trim();
  if (!line) return null;

  const banner = BANNER_RE.exec(line);
  if (banner) return { kind: 'banner', node: banner[1], text: line };

  const radio = RADIO_RE.exec(line);
  if (radio) {
    return {
      kind: 'radio',
      freq: parseFloat(radio[1]),
      sf: parseInt(radio[2], 10),
      text: line,
    };
  }

  const recv = RECV_RE.exec(line);
  if (recv) {
    const { from, text } = splitSender(recv[1]);
    return {
      kind: 'recv',
      from,
      text,
      rssi: parseFloat(recv[2]),
      snr: parseFloat(recv[3]),
    };
  }

  const sent = SENT_RE.exec(line);
  if (sent) return { kind: 'sent', text: sent[1] };

  const err = ERROR_RE.exec(line);
  if (err) return { kind: 'error', text: err[1] };

  return { kind: 'system', text: line };
}

// Payloads are "NAME: message". NODE_NAME has no colon in it, so the first
// ": " is the separator; anything else is treated as an unnamed message.
function splitSender(payload) {
  const at = payload.indexOf(': ');
  if (at <= 0) return { from: null, text: payload };
  return { from: payload.slice(0, at), text: payload.slice(at + 2) };
}

// -80 dBm and up is a comfortable link; below -100 is nearly out of range.
export function signalLevel(rssi) {
  if (rssi === null || rssi === undefined) return 'none';
  if (rssi >= -80) return 'good';
  if (rssi >= -100) return 'fair';
  return 'weak';
}

// Splits a byte stream into lines across chunk boundaries.
export class LineSplitter {
  constructor(onLine) {
    this.onLine = onLine;
    this.buf = '';
    this.decoder = new TextDecoder();
  }

  push(chunk) {
    this.buf += this.decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.trim()) this.onLine(line);
    }
    // A board mid-sentence can leave a partial line buffered forever; cap it so
    // binary noise on a wrong baud rate cannot grow without bound.
    if (this.buf.length > 4096) this.buf = '';
  }
}
