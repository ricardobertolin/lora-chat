// node --test test/radar.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickScale, polarToXY, formatScale } from '../radar.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} +/- ${tol}`);

test('scale is the smallest round ring that contains everything', () => {
  assert.equal(pickScale(40), 50);
  assert.equal(pickScale(50), 50, 'exactly on a ring stays on it');
  assert.equal(pickScale(51), 100);
  assert.equal(pickScale(900), 1000);
  assert.equal(pickScale(1200), 2500);
});

test('scale copes with no contacts', () => {
  assert.equal(pickScale(0), 50);
  assert.equal(pickScale(NaN), 50);
  assert.equal(pickScale(-5), 50);
});

test('anything beyond the largest ring still gets a scale', () => {
  assert.equal(pickScale(10 ** 9), 50000);
});

test('north is up and east is right', () => {
  const r = 100;
  const n = polarToXY(500, 0, 500, r);
  near(n.x, 0, 0.001, 'north x');
  near(n.y, -r, 0.001, 'north y is negative, screen coordinates');

  const e = polarToXY(500, 90, 500, r);
  near(e.x, r, 0.001, 'east x');
  near(e.y, 0, 0.001, 'east y');

  const s = polarToXY(500, 180, 500, r);
  near(s.y, r, 0.001, 'south y');

  const w = polarToXY(500, 270, 500, r);
  near(w.x, -r, 0.001, 'west x');
});

test('distance maps proportionally to the ring', () => {
  const half = polarToXY(250, 0, 500, 100);
  near(half.y, -50, 0.001, 'half the scale is half the radius');
});

test('a contact past the scale is clamped to the edge', () => {
  const out = polarToXY(9999, 90, 500, 100);
  near(out.x, 100, 0.001, 'clamped, not drawn off-canvas');
});

test('diagonal bearings land where expected', () => {
  const ne = polarToXY(100, 45, 100, 100);
  near(ne.x, 70.71, 0.01, 'north-east x');
  near(ne.y, -70.71, 0.01, 'north-east y');
});

test('scale labels switch to kilometres', () => {
  assert.equal(formatScale(500), '500 m');
  assert.equal(formatScale(1000), '1 km');
  assert.equal(formatScale(25000), '25 km');
});
