import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PITCH_LIMIT,
  BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
  type BattleRoyalDropSnapshot,
} from '@voxel-strike/shared';
import {
  applyBattleRoyalDeploymentCamera,
  writeBattleRoyalDeploymentCameraTarget,
  type BattleRoyalDeploymentCameraTarget,
} from './battleRoyalDropView';

function makeDrop(status: BattleRoyalDropSnapshot['players'][number]['status']): BattleRoyalDropSnapshot {
  return {
    enabled: true,
    phaseStartedAt: 0,
    phaseEndsAt: 10_000,
    serverTime: 2_000,
    ship: {
      start: { x: -50, y: 132, z: 10 },
      end: { x: 50, y: 132, z: 10 },
      position: { x: 0, y: 132, z: 10 },
      altitude: 132,
      startedAt: 0,
      endsAt: 10_000,
      autoDropAt: 9_000,
      dropStartsAt: 2_000,
      dropEndsAt: 8_000,
      canDrop: true,
    },
    players: [{
      playerId: 'local-player',
      team: 'red',
      status,
      position: { x: 12, y: 64, z: -18 },
      velocity: { x: 3, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: -4 },
      droppedAt: status === 'aboard' ? null : 1_000,
      landedAt: status === 'landed' ? 3_000 : null,
      attachedToPlayerId: null,
    }],
  };
}

function makeAttachedSquadDrop(): BattleRoyalDropSnapshot {
  const drop = makeDrop('dropping');
  drop.players = [
    {
      playerId: 'leader-player',
      team: 'red',
      status: 'dropping',
      position: { x: 30, y: 72, z: -24 },
      velocity: { x: 6, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: -2 },
      droppedAt: 1_000,
      landedAt: null,
      attachedToPlayerId: null,
    },
    {
      playerId: 'local-player',
      team: 'red',
      status: 'dropping',
      position: { x: 10, y: 68, z: -8 },
      velocity: { x: -3, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: 5 },
      droppedAt: 1_000,
      landedAt: null,
      attachedToPlayerId: 'leader-player',
    },
  ];
  return drop;
}

const target: BattleRoyalDeploymentCameraTarget = {
  mode: 'ship',
  position: new THREE.Vector3(999, 999, 999),
  yaw: 0.75,
};
const livePodPosition = new THREE.Vector3(21, 70, -9);

writeBattleRoyalDeploymentCameraTarget({
  drop: makeDrop('dropping'),
  playerId: 'local-player',
  now: 2_000,
  livePodPosition,
  target,
});

assert.equal(target.mode, 'pod');
assert.deepEqual(target.position.toArray(), [21, 70, -9]);
assert.equal(target.yaw, Math.atan2(3, -4));

target.position.set(999, 999, 999);
writeBattleRoyalDeploymentCameraTarget({
  drop: makeAttachedSquadDrop(),
  playerId: 'local-player',
  now: 2_000,
  livePodPosition,
  target,
});

assert.equal(target.mode, 'pod');
assert.deepEqual(target.position.toArray(), [30, 72, -24]);
assert.equal(target.yaw, Math.atan2(6, -2));

const camera = new THREE.PerspectiveCamera();
const cameraPosition = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
camera.position.copy(target.position);
applyBattleRoyalDeploymentCamera({
  camera,
  currentPosition: cameraPosition,
  lookTarget,
  cameraTarget: target,
  localYaw: 0,
  localPitch: -PITCH_LIMIT,
  delta: 1,
});
assert.equal(camera.position.y > target.position.y, true);
assert.equal(lookTarget.y < target.position.y, true);

target.position.set(999, 999, 999);
target.yaw = 1.25;
writeBattleRoyalDeploymentCameraTarget({
  drop: makeDrop('landed'),
  playerId: 'local-player',
  now: 4_000,
  target,
});

assert.equal(target.mode, 'pod');
assert.deepEqual(target.position.toArray(), [12, 64, -18]);
assert.equal(target.yaw, 1.25);

writeBattleRoyalDeploymentCameraTarget({
  drop: makeDrop('aboard'),
  playerId: 'local-player',
  now: 5_000,
  target,
});

assert.equal(target.mode, 'ship');
assert.deepEqual(target.position.toArray(), [0, 132, 10]);

const shipCamera = new THREE.PerspectiveCamera();
const shipCameraPosition = new THREE.Vector3();
const shipLookTarget = new THREE.Vector3();
shipCamera.position.copy(target.position);
applyBattleRoyalDeploymentCamera({
  camera: shipCamera,
  currentPosition: shipCameraPosition,
  lookTarget: shipLookTarget,
  cameraTarget: target,
  localYaw: 0,
  localPitch: 0,
  delta: 1,
});
assert.equal(Math.abs(shipLookTarget.x - target.position.x) < 0.001, true);
assert.equal(shipLookTarget.z < target.position.z, true);
assert.equal(Math.abs(shipCameraPosition.x - target.position.x) < 0.001, true);
assert.equal(shipCameraPosition.z > target.position.z, true);

console.log('battle royal drop view tests passed');
