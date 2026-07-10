import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BLAZE_SCRAPSHOT_RANGE } from '@voxel-strike/shared';
import {
  CHRONOS_PRIMARY_ORB_SOCKET,
  calculateLookDirection,
  calculatePlayerSocketPosition,
} from './constants';
import {
  getMobileAimAssistActionConfig,
  MOBILE_AIM_ASSIST_MAX_ANGLE_RADIANS,
  resolveAbilityAimDirection,
  resolveMobileAimAssistPoint,
  type MobileAimAssistTargetCandidate,
} from './abilityAim';
import { buildAbilityCastOriginHints } from './abilityCastOriginHints';
import type { AbilityContext } from './types';
import { useLoadoutStore } from '../../store/loadoutStore';

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

const chronosCamera = new THREE.PerspectiveCamera();
chronosCamera.updateMatrixWorld();
const chronosContext = makeContext({
  heroId: 'chronos',
  yaw: 0,
  pitch: 0,
  camera: chronosCamera,
  position: new THREE.Vector3(0, 1, 0),
  aimPoint: { x: 0, y: 12, z: -8 },
  viewmodelElapsedSeconds: 0,
  viewmodelNowMs: 1000,
});
const chronosHints = buildAbilityCastOriginHints(chronosContext, {
  ...chronosContext.inputState,
  primaryFire: true,
});
assert.ok(chronosHints);
const chronosHint = chronosHints.find((hint) => hint.abilityId === 'chronos_verdant_pulse');
assert.ok(chronosHint);
const rawChronosOrigin = calculatePlayerSocketPosition(
  chronosContext.position,
  chronosContext.yaw,
  CHRONOS_PRIMARY_ORB_SOCKET
);
assert.ok(rawChronosOrigin);
assert.equal(chronosHint.aimPoint?.y, 12);
assert.equal(chronosHint.origin.y > rawChronosOrigin.y + 0.2, true);

useLoadoutStore.getState().setBlazePrimarySkill('scrapshot');
const blazeContext = makeContext({
  heroId: 'blaze',
  camera: chronosCamera,
  position: new THREE.Vector3(0, 1, 0),
  viewmodelElapsedSeconds: 0,
  viewmodelNowMs: 1000,
});
const blazeHints = buildAbilityCastOriginHints(blazeContext, {
  ...blazeContext.inputState,
  primaryFire: true,
});
assert.ok(blazeHints?.some((hint) => hint.abilityId === 'blaze_scrapshot'));
useLoadoutStore.getState().setBlazePrimarySkill('fireball_rockets');

const mobileAssistCandidates: MobileAimAssistTargetCandidate[] = [
  {
    id: 'wide-enemy',
    team: 'blue',
    x: 5,
    y: 1,
    z: -20,
    hitboxRadius: 0.45,
    hitboxSegmentHalfHeight: 0.75,
  },
  {
    id: 'near-crosshair-enemy',
    team: 'blue',
    x: 1,
    y: 1,
    z: -18,
    hitboxRadius: 0.45,
    hitboxSegmentHalfHeight: 0.75,
  },
  {
    id: 'teammate',
    team: 'red',
    x: 0.2,
    y: 1,
    z: -10,
    hitboxRadius: 0.45,
    hitboxSegmentHalfHeight: 0.75,
  },
];

const mobileAssistPoint = resolveMobileAimAssistPoint({
  ownerId: 'local-player',
  ownerTeam: 'red',
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  candidates: mobileAssistCandidates,
  maxDistance: 30,
});
assert.deepEqual(mobileAssistPoint, { x: 1, y: 1, z: -18 });

const teammateDragAssistPoint = resolveMobileAimAssistPoint({
  ownerId: 'local-player',
  ownerTeam: 'red',
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  candidates: mobileAssistCandidates,
  maxDistance: 30,
  targetTeam: 'any',
});
assert.deepEqual(teammateDragAssistPoint, { x: 0.2, y: 1, z: -10 });

const blockedAssistPoint = resolveMobileAimAssistPoint({
  ownerId: 'local-player',
  ownerTeam: 'red',
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  candidates: mobileAssistCandidates,
  maxDistance: 30,
  hasLineOfSight: (_from, to) => to.x !== 1,
});
assert.equal(blockedAssistPoint, null);

const outsideConeAssistPoint = resolveMobileAimAssistPoint({
  ownerId: 'local-player',
  ownerTeam: 'red',
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  candidates: [{
    id: 'outside-cone',
    team: 'blue',
    x: 6,
    y: 1,
    z: -20,
    hitboxRadius: 0.2,
    hitboxSegmentHalfHeight: 0.75,
  }],
  maxDistance: 30,
  maxAngleRadians: MOBILE_AIM_ASSIST_MAX_ANGLE_RADIANS,
});
assert.equal(outsideConeAssistPoint, null);

assert.deepEqual(
  getMobileAimAssistActionConfig('phantom', {
    primaryFire: true,
    secondaryFire: false,
    ability1: false,
  }),
  { maxDistance: 30, targetTeam: 'enemy' }
);
assert.equal(
  getMobileAimAssistActionConfig('chronos', {
    primaryFire: true,
    secondaryFire: false,
    ability1: true,
  }),
  null
);
assert.deepEqual(
  getMobileAimAssistActionConfig('blaze', {
    primaryFire: true,
    secondaryFire: false,
    ability1: false,
  }, 'scrapshot'),
  { maxDistance: BLAZE_SCRAPSHOT_RANGE, targetTeam: 'enemy' }
);

console.log('ability aim tests passed');
