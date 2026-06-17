import assert from 'node:assert/strict';
import type { PackedPlayerTransform, PlayerVitalsSnapshot, Vec3 } from '@voxel-strike/shared';
import { Player } from '../rooms/schema/Player';
import {
  ReplicationFrameRuntime,
  buildPlayerInterestStreamMessage,
  buildPlayerTransformsStreamMessage,
  buildPlayerVitalsStreamMessage,
  collectRecipientPlayerStateStreams,
  createVisibilityInterestPlayer,
  getPlayerStateStreamBroadcastPlan,
} from '../rooms/replicationFrameRuntime';
import { VisibilityInterestManager } from '../rooms/visibilityInterest';

function player(input: {
  id: string;
  team?: string;
  state?: string;
  x?: number;
  y?: number;
  z?: number;
}): Player {
  const result = new Player();
  result.id = input.id;
  result.name = input.id;
  result.team = input.team ?? 'red';
  result.heroId = 'phantom';
  result.state = input.state ?? 'alive';
  result.position.x = input.x ?? 0;
  result.position.y = input.y ?? 1;
  result.position.z = input.z ?? 0;
  return result;
}

function transform(id: string): PackedPlayerTransform {
  const netId = id.charCodeAt(0);
  return [netId, netId + 1, netId + 2, netId + 3, 0, 0, 0, 0, 0, 1, 0, 1, 255];
}

function createRuntime(options: {
  collisionRevision?: number;
  hasLineOfSight?: (from: Vec3, to: Vec3) => boolean;
  getRecentCombatRevealUntil?: (recipientId: string, targetId: string) => number;
} = {}): ReplicationFrameRuntime {
  return new ReplicationFrameRuntime({
    visibilityInterest: new VisibilityInterestManager(),
    getMovementCollisionRevision: () => options.collisionRevision ?? 0,
    hasLineOfSight: options.hasLineOfSight ?? (() => true),
    getRecentCombatRevealUntil: options.getRecentCombatRevealUntil ?? (() => 0),
    buildPackedTransform: (id) => transform(id),
  });
}

{
  assert.deepEqual(getPlayerStateStreamBroadcastPlan({
    transforms: false,
    vitals: true,
    forceVitals: false,
    now: 1_100,
    lastVitalsBroadcastAt: 1_000,
    lastInterestBroadcastAt: 950,
    vitalsIntervalMs: 125,
    interestIntervalMs: 200,
  }), {
    shouldBroadcastVitals: false,
    shouldBroadcastInterest: false,
    shouldBroadcastTransforms: false,
  });

  assert.deepEqual(getPlayerStateStreamBroadcastPlan({
    transforms: false,
    vitals: true,
    forceVitals: false,
    now: 1_200,
    lastVitalsBroadcastAt: 1_000,
    lastInterestBroadcastAt: 950,
    vitalsIntervalMs: 125,
    interestIntervalMs: 200,
  }), {
    shouldBroadcastVitals: true,
    shouldBroadcastInterest: true,
    shouldBroadcastTransforms: false,
  });

  assert.deepEqual(getPlayerStateStreamBroadcastPlan({
    transforms: false,
    vitals: true,
    forceVitals: true,
    now: 1_010,
    lastVitalsBroadcastAt: 1_000,
    lastInterestBroadcastAt: 1_000,
    vitalsIntervalMs: 125,
    interestIntervalMs: 200,
  }), {
    shouldBroadcastVitals: true,
    shouldBroadcastInterest: true,
    shouldBroadcastTransforms: false,
  });

  assert.deepEqual(getPlayerStateStreamBroadcastPlan({
    transforms: true,
    vitals: false,
    forceVitals: true,
    now: 1_010,
    lastVitalsBroadcastAt: 1_000,
    lastInterestBroadcastAt: 1_000,
    vitalsIntervalMs: 125,
    interestIntervalMs: 200,
  }), {
    shouldBroadcastVitals: false,
    shouldBroadcastInterest: false,
    shouldBroadcastTransforms: true,
  });
}

