// node --test test/media.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  airtimeMs,
  transferEstimate,
  formatDuration,
  ditherToBitmap,
  bitmapToGray,
  packImage,
  unpackImage,
  encodeAdpcm,
  decodeAdpcm,
  packAudio,
  unpackAudio,
  downsample,
  floatToInt16,
  bytesToBase64,
  base64ToBytes,
} from '../media.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} +/- ${tol}`);

// ------------------------------------------------------------------ airtime

test('airtime matches the published figures for SF9', () => {
  // A 20-byte payload at SF9/125k/CR4-7 is about 226 ms.
  near(airtimeMs(20, { sf: 9 }), 226, 10, 'SF9 20B');
  // A full 255-byte packet is about 1.7 s.
  near(airtimeMs(255, { sf: 9 }), 1720, 60, 'SF9 255B');
});

test('airtime grows with spreading factor', () => {
  const at = (sf) => airtimeMs(20, { sf });
  assert.ok(at(7) < at(9) && at(9) < at(12));
  // SF12 is roughly seven times SF9 for a short message.
  near(at(12) / at(9), 7, 1.2, 'SF12/SF9 ratio');
});

test('wider bandwidth is faster', () => {
  assert.ok(airtimeMs(100, { sf: 9, bw: 250 }) < airtimeMs(100, { sf: 9, bw: 125 }));
});

test('transfer estimate counts fragments and scales with size', () => {
  const small = transferEstimate(1024, { sf: 9 });
  assert.ok(small.fragments > 1, 'a 1 kB image needs several fragments');
  // ~1 kB at SF9 lands in the region of ten to twenty seconds.
  assert.ok(small.ms > 8000 && small.ms < 25000, `got ${small.ms} ms`);

  const big = transferEstimate(10240, { sf: 9 });
  assert.ok(big.fragments > small.fragments);
  assert.ok(big.ms > small.ms * 5, 'ten times the data takes much longer');

  assert.ok(transferEstimate(1024, { sf: 7 }).ms < small.ms, 'SF7 is quicker');
});

test('duration formatting', () => {
  assert.equal(formatDuration(4200), '4s');
  assert.equal(formatDuration(65000), '1m 05s');
});

// ------------------------------------------------------------------- image

test('dithering packs one bit per pixel', () => {
  const w = 16, h = 8;
  const gray = new Uint8ClampedArray(w * h).fill(255);
  const bits = ditherToBitmap(gray, w, h);
  assert.equal(bits.length, (w * h) / 8);
  assert.ok([...bits].every((b) => b === 0xff), 'all-white becomes all ones');
});

test('black stays black, white stays white', () => {
  const bits = ditherToBitmap(new Uint8ClampedArray(64).fill(0), 8, 8);
  assert.ok([...bits].every((b) => b === 0), 'all-black becomes all zeroes');
});

test('mid grey dithers to roughly half the pixels', () => {
  const w = 32, h = 32;
  const bits = ditherToBitmap(new Uint8ClampedArray(w * h).fill(128), w, h);
  let lit = 0;
  for (const b of bits) lit += b.toString(2).replace(/0/g, '').length;
  const ratio = lit / (w * h);
  assert.ok(ratio > 0.35 && ratio < 0.65, `50% grey gave ${(ratio * 100).toFixed(0)}% lit`);
});

test('a gradient survives as varying density', () => {
  const w = 64, h = 8;
  const gray = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = (x / (w - 1)) * 255;
  const bits = ditherToBitmap(gray, w, h);
  const count = (from, to) => {
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = from; x < to; x++) {
        const i = y * w + x;
        if (bits[i >> 3] & (0x80 >> (i & 7))) n++;
      }
    }
    return n;
  };
  assert.ok(count(48, 64) > count(0, 16), 'the bright end is denser than the dark end');
});

test('bitmap unpacks back to a two-level image', () => {
  const w = 8, h = 2;
  const gray = new Uint8ClampedArray(w * h).fill(255);
  const back = bitmapToGray(ditherToBitmap(gray, w, h), w, h);
  assert.equal(back.length, w * h);
  assert.ok([...back].every((v) => v === 0 || v === 255));
});

test('image header round-trips geometry', () => {
  const bits = ditherToBitmap(new Uint8ClampedArray(128 * 64).fill(200), 128, 64);
  const packed = packImage(bits, 128, 64);
  assert.equal(packed.length, 7 + 1024, '128x64 is 1024 bytes plus header');
  const back = unpackImage(packed);
  assert.equal(back.w, 128);
  assert.equal(back.h, 64);
  assert.deepEqual([...back.bytes], [...bits]);
});

test('unpackImage rejects foreign data', () => {
  assert.equal(unpackImage(new Uint8Array([1, 2, 3])), null);
  assert.equal(unpackImage(new Uint8Array(20)), null, 'wrong magic');
});

// ------------------------------------------------------------------- audio

test('adpcm halves the byte count', () => {
  const samples = new Int16Array(1000);
  assert.equal(encodeAdpcm(samples).length, 500, '4 bits per sample');
});

test('adpcm round-trips a sine wave with bounded error', () => {
  const n = 2000;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.round(Math.sin(i / 8) * 12000);

  const back = decodeAdpcm(encodeAdpcm(samples), n);
  let err = 0;
  let signal = 0;
  for (let i = 0; i < n; i++) {
    err += (back[i] - samples[i]) ** 2;
    signal += samples[i] ** 2;
  }
  const snr = 10 * Math.log10(signal / err);
  assert.ok(snr > 20, `ADPCM SNR was ${snr.toFixed(1)} dB, expected over 20`);
});

test('adpcm tracks silence without drifting', () => {
  const back = decodeAdpcm(encodeAdpcm(new Int16Array(500)), 500);
  assert.ok([...back].every((v) => Math.abs(v) < 40), 'silence stays near zero');
});

test('audio header round-trips', () => {
  const bytes = encodeAdpcm(new Int16Array(800));
  const back = unpackAudio(packAudio(bytes, 4000, 800));
  assert.equal(back.sampleRate, 4000);
  assert.equal(back.sampleCount, 800);
  assert.equal(back.bytes.length, bytes.length);
});

test('unpackAudio rejects foreign data', () => {
  assert.equal(unpackAudio(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9])), null);
});

test('downsampling averages rather than dropping samples', () => {
  const input = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
  const out = downsample(input, 8000, 4000);
  assert.equal(out.length, 4);
  for (const v of out) near(v, 0.5, 0.001, 'averaged pair');
});

test('downsampling to a higher rate is a no-op', () => {
  const input = new Float32Array([0.1, 0.2, 0.3]);
  assert.deepEqual([...downsample(input, 4000, 8000)], [...input]);
});

test('float to int16 clamps', () => {
  const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2]));
  assert.deepEqual([...out], [0, 32767, -32767, 32767, -32768]);
});

// ------------------------------------------------------------------ base64

test('base64 round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
});
