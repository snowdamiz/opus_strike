import assert from 'node:assert/strict';
import { getDamageIndicatorAngleDeg } from './damageIndicator';

function assertAngleClose(actual: number | null, expected: number): void {
  assert.notEqual(actual, null);
  const diff = Math.abs((((actual! - expected + 180) % 360) + 360) % 360 - 180);
  assert.ok(diff < 0.0001, `expected ${expected}, got ${actual}`);
}

const origin = { x: 0, z: 0 };

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: { x: 0, z: -10 },
  targetPosition: origin,
  lookYaw: 0,
}), 0);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: { x: 10, z: 0 },
  targetPosition: origin,
  lookYaw: 0,
}), 90);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: { x: 0, z: 10 },
  targetPosition: origin,
  lookYaw: 0,
}), 180);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: { x: -10, z: 0 },
  targetPosition: origin,
  lookYaw: 0,
}), -90);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: { x: -10, z: 0 },
  targetPosition: origin,
  lookYaw: Math.PI / 2,
}), 0);

assert.equal(getDamageIndicatorAngleDeg({
  sourcePosition: origin,
  targetPosition: origin,
  lookYaw: 0,
}), null);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: origin,
  sourceDirection: { x: 0, z: 1 },
  targetPosition: origin,
  lookYaw: 0,
}), 0);

assertAngleClose(getDamageIndicatorAngleDeg({
  sourcePosition: origin,
  sourceDirection: { x: 0, z: -1 },
  targetPosition: origin,
  lookYaw: 0,
}), 180);
