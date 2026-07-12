import assert from 'node:assert/strict';
import {
  PHANTOM_NIGHTREIGN_DURATION_SECONDS,
  applyPhantomNightreignHit,
  getPhantomUltimateAbilityId,
  isPhantomUltimateSkill,
} from '../dist/index.js';

assert.equal(isPhantomUltimateSkill('nightreign'), true);
assert.equal(isPhantomUltimateSkill('phantom_veil'), true);
assert.equal(isPhantomUltimateSkill('invalid'), false);
assert.equal(getPhantomUltimateAbilityId('nightreign'), 'phantom_nightreign');

const now = 10_000;
const source = { health: 100, maxHealth: 180 };
const nightreign = { isActive: true, activatedAt: now - 1_000 };
const blink = { cooldownRemaining: 7.5 };
const hit = applyPhantomNightreignHit({
  source,
  nightreign,
  blink,
  appliedDamage: 18,
  killed: false,
  now,
});

assert.deepEqual(hit, {
  applied: true,
  healed: 9,
  blinkCooldownReducedBy: 1,
  durationExtendedByMs: 0,
});
assert.equal(source.health, 109);
assert.equal(blink.cooldownRemaining, 6.5);

const kill = applyPhantomNightreignHit({
  source,
  nightreign,
  blink,
  appliedDamage: 18,
  killed: true,
  now,
});
assert.equal(kill.durationExtendedByMs, 2_000);
assert.equal(nightreign.activatedAt, now + 1_000);

const expired = applyPhantomNightreignHit({
  source,
  nightreign: {
    isActive: true,
    activatedAt: now - PHANTOM_NIGHTREIGN_DURATION_SECONDS * 1_000,
  },
  blink,
  appliedDamage: 18,
  killed: true,
  now,
});
assert.equal(expired.applied, false);

console.log('phantom nightreign tests passed');
