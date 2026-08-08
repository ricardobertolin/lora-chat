// node --test test/version.test.mjs
//
// The version lives in two files that cannot import each other: version.js is a
// module, sw.js is a service worker. This is what keeps them honest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../version.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('version is a plain three-part number', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `got ${VERSION}`);
});

test('the service worker cache name carries the version', () => {
  const sw = read('../sw.js');
  const m = /const CACHE = '([^']+)'/.exec(sw);
  assert.ok(m, 'could not find the CACHE constant in sw.js');
  assert.ok(
    m[1].includes(VERSION),
    `sw.js cache is "${m[1]}" but version.js says "${VERSION}" - bump them together`
  );
});

test('the service worker caches version.js itself', () => {
  assert.match(read('../sw.js'), /'version\.js'/, 'version.js must be in the shell');
});

test('index.html ships a fallback version for before the module loads', () => {
  assert.match(read('../index.html'), /id="ver"/, 'the header needs a version element');
});
