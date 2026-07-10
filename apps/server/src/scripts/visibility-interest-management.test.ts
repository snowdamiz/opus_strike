import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  VisibilityInterestManager,
  type VisibilityInterestPlayer,
} from '../rooms/visibilityInterest';
import {
  buildPlayerInterestSnapshot,
  getPlayerInterestSignature,
  removeMissingPlayerInterestSignatures,
  selectChangedPlayerInterestSnapshot,
} from '../rooms/playerInterestSnapshot';
import { getPlayerLineOfSightSamplePoints, type Team, type Vec3 } from '@voxel-strike/shared';

function makePlayer(
  id: string,
  team: Team,
  x: number,
  z: number,
  options: Partial<VisibilityInterestPlayer> = {}
): VisibilityInterestPlayer {
  return {
    id,
    team,
    state: 'alive',
    position: { x, y: 1, z },
    ...options,
  };
}

function makeContext(options: {
  now?: number;
  collisionRevision?: number;
  getLineOfSightPoints?: (player: VisibilityInterestPlayer) => readonly Vec3[];
  hasLineOfSight?: (from: Vec3, to: Vec3) => boolean;
  isExplicitlyRevealed?: (recipient: VisibilityInterestPlayer, target: VisibilityInterestPlayer, now: number) => boolean;
  getRecentCombatRevealUntil?: (recipient: VisibilityInterestPlayer, target: VisibilityInterestPlayer) => number;
}) {
  return {
    now: options.now ?? 1_000,
    collisionRevision: options.collisionRevision ?? 1,
    getEyePosition: (player: VisibilityInterestPlayer) => player.position,
    getLineOfSightPoints: options.getLineOfSightPoints,
    hasLineOfSight: options.hasLineOfSight ?? (() => false),
    isExplicitlyRevealed: options.isExplicitlyRevealed,
    getRecentCombatRevealUntil: options.getRecentCombatRevealUntil,
  };
}

const self = makePlayer('red-a', 'red', 0, 0);
const teammate = makePlayer('red-b', 'red', 12, 0);
const enemy = makePlayer('blue-a', 'blue', 12, 0);

{
  const baseSnapshot = {
    playerId: 'red-b',
    state: 'visible' as const,
    reason: 'team',
    expiresAt: 1_150,
  };
  const refreshedSnapshot = {
    ...baseSnapshot,
    expiresAt: 1_350,
  };

  assert.equal(
    getPlayerInterestSignature(baseSnapshot),
    getPlayerInterestSignature(refreshedSnapshot),
    'expiry-only interest refreshes should not trigger a new broadcast signature'
  );
  assert.notEqual(
    getPlayerInterestSignature(baseSnapshot),
    getPlayerInterestSignature({ ...baseSnapshot, state: 'hidden' }),
    'state changes must still trigger a new broadcast signature'
  );
  assert.notEqual(
    getPlayerInterestSignature(baseSnapshot),
    getPlayerInterestSignature({
      ...baseSnapshot,
      state: 'last_known',
      reason: 'last_known',
      lastKnownPosition: { x: 4, y: 1, z: -2 },
    }),
    'last-known position changes must still trigger a new broadcast signature'
  );
}

{
  const signatures = new Map<string, string>();
  const visibleSnapshot = {
    playerId: 'blue-a',
    state: 'visible' as const,
    reason: 'line_of_sight',
  };

  assert.equal(selectChangedPlayerInterestSnapshot({
    signatures,
    playerId: visibleSnapshot.playerId,
    snapshot: visibleSnapshot,
    force: false,
  }), visibleSnapshot);
  assert.equal(signatures.get(visibleSnapshot.playerId), getPlayerInterestSignature(visibleSnapshot));

  assert.equal(selectChangedPlayerInterestSnapshot({
    signatures,
    playerId: visibleSnapshot.playerId,
    snapshot: visibleSnapshot,
    force: false,
  }), null);

  assert.equal(selectChangedPlayerInterestSnapshot({
    signatures,
    playerId: visibleSnapshot.playerId,
    snapshot: visibleSnapshot,
    force: true,
  }), visibleSnapshot);

  const hiddenSnapshot = {
    ...visibleSnapshot,
    state: 'hidden' as const,
    reason: 'hidden',
  };
  assert.equal(selectChangedPlayerInterestSnapshot({
    signatures,
    playerId: hiddenSnapshot.playerId,
    snapshot: hiddenSnapshot,
    force: false,
  }), hiddenSnapshot);
  assert.equal(signatures.get(hiddenSnapshot.playerId), getPlayerInterestSignature(hiddenSnapshot));
}

