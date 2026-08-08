// node --test test/survey.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSurvey,
  recordSent,
  recordReply,
  summarise,
  spread,
  linkMargin,
  rangeFactor,
  formatPercent,
  toCsv,
  SNR_FLOOR,
} from '../survey.js';

test('link margin is SNR above the spreading factor floor', () => {
  assert.equal(linkMargin(11, 9), 23.5);      // desk test: SF9 floor is -12.5
  assert.equal(linkMargin(-12.5, 9), 0);      // exactly at the limit
  assert.equal(linkMargin(-18, 12), 2);
  assert.equal(linkMargin(5, 99), null, 'unknown SF');
  assert.equal(linkMargin(NaN, 9), null);
});

test('every spreading factor has a floor', () => {
  for (let sf = 7; sf <= 12; sf++) {
    assert.ok(Number.isFinite(SNR_FLOOR[sf]), `SF${sf}`);
  }
});

test('range factor follows the path-loss exponent', () => {
  // 10 dB of margin at n=3 is 10^(10/30) = 2.15x further.
  assert.ok(Math.abs(rangeFactor(10, 3) - 2.154) < 0.01);
  // Free space is more forgiving: same margin goes further.
  assert.ok(rangeFactor(10, 2) > rangeFactor(10, 3));
  // Dense urban is less forgiving.
  assert.ok(rangeFactor(10, 5) < rangeFactor(10, 3));
  assert.equal(rangeFactor(0, 3), 1, 'no margin, no extra range');
});

test('counts a clean run', () => {
  const s = createSurvey({ sf: 9, timeoutMs: 1000 });
  for (let i = 1; i <= 3; i++) {
    recordSent(s, i, i * 100);
    recordReply(s, i, { rssi: -40, snr: 10, at: i * 100 + 50 });
  }
  const r = summarise(s, 10000);
  assert.equal(r.sent, 3);
  assert.equal(r.received, 3);
  assert.equal(r.lost, 0);
  assert.equal(r.pdr, 1);
  assert.equal(r.rtt.avg, 50);
});

test('in-flight probes are pending, not lost', () => {
  const s = createSurvey({ timeoutMs: 5000 });
  recordSent(s, 1, 1000);
  const r = summarise(s, 2000);  // only 1 s elapsed
  assert.equal(r.pending, 1);
  assert.equal(r.lost, 0);
  assert.equal(r.pdr, null, 'no verdict yet, so no delivery ratio');
});

test('a probe past its timeout counts as lost', () => {
  const s = createSurvey({ timeoutMs: 5000 });
  recordSent(s, 1, 1000);
  const r = summarise(s, 9000);
  assert.equal(r.lost, 1);
  assert.equal(r.pdr, 0);
});

test('delivery ratio ignores probes still in flight', () => {
  const s = createSurvey({ timeoutMs: 5000 });
  recordSent(s, 1, 0);
  recordReply(s, 1, { rssi: -50, snr: 8, at: 100 });
  recordSent(s, 2, 100);            // expired, no reply
  recordSent(s, 3, 20000);          // still in flight at now=21000
  const r = summarise(s, 21000);
  assert.equal(r.received, 1);
  assert.equal(r.lost, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.pdr, 0.5, '1 of 2 answered, the third does not count');
});

test('a reply to an unknown probe is rejected', () => {
  const s = createSurvey();
  recordSent(s, 1, 0);
  assert.equal(recordReply(s, 99, { rssi: -1, snr: 1, at: 10 }), false);
  assert.equal(summarise(s, 0).received, 0);
});

test('a duplicate reply does not double-count', () => {
  const s = createSurvey();
  recordSent(s, 1, 0);
  assert.equal(recordReply(s, 1, { rssi: -50, snr: 9, at: 50 }), true);
  assert.equal(recordReply(s, 1, { rssi: -50, snr: 9, at: 60 }), false);
  assert.equal(summarise(s, 100).received, 1);
});

test('margin uses the survey spreading factor', () => {
  const s = createSurvey({ sf: 12 });
  recordSent(s, 1, 0);
  recordReply(s, 1, { rssi: -120, snr: -15, at: 10 });
  const r = summarise(s, 100);
  assert.equal(r.margin, 5, 'SF12 floor is -20, so -15 leaves 5 dB');
  assert.ok(r.rangeFactor > 1);
});

test('spread reports min, max, mean and count', () => {
  assert.deepEqual(spread([2, 4, 9]), { min: 2, max: 9, avg: 5, n: 3 });
  assert.equal(spread([]), null);
});

test('an empty survey summarises without throwing', () => {
  const r = summarise(createSurvey(), 0);
  assert.equal(r.sent, 0);
  assert.equal(r.pdr, null);
  assert.equal(r.rtt, null);
  assert.equal(r.margin, null);
});

test('percent formatting', () => {
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(0.833), '83%');
  assert.equal(formatPercent(null), '-');
});

test('csv has a header and one row per probe', () => {
  const s = createSurvey({ sf: 10 });
  recordSent(s, 1, 1000);
  recordReply(s, 1, { rssi: -70, snr: 4, at: 1200 });
  recordSent(s, 2, 6000);
  const lines = toCsv(s).split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^seq,sent_at_ms,delivered/);
  assert.equal(lines[1], '1,1000,1,200,-70,4,10');
  assert.equal(lines[2], '2,6000,0,,,,10', 'a lost probe leaves the fields empty');
});
