import assert from 'node:assert/strict';
import { formatCompactTokenAmount } from './tokenAmountFormat';

assert.equal(formatCompactTokenAmount('1000000'), '1M');
assert.equal(formatCompactTokenAmount('1500000'), '1.5M');
assert.equal(formatCompactTokenAmount('20000'), '20K');
assert.equal(formatCompactTokenAmount('999'), '999');
assert.equal(formatCompactTokenAmount('999950'), '1M');
assert.equal(formatCompactTokenAmount('2500000000'), '2.5B');
assert.equal(formatCompactTokenAmount(undefined, 'TBA'), 'TBA');
assert.equal(formatCompactTokenAmount('not-a-number', 'TBA'), 'TBA');

console.log('token amount format tests passed');
