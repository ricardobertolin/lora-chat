// node --test test/presence.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  touchNode,
  setPosition,
  dropNode,
  sweep,
  roster,
  activeCount,
  formatSeen,
  PRESENCE_TIMEOUT_MS,
} from '../presence.js';

test('the first sighting of a name is a join', () => {
  const nodes = new Map();
  assert.equal(touchNode(nodes, '8424', 1000), 'joined');
  assert.equal(touchNode(nodes, '8424', 2000), 'seen', 'not announced twice');
  assert.equal(nodes.get('8424').firstSeen, 1000);
  assert.equal(nodes.get('8424').lastSeen, 2000);
});

test('signal readings are kept, and nulls do not wipe them', () => {
  const nodes = new Map();
  touchNode(nodes, 'a', 0, { rssi: -40, snr: 9 });
  touchNode(nodes, 'a', 10);
  assert.equal(nodes.get('a').rssi, -40, 'a sighting without a reading keeps the old one');
  touchNode(nodes, 'a', 20, { rssi: -80, snr: 2 });
  assert.equal(nodes.get('a').rssi, -80);
});

test('going quiet marks a node stale, exactly once', () => {
  const nodes = new Map();
  touchNode(nodes, 'a', 0);
  assert.deepEqual(sweep(nodes, 1000), [], 'still fresh');

  const gone = sweep(nodes, PRESENCE_TIMEOUT_MS + 1);
  assert.deepEqual(gone, ['a']);
  assert.equal(nodes.get('a').stale, true);
  assert.deepEqual(sweep(nodes, PRESENCE_TIMEOUT_MS + 2), [], 'not announced again');
});

test('a stale node speaking again is a return', () => {
  const nodes = new Map();
  touchNode(nodes, 'a', 0);
  sweep(nodes, PRESENCE_TIMEOUT_MS + 1);
  assert.equal(touchNode(nodes, 'a', PRESENCE_TIMEOUT_MS + 2), 'returned');
  assert.equal(nodes.get('a').stale, false);
});

test('positions attach to a node and imply a sighting', () => {
  const nodes = new Map();
  setPosition(nodes, 'b', { lat: 1, lon: 2, accuracy: 5 }, 500);
  assert.equal(nodes.get('b').pos.lat, 1);
  assert.equal(nodes.get('b').lastSeen, 500);
});

test('dropping a node removes it', () => {
  const nodes = new Map();
  touchNode(nodes, 'a', 0);
  assert.equal(dropNode(nodes, 'a'), true);
  assert.equal(dropNode(nodes, 'a'), false);
  assert.equal(nodes.size, 0);
});

test('active count excludes stale nodes', () => {
  const nodes = new Map();
  touchNode(nodes, 'a', 0);
  touchNode(nodes, 'b', PRESENCE_TIMEOUT_MS);
  sweep(nodes, PRESENCE_TIMEOUT_MS + 1);
  assert.equal(activeCount(nodes), 1, 'a went quiet, b did not');
});

test('roster is sorted by name', () => {
  const nodes = new Map();
  for (const n of ['zz', 'aa', 'mm']) touchNode(nodes, n, 0);
  assert.deepEqual(roster(nodes).map((n) => n.name), ['aa', 'mm', 'zz']);
});

test('last-seen formatting', () => {
  const node = { lastSeen: 0 };
  assert.equal(formatSeen(node, 5000), '5s ago');
  assert.equal(formatSeen(node, 120000), '2m ago');
  assert.equal(formatSeen(node, 7200000), '2h ago');
});
