// node --test test/outbox.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createItem,
  enqueue,
  remove,
  sanitise,
  load,
  save,
  clear,
  describe,
  OUTBOX_KEY,
} from '../outbox.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

test('items get a unique id', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(createItem('x').id);
  assert.equal(ids.size, 500);
});

test('queues in order', () => {
  let list = [];
  for (const t of ['one', 'two', 'three']) list = enqueue(list, createItem(t));
  assert.deepEqual(list.map((i) => i.text), ['one', 'two', 'three']);
});

test('past the cap the oldest is dropped, not the newest', () => {
  let list = [];
  for (let i = 0; i < 6; i++) list = enqueue(list, createItem(`m${i}`), 3);
  assert.deepEqual(list.map((i) => i.text), ['m3', 'm4', 'm5'],
    'what you just typed matters more than something stale');
});

test('remove takes one item by id and leaves the rest', () => {
  const a = createItem('a');
  const b = createItem('b');
  const list = remove(enqueue(enqueue([], a), b), a.id);
  assert.deepEqual(list.map((i) => i.text), ['b']);
  assert.deepEqual(remove(list, 'nope').map((i) => i.text), ['b'], 'unknown id is a no-op');
});

test('sanitise drops anything malformed', () => {
  const good = createItem('keep');
  const raw = [
    good,
    null,
    'a string',
    { id: 'x', text: '', at: 1 },
    { id: 'x', at: 1 },
    { id: 'x', text: 'no timestamp' },
    { id: 5, text: 'bad id', at: 1 },
  ];
  assert.deepEqual(sanitise(raw).map((i) => i.text), ['keep']);
  assert.deepEqual(sanitise('junk'), []);
});

test('round-trips through storage', () => {
  const s = fakeStorage();
  const list = [createItem('hello'), createItem('again')];
  assert.equal(save(list, s), true);
  assert.deepEqual(load(s).map((i) => i.text), ['hello', 'again']);
});

test('load survives corrupt storage', () => {
  assert.deepEqual(load(fakeStorage({ [OUTBOX_KEY]: 'not json' })), []);
  assert.deepEqual(load(fakeStorage({ [OUTBOX_KEY]: '"a string"' })), []);
  assert.deepEqual(load(fakeStorage()), []);
});

test('save reports failure rather than throwing when storage is full', () => {
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  assert.equal(save([createItem('x')], full), false);
});

test('clear empties storage', () => {
  const s = fakeStorage();
  save([createItem('x')], s);
  clear(s);
  assert.deepEqual(load(s), []);
});

test('description pluralises', () => {
  assert.equal(describe([]), 'empty');
  assert.equal(describe([createItem('a')]), '1 message waiting');
  assert.equal(describe([createItem('a'), createItem('b')]), '2 messages waiting');
  assert.equal(describe(null), 'empty');
});
