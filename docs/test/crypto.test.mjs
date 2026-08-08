// node --test test/crypto.test.mjs
// Node's webcrypto is the same API the browser uses, so this exercises the real
// implementation rather than a stub.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  isEncrypted,
  encryptedLength,
  ENC_PREFIX,
} from '../crypto.js';

const KEY = await deriveKey('correct horse battery staple');

test('round-trips a message', async () => {
  const out = await encryptMessage(KEY, 'meet at the bridge');
  assert.ok(out.startsWith(ENC_PREFIX));
  assert.equal(await decryptMessage(KEY, out), 'meet at the bridge');
});

test('ciphertext does not leak the plaintext', async () => {
  const out = await encryptMessage(KEY, 'bridge');
  assert.ok(!out.includes('bridge'));
});

test('the same plaintext encrypts differently each time', async () => {
  const a = await encryptMessage(KEY, 'same words');
  const b = await encryptMessage(KEY, 'same words');
  assert.notEqual(a, b, 'a fresh IV must be used per message');
  assert.equal(await decryptMessage(KEY, a), 'same words');
  assert.equal(await decryptMessage(KEY, b), 'same words');
});

test('a different passphrase cannot read it', async () => {
  const other = await deriveKey('wrong passphrase');
  const out = await encryptMessage(KEY, 'secret');
  assert.equal(await decryptMessage(other, out), null);
});

test('the same passphrase derives the same key on both ends', async () => {
  const again = await deriveKey('correct horse battery staple');
  const out = await encryptMessage(KEY, 'shared');
  assert.equal(await decryptMessage(again, out), 'shared');
});

test('tampering is detected', async () => {
  const out = await encryptMessage(KEY, 'transfer 100');
  const body = out.slice(ENC_PREFIX.length + 1);
  // Flip a character in the middle of the ciphertext.
  const at = Math.floor(body.length / 2);
  const flipped = body[at] === 'A' ? 'B' : 'A';
  const tampered = `${ENC_PREFIX} ${body.slice(0, at)}${flipped}${body.slice(at + 1)}`;
  assert.equal(await decryptMessage(KEY, tampered), null);
});

test('truncation is detected', async () => {
  const out = await encryptMessage(KEY, 'a message worth cutting short');
  assert.equal(await decryptMessage(KEY, out.slice(0, out.length - 8)), null);
});

test('malformed input returns null rather than throwing', async () => {
  assert.equal(await decryptMessage(KEY, '!ENC not-valid-base64!!!'), null);
  assert.equal(await decryptMessage(KEY, '!ENC AAAA'), null, 'shorter than the IV');
  assert.equal(await decryptMessage(KEY, 'plain text'), null);
});

test('survives unicode and emoji', async () => {
  const msg = 'ola, tudo bem? ~ acentuacao e emoji 📡🔒';
  assert.equal(await decryptMessage(KEY, await encryptMessage(KEY, msg)), msg);
});

test('handles an empty message', async () => {
  assert.equal(await decryptMessage(KEY, await encryptMessage(KEY, '')), '');
});

test('isEncrypted only matches the marker', () => {
  assert.ok(isEncrypted('!ENC abc'));
  assert.ok(!isEncrypted('!POS 1 2 3'));
  assert.ok(!isEncrypted('hello'));
  assert.ok(!isEncrypted(null));
});

test('a rejected passphrase is not silently accepted', async () => {
  await assert.rejects(() => deriveKey(''), /passphrase required/);
});

test('length estimate matches reality', async () => {
  const plain = 'a'.repeat(40);
  const out = await encryptMessage(KEY, plain);
  assert.equal(out.length, encryptedLength(40));
});

test('a realistic message still fits a LoRa packet', async () => {
  const out = await encryptMessage(KEY, 'x'.repeat(150));
  // The firmware prefixes "NAME: " and the SX1262 tops out at 255 bytes.
  assert.ok(out.length + 6 < 255, `encrypted length ${out.length} must leave room`);
});
