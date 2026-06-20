import assert from 'node:assert/strict';
import {
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
} from '@voxel-strike/shared';
import {
  BlazeFlamethrowerRuntimeTracker,
  resolveBlazeFlamethrowerDamageFrame,
  resolveBlazeFlamethrowerDamageTargets,
  resolveBlazeFlamethrowerFrameState,
} from '../rooms/blazeFlamethrowerRuntime';

{
  const state = resolveBlazeFlamethrowerFrameState({
    isFiring: true,
    fuel: 50,
    dt: 0.5,
    tempoMultiplier: 2,
  });

  assert.deepEqual(state, {
    active: true,
    fuel: 50 - BLAZE_FLAMETHROWER_FUEL_DRAIN,
    isJetpacking: true,
    shouldApplyDamage: true,
  });
}

{
  const state = resolveBlazeFlamethrowerFrameState({
    isFiring: true,
    fuel: 1,
    dt: 1,
    tempoMultiplier: 1,
  });

  assert.deepEqual(state, {
    active: true,
    fuel: 0,
    isJetpacking: true,
    shouldApplyDamage: true,
  });
}

{
  const state = resolveBlazeFlamethrowerFrameState({
    isFiring: true,
    fuel: 0,
    dt: 0.5,
    tempoMultiplier: 1,
  });

  assert.deepEqual(state, {
    active: false,
    fuel: BLAZE_FLAMETHROWER_FUEL_REGEN * 0.5,
    isJetpacking: false,
    shouldApplyDamage: false,
  });
}

{
  const state = resolveBlazeFlamethrowerFrameState({
    isFiring: false,
    fuel: BLAZE_FLAMETHROWER_MAX_FUEL - 1,
    dt: 1,
    tempoMultiplier: 2,
  });

  assert.deepEqual(state, {
    active: false,
    fuel: BLAZE_FLAMETHROWER_MAX_FUEL,
    isJetpacking: false,
    shouldApplyDamage: false,
  });
}

{
  assert.deepEqual(resolveBlazeFlamethrowerDamageFrame({
    origin: { x: 0, y: 1, z: 0 },
    terrainHit: { x: 0, y: 1, z: 4 },
    range: 9,
    collisionRadius: 0.5,
    playerRadius: 0.4,
    hitboxPadding: 0.2,
    baseDamageIntervalMs: 250,
    tempoMultiplier: 2,
  }), {
    flameDistance: 4,
    candidateRange: 10.1,
    damageIntervalMs: 125,
  });
}

{
  assert.deepEqual(resolveBlazeFlamethrowerDamageFrame({
    origin: { x: 0, y: 1, z: 0 },
    terrainHit: { x: 0, y: 1, z: 12 },
    range: 9,
    collisionRadius: 0.5,
    playerRadius: 0.4,
    hitboxPadding: 0.2,
    baseDamageIntervalMs: 250,
    tempoMultiplier: 1,
  }), {
    flameDistance: 9,
    candidateRange: 10.1,
    damageIntervalMs: 250,
  });
}

{
  assert.deepEqual(resolveBlazeFlamethrowerDamageFrame({
    origin: { x: 1, y: 2, z: 3 },
    terrainHit: null,
    range: 9,
    collisionRadius: 0.5,
    playerRadius: 0.4,
    hitboxPadding: 0.2,
    baseDamageIntervalMs: 250,
    tempoMultiplier: 0.5,
  }), {
    flameDistance: 9,
    candidateRange: 10.1,
    damageIntervalMs: 500,
  });
}

{
  const plan = resolveBlazeFlamethrowerDamageTargets({
    candidates: [
      { player: 'player-a', distance: 4 },
      { player: 'player-b', distance: 7 },
    ],
  });

  assert.deepEqual(plan.playerHits.map((hit) => hit.player), ['player-a', 'player-b']);
  assert.equal(plan.aegisHit, null);
}

{
  const initialAegisHit = { id: 'initial-aegis', distance: 3 };
  const plan = resolveBlazeFlamethrowerDamageTargets({
    initialAegisHit,
    candidates: [
      { player: 'player-a', distance: 4 },
    ],
  });

  assert.deepEqual(plan.playerHits.map((hit) => hit.player), ['player-a']);
  assert.equal(plan.aegisHit, initialAegisHit);
}

{
  const blockingAegisHit = { id: 'blocking-aegis', distance: 4 };
  const plan = resolveBlazeFlamethrowerDamageTargets({
    candidates: [
      { player: 'blocked-player', distance: 4, aegisHit: blockingAegisHit },
      { player: 'clear-player', distance: 5 },
    ],
  });

  assert.deepEqual(plan.playerHits.map((hit) => hit.player), ['clear-player']);
  assert.equal(plan.aegisHit, blockingAegisHit);
}

