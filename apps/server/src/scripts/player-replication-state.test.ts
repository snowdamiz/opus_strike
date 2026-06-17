import assert from 'node:assert/strict';
import type { PackedPlayerTransform, PlayerVitalsSnapshot } from '@voxel-strike/shared';
import { PlayerReplicationStateTracker } from '../rooms/playerReplicationState';

const transformA: PackedPlayerTransform = [1, 10, 20, 30, 0, 0, 0, 90, 0, 1, 0, 1, 255];
const transformB: PackedPlayerTransform = [2, 11, 21, 31, 0, 0, 0, 91, 0, 1, 0, 1, 255];

function vitals(id: string): PlayerVitalsSnapshot {
  return {
    id,
    netId: 1,
    name: id,
    team: 'red',
    heroId: null,
    state: 'alive',
    isReady: true,
    isBot: false,
    rank: {
      tier: 'bronze',
      tierLabel: 'Bronze',
      division: 1,
      divisionIndex: 0,
      label: 'Bronze I',
      iconKey: 'bronze',
      isRanked: true,
      placementRemaining: 0,
    },
    health: 100,
    maxHealth: 100,
    ultimateCharge: 0,
    onFireUntil: null,
    powerupBoostUntil: null,
    hasFlag: false,
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: 1,
      isGliding: false,
      chronosAscendantStartY: undefined,
    },
    abilities: {},
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      flagCaptures: 0,
      flagReturns: 0,
    },
    respawnTime: null,
    spawnProtectionUntil: null,
    visibility: 'visible',
  };
}

{
  const tracker = new PlayerReplicationStateTracker();
  assert.equal(tracker.getStreamEpoch(), 0);

  assert.equal(tracker.getPlayerNetId('player-a'), 1);
  assert.equal(tracker.getStreamEpoch(), 1);
  assert.equal(tracker.getPlayerNetId('player-a'), 1);
  assert.equal(tracker.getStreamEpoch(), 1);

  tracker.getGlobalTransformState().signatures.set('player-a', transformA);
  tracker.getGlobalTransformState().heartbeatAt.set('player-a', 1_000);
  tracker.getTransformState('recipient-a').signatures.set('player-a', transformA);

  assert.equal(tracker.getPlayerNetId('player-b'), 2);
  assert.equal(tracker.getStreamEpoch(), 2);
  assert.equal(tracker.getGlobalTransformState().signatures.size, 0);
  assert.equal(tracker.getGlobalTransformState().heartbeatAt.size, 0);
  assert.equal(tracker.getTransformState('recipient-a').signatures.size, 0);
}

{
  const tracker = new PlayerReplicationStateTracker();
  tracker.getPlayerNetId('player-a');
  tracker.markKnownPlayer('player-a');
  tracker.markKnownPlayer('player-b');

  const vitalsState = tracker.getVitalsState('recipient-a');
  vitalsState.signatures.set('player-a', vitals('player-a'));
  vitalsState.reconcileAt.set('player-a', 1_000);
  vitalsState.knownPlayerIds.add('player-a');
  tracker.getInterestSignatures('recipient-a').set('player-a', 'visible:1');
  tracker.getTransformState('recipient-a').signatures.set('player-a', transformA);
  tracker.getTransformState('recipient-a').heartbeatAt.set('player-a', 1_000);

  tracker.clearPlayer('player-a');

  assert.equal(vitalsState.signatures.has('player-a'), false);
  assert.equal(vitalsState.reconcileAt.has('player-a'), false);
  assert.equal(vitalsState.knownPlayerIds.has('player-a'), false);
  assert.equal(tracker.getInterestSignatures('recipient-a').has('player-a'), false);
  assert.equal(tracker.getTransformState('recipient-a').signatures.has('player-a'), false);
}

{
  const tracker = new PlayerReplicationStateTracker();
  tracker.markKnownPlayer('player-a');
  tracker.markKnownPlayer('player-b');
  tracker.getGlobalTransformState().signatures.set('player-a', transformA);
  tracker.getGlobalTransformState().signatures.set('player-b', transformB);

  assert.deepEqual(tracker.removeMissingKnownPlayers(new Set(['player-b'])), ['player-a']);
  assert.equal(tracker.getGlobalTransformState().signatures.has('player-a'), false);
  assert.equal(tracker.getGlobalTransformState().signatures.has('player-b'), false);
  assert.equal(tracker.getStreamEpoch(), 1);
}

{
  const tracker = new PlayerReplicationStateTracker();
  tracker.markRecentCombatTransform('player-a', 1_000, 250);
  tracker.markRecentCombatInterest('player-a', 'player-b', 1_000, 500);

  assert.equal(tracker.getRecentCombatTransformUntil('player-a'), 1_250);
  assert.equal(tracker.getRecentCombatInterestUntil('player-a', 'player-b'), 1_500);
  assert.equal(tracker.getRecentCombatInterestUntil('player-b', 'player-a'), 1_500);

  tracker.clearPlayer('player-a');
  assert.equal(tracker.getRecentCombatTransformUntil('player-a'), 0);
  assert.equal(tracker.getRecentCombatInterestUntil('player-a', 'player-b'), 0);
  assert.equal(tracker.getRecentCombatInterestUntil('player-b', 'player-a'), 0);
}

console.log('player replication state tests passed');
