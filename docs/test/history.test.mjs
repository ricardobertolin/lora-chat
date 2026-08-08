// node --test test/history.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendEntry,
  sanitise,
  load,
  save,
  clear,
  formatStamp,
  HISTORY_KEY,
} from '../history.js';

const entry = (text, at = 1000) => ({ mine: true, who: null, text, at });

// Minimal stand-in for localStorage.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

test('appends in order', () => {
  const list = appendEntry(appendEntry([], entry('one')), entry('two'));
  assert.deepEqual(list.map((e) => e.text), ['one', 'two']);
});

test('drops the oldest past the cap', () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = appendEntry(list, entry(`m${i}`), 4);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((e) => e.text), ['m6', 'm7', 'm8', 'm9']);
});

test('tolerates a non-array starting point', () => {
  assert.deepEqual(appendEntry(null, entry('x')).map((e) => e.text), ['x']);
});

test('sanitise drops malformed entries', () => {
  const raw = [
    entry('good'),
    null,
    'a string',
    { text: 'no mine flag', at: 1 },
    { mine: true, text: 'no timestamp' },
    { mine: true, text: 42, at: 1 },
  ];
  assert.deepEqual(sanitise(raw).map((e) => e.text), ['good']);
});

test('sanitise handles junk in place of an array', () => {
  assert.deepEqual(sanitise(null), []);
  assert.deepEqual(sanitise({}), []);
});

test('round-trips through storage', () => {
  const s = fakeStorage();
  const list = [entry('hello'), { mine: false, who: '3D2C', text: 'hi', at: 2000 }];
  assert.equal(save(list, s), true);
  assert.deepEqual(load(s), list);
});

test('load survives corrupt storage', () => {
  assert.deepEqual(load(fakeStorage({ [HISTORY_KEY]: 'not json' })), []);
  assert.deepEqual(load(fakeStorage({ [HISTORY_KEY]: '{"not":"an array"}' })), []);
  assert.deepEqual(load(fakeStorage()), []);
});

test('save reports failure instead of throwing when storage is full', () => {
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  assert.equal(save([entry('x')], full), false);
});

test('clear empties storage', () => {
  const s = fakeStorage();
  save([entry('x')], s);
  clear(s);
  assert.deepEqual(load(s), []);
});

test('timestamps are zero-padded', () => {
  const at = new Date(2026, 0, 1, 9, 5).getTime();
  assert.equal(formatStamp(at), '09:05');
});
