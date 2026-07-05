import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BattleRoyalTeamSpectatorTarget } from './BattleRoyalTeamSpectatorCameraController';
import {
  getBattleRoyalTeamSpectatorTargets,
  getNextBattleRoyalTeamSpectatorTargetId,
  writeBattleRoyalSpectatorCameraOffset,
} from './BattleRoyalTeamSpectatorCameraController';

function target(
  id: string,
  name: string,
  team: string,
  state: BattleRoyalTeamSpectatorTarget['state'] = 'alive'
): BattleRoyalTeamSpectatorTarget {
  return { id, name, team, state };
}

const localPlayer = { id: 'local', team: 'br_01' };
const targets = getBattleRoyalTeamSpectatorTargets(localPlayer, [
  target('local', 'Local', 'br_01'),
  target('charlie', 'Charlie', 'br_01'),
  target('alpha', 'Alpha', 'br_01', 'downed'),
  target('dead', 'Dead', 'br_01', 'dead'),
  target('enemy', 'Enemy', 'br_02'),
]);

assert.deepEqual(
  targets.map((player) => player.id),
  ['alpha', 'charlie'],
  'BR spectator targets should include remaining alive/downed teammates sorted by name'
);

assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId(null, targets, 1),
  'alpha',
  'cycling with no current target should select the first teammate'
);
assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId('alpha', targets, 1),
  'charlie',
  'LMB/forward cycling should advance to the next teammate'
);
assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId('charlie', targets, 1),
  'alpha',
  'forward cycling should wrap around'
);
assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId('alpha', targets, -1),
  'charlie',
  'reverse cycling should wrap around'
);
assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId('missing', targets, 1),
  'alpha',
  'missing current targets should recover to the first teammate'
);
assert.equal(
  getNextBattleRoyalTeamSpectatorTargetId('alpha', [], 1),
  null,
  'cycling with no available teammates should clear the target'
);

const neutralOffset = writeBattleRoyalSpectatorCameraOffset(0, 0, false, new THREE.Vector3());
const rotatedOffset = writeBattleRoyalSpectatorCameraOffset(Math.PI / 2, 0, false, new THREE.Vector3());
const upwardLookOffset = writeBattleRoyalSpectatorCameraOffset(0, 0.7, false, new THREE.Vector3());
const downwardLookOffset = writeBattleRoyalSpectatorCameraOffset(0, -0.7, false, new THREE.Vector3());
assert.equal(neutralOffset.z > 0, true, 'neutral spectator yaw should sit behind the target');
assert.equal(
  Math.abs(rotatedOffset.x - neutralOffset.z) < 0.000001,
  true,
  'spectator yaw should rotate the follow camera around the target'
);
assert.equal(
  upwardLookOffset.y < neutralOffset.y,
  true,
  'positive spectator pitch should lower the orbit camera for upward free look'
);
assert.equal(
  downwardLookOffset.y > neutralOffset.y,
  true,
  'negative spectator pitch should raise the orbit camera for downward free look'
);

console.log('battle royal team spectator camera tests passed');
