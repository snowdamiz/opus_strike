import assert from 'node:assert/strict';
import { resolveSlideScreenFlow } from './SlideEffects';

const EPSILON = 0.000001;

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < EPSILON, `Expected ${actual} to be close to ${expected}`);
}

const forward = resolveSlideScreenFlow({ x: 0, z: -4 }, 0);
assert.ok(forward);
assertClose(forward.x, 0);
assertClose(forward.y, 1);
assertClose(forward.angleDeg, 0);

const backward = resolveSlideScreenFlow({ x: 0, z: 4 }, 0);
assert.ok(backward);
assertClose(backward.x, 0);
assertClose(backward.y, -1);
assertClose(Math.abs(backward.angleDeg), 180);

const right = resolveSlideScreenFlow({ x: 4, z: 0 }, 0);
assert.ok(right);
assertClose(right.x, 1);
assertClose(right.y, 0);
assertClose(right.angleDeg, -90);

const left = resolveSlideScreenFlow({ x: -4, z: 0 }, 0);
assert.ok(left);
assertClose(left.x, -1);
assertClose(left.y, 0);
assertClose(left.angleDeg, 90);

const yawedForward = resolveSlideScreenFlow({ x: -4, z: 0 }, Math.PI / 2);
assert.ok(yawedForward);
assertClose(yawedForward.x, 0);
assertClose(yawedForward.y, 1);
assertClose(yawedForward.angleDeg, 0);

assert.equal(resolveSlideScreenFlow({ x: 0, z: 0 }, 0), null);
