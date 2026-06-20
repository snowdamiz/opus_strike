import assert from 'node:assert/strict';
import {
  BLAZE_GEARSTORM_DURATION_SECONDS,
  HOOKSHOT_GROUND_HOOKS_RADIUS,
  HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
} from '@voxel-strike/shared';
import {
  HOOKSHOT_ANCHOR_WALL_DURATION,
  HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
  buildChronosLifelineCastPlan,
  buildHookshotAnchorWallPlan,
  buildHookshotGrappleCastPayload,
  buildHookshotGroundHooksCastPayload,
  buildStandardAbilityCastPlan,
  getAbilityUsePreflightRejection,
  type AbilityCasterSnapshot,
} from '../rooms/roomAbilityCastRuntime';

const NOW = 10_000;

function caster(overrides: Partial<AbilityCasterSnapshot> = {}): AbilityCasterSnapshot {
  return {
    id: 'player-a',
    team: 'red',
    heroId: 'chronos',
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 0.5, y: 1.5, z: -0.5 },
    lookYaw: Math.PI / 2,
    lookPitch: 0,
    ...overrides,
  };
}

{
  assert.deepEqual(
    getAbilityUsePreflightRejection({
      playerState: 'dead',
      heroId: 'chronos',
      isHeroId: true,
      slot: 'ability1',
      abilityId: 'chronos_lifeline_conduit',
      chronosLifelineMode: 'self',
      chronosLifelineTargetCount: 1,
      hasHookshotGrappleTarget: true,
      phantomPrimaryReloading: false,
      rootedAndBlocked: false,
    }),
    { reason: 'invalid_state:ability1', logEvent: true }
  );

  assert.deepEqual(
    getAbilityUsePreflightRejection({
      playerState: 'alive',
      heroId: 'chronos',
      isHeroId: true,
      slot: 'ability1',
      abilityId: 'chronos_lifeline_conduit',
      chronosLifelineMode: undefined,
      chronosLifelineTargetCount: 1,
      hasHookshotGrappleTarget: true,
      phantomPrimaryReloading: false,
      rootedAndBlocked: false,
    }),
    { reason: 'chronos_lifeline_mode_required', logEvent: false }
  );

  assert.deepEqual(
    getAbilityUsePreflightRejection({
      playerState: 'alive',
      heroId: 'phantom',
      isHeroId: true,
      slot: 'ability2',
      abilityId: 'phantom_void_ray',
      chronosLifelineMode: undefined,
      chronosLifelineTargetCount: 0,
      hasHookshotGrappleTarget: true,
      phantomPrimaryReloading: true,
      rootedAndBlocked: true,
    }),
    { reason: 'phantom_reload_blocks:phantom_void_ray', logEvent: false }
  );

  assert.equal(
    getAbilityUsePreflightRejection({
      playerState: 'alive',
      heroId: 'blaze',
      isHeroId: true,
      slot: 'ability2',
      abilityId: 'blaze_rocketjump',
      chronosLifelineMode: undefined,
      chronosLifelineTargetCount: 0,
      hasHookshotGrappleTarget: true,
      phantomPrimaryReloading: false,
      rootedAndBlocked: false,
    }),
    null
  );
}

{
  assert.deepEqual(
    getAbilityUsePreflightRejection({
      playerState: 'alive',
      heroId: 'chronos',
      isHeroId: true,
      slot: 'ability1',
      abilityId: 'chronos_lifeline_conduit',
      chronosLifelineMode: 'allies',
      chronosLifelineTargetCount: 0,
      hasHookshotGrappleTarget: true,
      phantomPrimaryReloading: false,
      rootedAndBlocked: false,
    }),
    { reason: 'chronos_lifeline_no_targets', logEvent: false }
  );

  assert.deepEqual(
    getAbilityUsePreflightRejection({
      playerState: 'alive',
      heroId: 'hookshot',
      isHeroId: true,
      slot: 'ability1',
      abilityId: 'hookshot_grapple',
      chronosLifelineMode: undefined,
      chronosLifelineTargetCount: 0,
      hasHookshotGrappleTarget: false,
      phantomPrimaryReloading: false,
      rootedAndBlocked: false,
    }),
    { reason: 'hookshot_grapple_no_target', logEvent: false }
  );
}

{
  const plan = buildChronosLifelineCastPlan({
    caster: caster({ heroId: 'chronos', team: 'blue' }),
    abilityId: 'chronos_lifeline_conduit',
    castId: 'chronos_lifeline_conduit_player-a_1',
    startPosition: { x: 2, y: 3, z: 4 },
    targetIds: ['ally-a', 'ally-b'],
    mode: 'allies',
    usedAt: NOW,
  });

  assert.equal(plan.releaseAt, 10_210);
  assert.equal(plan.healAmount, 70);
  assert.deepEqual(plan.targetIds, ['ally-a', 'ally-b']);
  assert.deepEqual(plan.payload, {
    playerId: 'player-a',
    abilityId: 'chronos_lifeline_conduit',
    castId: 'chronos_lifeline_conduit_player-a_1',
    position: { x: 1, y: 2, z: 3 },
    startPosition: { x: 2, y: 3, z: 4 },
    targetIds: ['ally-a', 'ally-b'],
    mode: 'allies',
    ownerTeam: 'blue',
    serverTime: NOW,
    releaseAt: 10_210,
  });
}

