import assert from 'node:assert/strict';
import { DEV_TUTORIAL_BYPASS_HEADER } from '@voxel-strike/shared';
import { ALLOWED_CORS_HEADERS, ALLOWED_CORS_HEADER_VALUE } from '../config/corsHeaders';

assert.ok(ALLOWED_CORS_HEADERS.includes('Authorization'));
assert.ok(ALLOWED_CORS_HEADERS.includes('Content-Type'));
assert.ok(ALLOWED_CORS_HEADERS.includes('X-CSRF-Token'));
assert.ok(ALLOWED_CORS_HEADERS.includes('X-Internal-Status-Token'));
assert.ok(ALLOWED_CORS_HEADERS.includes(DEV_TUTORIAL_BYPASS_HEADER));
assert.equal(new Set(ALLOWED_CORS_HEADERS).size, ALLOWED_CORS_HEADERS.length);
assert.equal(ALLOWED_CORS_HEADER_VALUE, ALLOWED_CORS_HEADERS.join(', '));

console.log('CORS header config tests passed.');
