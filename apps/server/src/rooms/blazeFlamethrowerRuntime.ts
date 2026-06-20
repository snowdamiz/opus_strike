import {
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
} from '@voxel-strike/shared';

export type BlazeFlamethrowerDamageTarget =
  | { kind: 'player'; playerId: string }
  | { kind: 'aegis'; playerId: string };

export type BlazeFlamethrowerPoint = { x: number; y: number; z: number };

export interface BlazeFlamethrowerFrameInput {
  isFiring: boolean;
  fuel: number;
  dt: number;
  tempoMultiplier: number;
}

export interface BlazeFlamethrowerFrameState {
  active: boolean;
  fuel: number;
  isJetpacking: boolean;
  shouldApplyDamage: boolean;
}

export interface BlazeFlamethrowerDamageFrameInput {
  origin: BlazeFlamethrowerPoint;
  terrainHit?: BlazeFlamethrowerPoint | null;
  range: number;
  collisionRadius: number;
  playerRadius: number;
  hitboxPadding: number;
  baseDamageIntervalMs: number;
  tempoMultiplier: number;
}

export interface BlazeFlamethrowerDamageFrame {
  flameDistance: number;
  candidateRange: number;
  damageIntervalMs: number;
}

export type BlazeFlamethrowerAegisHit = { distance: number };

export interface BlazeFlamethrowerPlayerHitCandidate<
  TPlayer,
  TAegisHit extends BlazeFlamethrowerAegisHit,
> {
  player: TPlayer;
  distance: number;
  aegisHit?: TAegisHit | null;
}

export interface BlazeFlamethrowerDamageTargetPlan<
  TPlayer,
  TAegisHit extends BlazeFlamethrowerAegisHit,
> {
  playerHits: Array<BlazeFlamethrowerPlayerHitCandidate<TPlayer, TAegisHit>>;
  aegisHit: TAegisHit | null;
}

interface BlazeFlamethrowerDamageTick {
  sourceId: string;
  target: BlazeFlamethrowerDamageTarget;
  lastTickAt: number;
}

export function resolveBlazeFlamethrowerFrameState(
  input: BlazeFlamethrowerFrameInput
): BlazeFlamethrowerFrameState {
  const active = input.isFiring && input.fuel > 0;
  if (active) {
    return {
      active: true,
      fuel: Math.max(
        0,
        input.fuel - BLAZE_FLAMETHROWER_FUEL_DRAIN * input.dt * input.tempoMultiplier
      ),
      isJetpacking: true,
      shouldApplyDamage: true,
    };
  }

  return {
    active: false,
    fuel: input.fuel < BLAZE_FLAMETHROWER_MAX_FUEL
      ? Math.min(
        BLAZE_FLAMETHROWER_MAX_FUEL,
        input.fuel + BLAZE_FLAMETHROWER_FUEL_REGEN * input.dt * input.tempoMultiplier
      )
      : input.fuel,
    isJetpacking: false,
    shouldApplyDamage: false,
  };
}

export function resolveBlazeFlamethrowerDamageFrame(
  input: BlazeFlamethrowerDamageFrameInput
): BlazeFlamethrowerDamageFrame {
  const terrainDistance = input.terrainHit
    ? distance3D(input.origin, input.terrainHit)
    : input.range;

  return {
    flameDistance: Math.min(input.range, terrainDistance),
    candidateRange: input.range + input.collisionRadius + input.playerRadius + input.hitboxPadding,
    damageIntervalMs: input.baseDamageIntervalMs / input.tempoMultiplier,
  };
}

export function resolveBlazeFlamethrowerDamageTargets<
  TPlayer,
  TAegisHit extends BlazeFlamethrowerAegisHit,
>(input: {
  initialAegisHit?: TAegisHit | null;
  candidates: readonly BlazeFlamethrowerPlayerHitCandidate<TPlayer, TAegisHit>[];
}): BlazeFlamethrowerDamageTargetPlan<TPlayer, TAegisHit> {
  let aegisHit = input.initialAegisHit ?? null;
  const playerHits: Array<BlazeFlamethrowerPlayerHitCandidate<TPlayer, TAegisHit>> = [];

  for (const candidate of input.candidates) {
    const targetAegisHit = candidate.aegisHit ?? null;
    if (targetAegisHit && targetAegisHit.distance <= candidate.distance) {
      if (!aegisHit || targetAegisHit.distance < aegisHit.distance) {
        aegisHit = targetAegisHit;
      }
      continue;
    }

    playerHits.push(candidate);
  }

  return {
    playerHits,
    aegisHit,
  };
}

export class BlazeFlamethrowerRuntimeTracker {
  private readonly activePlayerIds = new Set<string>();
  private readonly activePlayerIdsThisFrame = new Set<string>();
  private readonly damageTicks = new Map<string, BlazeFlamethrowerDamageTick>();

  setActive(playerId: string, active: boolean): boolean {
    const wasActive = this.activePlayerIds.has(playerId);
    if (wasActive === active) return false;

    if (active) {
      this.activePlayerIds.add(playerId);
    } else {
      this.activePlayerIds.delete(playerId);
      this.activePlayerIdsThisFrame.delete(playerId);
    }
    return true;
  }

  isActive(playerId: string): boolean {
    return this.activePlayerIds.has(playerId);
  }

  getActivePlayerIdsSnapshot(): string[] {
    return [...this.activePlayerIds];
  }

  beginActiveFrame(): void {
    this.activePlayerIdsThisFrame.clear();
  }

  markActiveThisFrame(playerId: string): void {
    this.activePlayerIdsThisFrame.add(playerId);
  }

  getActivePlayerIdsMissingFromFrame(): string[] {
    const missingPlayerIds: string[] = [];
    for (const playerId of this.activePlayerIds) {
      if (!this.activePlayerIdsThisFrame.has(playerId)) {
        missingPlayerIds.push(playerId);
      }
    }
    return missingPlayerIds;
  }

  clearPlayer(playerId: string): void {
    this.activePlayerIds.delete(playerId);
    this.activePlayerIdsThisFrame.delete(playerId);
    this.clearDamageTicksForPlayer(playerId);
  }

  clearDamageTicks(): void {
    this.damageTicks.clear();
  }

  clearDamageTicksForPlayer(playerId: string): number {
    let cleared = 0;
    for (const [key, tick] of this.damageTicks) {
      if (tick.sourceId !== playerId && tick.target.playerId !== playerId) continue;
      this.damageTicks.delete(key);
      cleared++;
    }
    return cleared;
  }

  getLastDamageTick(
    sourceId: string,
    target: BlazeFlamethrowerDamageTarget
  ): number | undefined {
    return this.damageTicks.get(this.getDamageTickKey(sourceId, target))?.lastTickAt;
  }

  consumeDamageTick(
    sourceId: string,
    target: BlazeFlamethrowerDamageTarget,
    now: number,
    intervalMs: number
  ): boolean {
    const previousTickAt = this.getLastDamageTick(sourceId, target) ?? 0;
    if (now - previousTickAt < intervalMs) return false;

    this.damageTicks.set(this.getDamageTickKey(sourceId, target), {
      sourceId,
      target,
      lastTickAt: now,
    });
    return true;
  }

  private getDamageTickKey(
    sourceId: string,
    target: BlazeFlamethrowerDamageTarget
  ): string {
    return `${sourceId}:${target.kind}:${target.playerId}`;
  }
}

function distance3D(a: BlazeFlamethrowerPoint, b: BlazeFlamethrowerPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
