import assert from 'node:assert/strict';
import { calculateLookDirection } from './constants';
import { resolveAbilityAimDirection } from './abilityAim';
import type { AbilityContext } from './types';

function makeContext(overrides: Partial<AbilityContext> = {}): AbilityContext {
  return {
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0.25,
    pitch: -0.1,
    heroId: 'phantom',
    localPlayer: {
      id: 'local-player',
      team: 'red',
      position: { x: 0, y: 1, z: 0 },
      ultimateCharge: 0,
    },
    inputState: {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      sprint: false,
      primaryFire: false,
      secondaryFire: false,
      reload: false,
      ability1: false,
      ability2: false,
      ultimate: false,
      interact: false,
    },
    dt: 1 / 60,
    isGrounded: true,
    ...overrides,
  } as AbilityContext;
}

function assertApprox(actual: number, expected: number): void {
  assert.equal(Math.abs(actual - expected) <= 0.000001, true);
}

const baseContext = makeContext();
const rawDirection = calculateLookDirection(baseContext.yaw, baseContext.pitch);
const firstPersonDirection = resolveAbilityAimDirection(
  baseContext,
  { x: 1.2, y: 1.4, z: -0.6 }
);
assert.deepEqual(firstPersonDirection, rawDirection);

const aimedDirection = resolveAbilityAimDirection(
  makeContext({ aimPoint: { x: 0, y: 2, z: -10 } }),
  { x: 0, y: 1, z: 0 }
);
const expectedLength = Math.sqrt(1 * 1 + 10 * 10);
assertApprox(aimedDirection.x, 0);
assertApprox(aimedDirection.y, 1 / expectedLength);
assertApprox(aimedDirection.z, -10 / expectedLength);

const degenerateDirection = resolveAbilityAimDirection(
  makeContext({ aimPoint: { x: 1, y: 1, z: 1 } }),
  { x: 1, y: 1, z: 1 }
);
assert.deepEqual(degenerateDirection, rawDirection);

console.log('ability aim tests passed');
