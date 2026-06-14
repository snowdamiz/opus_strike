import { performance } from 'node:perf_hooks';
import type { PlayerVisibilityState, Vec3 } from '@voxel-strike/shared';

export type InterestPrecision = 'full' | 'coarse' | 'none';

export type InterestReason =
  | 'self'
  | 'team'
  | 'invalid_target'
  | 'explicit_reveal'
  | 'recent_combat'
  | 'proximity'
  | 'distance_cutoff'
  | 'line_of_sight'
  | 'stealth'
  | 'last_known'
  | 'hidden';

export interface VisibilityInterestPlayer {
  id: string;
  team: string;
  state: string;
  position: Vec3;
  abilities?: Iterable<{ abilityId?: string; isActive?: boolean }>;
}

export interface RecipientInterestDecision {
  recipientId: string;
  targetId: string;
  state: PlayerVisibilityState;
  precision: InterestPrecision;
  expiresAt: number;
  lastVisibleAt: number;
  lastKnownPosition: Vec3 | null;
  reason: InterestReason;
}

export interface VisibilityInterestContext {
  now: number;
  collisionRevision: number;
  getEyePosition: (player: VisibilityInterestPlayer) => Vec3;
  getLineOfSightPoints?: (player: VisibilityInterestPlayer) => readonly Vec3[];
  hasLineOfSight: (from: Vec3, to: Vec3) => boolean;
  isExplicitlyRevealed?: (recipient: VisibilityInterestPlayer, target: VisibilityInterestPlayer, now: number) => boolean;
  getRecentCombatRevealUntil?: (recipient: VisibilityInterestPlayer, target: VisibilityInterestPlayer) => number;
}

export interface VisibilityInterestMetrics {
  recomputeMs: number;
  losChecks: number;
  visibleTargets: number;
  hiddenTargets: number;
  lastKnownTargets: number;
  filteredTargets: number;
  hiddenTargetLeakCount: number;
}

interface CachedInterestDecision extends RecipientInterestDecision {
  collisionRevision: number;
}

interface CachedLineOfSight {
  result: boolean;
  expiresAt: number;
  collisionRevision: number;
}

export interface VisibilityInterestOptions {
  visibleTtlMs?: number;
  hiddenTtlMs?: number;
  lineOfSightTtlMs?: number;
  proximityRevealMeters?: number;
  maxPerceptionMeters?: number;
  lastKnownTtlMs?: number;
  visibilityLossGraceMs?: number;
  losQuantizationMeters?: number;
  maxLineOfSightCacheEntries?: number;
}

const DEFAULT_VISIBLE_TTL_MS = 150;
const DEFAULT_HIDDEN_TTL_MS = 180;
const DEFAULT_LINE_OF_SIGHT_TTL_MS = 180;
const DEFAULT_PROXIMITY_REVEAL_METERS = 7.5;
const DEFAULT_MAX_PERCEPTION_METERS = 62;
const DEFAULT_LAST_KNOWN_TTL_MS = 1800;
const DEFAULT_VISIBILITY_LOSS_GRACE_MS = 320;
const DEFAULT_LOS_QUANTIZATION_METERS = 0.75;
const DEFAULT_MAX_LOS_CACHE_ENTRIES = 4096;

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function distanceSq2D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function isActiveStealthAbility(ability: { abilityId?: string; isActive?: boolean }): boolean {
  return ability.isActive === true && ability.abilityId === 'phantom_veil';
}

function hasStealthActive(player: VisibilityInterestPlayer): boolean {
  if (!player.abilities) return false;
  for (const ability of player.abilities) {
    if (isActiveStealthAbility(ability)) return true;
  }
  return false;
}

function quantize(value: number, step: number): number {
  return Math.round(value / step);
}

function makeEmptyMetrics(): VisibilityInterestMetrics {
  return {
    recomputeMs: 0,
    losChecks: 0,
    visibleTargets: 0,
    hiddenTargets: 0,
    lastKnownTargets: 0,
    filteredTargets: 0,
    hiddenTargetLeakCount: 0,
  };
}

export class VisibilityInterestManager {
  private readonly visibleTtlMs: number;
  private readonly hiddenTtlMs: number;
  private readonly lineOfSightTtlMs: number;
  private readonly proximityRevealSq: number;
  private readonly maxPerceptionSq: number;
  private readonly lastKnownTtlMs: number;
  private readonly visibilityLossGraceMs: number;
  private readonly losQuantizationMeters: number;
  private readonly maxLineOfSightCacheEntries: number;
  private readonly interestCache = new Map<string, Map<string, CachedInterestDecision>>();
  private readonly lineOfSightCache = new Map<string, CachedLineOfSight>();
  private lastMetrics: VisibilityInterestMetrics = makeEmptyMetrics();

