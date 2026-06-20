import assert from 'node:assert/strict';
import {
  POWERUP_BUFF_DURATION_MS,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  PowerupBoostTracker,
  PowerupPickupTracker,
  applyPowerupPickup,
  type MapPowerupPickup,
} from '../rooms/powerups';
import type { Player } from '../rooms/schema/Player';

const playerId = 'player-a';

function createPickup(overrides: Partial<MapPowerupPickup> = {}): MapPowerupPickup {
  return {
    id: overrides.id ?? 'boost-mid',
    kind: overrides.kind ?? 'powerup',
    position: overrides.position ?? { x: 1, y: 2, z: 3 },
    radius: overrides.radius ?? 1.45,
    respawnSeconds: overrides.respawnSeconds ?? 28,
    strategicRole: overrides.strategicRole ?? 'midfield_contest',
  };
}

function createManifest(powerups: MapPowerupPickup[]): VoxelMapManifest {
  return { gameplay: { powerups } } as unknown as VoxelMapManifest;
}

{
  const tracker = new PowerupBoostTracker();

  tracker.setUntil(playerId, 2_000);
  assert.equal(tracker.getUntil(playerId, 1_999), 2_000);
  assert.equal(tracker.has(playerId, 1_999), true);
  assert.equal(tracker.getUntil(playerId, 2_000), null);
  assert.equal(tracker.has(playerId, 2_001), false);
  assert.equal(tracker.clear(playerId), false);
}

{
  const tracker = new PowerupBoostTracker();

  tracker.setUntil(playerId, 3_000);
  tracker.clearAll();
  assert.equal(tracker.getUntil(playerId, 2_500), null);
}

{
  const tracker = new PowerupPickupTracker();
  const boost = createPickup({ id: 'boost' });
  const health = createPickup({ id: 'health', kind: 'health_pack' });
  const manifest = createManifest([boost, health]);

  tracker.reset(manifest, 1_000);
  assert.equal(tracker.getAvailableAt(boost.id), 1_000);
  assert.equal(tracker.getAvailableAt(health.id), 1_000);

  tracker.setAvailableAt(boost.id, 2_000);
  assert.deepEqual(tracker.buildStateMessage(3_000, manifest), {
    serverTime: 3_000,
    pickups: [
      { pickupId: boost.id, availableAt: 2_000 },
      { pickupId: health.id, availableAt: 1_000 },
    ],
  });

  tracker.reset(manifest, 0);
  assert.equal(tracker.getAvailableAt(boost.id), 0);
}

{
  const tracker = new PowerupPickupTracker();

  assert.equal(tracker.getAvailableAt('late-added'), 0);
  tracker.setAvailableAt('late-added', 4_000);
  assert.equal(tracker.getAvailableAt('late-added'), 4_000);
}

{
  const boosts = new PowerupBoostTracker();
  const pickups = new PowerupPickupTracker();
  const pickup = createPickup();
  const player = { id: playerId } as unknown as Player;
  const now = 5_000;

  const result = applyPowerupPickup({
    player,
    pickup,
    now,
    powerupPickups: pickups,
    powerupBoosts: boosts,
  });

  assert.equal(result?.message.expiresAt, now + POWERUP_BUFF_DURATION_MS);
  assert.equal(boosts.getUntil(playerId, now), now + POWERUP_BUFF_DURATION_MS);
  assert.equal(pickups.getAvailableAt(pickup.id), now + pickup.respawnSeconds * 1000);
}

console.log('powerup tracker tests passed');