{
  const runtime = createRuntime({ collisionRevision: 7 });
  const red = player({ id: 'red' });
  const blue = player({ id: 'blue', team: 'blue', state: 'spawning' });
  const spectator = player({ id: 'spectator', state: 'spectating' });
  const frame = runtime.buildFrameContext(new Map([
    [red.id, red],
    [blue.id, blue],
    [spectator.id, spectator],
  ]), 1_000);

  assert.equal(frame.now, 1_000);
  assert.equal(frame.visibilityContext.now, 1_000);
  assert.equal(frame.visibilityContext.collisionRevision, 7);
  assert.deepEqual([...frame.currentIds].sort(), ['blue', 'red', 'spectator']);
  assert.deepEqual(frame.packedTransforms.get('red'), transform('red'));
  assert.deepEqual(frame.packedTransforms.get('blue'), transform('blue'));
  assert.equal(frame.packedTransforms.has('spectator'), false);
  assert.equal(frame.packedTransformSignatures.get('red'), frame.packedTransforms.get('red'));

  frame.recipientInterests.set('missing', new Map());
  frame.fullVitalsByPlayer.set('red', {} as PlayerVitalsSnapshot);
  frame.visibleEnemyVitalsByPlayer.set('blue', {} as PlayerVitalsSnapshot);
  frame.publicEnemyVitalsByPlayer.set('blue:hidden', {} as PlayerVitalsSnapshot);

  const nextFrame = runtime.buildFrameContext(new Map([[red.id, red]]), 1_100);
  assert.equal(nextFrame, frame);
  assert.deepEqual([...nextFrame.currentIds], ['red']);
  assert.equal(nextFrame.recipientInterests.has('missing'), false);
  assert.equal(nextFrame.fullVitalsByPlayer.size, 0);
  assert.equal(nextFrame.visibleEnemyVitalsByPlayer.size, 0);
  assert.equal(nextFrame.publicEnemyVitalsByPlayer.size, 0);
}

{
  let lineOfSightChecks = 0;
  const runtime = createRuntime({
    hasLineOfSight: () => {
      lineOfSightChecks++;
      return true;
    },
  });
  const recipient = player({ id: 'red', x: 0 });
  const target = player({ id: 'blue', team: 'blue', x: 20 });
  const frame = runtime.buildFrameContext(new Map([
    [recipient.id, recipient],
    [target.id, target],
  ]), 2_000);

  const decision = runtime.getRecipientInterest(recipient, target, 2_000, frame);
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'line_of_sight');
  assert.equal(frame.recipientInterests.get(recipient.id)?.get(target.id), decision);
  assert.equal(lineOfSightChecks > 0, true);

  const checksAfterFirstDecision = lineOfSightChecks;
  assert.equal(runtime.getRecipientInterest(recipient, target, 2_000, frame), decision);
  assert.equal(lineOfSightChecks, checksAfterFirstDecision);
}

{
  const runtime = createRuntime({
    hasLineOfSight: () => false,
    getRecentCombatRevealUntil: () => 3_500,
  });
  const recipient = player({ id: 'red', x: 0 });
  const target = player({ id: 'blue', team: 'blue', x: 20 });

  const decision = runtime.getRecipientInterest(recipient, target, 3_000);
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'recent_combat');
}

{
  const source = player({ id: 'source', team: 'blue', state: 'spawning' });
  const visibilityPlayer = createVisibilityInterestPlayer(source);

  assert.equal(visibilityPlayer.id, source.id);
  assert.equal(visibilityPlayer.team, source.team);
  assert.equal(visibilityPlayer.state, source.state);
  assert.equal(visibilityPlayer.position, source.position);
  assert.equal(visibilityPlayer.heroId, source.heroId);
}