{
  const signatures = new Map([
    ['stale', 'hidden:hidden:'],
    ['current', 'visible:team:'],
  ]);

  assert.deepEqual(removeMissingPlayerInterestSignatures(signatures, new Set(['current'])), ['stale']);
  assert.equal(signatures.has('stale'), false);
  assert.equal(signatures.has('current'), true);
}

{
  const manager = new VisibilityInterestManager({ visibleTtlMs: 150 });
  const decision = manager.getRecipientInterest(self, teammate, makeContext({ now: 1_000 }));
  const snapshot = buildPlayerInterestSnapshot(teammate.id, decision);

  assert.equal(snapshot.state, 'visible');
  assert.equal(snapshot.reason, 'team');
  assert.equal('expiresAt' in snapshot, false);
}

{
  const manager = new VisibilityInterestManager();
  const decision = manager.getRecipientInterest(self, self, makeContext({}));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'self');
}

{
  let losChecks = 0;
  const manager = new VisibilityInterestManager();
  const decision = manager.getRecipientInterest(self, teammate, makeContext({
    hasLineOfSight: () => {
      losChecks++;
      return false;
    },
  }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'team');
  assert.equal(losChecks, 0);
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const decision = manager.getRecipientInterest(self, enemy, makeContext({ hasLineOfSight: () => false }));
  assert.equal(decision.state, 'hidden');
  assert.equal(decision.reason, 'hidden');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const decision = manager.getRecipientInterest(self, enemy, makeContext({ hasLineOfSight: () => true }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'line_of_sight');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const downedEnemy = makePlayer('blue-downed', 'blue', 12, 0, { state: 'downed' });
  const decision = manager.getRecipientInterest(self, downedEnemy, makeContext({ hasLineOfSight: () => true }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'line_of_sight');
}

{
  let losChecks = 0;
  const manager = new VisibilityInterestManager({
    proximityRevealMeters: 1,
    maxPerceptionMeters: 20,
  });
  const droppingEnemy = makePlayer('blue-dropping', 'blue', 100, 0, { state: 'dropping' });
  const decision = manager.getRecipientInterest(self, droppingEnemy, makeContext({
    hasLineOfSight: () => {
      losChecks++;
      return false;
    },
  }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'deployment');
  assert.equal(losChecks, 0);
}

{
  const manager = new VisibilityInterestManager({
    proximityRevealMeters: 1,
    visibleTtlMs: 1,
    hiddenTtlMs: 1,
    lineOfSightTtlMs: 1,
    lastKnownTtlMs: 100,
    visibilityLossGraceMs: 20,
  });
  assert.equal(manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_000,
    hasLineOfSight: () => true,
  })).state, 'visible');
  const graceVisible = manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_010,
    hasLineOfSight: () => false,
  }));
  assert.equal(graceVisible.state, 'visible');
  const stillGraceVisible = manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_019,
    hasLineOfSight: () => false,
  }));
  assert.equal(stillGraceVisible.state, 'visible');
  const lastKnown = manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_021,
    hasLineOfSight: () => false,
  }));
  assert.equal(lastKnown.state, 'last_known');
  assert.deepEqual(lastKnown.lastKnownPosition, enemy.position);
  const hidden = manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_140,
    hasLineOfSight: () => false,
  }));
  assert.equal(hidden.state, 'hidden');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const targetPoints = [
    { x: 12, y: 0.2, z: 0 },
    { x: 12, y: 1.7, z: 0 },
  ];
  const decision = manager.getRecipientInterest(self, enemy, makeContext({
    getLineOfSightPoints: () => targetPoints,
    hasLineOfSight: (_from, to) => to.y > 1,
  }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'line_of_sight');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const cornerVisibleEnemy = makePlayer('blue-corner', 'blue', 12, 0, { heroId: 'blaze' });
  const checkedTargets: Vec3[] = [];
  const decision = manager.getRecipientInterest(self, cornerVisibleEnemy, makeContext({
    getLineOfSightPoints: getPlayerLineOfSightSamplePoints,
    hasLineOfSight: (_from, to) => {
      checkedTargets.push(to);
      return to.x > 12.4 && to.z > 0.4;
    },
  }));

  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'line_of_sight');
  assert.ok(
    checkedTargets.some((point) => point.x > 12.4 && point.z > 0.4),
    'hero LOS samples should include exposed diagonal body corners'
  );
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const decision = manager.getRecipientInterest(self, enemy, makeContext({
    hasLineOfSight: () => false,
    isExplicitlyRevealed: () => true,
  }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'explicit_reveal');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const decision = manager.getRecipientInterest(self, enemy, makeContext({
    hasLineOfSight: () => false,
    getRecentCombatRevealUntil: () => 2_000,
  }));
  assert.equal(decision.state, 'visible');
  assert.equal(decision.reason, 'recent_combat');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const stealthed = makePlayer('blue-stealth', 'blue', 12, 0, {
    abilities: [{ abilityId: 'phantom_veil', isActive: true }],
  });
  const hidden = manager.getRecipientInterest(self, stealthed, makeContext({ hasLineOfSight: () => true }));
  assert.equal(hidden.state, 'hidden');
  assert.equal(hidden.reason, 'stealth');

  manager.clearAll();
  const revealed = manager.getRecipientInterest(self, stealthed, makeContext({
    hasLineOfSight: () => false,
    isExplicitlyRevealed: () => true,
  }));
  assert.equal(revealed.state, 'visible');
  assert.equal(revealed.reason, 'explicit_reveal');
}

