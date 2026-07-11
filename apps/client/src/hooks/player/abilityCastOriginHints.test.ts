import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  createEmptyInputState,
} from '@voxel-strike/shared';
import { useLoadoutStore } from '../../store/loadoutStore';
import {
  registerViewmodelPoseSampler,
  registerViewmodelSocket,
} from '../../viewmodel/viewmodelSocketRegistry';
import { buildAbilityCastOriginHints } from './abilityCastOriginHints';
import type { AbilityContext } from './types';

const liveStaffTip = new THREE.Object3D();
liveStaffTip.position.set(1, 2, 3);
liveStaffTip.updateMatrixWorld(true);

const unregisterLiveSocket = registerViewmodelSocket(
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  liveStaffTip,
);
const unregisterSampledSocket = registerViewmodelPoseSampler(
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  () => ({
    position: new THREE.Vector3(8, 8, 8),
    quaternion: new THREE.Quaternion(),
  }),
);

try {
  useLoadoutStore.getState().setBlazePrimarySkill('scrapshot');
  const input = {
    ...createEmptyInputState(),
    primaryFire: true,
  };
  const context: AbilityContext = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    heroId: 'blaze',
    localPlayer: {
      id: 'local',
      team: 'red',
      position: { x: 0, y: 0, z: 0 },
    },
    inputState: input,
    dt: 1 / 60,
    isGrounded: true,
    camera: new THREE.PerspectiveCamera(),
    viewmodelElapsedSeconds: 1,
    viewmodelNowMs: 1000,
  };

  const hint = buildAbilityCastOriginHints(context, input)?.find((candidate) => (
    candidate.abilityId === 'blaze_scrapshot'
  ));
  assert.ok(hint, 'Scrapshot should emit a staff-tip cast-origin hint');
  assert.equal(hint.socketName, BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME);
  assert.deepEqual(hint.origin, { x: 1, y: 2, z: 3 });

  useLoadoutStore.getState().setBlazeSecondarySkill('phosphor_flare');
  const secondaryInput = {
    ...createEmptyInputState(),
    secondaryFire: true,
  };
  const secondaryHint = buildAbilityCastOriginHints(
    { ...context, inputState: secondaryInput },
    secondaryInput,
  )?.find((candidate) => candidate.abilityId === 'blaze_phosphor_flare');
  assert.ok(secondaryHint, 'Phosphor Flare should emit a staff-tip cast-origin hint');
  assert.equal(secondaryHint.socketName, BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME);
  assert.deepEqual(secondaryHint.origin, { x: 1, y: 2, z: 3 });

  useLoadoutStore.getState().setBlazeUltimateSkill('phoenix_dive');
  const ultimateInput = {
    ...createEmptyInputState(),
    ultimate: true,
  };
  const ultimateHint = buildAbilityCastOriginHints(
    {
      ...context,
      inputState: ultimateInput,
      aimPoint: new THREE.Vector3(12, 0, -8),
    },
    ultimateInput,
  )?.find((candidate) => candidate.abilityId === 'blaze_phoenix_dive');
  assert.ok(ultimateHint, 'Phoenix Dive should emit a targeted root cast hint');
  assert.equal(ultimateHint.socketName, 'root');
  assert.deepEqual(ultimateHint.aimPoint, { x: 12, y: 0, z: -8 });

  const confirmedTargetHint = buildAbilityCastOriginHints(
    { ...context, inputState: ultimateInput },
    ultimateInput,
    { phoenixDiveTarget: { x: 9, y: 1.25, z: -6 } },
  )?.find((candidate) => candidate.abilityId === 'blaze_phoenix_dive');
  assert.deepEqual(confirmedTargetHint?.aimPoint, { x: 9, y: 1.25, z: -6 });
} finally {
  useLoadoutStore.getState().setBlazePrimarySkill('fireball_rockets');
  useLoadoutStore.getState().setBlazeSecondarySkill('meteor_strike');
  useLoadoutStore.getState().setBlazeUltimateSkill('infernal_gearstorm');
  unregisterSampledSocket();
  unregisterLiveSocket();
}

console.log('ability cast origin hint tests passed');