{
  const payload = buildHookshotGrappleCastPayload({
    caster: caster({ heroId: 'hookshot', lookYaw: 0.25, lookPitch: -0.1 }),
    abilityId: 'hookshot_grapple',
    castId: 'hookshot_grapple_player-a_1',
    startPosition: { x: 5, y: 6, z: 7 },
    targetPosition: { x: 8, y: 9, z: 10 },
    aimDirection: { x: 0, y: 0, z: -1 },
    usedAt: NOW,
  });

  assert.deepEqual(payload, {
    playerId: 'player-a',
    abilityId: 'hookshot_grapple',
    castId: 'hookshot_grapple_player-a_1',
    position: { x: 1, y: 2, z: 3 },
    startPosition: { x: 5, y: 6, z: 7 },
    targetPosition: { x: 8, y: 9, z: 10 },
    direction: { yaw: 0.25, pitch: -0.1 },
    aimDirection: { x: 0, y: 0, z: -1 },
    ownerTeam: 'red',
    launchSide: 1,
    launchYaw: 0.25,
    serverTime: NOW,
  });
}

{
  const plan = buildHookshotAnchorWallPlan({
    caster: caster({ heroId: 'hookshot' }),
    abilityId: 'hookshot_anchor_wall',
    castId: 'hookshot_anchor_wall_player-a_1',
    startPosition: { x: 4, y: 5, z: 6 },
    direction: { x: 0.25, y: 0, z: -0.75 },
    usedAt: NOW,
  });

  assert.deepEqual(plan.wall, {
    id: 'hookshot_anchor_wall_player-a_1',
    startPosition: { x: 4, y: 5, z: 6 },
    direction: { x: 0.25, y: 0, z: -0.75 },
    startTime: NOW,
    duration: HOOKSHOT_ANCHOR_WALL_DURATION,
    maxDistance: HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE,
    ownerId: 'player-a',
    ownerTeam: 'red',
  });
  assert.equal(plan.payload.maxDistance, HOOKSHOT_ANCHOR_WALL_MAX_DISTANCE);
  assert.equal(plan.payload.duration, HOOKSHOT_ANCHOR_WALL_DURATION);
}

{
  const payload = buildHookshotGroundHooksCastPayload({
    caster: caster({ heroId: 'hookshot' }),
    abilityId: 'hookshot_ground_hooks',
    castId: 'hookshot_ground_hooks_player-a_1',
    rootTargets: [{ targetId: 'enemy-a' }, { targetId: 'enemy-b' }],
    usedAt: NOW,
  });

  assert.deepEqual(payload.targetIds, ['enemy-a', 'enemy-b']);
  assert.equal(payload.radius, HOOKSHOT_GROUND_HOOKS_RADIUS);
  assert.equal(payload.duration, HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS);
  assert.equal(payload.rootUntil, 13_000);
}

{
  const plan = buildStandardAbilityCastPlan({
    caster: caster({ heroId: 'chronos', lookYaw: Math.PI / 2 }),
    abilityId: 'chronos_timebreak',
    abilityDef: { duration: 0.35 },
    castId: 'chronos_timebreak_player-a_1',
    startedAt: { x: 1, y: 2, z: 3 },
    abilityStartPosition: { x: 3, y: 4, z: 5 },
    abilityActivatedAt: 10_210,
    usedAt: NOW,
  });

  assert.deepEqual(plan.timebreakShockwave, {
    casterId: 'player-a',
    direction: { x: -1, y: 0, z: -6.123233995736766e-17 },
    releaseAt: 10_210,
  });
  assert.equal(plan.blazeGearstorm, null);
  assert.equal(plan.payload.releaseAt, 10_210);
  assert.equal(plan.payload.radius, 11);
  assert.deepEqual(plan.payload.startPosition, { x: 3, y: 4, z: 5 });
}

{
  const plan = buildStandardAbilityCastPlan({
    caster: caster({ heroId: 'blaze' }),
    abilityId: 'blaze_airstrike',
    abilityDef: { duration: BLAZE_GEARSTORM_DURATION_SECONDS },
    castId: 'blaze_airstrike_player-a_1',
    startedAt: { x: 11, y: 12, z: 13 },
    abilityStartPosition: { x: 11, y: 12, z: 13 },
    abilityActivatedAt: NOW,
    usedAt: NOW,
  });

  assert.deepEqual(plan.blazeGearstorm, {
    startedAt: { x: 11, y: 12, z: 13 },
    usedAt: NOW,
    duration: BLAZE_GEARSTORM_DURATION_SECONDS,
  });
  assert.equal(plan.timebreakShockwave, null);
  assert.equal(plan.payload.abilityId, 'blaze_airstrike');
}

console.log('room ability cast runtime tests passed');
