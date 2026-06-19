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
    }],
  };
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

console.log('battle royal drop view tests passed');
