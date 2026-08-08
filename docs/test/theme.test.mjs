// node --test test/theme.test.mjs
// applyAccent needs a DOM, so only the pure helpers are covered here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseHex, hexToInt, lighten, DEFAULT_ACCENT } from '../theme.js';

test('accepts six-digit hex and lowercases it', () => {
  assert.equal(normaliseHex('#D8FF2F'), '#d8ff2f');
  assert.equal(normaliseHex('  #abcdef '), '#abcdef');
});

test('rejects anything else', () => {
  assert.equal(normaliseHex('#fff'), null, 'shorthand is not accepted');
  assert.equal(normaliseHex('red'), null);
  assert.equal(normaliseHex('#gggggg'), null);
  assert.equal(normaliseHex(''), null);
  assert.equal(normaliseHex(null), null);
});

test('hex converts to the integer three.js wants', () => {
  assert.equal(hexToInt('#d8ff2f'), 0xd8ff2f);
  assert.equal(hexToInt('#000000'), 0);
  assert.equal(hexToInt('nonsense'), parseInt(DEFAULT_ACCENT.slice(1), 16), 'falls back');
});

test('lighten moves towards white without overflowing', () => {
  assert.equal(lighten('#000000', 0), '#000000');
  assert.equal(lighten('#ffffff', 0.5), '#ffffff', 'white stays white');
  const lit = lighten('#808080', 0.5);
  assert.match(lit, /^#[0-9a-f]{6}$/);
  assert.ok(parseInt(lit.slice(1, 3), 16) > 0x80, 'brighter than the input');
});

test('lighten keeps six digits for dark colours', () => {
  assert.equal(lighten('#000102', 0).length, 7, 'no dropped leading zeroes');
});
