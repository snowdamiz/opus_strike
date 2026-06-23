import {
  BOT_LOS_SAMPLE_STEP,
  type PlainVec3,
} from './bot-ai';

const LINE_OF_SIGHT_CACHE_TTL_MS = 180;
const LINE_OF_SIGHT_CACHE_MAX_ENTRIES = 1500;
const LINE_OF_SIGHT_CACHE_EVICT_BATCH = 150;

type BlockedPositionPredicate = (position: PlainVec3) => boolean;

function getLineOfSightCacheKey(start: PlainVec3, end: PlainVec3, collisionRevision: number): string {
  const q = (value: number) => Math.round(value * 2);
  return `${collisionRevision}:${q(start.x)}:${q(start.y)}:${q(start.z)}>${q(end.x)}:${q(end.y)}:${q(end.z)}`;
}

interface CachedLineOfSightResult {
  result: boolean;
  expiresAt: number;
  collisionRevision: number;
}

export class LineOfSightCache {
  private readonly cache = new Map<string, CachedLineOfSightResult>();
  private readonly samplePoint: PlainVec3 = { x: 0, y: 0, z: 0 };

  private pruneCache(now: number): void {
    if (this.cache.size < LINE_OF_SIGHT_CACHE_MAX_ENTRIES) return;

    for (const [key, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size < LINE_OF_SIGHT_CACHE_MAX_ENTRIES) return;

    let evicted = 0;
    for (const key of this.cache.keys()) {
      this.cache.delete(key);
      evicted++;
      if (evicted >= LINE_OF_SIGHT_CACHE_EVICT_BATCH || this.cache.size < LINE_OF_SIGHT_CACHE_MAX_ENTRIES) break;
    }
  }

  hasLineOfSight(
    start: PlainVec3,
    end: PlainVec3,
    now: number,
    collisionRevision: number,
    isBlockedAtPosition: BlockedPositionPredicate
  ): boolean {
    const cacheKey = getLineOfSightCacheKey(start, end, collisionRevision);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.collisionRevision === collisionRevision) {
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

    this.pruneCache(now);
    this.cache.set(cacheKey, {
      result,
      expiresAt: now + LINE_OF_SIGHT_CACHE_TTL_MS,
      collisionRevision,
    });
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
