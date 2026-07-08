import {
  BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
  BLAZE_FLAMETHROWER_BURN_TICKS,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';

export interface BlazeBurnTick {
  targetId: string;
  sourceId: string | null;
  sourcePosition: PlainVec3 | null;
  sourceDirection: PlainVec3 | null;
  tickCount: number;
}

interface BlazeBurnEffect {
  sourceId: string;
  ticksRemaining: number;
  nextTickAt: number;
  sourcePosition: PlainVec3 | null;
  sourceDirection: PlainVec3 | null;
}

export class BlazeBurnEffectTracker {
  private readonly burns = new Map<string, BlazeBurnEffect>();

  clearTarget(targetId: string): boolean {
    return this.burns.delete(targetId);
  }

  clearPlayer(playerId: string): void {
    this.burns.delete(playerId);
    for (const [targetId, burn] of this.burns) {
      if (burn.sourceId === playerId) {
        this.burns.delete(targetId);
      }
    }
  }

  clearAll(): void {
    this.burns.clear();
  }

  getBurnUntil(targetId: string): number | null {
    const burn = this.burns.get(targetId);
    if (!burn || burn.ticksRemaining <= 0) return null;
    return burn.nextTickAt + Math.max(0, burn.ticksRemaining - 1) * BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;
  }

  ignite(
    targetId: string,
    sourceId: string,
    now: number,
    sourcePosition: PlainVec3 | null,
    sourceDirection: PlainVec3 | null
  ): void {
    const existing = this.burns.get(targetId);
    const nextTickAt = existing && existing.ticksRemaining > 0
      ? Math.min(existing.nextTickAt, now + BLAZE_FLAMETHROWER_BURN_INTERVAL_MS)
      : now + BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;

    this.burns.set(targetId, {
      sourceId,
      ticksRemaining: BLAZE_FLAMETHROWER_BURN_TICKS,
      nextTickAt,
      sourcePosition: sourcePosition ? { ...sourcePosition } : null,
      sourceDirection: sourceDirection ? { ...sourceDirection } : null,
    });
  }

  update(
    now: number,
    options: {
      isTargetDamageable: (targetId: string) => boolean;
      hasSource: (sourceId: string) => boolean;
      applyTick: (tick: BlazeBurnTick) => boolean;
    }
  ): void {
    for (const [targetId, burn] of this.burns) {
      if (!options.isTargetDamageable(targetId) || burn.ticksRemaining <= 0) {
        this.burns.delete(targetId);
        continue;
      }

      let dueTicks = 0;
      while (burn.ticksRemaining > 0 && now >= burn.nextTickAt) {
        dueTicks++;
        burn.ticksRemaining--;
        burn.nextTickAt += BLAZE_FLAMETHROWER_BURN_INTERVAL_MS;
      }

      if (dueTicks > 0 && options.isTargetDamageable(targetId)) {
        const killed = options.applyTick({
          targetId,
          sourceId: options.hasSource(burn.sourceId) ? burn.sourceId : null,
          sourcePosition: burn.sourcePosition,
          sourceDirection: burn.sourceDirection,
          tickCount: dueTicks,
        });
        if (killed || !options.isTargetDamageable(targetId)) {
          this.burns.delete(targetId);
          continue;
        }
      }

      if (burn.ticksRemaining <= 0 || !options.isTargetDamageable(targetId)) {
        this.burns.delete(targetId);
      }
    }
  }
}