{
  const runtime = createRuntime();
  const red = player({ id: 'red', team: 'red' });
  const blue = player({ id: 'blue', team: 'blue' });
  const spectator = player({ id: 'spectator', state: 'spectating' });
  const players = new Map([
    [red.id, red],
    [blue.id, blue],
    [spectator.id, spectator],
  ]);
  const frame = runtime.buildFrameContext(players, 4_000);
  const vitalsState = {
    signatures: new Map<string, PlayerVitalsSnapshot>(),
    reconcileAt: new Map<string, number>(),
    knownPlayerIds: new Set(['stale']),
  };
  const interestSignatures = new Map<string, string>([['stale', 'old']]);
  const transformState = {
    signatures: new Map<string, PackedPlayerTransform>([['blue', transform('blue')]]),
    heartbeatAt: new Map<string, number>(),
  };

  const collection = collectRecipientPlayerStateStreams({
    players,
    recipient: red,
    recipientId: red.id,
    frameContext: frame,
    vitalsState,
    interestSignatures,
    transformState,
    globallyRemovedPlayerIds: ['globally-removed'],
    forceVitals: true,
    forceTransforms: true,
    vitalsReconcileIntervalMs: 2_500,
    buildPlayerVitalsForRecipient: (playerId) => ({ id: playerId } as unknown as PlayerVitalsSnapshot),
    getRecipientInterest: (recipient, target, now) => ({
      recipientId: recipient.id,
      targetId: target.id,
      state: 'visible',
      precision: 'full',
      expiresAt: now + 150,
      lastVisibleAt: now,
      lastKnownPosition: null,
      reason: recipient.id === target.id ? 'self' : 'line_of_sight',
    }),
    shouldSendExactEnemyState: (_recipient, playerId) => playerId !== 'blue',
    isHighRelevanceTransform: () => true,
    buildPackedTransform: (playerId) => transform(playerId),
  });

  assert.deepEqual(collection.vitalsPlayers.map((vitals) => vitals.id), ['red', 'blue', 'spectator']);
  assert.deepEqual(collection.removedPlayerIds, ['globally-removed', 'stale']);
  assert.deepEqual(collection.interestPlayers.map((interest) => interest.playerId), ['red', 'blue', 'spectator']);
  assert.equal(interestSignatures.has('stale'), false);
  assert.deepEqual(collection.transformPlayers, [transform('red')]);
  assert.deepEqual(collection.hiddenPlayerIds, ['blue']);
}

{
  assert.equal(buildPlayerVitalsStreamMessage({
    tick: 1,
    serverTime: 10,
    players: [],
    removedPlayerIds: [],
    force: false,
  }), null);
  assert.deepEqual(buildPlayerVitalsStreamMessage({
    tick: 2,
    serverTime: 20,
    players: [{ id: 'red' } as unknown as PlayerVitalsSnapshot],
    removedPlayerIds: ['gone'],
    force: false,
  }), {
    tick: 2,
    serverTime: 20,
    players: [{ id: 'red' }],
    removedPlayerIds: ['gone'],
  });

  assert.equal(buildPlayerInterestStreamMessage({
    tick: 3,
    serverTime: 30,
    players: [],
    force: false,
  }), null);
  assert.deepEqual(buildPlayerInterestStreamMessage({
    tick: 4,
    serverTime: 40,
    players: [],
    force: true,
  }), {
    tick: 4,
    serverTime: 40,
    players: [],
  });

  assert.equal(buildPlayerTransformsStreamMessage({
    tick: 5,
    serverTime: 50,
    streamEpoch: 9,
    full: false,
    players: [],
    hiddenPlayerIds: [],
  }), null);
  assert.deepEqual(buildPlayerTransformsStreamMessage({
    tick: 6,
    serverTime: 60,
    streamEpoch: 10,
    full: true,
    players: [transform('red')],
    hiddenPlayerIds: ['hidden'],
  }), {
    version: 2,
    tick: 6,
    serverTime: 60,
    streamEpoch: 10,
    full: true,
    players: [transform('red')],
    hiddenPlayerIds: ['hidden'],
  });
}

console.log('replication frame runtime tests passed');
