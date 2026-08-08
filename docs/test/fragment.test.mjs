// node --test test/fragment.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeId,
  packFragments,
  parseFragment,
  createAssembly,
  addFragment,
  missingOf,
  receivedCount,
  isComplete,
  assembled,
  endLine,
  parseEnd,
  requestLine,
  parseRequest,
  splitRequest,
  MAX_LINE,
} from '../fragment.js';

const payload = (n) => 'x'.repeat(n);

test('ids are three base36 characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeId(), /^[0-9a-z]{3}$/);
});

test('round-trips a payload through pack and assemble', () => {
  const body = Array.from({ length: 900 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
  const lines = packFragments({ id: 'abc', kind: 'i', encrypted: true, payload: body });
  assert.ok(lines.length > 1, 'should have split');

  let asm = null;
  for (const line of lines) {
    const f = parseFragment(line);
    assert.ok(f, `parsed: ${line.slice(0, 30)}`);
    if (!asm) asm = createAssembly(f);
    addFragment(asm, f);
  }
  assert.ok(isComplete(asm));
  assert.equal(assembled(asm), body);
  assert.equal(asm.kind, 'i');
  assert.equal(asm.encrypted, true);
});

test('no fragment exceeds the line limit', () => {
  for (const size of [1, 50, 200, 999, 5000, 40000]) {
    for (const line of packFragments({ id: 'zzz', kind: 'a', encrypted: false, payload: payload(size) })) {
      assert.ok(line.length <= MAX_LINE, `size ${size}: line was ${line.length}`);
    }
  }
});

test('a single short payload is one fragment', () => {
  const lines = packFragments({ id: 'abc', kind: 't', encrypted: false, payload: 'hello' });
  assert.equal(lines.length, 1);
  assert.equal(parseFragment(lines[0]).chunk, 'hello');
});

test('rejects bad input', () => {
  assert.throws(() => packFragments({ id: 'abc', kind: 'x', encrypted: false, payload: 'a' }), /bad kind/);
  assert.throws(() => packFragments({ id: 'abc', kind: 'i', encrypted: false, payload: '' }), /empty/);
});

test('parseFragment refuses malformed lines', () => {
  assert.equal(parseFragment('hello there'), null);
  assert.equal(parseFragment('!Babc.0.0.i1 data'), null, 'zero total');
  assert.equal(parseFragment('!Babc.5.5.i1 data'), null, 'seq past the end');
  assert.equal(parseFragment('!Babc.0.3.z1 data'), null, 'unknown kind');
  assert.equal(parseFragment('!Babc.0.3.i1'), null, 'no chunk');
});

test('tracks what is missing', () => {
  const lines = packFragments({ id: 'abc', kind: 'i', encrypted: false, payload: payload(900) });
  const frags = lines.map(parseFragment);
  const asm = createAssembly(frags[0]);
  for (const f of frags) if (f.seq !== 2 && f.seq !== 4) addFragment(asm, f);

  assert.deepEqual(missingOf(asm), [2, 4]);
  assert.equal(isComplete(asm), false);
  assert.equal(assembled(asm), null, 'incomplete assembly yields nothing');
  assert.equal(receivedCount(asm), frags.length - 2);

  addFragment(asm, frags[2]);
  addFragment(asm, frags[4]);
  assert.ok(isComplete(asm));
});

test('a duplicate resend is not counted twice', () => {
  const lines = packFragments({ id: 'abc', kind: 'i', encrypted: false, payload: payload(400) });
  const f = parseFragment(lines[0]);
  const asm = createAssembly(f);
  assert.equal(addFragment(asm, f), true);
  assert.equal(addFragment(asm, f), false, 'second time is a duplicate');
  assert.equal(receivedCount(asm), 1);
});

test('fragments from another transfer are rejected', () => {
  const mine = parseFragment(packFragments({ id: 'aaa', kind: 'i', encrypted: false, payload: payload(400) })[0]);
  const other = parseFragment(packFragments({ id: 'bbb', kind: 'i', encrypted: false, payload: payload(400) })[0]);
  const asm = createAssembly(mine);
  assert.equal(addFragment(asm, other), false);
});

test('out-of-order arrival still assembles', () => {
  const body = payload(700).split('').map((_, i) => String(i % 10)).join('');
  const frags = packFragments({ id: 'abc', kind: 'a', encrypted: false, payload: body }).map(parseFragment);
  const asm = createAssembly(frags[0]);
  for (const f of [...frags].reverse()) addFragment(asm, f);
  assert.equal(assembled(asm), body);
});

test('end and request lines round-trip', () => {
  assert.equal(parseEnd(endLine('abc')), 'abc');
  assert.equal(parseEnd('!BEabc extra'), null);
  assert.deepEqual(parseRequest(requestLine('abc', [1, 5, 9])), { id: 'abc', missing: [1, 5, 9] });
  assert.equal(parseRequest('!BRabc'), null);
});

test('a long missing list is split across several requests', () => {
  const missing = Array.from({ length: 400 }, (_, i) => i);
  const batches = splitRequest('abc', missing);
  assert.ok(batches.length > 1, 'should not fit in one line');
  for (const b of batches) {
    assert.ok(requestLine('abc', b).length <= MAX_LINE, 'each request fits a line');
  }
  assert.deepEqual(batches.flat(), missing, 'nothing dropped or duplicated');
});

test('a short missing list stays as one request', () => {
  assert.deepEqual(splitRequest('abc', [3, 7]), [[3, 7]]);
});
