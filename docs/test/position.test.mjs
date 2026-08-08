// node --test test/position.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodePosition,
  decodePosition,
  isPosition,
  distanceM,
  bearingDeg,
  compassPoint,
  formatDistance,
  formatAge,
  describeRelative,
} from '../position.js';

const near = (actual, expected, tol, what) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what}: got ${actual}, expected ${expected} +/- ${tol}`
  );

test('encodes to six decimal places', () => {
  assert.equal(
    encodePosition({ lat: -23.5505199, lon: -46.6333094, accuracy: 12.4 }),
    '!POS -23.550520 -46.633309 12'
  );
});

test('round-trips', () => {
  const p = { lat: -23.55052, lon: -46.633309, accuracy: 12 };
  assert.deepEqual(decodePosition(encodePosition(p)), p);
});

test('rejects malformed or out-of-range positions', () => {
  assert.equal(decodePosition('hello there'), null);
  assert.equal(decodePosition('!POS 1 2'), null, 'too few fields');
  assert.equal(decodePosition('!POS abc 2 3'), null, 'non-numeric');
  assert.equal(decodePosition('!POS 91 0 5'), null, 'latitude past the pole');
  assert.equal(decodePosition('!POS 0 181 5'), null, 'longitude past the date line');
  assert.equal(decodePosition('!POS 0 0 -1'), null, 'negative accuracy');
  assert.equal(decodePosition(null), null);
});

test('a chat message starting with !POS does not corrupt the peer list', () => {
  assert.ok(isPosition('!POS is how positions are sent'));
  assert.equal(decodePosition('!POS is how positions are sent'), null);
});

test('tolerates extra whitespace', () => {
  assert.deepEqual(decodePosition('  !POS   10.5   -20.25   3  '), {
    lat: 10.5,
    lon: -20.25,
    accuracy: 3,
  });
});

test('one degree at the equator is about 111 km, either axis', () => {
  near(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111195, 50, 'east');
  near(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111195, 50, 'north');
});

test('distance to self is zero', () => {
  assert.equal(distanceM({ lat: -23.5, lon: -46.6 }, { lat: -23.5, lon: -46.6 }), 0);
});

test('distance is symmetric', () => {
  const a = { lat: -23.5505, lon: -46.6333 };
  const b = { lat: -22.9068, lon: -43.1729 };
  near(distanceM(a, b), distanceM(b, a), 0.001, 'symmetry');
  // Sao Paulo to Rio de Janeiro is about 360 km.
  near(distanceM(a, b), 360000, 5000, 'SP-Rio');
});

test('cardinal bearings', () => {
  const o = { lat: 0, lon: 0 };
  near(bearingDeg(o, { lat: 1, lon: 0 }), 0, 0.01, 'north');
  near(bearingDeg(o, { lat: 0, lon: 1 }), 90, 0.01, 'east');
  near(bearingDeg(o, { lat: -1, lon: 0 }), 180, 0.01, 'south');
  near(bearingDeg(o, { lat: 0, lon: -1 }), 270, 0.01, 'west');
});

test('compass points, including wrap past north', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(45), 'NE');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(270), 'W');
  assert.equal(compassPoint(359), 'N', 'wraps to north');
  assert.equal(compassPoint(-90), 'W', 'handles negatives');
});

test('distance formatting switches units', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(850.4), '850 m');
  assert.equal(formatDistance(1234), '1.23 km');
  assert.equal(formatDistance(45678), '46 km');
});

test('age formatting', () => {
  assert.equal(formatAge(5000), '5s ago');
  assert.equal(formatAge(120000), '2m ago');
  assert.equal(formatAge(7200000), '2h ago');
});

test('relative description combines distance and bearing', () => {
  const mine = { lat: 0, lon: 0 };
  assert.equal(describeRelative(mine, { lat: 0, lon: 1 }), '111 km E');
  assert.equal(describeRelative(null, { lat: 0, lon: 1 }), null);
  assert.equal(describeRelative(mine, null), null);
});