  constructor(options: VisibilityInterestOptions = {}) {
    this.visibleTtlMs = options.visibleTtlMs ?? DEFAULT_VISIBLE_TTL_MS;
    this.hiddenTtlMs = options.hiddenTtlMs ?? DEFAULT_HIDDEN_TTL_MS;
    this.lineOfSightTtlMs = options.lineOfSightTtlMs ?? DEFAULT_LINE_OF_SIGHT_TTL_MS;
    const proximityRevealMeters = options.proximityRevealMeters ?? DEFAULT_PROXIMITY_REVEAL_METERS;
    const maxPerceptionMeters = options.maxPerceptionMeters ?? DEFAULT_MAX_PERCEPTION_METERS;
    this.proximityRevealSq = proximityRevealMeters * proximityRevealMeters;
    this.maxPerceptionSq = maxPerceptionMeters * maxPerceptionMeters;
    this.lastKnownTtlMs = options.lastKnownTtlMs ?? DEFAULT_LAST_KNOWN_TTL_MS;
    this.visibilityLossGraceMs = options.visibilityLossGraceMs ?? DEFAULT_VISIBILITY_LOSS_GRACE_MS;
    this.losQuantizationMeters = options.losQuantizationMeters ?? DEFAULT_LOS_QUANTIZATION_METERS;
    this.maxLineOfSightCacheEntries = options.maxLineOfSightCacheEntries ?? DEFAULT_MAX_LOS_CACHE_ENTRIES;
  }

  getMetricsSnapshot(): VisibilityInterestMetrics {
    return { ...this.lastMetrics };
  }

  resetMetricsWindow(): void {
    this.lastMetrics = makeEmptyMetrics();
  }

  clearAll(): void {
    this.interestCache.clear();
    this.lineOfSightCache.clear();
    this.lastMetrics = makeEmptyMetrics();
  }

  clearPlayer(playerId: string): void {
    this.interestCache.delete(playerId);
    for (const targets of this.interestCache.values()) {
      targets.delete(playerId);
    }
  }

  clearLineOfSightCache(): void {
    this.lineOfSightCache.clear();
  }

  markHiddenTargetLeak(): void {
    this.lastMetrics.hiddenTargetLeakCount++;
  }

  getRecipientInterest(
    recipient: VisibilityInterestPlayer | null,
    target: VisibilityInterestPlayer,
    context: VisibilityInterestContext
  ): RecipientInterestDecision {
    const start = performance.now();
    const previous = recipient ? this.getCachedInterest(recipient.id, target.id) : undefined;
    if (
      previous &&
      previous.expiresAt > context.now &&
      previous.collisionRevision === context.collisionRevision
    ) {
      this.recordDecision(previous, performance.now() - start);
      return previous;
    }

    const decision = this.computeRecipientInterest(recipient, target, context, previous);
    if (recipient) {
      this.setCachedInterest(recipient.id, target.id, {
        ...decision,
        collisionRevision: context.collisionRevision,
      });
    }
    this.recordDecision(decision, performance.now() - start);
    return decision;
  }

