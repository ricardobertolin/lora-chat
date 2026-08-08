// Sharing a channel: radio settings plus the passphrase, in one scan.
//
// Getting a second person on the air otherwise means matching frequency,
// spreading factor, bandwidth and passphrase by hand, with no feedback when it
// goes wrong - mismatched settings look exactly like "nobody is there".
//
// The payload is carried in a URL fragment. Fragments are never sent to the
// server, so the passphrase does not leave the two devices. It does land in
// browser history, which is why the app strips it after applying.

export const SETUP_TAG = 'LORA1';

const BANDWIDTHS = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500];

export function validSetup(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Number.isFinite(s.freq) || s.freq < 150 || s.freq > 960) return false;
  if (!Number.isInteger(s.sf) || s.sf < 7 || s.sf > 12) return false;
  if (!Number.isFinite(s.bw) || !BANDWIDTHS.some((b) => Math.abs(b - s.bw) < 0.01)) return false;
  if (!Number.isInteger(s.power) || s.power < -9 || s.power > 22) return false;
  if (s.passphrase !== null && typeof s.passphrase !== 'string') return false;
  return true;
}

// base64url so the result is safe in a URL fragment and in a QR code's
// alphanumeric-ish range without escaping.
export function encodeSetup(setup) {
  if (!validSetup(setup)) throw new Error('invalid channel settings');
  const json = JSON.stringify({
    f: setup.freq,
    s: setup.sf,
    b: setup.bw,
    p: setup.power,
    k: setup.passphrase || '',
  });
  return `${SETUP_TAG}.${toBase64Url(json)}`;
}

export function decodeSetup(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const at = trimmed.indexOf(`${SETUP_TAG}.`);
  if (at < 0) return null;

  const body = trimmed.slice(at + SETUP_TAG.length + 1).split(/[\s&#]/)[0];
  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(body));
  } catch {
    return null;
  }
  const setup = {
    freq: Number(parsed.f),
    sf: Number(parsed.s),
    bw: Number(parsed.b),
    power: Number(parsed.p),
    passphrase: typeof parsed.k === 'string' && parsed.k.length ? parsed.k : null,
  };
  return validSetup(setup) ? setup : null;
}

// A link rather than a bare code, so any camera app can open it and the phone
// does not need a QR reader of its own.
export function buildLink(baseUrl, setup) {
  const url = new URL(baseUrl);
  url.hash = `s=${encodeSetup(setup)}`;
  return url.toString();
}

export function setupFromHash(hash) {
  if (typeof hash !== 'string') return null;
  const m = /[#&]s=([^&]+)/.exec(hash);
  return m ? decodeSetup(decodeURIComponent(m[1])) : null;
}

// The board commands that put the radio on these settings. Frequency last:
// each one is broadcast to the other end before being applied, and the earlier
// changes need to have landed first.
export function setupCommands(setup) {
  return [
    `/bw ${setup.bw}`,
    `/power ${setup.power}`,
    `/sf ${setup.sf}`,
    `/freq ${setup.freq}`,
  ];
}

export function describeSetup(setup) {
  return (
    `${setup.freq} MHz, SF${setup.sf}, BW ${setup.bw} kHz, ${setup.power} dBm` +
    (setup.passphrase ? ', with passphrase' : ', no encryption')
  );
}

function toBase64Url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
