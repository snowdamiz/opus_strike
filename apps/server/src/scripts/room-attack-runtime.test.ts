import assert from 'node:assert/strict';
import {
  ABILITY_DEFINITIONS,
  BLAZE_BOMB_AEGIS_COLLISION_RADIUS,
  BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS,
  BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS,
  BLAZE_PHOSPHOR_FLARE_DAMAGE,
  BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
  BLAZE_PHOSPHOR_FLARE_RADIUS,
  BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS,
  BLAZE_SCRAPSHOT_PELLET_DAMAGE,
  BLAZE_SCRAPSHOT_RANGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  HOOKSHOT_DRAG_HOOK_COOLDOWN_MS,
  HOOKSHOT_DRAG_HOOK_COOLDOWN_SECONDS,
  HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS,
  PHANTOM_DIRE_BALL_COLLISION_RADIUS,
} from '@voxel-strike/shared';
import {
  buildAttackImpactHint,
  getAttackDamageResolutionPlan,
  getAttackCastKind,
  getAttackPreflightRejection,
  getChronosAegisCollisionRadiusForAttack,
  getRoomAttackConfig,
  shouldResolveBlazeSecondaryAttack,
  withHookshotHeavyAttackTargetHint,
} from '../rooms/roomAttackRuntime';

{
  const attack = getRoomAttackConfig({
    heroId: 'blaze',
    mode: 'primary',
    chronosAscendantActive: false,
    blazePrimarySkill: 'scrapshot',
  });

  assert.equal(attack?.damageType, 'scrapshot');
  assert.equal(attack?.damage, BLAZE_SCRAPSHOT_PELLET_DAMAGE);
  assert.equal(attack?.range, BLAZE_SCRAPSHOT_RANGE);
  assert.equal(attack?.collisionRadius, BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS);
}

{
  const attack = getRoomAttackConfig({
    heroId: 'blaze',
    mode: 'secondary',
    chronosAscendantActive: false,
    blazeSecondarySkill: 'phosphor_flare',
  });

  assert.equal(attack?.damageType, 'phosphor_flare');
  assert.equal(attack?.damage, BLAZE_PHOSPHOR_FLARE_DAMAGE);
  assert.equal(attack?.range, BLAZE_PHOSPHOR_FLARE_MAX_RANGE);
  assert.equal(attack?.radius, BLAZE_PHOSPHOR_FLARE_RADIUS);
  assert.equal(attack?.cooldownMs, BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS);
  assert.equal(attack?.collisionRadius, BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS);
}

{
  assert.equal(shouldResolveBlazeSecondaryAttack({
    skill: 'phosphor_flare',
    secondaryFire: true,
    previousSecondaryFire: false,
  }), true);
  assert.equal(shouldResolveBlazeSecondaryAttack({
    skill: 'phosphor_flare',
    secondaryFire: false,
    previousSecondaryFire: true,
  }), false);
  assert.equal(shouldResolveBlazeSecondaryAttack({
    skill: 'meteor_strike',
    secondaryFire: true,
    previousSecondaryFire: false,
  }), false);
  assert.equal(shouldResolveBlazeSecondaryAttack({
    skill: 'meteor_strike',
    secondaryFire: false,
    previousSecondaryFire: true,
  }), true);
}

{
  const attack = getRoomAttackConfig({
    heroId: 'phantom',
    mode: 'primary',
    chronosAscendantActive: false,
  });

  assert.equal(attack?.damageType, 'dire_ball');
  assert.equal(attack?.collisionRadius, PHANTOM_DIRE_BALL_COLLISION_RADIUS);
}

{
  const attack = getRoomAttackConfig({
    heroId: 'hookshot',
    mode: 'secondary',
    chronosAscendantActive: false,
  });

  assert.equal(attack?.damageType, 'drag_hook');
  assert.equal(attack?.cooldownMs, HOOKSHOT_DRAG_HOOK_COOLDOWN_MS);
  assert.equal(ABILITY_DEFINITIONS.hookshot_heavy_attack.cooldown, HOOKSHOT_DRAG_HOOK_COOLDOWN_SECONDS);
  assert.equal(HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS, 1_500);
}

{
  const attack = getRoomAttackConfig({
    heroId: 'chronos',
    mode: 'primary',
    chronosAscendantActive: true,
  });

  assert.equal(attack?.damageType, 'ascendant_verdant_pulse');
  assert.equal(attack?.damage, CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE);
  assert.equal(attack?.cooldownMs, CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS);
  assert.equal(attack?.radius, CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS);
  assert.equal(attack?.collisionRadius, CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS);
  assert.equal(attack?.range, 42);
}

{
  assert.equal(getRoomAttackConfig({
    heroId: 'chronos',
    mode: 'secondary',
    chronosAscendantActive: true,
  }), null);
}

