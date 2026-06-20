import assert from 'node:assert/strict';
import {
  HERO_OUT_OF_COMBAT_REGEN_CAP_RATIO,
  HERO_OUT_OF_COMBAT_REGEN_DELAY_MS,
  HERO_OUT_OF_COMBAT_REGEN_PER_SECOND,
} from '@voxel-strike/shared';
import { PlayerCombatActivityTracker } from '../rooms/playerCombatActivity';

function createPlayer(overrides: Partial<{
  id: string;
  health: number;
  maxHealth: number;
  state: string;
}> = {}) {
  return {
    id: overrides.id ?? 'player-a',
    health: overrides.health ?? 20,
    maxHealth: overrides.maxHealth ?? 100,
    state: overrides.state ?? 'alive',
  };
}

{
  const tracker = new PlayerCombatActivityTracker();
  const source = { id: 'source' };
  const target = { id: 'target' };

  tracker.markBetween(source, target, 1_000);
  assert.equal(tracker.getLastActivityAt('source'), 1_000);
  assert.equal(tracker.getLastActivityAt('target'), 1_000);

  tracker.markBetween(target, target, 2_000);
  assert.equal(tracker.getLastActivityAt('target'), 2_000);
  assert.equal(tracker.getLastActivityAt('source'), 1_000);

  assert.equal(tracker.clear('source'), true);
  assert.equal(tracker.clear('source'), false);
}

{
  const tracker = new PlayerCombatActivityTracker();
  const player = createPlayer({ health: 20, maxHealth: 100 });
  const now = 10_000;

  tracker.mark(player.id, now);
  assert.equal(
    tracker.updateOutOfCombatHealthRegen(player, now + HERO_OUT_OF_COMBAT_REGEN_DELAY_MS - 1, 1),
    false
  );
  assert.equal(player.health, 20);

  assert.equal(
    tracker.updateOutOfCombatHealthRegen(player, now + HERO_OUT_OF_COMBAT_REGEN_DELAY_MS, 1.5),
    true
  );
  assert.equal(player.health, 20 + HERO_OUT_OF_COMBAT_REGEN_PER_SECOND * 1.5);
}

{
  const tracker = new PlayerCombatActivityTracker();
  const cap = 200 * HERO_OUT_OF_COMBAT_REGEN_CAP_RATIO;
  const player = createPlayer({ health: cap - 1, maxHealth: 200 });

  assert.equal(tracker.updateOutOfCombatHealthRegen(player, 10_000, 10), true);
  assert.equal(player.health, cap);
  assert.equal(tracker.updateOutOfCombatHealthRegen(player, 11_000, 10), false);
  assert.equal(player.health, cap);
}

{
  const tracker = new PlayerCombatActivityTracker();
  const alive = createPlayer({ id: 'alive', health: 10 });
  const dead = createPlayer({ id: 'dead', health: 10, state: 'dead' });

  assert.equal(tracker.updateOutOfCombatHealthRegens([alive, dead], 10_000, 1), 1);
  assert.equal(alive.health, 20);
  assert.equal(dead.health, 10);
}

{
  const tracker = new PlayerCombatActivityTracker();
  const player = createPlayer({ health: 0 });

  assert.equal(tracker.updateOutOfCombatHealthRegen(player, 10_000, 1), false);
  assert.equal(player.health, 0);
}

console.log('player combat activity tests passed');
