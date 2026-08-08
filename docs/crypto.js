// End-to-end encryption, done in the browser so the firmware stays a dumb pipe.
//
// A message goes out as:
//   !ENC <base64 of 12-byte IV || AES-GCM ciphertext || 16-byte tag>
// which the board relays as ordinary text. AES-GCM authenticates as well as
// encrypts, so a tampered or wrong-key packet fails to decrypt rather than
// producing garbage.
//
// What this does NOT hide: the sender name, which the firmware prefixes outside
// the ciphertext, and the fact that a transmission happened at all.

export const ENC_PREFIX = '!ENC';

const IV_BYTES = 12;      // 96 bits, the size AES-GCM is specified around
const KEY_BITS = 256;
const ITERATIONS = 200000;

// A fixed salt is a real weakness - it means the passphrase alone determines
// the key, so identical passphrases across users give identical keys and
// precomputation is possible. Both ends must derive the same key without
// exchanging anything first, which rules out a random per-conversation salt.
// The iteration count and a strong passphrase are what carry the security here.
const SALT = 'lora-chat/v1/pbkdf2-salt';

const subtle = () => globalThis.crypto.subtle;

export async function deriveKey(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('passphrase required');
  }
  const base = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(SALT),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncrypted(text) {
  return typeof text === 'string' && text.trim().startsWith(ENC_PREFIX);
}

export async function encryptMessage(key, plaintext) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const packed = new Uint8Array(IV_BYTES + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), IV_BYTES);
  return `${ENC_PREFIX} ${toBase64(packed)}`;
}

// Returns the plaintext, or null for anything that does not authenticate:
// wrong key, tampering, truncation or malformed base64.
export async function decryptMessage(key, payload) {
  if (!isEncrypted(payload)) return null;
  const b64 = payload.trim().slice(ENC_PREFIX.length).trim();

  let packed;
  try {
    packed = fromBase64(b64);
  } catch {
    return null;
  }
  if (packed.length <= IV_BYTES) return null;

  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) },
      key,
      packed.slice(IV_BYTES)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// Encryption roughly doubles a short message on air: 28 bytes of IV and tag,
// then base64's 4/3 expansion on top.
export function encryptedLength(plaintextBytes) {
  const packed = IV_BYTES + plaintextBytes + 16;  // IV, ciphertext, GCM tag
  const base64 = 4 * Math.ceil(packed / 3);       // padded to whole 4-char groups
  return base64 + ENC_PREFIX.length + 1;          // marker and its space
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
