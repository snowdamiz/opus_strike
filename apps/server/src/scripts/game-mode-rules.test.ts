import assert from 'node:assert/strict';
import {
  getAliveTeams,
  getBattleRoyalContestingTeams,
  getWinningTeam,
  resolveBattleRoyalMatchEnd,
  shouldEndGameAfterRound,
} from '../rooms/gameModeRules';

assert.equal(getWinningTeam(3, 2), 'red');
assert.equal(getWinningTeam(2, 3), 'blue');
assert.equal(getWinningTeam(2, 2), null);

assert.equal(shouldEndGameAfterRound('capture_the_flag', 2, 1, 3), false);
assert.equal(shouldEndGameAfterRound('capture_the_flag', 3, 1, 3), true);
assert.equal(shouldEndGameAfterRound('team_deathmatch', 4, 5, 30), true);
assert.equal(shouldEndGameAfterRound('battle_royal', 0, 0, 0), false);

const players = [
  { team: 'br_01', state: 'alive' },
  { team: 'br_01', state: 'dead' },
  { team: 'br_02', state: 'alive' },
  { team: null, state: 'alive' },
];
assert.deepEqual(getAliveTeams(players), ['br_01', 'br_02']);
assert.deepEqual(getBattleRoyalContestingTeams([
  ...players,
  { team: 'br_03', state: 'downed' },
  { team: 'br_04', state: 'dropping' },
  { team: 'br_05', state: 'spawning' },
]), ['br_01', 'br_02', 'br_03', 'br_04', 'br_05']);
assert.deepEqual(resolveBattleRoyalMatchEnd(players), {
  shouldEnd: false,
  winningTeam: null,
  aliveTeams: ['br_01', 'br_02'],
});
assert.deepEqual(resolveBattleRoyalMatchEnd([
  { team: 'br_04', state: 'dead' },
  { team: 'br_05', state: 'alive' },
  { team: 'br_05', state: 'alive' },
]), {
  shouldEnd: true,
  winningTeam: 'br_05',
  aliveTeams: ['br_05'],
});
assert.deepEqual(resolveBattleRoyalMatchEnd([
  { team: 'br_04', state: 'downed' },
  { team: 'br_05', state: 'alive' },
]), {
  shouldEnd: false,
  winningTeam: null,
  aliveTeams: ['br_04', 'br_05'],
});
assert.deepEqual(resolveBattleRoyalMatchEnd([
  { team: 'br_04', state: 'dead' },
  { team: 'br_05', state: 'dead' },
]), {
  shouldEnd: true,
  winningTeam: null,
  aliveTeams: [],
});

console.log('game mode rules tests passed');
