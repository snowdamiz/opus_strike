import assert from 'node:assert/strict';
import { getHudAbilityCooldownSeconds } from './HUD';

function testClientCooldownTakesPriority() {
  const now = 10_000;
  const remaining = getHudAbilityCooldownSeconds({
    now,
    isUltimate: false,
    canTrackAbility: true,
    showActiveTimer: false,
    clientCooldownEnd: now + 2_500,
    serverCooldownUntil: now + 6_000,
    serverCooldownRemaining: 6,
  });

  assert.equal(remaining, 2.5);
}

function testServerCooldownTicksFromDeadline() {
  const cooldownUntil = 25_000;
  const initial = getHudAbilityCooldownSeconds({
    now: 20_000,
    isUltimate: false,
    canTrackAbility: true,
    showActiveTimer: false,
    serverCooldownUntil: cooldownUntil,
    serverCooldownRemaining: 5,
  });
  const later = getHudAbilityCooldownSeconds({
    now: 23_800,
    isUltimate: false,
    canTrackAbility: true,
    showActiveTimer: false,
    serverCooldownUntil: cooldownUntil,
    serverCooldownRemaining: 5,
  });

  assert.equal(initial, 5);
  assert.equal(Math.round(later * 10) / 10, 1.2);
}

function testExpiredServerDeadlineIgnoresStaleRemainingSnapshot() {
  const now = 40_000;
  const remaining = getHudAbilityCooldownSeconds({
    now,
    isUltimate: false,
    canTrackAbility: true,
    showActiveTimer: false,
    serverCooldownUntil: now - 1,
    serverCooldownRemaining: 9,
  });

  assert.equal(remaining, 0);
}

function testUltimateIgnoresCooldowns() {
  const now = 50_000;
  const remaining = getHudAbilityCooldownSeconds({
    now,
    isUltimate: true,
    canTrackAbility: true,
    showActiveTimer: false,
    clientCooldownEnd: now + 10_000,
    serverCooldownUntil: now + 10_000,
    serverCooldownRemaining: 10,
  });

  assert.equal(remaining, 0);
}

testClientCooldownTakesPriority();
testServerCooldownTicksFromDeadline();
testExpiredServerDeadlineIgnoresStaleRemainingSnapshot();
testUltimateIgnoresCooldowns();

console.log('HUD cooldown tests passed');
