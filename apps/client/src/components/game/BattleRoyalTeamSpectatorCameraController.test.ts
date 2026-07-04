import assert from 'node:assert/strict';
import type { BattleRoyalTeamSpectatorTarget } from './BattleRoyalTeamSpectatorCameraController';
import {
  getBattleRoyalTeamSpectatorTargets,
  getNextBattleRoyalTeamSpectatorTargetId,
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

console.log('battle royal team spectator camera tests passed');
