// node --test test/channel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSetup,
  decodeSetup,
  validSetup,
  buildLink,
  setupFromHash,
  setupCommands,
  describeSetup,
  SETUP_TAG,
} from '../channel.js';

const base = { freq: 915, sf: 9, bw: 125, power: 14, passphrase: 'correct horse' };

test('round-trips a full setup', () => {
  assert.deepEqual(decodeSetup(encodeSetup(base)), base);
});

test('round-trips without a passphrase', () => {
  const open = { ...base, passphrase: null };
  assert.deepEqual(decodeSetup(encodeSetup(open)), open);
});

test('an empty passphrase decodes as none rather than empty string', () => {
  assert.equal(decodeSetup(encodeSetup({ ...base, passphrase: '' })).passphrase, null);
});

test('survives unicode and spaces in the passphrase', () => {
  const tricky = { ...base, passphrase: 'sen~ha com espaço e emoji 🔒' };
  assert.equal(decodeSetup(encodeSetup(tricky)).passphrase, tricky.passphrase);
});

test('the payload is url and QR safe', () => {
  const code = encodeSetup(base);
  assert.match(code, new RegExp(`^${SETUP_TAG}\\.[A-Za-z0-9\\-_]+$`));
});

test('rejects settings the radio cannot do', () => {
  assert.equal(validSetup({ ...base, sf: 13 }), false, 'SF out of range');
  assert.equal(validSetup({ ...base, sf: 9.5 }), false, 'SF must be whole');
  assert.equal(validSetup({ ...base, freq: 2400 }), false, 'frequency out of range');
  assert.equal(validSetup({ ...base, bw: 300 }), false, 'not a real bandwidth step');
  assert.equal(validSetup({ ...base, power: 30 }), false, 'power out of range');
  assert.equal(validSetup(null), false);
  assert.throws(() => encodeSetup({ ...base, sf: 99 }), /invalid/);
});

test('decode refuses junk instead of throwing', () => {
  assert.equal(decodeSetup('hello'), null);
  assert.equal(decodeSetup('LORA1.@@@@'), null);
  assert.equal(decodeSetup('LORA1.' + Buffer.from('{"f":1}').toString('base64url')), null,
    'valid base64 but not a usable setup');
  assert.equal(decodeSetup(null), null);
  assert.equal(decodeSetup(''), null);
});

test('a link carries the setup in the fragment, not the query', () => {
  const link = buildLink('https://example.com/app/', base);
  assert.ok(link.includes('#s='), 'must be a fragment so it never reaches a server');
  assert.ok(!link.includes('?'), 'nothing in the query string');
  assert.deepEqual(setupFromHash(new URL(link).hash), base);
});

test('reads a setup out of a hash with other parameters', () => {
  assert.deepEqual(setupFromHash(`#a=1&s=${encodeSetup(base)}`), base);
  assert.equal(setupFromHash('#nothing=here'), null);
  assert.equal(setupFromHash(''), null);
});

test('decodes a payload embedded in a scanned URL', () => {
  const scanned = `https://example.com/app/#s=${encodeSetup(base)}`;
  assert.deepEqual(decodeSetup(scanned), base);
});

test('commands set frequency last', () => {
  const cmds = setupCommands(base);
  assert.deepEqual(cmds, ['/bw 125', '/power 14', '/sf 9', '/freq 915']);
  assert.ok(cmds[cmds.length - 1].startsWith('/freq'), 'frequency moves the channel, so it goes last');
});

test('description mentions whether encryption is on', () => {
  assert.match(describeSetup(base), /915 MHz, SF9, BW 125 kHz, 14 dBm, with passphrase/);
  assert.match(describeSetup({ ...base, passphrase: null }), /no encryption/);
});
