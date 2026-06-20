import {
  BOT_LOS_SAMPLE_STEP,
  type PlainVec3,
} from './bot-ai';

const LINE_OF_SIGHT_CACHE_TTL_MS = 180;
const LINE_OF_SIGHT_CACHE_MAX_ENTRIES = 1500;

type BlockedPositionPredicate = (position: PlainVec3) => boolean;

function getLineOfSightCacheKey(start: PlainVec3, end: PlainVec3): string {
  const q = (value: number) => Math.round(value * 2);
  return `${q(start.x)}:${q(start.y)}:${q(start.z)}>${q(end.x)}:${q(end.y)}:${q(end.z)}`;
}

export class LineOfSightCache {
  private readonly cache = new Map<string, { result: boolean; expiresAt: number }>();
  private readonly samplePoint: PlainVec3 = { x: 0, y: 0, z: 0 };

  hasLineOfSight(
    start: PlainVec3,
    end: PlainVec3,
    now: number,
    isBlockedAtPosition: BlockedPositionPredicate
  ): boolean {
    const cacheKey = getLineOfSightCacheKey(start, end);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(distance / BOT_LOS_SAMPLE_STEP));

    let result = true;
    const samplePoint = this.samplePoint;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      samplePoint.x = start.x + dx * t;
      samplePoint.y = start.y + dy * t;
      samplePoint.z = start.z + dz * t;
      if (isBlockedAtPosition(samplePoint)) {
        result = false;
        break;
      }
    }

    if (this.cache.size > LINE_OF_SIGHT_CACHE_MAX_ENTRIES) {
      this.cache.clear();
    }
    this.cache.set(cacheKey, {
      result,
      expiresAt: now + LINE_OF_SIGHT_CACHE_TTL_MS,
    });
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
