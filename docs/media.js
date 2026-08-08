// Turning pictures and sound into something a 1.25 kbit/s link can carry.
//
// Images become 1-bit dithered bitmaps: a 128x64 picture is exactly 1024 bytes,
// which is about eleven seconds on air at SF9. Audio becomes 4-bit IMA ADPCM at
// a low sample rate.
//
// The pure maths lives here so it can be tested under node; the parts that need
// a canvas or an AudioContext take those as arguments.

// ---------------------------------------------------------------- airtime ---

// Semtech's LoRa airtime formula. Used to warn before a send rather than
// letting someone queue four minutes of transmission by accident.
export function airtimeMs(payloadBytes, { sf = 9, bw = 125, cr = 7, preamble = 8, crc = true } = {}) {
  const symbolMs = (2 ** sf / (bw * 1000)) * 1000;
  const lowRateOpt = sf >= 11 ? 1 : 0;   // mandatory at 125 kHz for SF11/12
  const crDenom = cr - 4;                // RadioLib's 5..8 maps to 1..4 here

  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * (crc ? 1 : 0);
  const denominator = 4 * (sf - 2 * lowRateOpt);
  const payloadSymbols = 8 + Math.max(Math.ceil(numerator / denominator) * (crDenom + 4), 0);

  return (preamble + 4.25) * symbolMs + payloadSymbols * symbolMs;
}

// What a blob actually costs once fragmented: base64 expansion, per-line
// headers, and the name the firmware prefixes to every packet.
export function transferEstimate(byteLength, { sf = 9, bw = 125, maxLine = 180, headerBytes = 26 } = {}) {
  const base64Chars = 4 * Math.ceil(byteLength / 3);
  const perLine = maxLine - headerBytes;
  const fragments = Math.max(1, Math.ceil(base64Chars / perLine));
  const lastChars = base64Chars - perLine * (fragments - 1);

  const full = airtimeMs(maxLine + 6, { sf, bw });          // +6 for "NAME: "
  const last = airtimeMs(lastChars + headerBytes + 6, { sf, bw });
  return { fragments, bytes: byteLength, ms: full * (fragments - 1) + last };
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// ----------------------------------------------------------------- images ---

// Floyd-Steinberg over a grayscale plane, packed one bit per pixel, MSB first.
// Dithering rather than a plain threshold because at 1 bit a threshold destroys
// every gradient in the picture.
export function ditherToBitmap(gray, w, h) {
  const buf = Float32Array.from(gray);          // copy: error diffusion mutates
  const out = new Uint8Array(Math.ceil((w * h) / 8));

  const at = (x, y) => y * w + x;
  const spread = (x, y, err, factor) => {
    if (x < 0 || x >= w || y >= h) return;
    buf[at(x, y)] += err * factor;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const old = buf[i];
      const bit = old >= 128 ? 1 : 0;
      const err = old - (bit ? 255 : 0);
      if (bit) {
        const p = i;
        out[p >> 3] |= 0x80 >> (p & 7);
      }
      spread(x + 1, y, err, 7 / 16);
      spread(x - 1, y + 1, err, 3 / 16);
      spread(x, y + 1, err, 5 / 16);
      spread(x + 1, y + 1, err, 1 / 16);
    }
  }
  return out;
}

export function bitmapToGray(bytes, w, h) {
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = bytes[i >> 3] & (0x80 >> (i & 7)) ? 255 : 0;
  }
  return out;
}

// Header so the receiver knows the geometry: 'LB1', width and height as 16-bit.
export function packImage(bytes, w, h) {
  const out = new Uint8Array(7 + bytes.length);
  out.set([0x4c, 0x42, 0x31], 0);  // "LB1"
  new DataView(out.buffer).setUint16(3, w, true);
  new DataView(out.buffer).setUint16(5, h, true);
  out.set(bytes, 7);
  return out;
}

export function unpackImage(data) {
  if (data.length < 8 || data[0] !== 0x4c || data[1] !== 0x42 || data[2] !== 0x31) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const w = view.getUint16(3, true);
  const h = view.getUint16(5, true);
  if (!w || !h || data.length - 7 < Math.ceil((w * h) / 8)) return null;
  return { w, h, bytes: data.subarray(7) };
}

// ------------------------------------------------------------------ audio ---

// IMA ADPCM: 4 bits per sample, no tables to ship, decodes to something
// recognisably speech-shaped. Not a speech codec - see the README on why a real
// one would be five times smaller.
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export function encodeAdpcm(samples) {
  let predictor = 0;
  let index = 0;
  const out = new Uint8Array(Math.ceil(samples.length / 2));

  for (let i = 0; i < samples.length; i++) {
    const step = STEP_TABLE[index];
    let diff = samples[i] - predictor;
    let code = 0;
    if (diff < 0) {
      code = 8;  // sign bit
      diff = -diff;
    }
    // Three magnitude bits, testing step, step/2 and step/4 in turn.
    let probe = step;
    for (let mask = 4; mask >= 1; mask >>= 1) {
      if (diff >= probe) {
        code |= mask;
        diff -= probe;
      }
      probe >>= 1;
    }
    // Rebuild delta from the code so encoder and decoder stay in step.
    let delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;

    predictor += code & 8 ? -delta : delta;
    predictor = Math.max(-32768, Math.min(32767, predictor));
    index = Math.max(0, Math.min(88, index + INDEX_TABLE[code]));

    if (i & 1) out[i >> 1] |= code << 4;
    else out[i >> 1] = code;
  }
  return out;
}

export function decodeAdpcm(bytes, sampleCount = bytes.length * 2) {
  let predictor = 0;
  let index = 0;
  const out = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const code = i & 1 ? bytes[i >> 1] >> 4 : bytes[i >> 1] & 0x0f;
    const step = STEP_TABLE[index];

    let delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;

    predictor += code & 8 ? -delta : delta;
    predictor = Math.max(-32768, Math.min(32767, predictor));
    index = Math.max(0, Math.min(88, index + INDEX_TABLE[code]));
    out[i] = predictor;
  }
  return out;
}

// Header: 'LA1', sample rate as 16-bit, sample count as 32-bit.
export function packAudio(bytes, sampleRate, sampleCount) {
  const out = new Uint8Array(9 + bytes.length);
  out.set([0x4c, 0x41, 0x31], 0);  // "LA1"
  const view = new DataView(out.buffer);
  view.setUint16(3, sampleRate, true);
  view.setUint32(5, sampleCount, true);
  out.set(bytes, 9);
  return out;
}

export function unpackAudio(data) {
  if (data.length < 10 || data[0] !== 0x4c || data[1] !== 0x41 || data[2] !== 0x31) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    sampleRate: view.getUint16(3, true),
    sampleCount: view.getUint32(5, true),
    bytes: data.subarray(9),
  };
}

// Simple box-average downsample. Averaging rather than picking every Nth sample
// keeps the aliasing down without a real filter.
export function downsample(input, fromRate, toRate) {
  if (toRate >= fromRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function floatToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
  }
  return out;
}

// --------------------------------------------------------------- base64 ---

export function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
