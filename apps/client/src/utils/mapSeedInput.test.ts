import assert from 'node:assert/strict';
import {
  MAP_SEED_PLACEHOLDER,
  isAllowedMapSeedInput,
  isValidMapSeedInput,
  parseOptionalMapSeedInput,
} from './mapSeedInput';

assert.equal(isAllowedMapSeedInput(''), true);
assert.equal(isValidMapSeedInput('0'), true);
assert.equal(isValidMapSeedInput('20260613'), true);
assert.equal(isValidMapSeedInput('4294967295'), true);
assert.equal(isValidMapSeedInput(MAP_SEED_PLACEHOLDER), true);

assert.equal(isAllowedMapSeedInput('4294967296'), false);
assert.equal(isAllowedMapSeedInput('123abc'), false);
assert.equal(isAllowedMapSeedInput('0xfeed'), false);
assert.equal(isAllowedMapSeedInput('-1'), false);
assert.equal(isAllowedMapSeedInput('10000000000'), false);

assert.equal(parseOptionalMapSeedInput(''), undefined);
assert.equal(parseOptionalMapSeedInput(' 20260613 '), 20260613);
assert.equal(parseOptionalMapSeedInput('4294967295'), 4294967295);
assert.throws(() => parseOptionalMapSeedInput('4294967296'), /0 to 4294967295/);
assert.throws(() => parseOptionalMapSeedInput('0xfeed'), /whole number/);
