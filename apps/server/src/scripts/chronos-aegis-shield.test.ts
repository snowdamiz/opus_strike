import assert from 'node:assert/strict';
import {
  CHRONOS_AEGIS_SHIELD_MAX_HP,
  CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND,
} from '@voxel-strike/shared';
import { ChronosAegisShieldTracker } from '../rooms/chronosAegisShield';

function player(overrides: Partial<{
  id: string;
  heroId: string;
  state: string;
  secondaryFire: boolean;
  ability1: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'chronos-a',
    heroId: overrides.heroId ?? 'chronos',
    state: overrides.state ?? 'alive',
    lastInput: {
      secondaryFire: overrides.secondaryFire ?? false,
      ability1: overrides.ability1 ?? false,
    },
  };
}

{
  const tracker = new ChronosAegisShieldTracker();

  assert.equal(tracker.getHp('chronos-a'), CHRONOS_AEGIS_SHIELD_MAX_HP);
  tracker.setHp('chronos-a', CHRONOS_AEGIS_SHIELD_MAX_HP + 100);
  assert.equal(tracker.getHp('chronos-a'), CHRONOS_AEGIS_SHIELD_MAX_HP);
  tracker.setHp('chronos-a', -50);
  assert.equal(tracker.getHp('chronos-a'), 0);
  assert.equal(tracker.clear('chronos-a'), true);
  assert.equal(tracker.clear('chronos-a'), false);
  assert.equal(tracker.getRatio('chronos-a'), 1);
}

{
  const tracker = new ChronosAegisShieldTracker();
  tracker.setHp('chronos-a', 10);

  assert.equal(tracker.isHeld(player({ secondaryFire: true })), true);
  assert.equal(tracker.isHeld(player({ secondaryFire: true, ability1: true })), false);
  assert.equal(tracker.isActive(player({ secondaryFire: true })), true);

  tracker.setHp('chronos-a', 0);
  assert.equal(tracker.isActive(player({ secondaryFire: true })), false);
}

{
  const tracker = new ChronosAegisShieldTracker();
  tracker.setHp('chronos-a', 10);
  tracker.update([player({ secondaryFire: false })], 0.5);
  assert.equal(tracker.getHp('chronos-a'), 10 + CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND * 0.5);

  tracker.update([player({ secondaryFire: true })], 1);
  assert.equal(tracker.getHp('chronos-a'), 10 + CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND * 0.5);

  tracker.setHp('not-chronos', 10);
  tracker.setHp('dead-chronos', 10);
  tracker.update([
    player({ id: 'not-chronos', heroId: 'phantom' }),
    player({ id: 'dead-chronos', state: 'dead' }),
  ], 1);
  assert.equal(tracker.getHp('not-chronos'), CHRONOS_AEGIS_SHIELD_MAX_HP);
  assert.equal(tracker.getHp('dead-chronos'), CHRONOS_AEGIS_SHIELD_MAX_HP);
}

{
  const tracker = new ChronosAegisShieldTracker();
  tracker.setHp('chronos-a', 25);

  const partial = tracker.absorbDamage('chronos-a', 10);
  assert.deepEqual(partial, {
    hadShield: true,
    absorbed: 10,
    nextHp: 15,
    shieldRatio: 15 / CHRONOS_AEGIS_SHIELD_MAX_HP,
    remainingDamage: 0,
    broken: false,
  });

  const broken = tracker.absorbDamage('chronos-a', 30);
  assert.deepEqual(broken, {
    hadShield: true,
    absorbed: 15,
    nextHp: 0,
    shieldRatio: 0,
    remainingDamage: 15,
    broken: true,
  });

  const depleted = tracker.absorbDamage('chronos-a', 5);
  assert.deepEqual(depleted, {
    hadShield: false,
    absorbed: 0,
    nextHp: 0,
    shieldRatio: 0,
    remainingDamage: 5,
    broken: false,
  });
}

console.log('chronos aegis shield tests passed');