{
  const manager = new VisibilityInterestManager({ proximityRevealMeters: 1 });
  const stealthed = makePlayer('blue-stealth-map', 'blue', 12, 0, {
    abilities: new Map([['phantom_veil', { abilityId: 'phantom_veil', isActive: true }]]),
  });
  const hidden = manager.getRecipientInterest(self, stealthed, makeContext({ hasLineOfSight: () => true }));
  assert.equal(hidden.state, 'hidden');
  assert.equal(hidden.reason, 'stealth');
}

{
  let losChecks = 0;
  const manager = new VisibilityInterestManager({
    proximityRevealMeters: 1,
    maxPerceptionMeters: 20,
  });
  const farEnemy = makePlayer('blue-far', 'blue', 100, 0);
  const decision = manager.getRecipientInterest(self, farEnemy, makeContext({
    hasLineOfSight: () => {
      losChecks++;
      return true;
    },
  }));
  assert.equal(decision.state, 'hidden');
  assert.equal(decision.reason, 'distance_cutoff');
  assert.equal(losChecks, 0);
}

{
  let losResult = true;
  let losChecks = 0;
  const manager = new VisibilityInterestManager({
    proximityRevealMeters: 1,
    visibleTtlMs: 100,
    lineOfSightTtlMs: 1_000,
    visibilityLossGraceMs: 0,
  });
  assert.equal(manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_000,
    collisionRevision: 1,
    hasLineOfSight: () => {
      losChecks++;
      return losResult;
    },
  })).state, 'visible');
  assert.equal(manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_010,
    collisionRevision: 1,
    hasLineOfSight: () => {
      losChecks++;
      return losResult;
    },
  })).state, 'visible');
  losResult = false;
  assert.equal(manager.getRecipientInterest(self, enemy, makeContext({
    now: 1_020,
    collisionRevision: 2,
    hasLineOfSight: () => {
      losChecks++;
      return losResult;
    },
  })).state, 'last_known');
  assert.equal(losChecks, 2);
}

{
  const players = [
    makePlayer('red-0', 'red', 0, 0),
    makePlayer('red-1', 'red', 4, 0),
    makePlayer('red-2', 'red', 8, 0),
    makePlayer('red-3', 'red', 12, 0),
    makePlayer('blue-0', 'blue', 0, 18),
    makePlayer('blue-1', 'blue', 4, 18),
    makePlayer('blue-2', 'blue', 8, 18),
    makePlayer('blue-3', 'blue', 12, 18),
  ];
  const manager = new VisibilityInterestManager({
    proximityRevealMeters: 2,
    losQuantizationMeters: 1,
  });
  const startedAt = performance.now();
  for (let frame = 0; frame < 60; frame++) {
    for (const recipient of players) {
      for (const target of players) {
        manager.getRecipientInterest(recipient, target, makeContext({
          now: 10_000 + frame * 16,
          collisionRevision: 1,
          hasLineOfSight: (_from, to) => to.z < 12,
        }));
      }
    }
  }
  const elapsedMs = performance.now() - startedAt;
  const metrics = manager.getMetricsSnapshot();
  assert.ok(elapsedMs < 500, `synthetic 4v4 interest benchmark took ${elapsedMs.toFixed(2)}ms`);
  assert.ok(metrics.recomputeMs >= 0);
  assert.ok(metrics.losChecks < 60 * players.length * players.length);
}

console.log('visibility interest management tests passed');
