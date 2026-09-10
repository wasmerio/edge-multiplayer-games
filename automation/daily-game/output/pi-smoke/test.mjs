import assert from 'node:assert/strict';
import { sum } from './sum.js';
assert.equal(sum(2, 3), 5);
assert.equal(sum(-2, 3), 1);
console.log('PROBE_TEST_PASS');
