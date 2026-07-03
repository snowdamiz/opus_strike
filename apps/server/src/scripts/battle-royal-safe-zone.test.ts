import assert from 'node:assert/strict';
import { BATTLE_ROYAL_MATCH_DURATION_SECONDS, type VoxelMapManifest } from '@voxel-strike/shared';
import {
  createBattleRoyalSafeZoneState,
  isOutsideBattleRoyalSafeZone,
  updateBattleRoyalSafeZoneState,
} from '../rooms/battleRoyalSafeZone';

function advanceToFinalSafeZonePhase(
  initialState: ReturnType<typeof createBattleRoyalSafeZoneState>
): ReturnType<typeof createBattleRoyalSafeZoneState> {
  let current = initialState;
  for (let phaseCount = 0; phaseCount < 16; phaseCount++) {
    const next = updateBattleRoyalSafeZoneState(current, current.phaseEndsAt + 1);
    if (next.phaseIndex === current.phaseIndex) return next;
    current = next;
  }
  return current;
}

const manifest = {
  seed: 0x51f15eed,
  origin: { x: -80, y: 0, z: -80 },
  voxelSize: { x: 1, y: 1, z: 1 },
  size: { x: 160, y: 1, z: 160 },
  boundary: [
    { x: 72, z: 0 },
    { x: 0, z: 72 },
    { x: -72, z: 0 },
    { x: 0, z: -72 },
  ],
} as unknown as VoxelMapManifest;

const startedAt = 1_000;
const initial = createBattleRoyalSafeZoneState(manifest, startedAt);

assert.equal(initial.enabled, true);
assert.equal(initial.phaseIndex, 0);
assert.equal(initial.seed, manifest.seed);
assert.deepEqual(initial.baseCenter, { x: 0, y: 0, z: 0 });
assert.equal(initial.radius, initial.baseRadius);
assert.equal(initial.nextRadius < initial.radius, true);
assert.equal(initial.nextZoneRevealsAt, startedAt);
assert.equal(initial.damagePerSecond, 3);
assert.equal(initial.shrinking, false);
assert.equal(initial.warning, false);
assert.equal(isOutsideBattleRoyalSafeZone(initial, { x: 0, z: 0 }), false);
assert.equal(isOutsideBattleRoyalSafeZone(initial, { x: initial.radius + 0.1, z: 0 }), true);

const expectedShrinkDurationsMs = [90_000, 80_000, 70_000, 60_000, 50_000, 45_000];
let phaseForTimingChecks = initial;
expectedShrinkDurationsMs.forEach((expectedShrinkMs, phaseIndex) => {
  assert.equal(phaseForTimingChecks.phaseIndex, phaseIndex);
  assert.equal(phaseForTimingChecks.phaseEndsAt - phaseForTimingChecks.shrinkStartsAt, expectedShrinkMs);
  if (phaseIndex < expectedShrinkDurationsMs.length - 1) {
    phaseForTimingChecks = updateBattleRoyalSafeZoneState(
      phaseForTimingChecks,
      phaseForTimingChecks.phaseEndsAt + 1
    );
  }
});

const matchDurationMs = BATTLE_ROYAL_MATCH_DURATION_SECONDS * 1000;
const finalPhase = advanceToFinalSafeZonePhase(initial);
assert.equal(finalPhase.phaseEndsAt - initial.phaseStartedAt <= matchDurationMs, true);

const firstRevealBufferMs = 3_000;
const bufferedInitial = createBattleRoyalSafeZoneState(manifest, startedAt + firstRevealBufferMs, {
  firstNextZoneRevealsAt: startedAt + firstRevealBufferMs,
});
const bufferedFinalPhase = advanceToFinalSafeZonePhase(bufferedInitial);
assert.equal(bufferedFinalPhase.phaseEndsAt <= startedAt + matchDurationMs, true);

const warning = updateBattleRoyalSafeZoneState(initial, initial.shrinkStartsAt - 10_000);
assert.equal(warning.warning, true);
assert.equal(warning.shrinking, false);
assert.equal(warning.radius, initial.radius);

const halfway = updateBattleRoyalSafeZoneState(
  initial,
  initial.shrinkStartsAt + (initial.phaseEndsAt - initial.shrinkStartsAt) / 2
);
assert.equal(halfway.shrinking, true);
assert.equal(halfway.radius < initial.radius, true);
assert.equal(halfway.radius > initial.nextRadius, true);
assert.equal(isOutsideBattleRoyalSafeZone(halfway, { x: halfway.radius + Math.abs(halfway.center.x) + 2, z: halfway.center.z }), true);

const nextPhase = updateBattleRoyalSafeZoneState(initial, initial.phaseEndsAt + 1);
assert.equal(nextPhase.phaseIndex, 1);
assert.equal(nextPhase.fromRadius, initial.nextRadius);
assert.deepEqual(nextPhase.fromCenter, initial.nextCenter);
assert.equal(nextPhase.nextRadius < initial.nextRadius, true);
assert.equal(nextPhase.nextZoneRevealsAt, initial.phaseEndsAt);
assert.equal(nextPhase.damagePerSecond, 5);

const delayedRevealAt = startedAt + 45_000;
const delayedInitial = createBattleRoyalSafeZoneState(manifest, delayedRevealAt, {
  firstNextZoneRevealsAt: delayedRevealAt,
});
assert.equal(delayedInitial.phaseStartedAt, delayedRevealAt);
assert.equal(delayedInitial.nextZoneRevealsAt, delayedRevealAt);
assert.equal(delayedInitial.shrinkStartsAt, delayedRevealAt + 90_000);

const late = updateBattleRoyalSafeZoneState(initial, initial.phaseEndsAt + 1_000_000);
assert.equal(late.phaseIndex > 1, true);
assert.equal(late.radius >= 4, true);
assert.equal(late.damagePerSecond > nextPhase.damagePerSecond, true);

console.log('battle royal safe zone tests passed');
