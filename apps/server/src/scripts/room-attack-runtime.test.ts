import assert from 'node:assert/strict';
import {
  BLAZE_BOMB_AEGIS_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  PHANTOM_DIRE_BALL_COLLISION_RADIUS,
} from '@voxel-strike/shared';
import {
  buildAttackImpactHint,
  getAttackDamageResolutionPlan,
  getAttackCastKind,
  getAttackPreflightRejection,
  getChronosAegisCollisionRadiusForAttack,
  getRoomAttackConfig,
  withHookshotHeavyAttackTargetHint,
} from '../rooms/roomAttackRuntime';

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
  }), { reason: 'blaze_primary_no_ammo', logEvent: false });
}

{
  assert.equal(getChronosAegisCollisionRadiusForAttack({ damageType: 'bomb' }), BLAZE_BOMB_AEGIS_COLLISION_RADIUS);
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