{
  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: false,
    playerState: 'alive',
    mode: 'primary',
    attackExists: true,
    isCoolingDown: false,
    phantomPrimaryReady: true,
    chronosPrimaryReady: true,
    phantomPrimaryShotAvailable: true,
    blazePrimaryShotAvailable: true,
    chronosPrimaryShotAvailable: true,
  }), { reason: 'attack_invalid_state:primary', logEvent: true });

  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: true,
    playerState: 'alive',
    mode: 'secondary',
    attackExists: false,
    isCoolingDown: false,
    phantomPrimaryReady: true,
    chronosPrimaryReady: true,
    phantomPrimaryShotAvailable: true,
    blazePrimaryShotAvailable: true,
    chronosPrimaryShotAvailable: true,
  }), { reason: 'attack_missing_config:secondary', logEvent: true });

  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: true,
    playerState: 'alive',
    mode: 'primary',
    attackExists: true,
    isCoolingDown: true,
    phantomPrimaryReady: false,
    chronosPrimaryReady: false,
    phantomPrimaryShotAvailable: false,
    blazePrimaryShotAvailable: false,
    chronosPrimaryShotAvailable: false,
  }), { reason: 'attack_cooldown:primary', logEvent: false });

  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: true,
    playerState: 'alive',
    mode: 'primary',
    attackExists: true,
    isCoolingDown: false,
    phantomPrimaryReady: true,
    chronosPrimaryReady: true,
    phantomPrimaryShotAvailable: false,
    blazePrimaryShotAvailable: true,
    chronosPrimaryShotAvailable: true,
  }), { reason: 'phantom_primary_no_ammo', logEvent: false });

  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: true,
    playerState: 'alive',
    mode: 'primary',
    attackExists: true,
    isCoolingDown: false,
    phantomPrimaryReady: true,
    chronosPrimaryReady: true,
    phantomPrimaryShotAvailable: true,
    blazePrimaryShotAvailable: false,
    chronosPrimaryShotAvailable: true,
  }), { reason: 'blaze_primary_no_ammo', logEvent: false });

  assert.deepEqual(getAttackPreflightRejection({
    isHeroId: true,
    playerState: 'alive',
    mode: 'primary',
    attackExists: true,
    isCoolingDown: false,
    phantomPrimaryReady: true,
    chronosPrimaryReady: true,
    phantomPrimaryShotAvailable: true,
    blazePrimaryShotAvailable: true,
    chronosPrimaryShotAvailable: false,
  }), { reason: 'chronos_primary_no_ammo', logEvent: false });
}

{
  assert.equal(getChronosAegisCollisionRadiusForAttack({ damageType: 'bomb' }), BLAZE_BOMB_AEGIS_COLLISION_RADIUS);
  assert.equal(getChronosAegisCollisionRadiusForAttack({ damageType: 'scrapshot' }), BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS);
  assert.equal(getChronosAegisCollisionRadiusForAttack({ damageType: 'phosphor_flare' }), BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS);
  assert.equal(getChronosAegisCollisionRadiusForAttack({ damageType: 'missing' }), 0);
}

{
  assert.deepEqual(buildAttackImpactHint({
    aegisBlocksAttack: true,
    aegisPoint: { x: 1, y: 2, z: 3 },
  }), {
    impactPosition: { x: 1, y: 2, z: 3 },
    interceptedByChronosAegis: true,
  });
  assert.deepEqual(buildAttackImpactHint({
    aegisBlocksAttack: false,
    aegisPoint: { x: 1, y: 2, z: 3 },
  }), {});
}

{
  assert.equal(getAttackCastKind({ heroId: 'phantom', mode: 'primary' }), 'phantom_dire_ball');
  assert.equal(getAttackCastKind({ heroId: 'hookshot', mode: 'secondary' }), 'hookshot_heavy_attack');
  assert.equal(getAttackCastKind({ heroId: 'chronos', mode: 'primary' }), 'chronos_verdant_pulse');
  assert.equal(getAttackCastKind({ heroId: 'chronos', mode: 'secondary' }), null);
}

{
  assert.deepEqual(withHookshotHeavyAttackTargetHint({
    impactHint: { impactPosition: { x: 0, y: 1, z: 2 } },
    mode: 'secondary',
    aegisBlocksAttack: false,
    targetId: 'enemy-a',
  }), {
    impactPosition: { x: 0, y: 1, z: 2 },
    targetIds: ['enemy-a'],
  });

  assert.deepEqual(withHookshotHeavyAttackTargetHint({
    impactHint: {},
    mode: 'secondary',
    aegisBlocksAttack: true,
    targetId: 'enemy-a',
  }), {
    targetIds: undefined,
  });
}

{
  assert.deepEqual(getAttackDamageResolutionPlan({
    heroId: 'phantom',
    mode: 'primary',
    aegisBlocksAttack: true,
    hasPrimaryTarget: true,
    attackRadius: 0,
  }), {
    action: 'chronos_aegis_absorb',
    startHookshotDragPull: false,
  });

  assert.deepEqual(getAttackDamageResolutionPlan({
    heroId: 'phantom',
    mode: 'primary',
    aegisBlocksAttack: false,
    hasPrimaryTarget: false,
    attackRadius: 5,
  }), {
    action: 'none',
    startHookshotDragPull: false,
  });

  assert.deepEqual(getAttackDamageResolutionPlan({
    heroId: 'chronos',
    mode: 'primary',
    aegisBlocksAttack: false,
    hasPrimaryTarget: true,
    attackRadius: 7,
  }), {
    action: 'area_damage',
    startHookshotDragPull: false,
  });

  assert.deepEqual(getAttackDamageResolutionPlan({
    heroId: 'hookshot',
    mode: 'secondary',
    aegisBlocksAttack: false,
    hasPrimaryTarget: true,
    attackRadius: 0,
  }), {
    action: 'direct_damage',
    startHookshotDragPull: true,
  });
}

console.log('room attack runtime tests passed');