  private computeRecipientInterest(
    recipient: VisibilityInterestPlayer | null,
    target: VisibilityInterestPlayer,
    context: VisibilityInterestContext,
    previous?: RecipientInterestDecision
  ): RecipientInterestDecision {
    if (!recipient) {
      return this.visibleDecision('', target.id, context.now, 'self', target.position, previous);
    }
    if (recipient.id === target.id) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'self', target.position, previous);
    }
    if (recipient.team === target.team) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'team', target.position, previous);
    }
    if (target.state !== 'alive' && target.state !== 'spawning') {
      return this.hiddenOrLastKnownDecision(recipient.id, target.id, context.now, 'invalid_target', previous);
    }

    const explicitReveal = context.isExplicitlyRevealed?.(recipient, target, context.now) === true;
    if (explicitReveal) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'explicit_reveal', target.position, previous);
    }

    const combatRevealUntil = context.getRecentCombatRevealUntil?.(recipient, target) ?? 0;
    if (combatRevealUntil > context.now) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'recent_combat', target.position, previous);
    }

    const distanceSq = distanceSq2D(recipient.position, target.position);
    if (distanceSq <= this.proximityRevealSq) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'proximity', target.position, previous);
    }

    const stealthActive = hasStealthActive(target);
    if (stealthActive) {
      return this.hiddenOrLastKnownDecision(recipient.id, target.id, context.now, 'stealth', previous);
    }

    if (distanceSq > this.maxPerceptionSq) {
      return this.hiddenOrLastKnownDecision(recipient.id, target.id, context.now, 'distance_cutoff', previous);
    }

    const hasLos = this.hasAnyCachedLineOfSight(
      context.getEyePosition(recipient),
      context.getLineOfSightPoints?.(target) ?? [context.getEyePosition(target)],
      context
    );
    if (hasLos) {
      return this.visibleDecision(recipient.id, target.id, context.now, 'line_of_sight', target.position, previous);
    }

    if (previous && this.shouldHoldRecentVisibility(previous, context.now)) {
      return this.visibilityGraceDecision(recipient.id, target.id, context.now, previous);
    }

    return this.hiddenOrLastKnownDecision(recipient.id, target.id, context.now, 'hidden', previous);
  }

  private visibleDecision(
    recipientId: string,
    targetId: string,
    now: number,
    reason: InterestReason,
    position: Vec3,
    previous?: RecipientInterestDecision
  ): RecipientInterestDecision {
    return {
      recipientId,
      targetId,
      state: 'visible',
      precision: 'full',
      expiresAt: now + this.visibleTtlMs,
      lastVisibleAt: now,
      lastKnownPosition: cloneVec3(position),
      reason,
    };
  }

  private hiddenOrLastKnownDecision(
    recipientId: string,
    targetId: string,
    now: number,
    reason: InterestReason,
    previous?: RecipientInterestDecision
  ): RecipientInterestDecision {
    const lastVisibleAt = previous?.lastVisibleAt ?? 0;
    const lastKnownPosition = previous?.lastKnownPosition ? cloneVec3(previous.lastKnownPosition) : null;
    if (lastVisibleAt > 0 && now - lastVisibleAt <= this.lastKnownTtlMs && lastKnownPosition) {
      return {
        recipientId,
        targetId,
        state: 'last_known',
        precision: 'coarse',
        expiresAt: Math.min(now + this.hiddenTtlMs, lastVisibleAt + this.lastKnownTtlMs),
        lastVisibleAt,
        lastKnownPosition,
        reason: 'last_known',
      };
    }

    return {
      recipientId,
      targetId,
      state: 'hidden',
      precision: 'none',
      expiresAt: now + this.hiddenTtlMs,
      lastVisibleAt,
      lastKnownPosition,
      reason,
    };
  }

  private shouldHoldRecentVisibility(previous: RecipientInterestDecision | undefined, now: number): boolean {
    return Boolean(
      previous &&
      previous.state === 'visible' &&
      previous.lastVisibleAt > 0 &&
      now - previous.lastVisibleAt <= this.visibilityLossGraceMs
    );
  }

  private visibilityGraceDecision(
    recipientId: string,
    targetId: string,
    now: number,
    previous: RecipientInterestDecision
  ): RecipientInterestDecision {
    return {
      recipientId,
      targetId,
      state: 'visible',
      precision: 'full',
      expiresAt: Math.min(now + this.visibleTtlMs, previous.lastVisibleAt + this.visibilityLossGraceMs),
      lastVisibleAt: previous.lastVisibleAt,
      lastKnownPosition: previous.lastKnownPosition ? cloneVec3(previous.lastKnownPosition) : null,
      reason: 'line_of_sight',
    };
  }

  private hasAnyCachedLineOfSight(
    from: Vec3,
    targets: readonly Vec3[],
    context: VisibilityInterestContext
  ): boolean {
    for (const target of targets) {
      if (this.hasCachedLineOfSight(from, target, context)) return true;
    }
    return false;
  }

  private hasCachedLineOfSight(from: Vec3, to: Vec3, context: VisibilityInterestContext): boolean {
    const key = this.getLineOfSightCacheKey(from, to, context.collisionRevision);
    const cached = this.lineOfSightCache.get(key);
    if (cached && cached.expiresAt > context.now && cached.collisionRevision === context.collisionRevision) {
      return cached.result;
    }

    const result = context.hasLineOfSight(from, to);
    this.lastMetrics.losChecks++;
    if (this.lineOfSightCache.size >= this.maxLineOfSightCacheEntries) {
      this.lineOfSightCache.clear();
    }
    this.lineOfSightCache.set(key, {
      result,
      expiresAt: context.now + this.lineOfSightTtlMs,
      collisionRevision: context.collisionRevision,
    });
    return result;
  }

  private getLineOfSightCacheKey(from: Vec3, to: Vec3, collisionRevision: number): string {
    const step = this.losQuantizationMeters;
    return [
      collisionRevision,
      quantize(from.x, step),
      quantize(from.y, step),
      quantize(from.z, step),
      quantize(to.x, step),
      quantize(to.y, step),
      quantize(to.z, step),
    ].join(':');
  }

  private getCachedInterest(recipientId: string, targetId: string): CachedInterestDecision | undefined {
    return this.interestCache.get(recipientId)?.get(targetId);
  }

  private setCachedInterest(recipientId: string, targetId: string, decision: CachedInterestDecision): void {
    let targets = this.interestCache.get(recipientId);
    if (!targets) {
      targets = new Map();
      this.interestCache.set(recipientId, targets);
    }
    targets.set(targetId, decision);
  }

  private recordDecision(decision: RecipientInterestDecision, recomputeMs: number): void {
    this.lastMetrics.recomputeMs += recomputeMs;
    if (decision.state === 'visible') {
      this.lastMetrics.visibleTargets++;
    } else if (decision.state === 'last_known') {
      this.lastMetrics.lastKnownTargets++;
      this.lastMetrics.filteredTargets++;
    } else if (decision.state === 'hidden') {
      this.lastMetrics.hiddenTargets++;
      this.lastMetrics.filteredTargets++;
    }
  }
}