{
  const behindTargetAegisHit = { id: 'behind-target-aegis', distance: 6 };
  const plan = resolveBlazeFlamethrowerDamageTargets({
    candidates: [
      { player: 'clear-player', distance: 5, aegisHit: behindTargetAegisHit },
    ],
  });

  assert.deepEqual(plan.playerHits.map((hit) => hit.player), ['clear-player']);
  assert.equal(plan.aegisHit, null);
}

{
  const initialAegisHit = { id: 'initial-aegis', distance: 4 };
  const fartherBlockingAegisHit = { id: 'farther-blocking-aegis', distance: 5 };
  const nearerBlockingAegisHit = { id: 'nearer-blocking-aegis', distance: 2 };
  const plan = resolveBlazeFlamethrowerDamageTargets({
    initialAegisHit,
    candidates: [
      { player: 'blocked-by-farther', distance: 6, aegisHit: fartherBlockingAegisHit },
      { player: 'blocked-by-nearer', distance: 3, aegisHit: nearerBlockingAegisHit },
    ],
  });

  assert.deepEqual(plan.playerHits, []);
  assert.equal(plan.aegisHit, nearerBlockingAegisHit);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();

  assert.equal(tracker.setActive('blaze-a', true), true);
  assert.equal(tracker.setActive('blaze-a', true), false);
  assert.equal(tracker.isActive('blaze-a'), true);
  assert.deepEqual(tracker.getActivePlayerIdsSnapshot(), ['blaze-a']);

  assert.equal(tracker.setActive('blaze-a', false), true);
  assert.equal(tracker.setActive('blaze-a', false), false);
  assert.equal(tracker.isActive('blaze-a'), false);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();

  tracker.setActive('seen', true);
  tracker.setActive('missing', true);
  tracker.beginActiveFrame();
  tracker.markActiveThisFrame('seen');

  assert.deepEqual(tracker.getActivePlayerIdsMissingFromFrame(), ['missing']);

  tracker.setActive('missing', false);
  assert.deepEqual(tracker.getActivePlayerIdsMissingFromFrame(), []);

  tracker.beginActiveFrame();
  assert.deepEqual(tracker.getActivePlayerIdsMissingFromFrame(), ['seen']);

  tracker.clearPlayer('seen');
  assert.deepEqual(tracker.getActivePlayerIdsMissingFromFrame(), []);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();
  const sourceId = 'source';
  const target = { kind: 'player' as const, playerId: 'target' };
  const aegisTarget = { kind: 'aegis' as const, playerId: 'target' };

  assert.equal(tracker.consumeDamageTick(sourceId, target, 1_000, 100), true);
  assert.equal(tracker.getLastDamageTick(sourceId, target), 1_000);

  assert.equal(tracker.consumeDamageTick(sourceId, target, 1_050, 100), false);
  assert.equal(tracker.getLastDamageTick(sourceId, target), 1_000);

  assert.equal(tracker.consumeDamageTick(sourceId, target, 1_100, 100), true);
  assert.equal(tracker.getLastDamageTick(sourceId, target), 1_100);

  assert.equal(tracker.consumeDamageTick(sourceId, aegisTarget, 1_050, 100), true);
  assert.equal(tracker.getLastDamageTick(sourceId, aegisTarget), 1_050);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();

  tracker.consumeDamageTick('player-a', { kind: 'player', playerId: 'player-b' }, 1_000, 100);
  tracker.consumeDamageTick('player-c', { kind: 'player', playerId: 'player-a' }, 1_000, 100);
  tracker.consumeDamageTick('player-c', { kind: 'aegis', playerId: 'player-a' }, 1_000, 100);
  tracker.consumeDamageTick('player-a-extra', { kind: 'player', playerId: 'player-b' }, 1_000, 100);

  assert.equal(tracker.clearDamageTicksForPlayer('player-a'), 3);
  assert.equal(tracker.getLastDamageTick('player-a', { kind: 'player', playerId: 'player-b' }), undefined);
  assert.equal(tracker.getLastDamageTick('player-c', { kind: 'player', playerId: 'player-a' }), undefined);
  assert.equal(tracker.getLastDamageTick('player-c', { kind: 'aegis', playerId: 'player-a' }), undefined);
  assert.equal(tracker.getLastDamageTick('player-a-extra', { kind: 'player', playerId: 'player-b' }), 1_000);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();

  tracker.setActive('player-a', true);
  tracker.consumeDamageTick('player-a', { kind: 'player', playerId: 'player-b' }, 1_000, 100);

  tracker.clearPlayer('player-a');
  assert.equal(tracker.isActive('player-a'), false);
  assert.equal(tracker.getLastDamageTick('player-a', { kind: 'player', playerId: 'player-b' }), undefined);
}

{
  const tracker = new BlazeFlamethrowerRuntimeTracker();

  tracker.consumeDamageTick('player-a', { kind: 'player', playerId: 'player-b' }, 1_000, 100);
  tracker.clearDamageTicks();
  assert.equal(tracker.getLastDamageTick('player-a', { kind: 'player', playerId: 'player-b' }), undefined);
}

console.log('blaze flamethrower runtime tests passed');
