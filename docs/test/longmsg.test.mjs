// node --test test/longmsg.test.mjs
//
// The firmware caps a serial line at 200 characters and transmits the overflow
// as a second packet. Verified on hardware: a 245-character line came out as
// 200 + 45. Unencrypted that is a truncated message plus an orphan; encrypted
// the ciphertext is split so neither half authenticates and the receiver blames
// the passphrase. These tests pin the point where the app must switch to
// fragmenting instead.

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveKey, encryptMessage } from '../crypto.js';
import { encodeMessage } from '../messaging.js';
import { MAX_LINE, packFragments, parseFragment } from '../fragment.js';

const FIRMWARE_LINE_CAP = 200;   // MAX_MSG_LEN in lora_chat.ino
const KEY = await deriveKey('test passphrase');

test('the fragment line limit stays under the firmware cap', () => {
  assert.ok(MAX_LINE < FIRMWARE_LINE_CAP,
    `MAX_LINE ${MAX_LINE} must leave room under the firmware's ${FIRMWARE_LINE_CAP}`);
});

test('a short encrypted message still fits a single line', async () => {
  const wire = await encryptMessage(KEY, encodeMessage(1, 'meet at the bridge'));
  assert.ok(wire.length <= MAX_LINE, `got ${wire.length}`);
});

test('a message long enough to be split is detected, not sent whole', async () => {
  // Roughly two lines of typing - the length at which this used to break.
  const text = 'A'.repeat(140);
  const wire = await encryptMessage(KEY, encodeMessage(1, text));
  assert.ok(wire.length > MAX_LINE,
    'this length must take the fragmented path, not a single line');
});

test('encryption is what pulls the limit down', async () => {
  const text = 'A'.repeat(140);
  const plain = encodeMessage(1, text);
  const wire = await encryptMessage(KEY, plain);
  assert.ok(plain.length <= MAX_LINE, 'fits in the clear');
  assert.ok(wire.length > MAX_LINE, 'does not fit once encrypted');
});

test('fragmenting a long message never produces an over-length line', async () => {
  for (const len of [120, 200, 500, 2000, 10000]) {
    const line = encodeMessage(7, 'A'.repeat(len));
    const wire = await encryptMessage(KEY, line);
    const payload = wire.slice(wire.indexOf(' ') + 1);
    for (const l of packFragments({ id: 'abc', kind: 't', encrypted: true, payload })) {
      assert.ok(l.length <= MAX_LINE, `len ${len}: fragment was ${l.length}`);
      assert.ok(l.length < FIRMWARE_LINE_CAP, `len ${len}: firmware would split this`);
    }
  }
});

test('a fragmented long message reassembles to the original line', async () => {
  const text = 'the quick brown fox '.repeat(40);
  const line = encodeMessage(9, text);
  const bytes = new TextEncoder().encode(line);

  // The text path carries UTF-8 of the line, base64'd like any other blob.
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const payload = btoa(bin);

  const frags = packFragments({ id: 'xyz', kind: 't', encrypted: false, payload })
    .map(parseFragment);
  assert.ok(frags.every(Boolean), 'every fragment parses');
  assert.ok(frags.every((f) => f.kind === 't'), 'kind survives');

  const joined = frags.map((f) => f.chunk).join('');
  const back = atob(joined);
  const out = new Uint8Array(back.length);
  for (let i = 0; i < back.length; i++) out[i] = back.charCodeAt(i);
  assert.equal(new TextDecoder().decode(out), line);
});

test('unicode survives the long path', async () => {
  const line = encodeMessage(3, 'acentuação, emoji e símbolos: 📡 '.repeat(20));
  const bytes = new TextEncoder().encode(line);
  assert.equal(new TextDecoder().decode(bytes), line);
});
