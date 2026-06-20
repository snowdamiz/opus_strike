import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAYER_EYE_HEIGHT,
  PLAYER_RADIUS,
} from '@voxel-strike/shared';
import { writeThirdPersonCameraPosition } from './useCamera';

const EPSILON = 0.000001;

function assertApprox(actual: number, expected: number): void {
  assert.equal(Math.abs(actual - expected) <= EPSILON, true);
}

function writeCameraPosition(
  yaw: number,
  collision?: Parameters<typeof writeThirdPersonCameraPosition>[3]['collision']
) {
  const position = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const direction = new THREE.Vector3();
  writeThirdPersonCameraPosition(position, anchor, direction, {
    bodyPosition: { x: 0, y: 1, z: 0 },
    yaw,
    eyeHeight: PLAYER_EYE_HEIGHT,
    collision,
  });
  return { position, anchor, direction };
}

const neutral = writeCameraPosition(0);
assert.equal(neutral.position.z > 4, true);
assert.equal(neutral.position.y > 1 + PLAYER_EYE_HEIGHT + 1, true);
assert.equal(neutral.position.x > PLAYER_RADIUS + 0.1, true);

// At neutral yaw and pitch, the camera looks down -Z. A shoulder offset keeps
// that center ray outside the local player's body radius instead of through it.
const centerRayXAtPlayerDepth = neutral.position.x;
assert.equal(Math.abs(centerRayXAtPlayerDepth) > PLAYER_RADIUS, true);

const yaw = Math.PI / 2;
const rotated = writeCameraPosition(yaw);
const forwardX = -Math.sin(yaw);
const forwardZ = -Math.cos(yaw);
const rightX = Math.cos(yaw);
const rightZ = -Math.sin(yaw);
const dx = rotated.position.x;
const dz = rotated.position.z;
const shoulderClearance = dx * rightX + dz * rightZ;
const backwardDistance = -(dx * forwardX + dz * forwardZ);
assert.equal(shoulderClearance > PLAYER_RADIUS + 0.1, true);
assert.equal(backwardDistance > 4, true);

let requestedDistance = 0;
const withCollision = writeCameraPosition(0, (_origin, _direction, maxDistance) => {
  requestedDistance = maxDistance;
  return maxDistance / 2;
});
assert.equal(requestedDistance > 0, true);
assert.equal(withCollision.position.distanceTo(withCollision.anchor) < requestedDistance, true);
assertApprox(withCollision.position.distanceTo(withCollision.anchor), requestedDistance / 2 - 0.3);

const withNearCollision = writeCameraPosition(0, () => 0.1);
assertApprox(withNearCollision.position.distanceTo(withNearCollision.anchor), 0.85);
