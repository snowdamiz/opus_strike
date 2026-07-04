import assert from 'node:assert/strict';
import { formatSolRewardLabel } from './combatFeedbackStore';

assert.equal(formatSolRewardLabel('3000'), '+0.000003 SOL');
assert.equal(formatSolRewardLabel('100000'), '+0.0001 SOL');
assert.equal(formatSolRewardLabel('1000000000'), '+1 SOL');
assert.equal(formatSolRewardLabel(17_500n), '+0.0000175 SOL');

console.log('combat feedback store tests passed');
