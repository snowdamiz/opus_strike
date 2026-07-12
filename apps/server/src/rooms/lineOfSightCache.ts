import {
  BOT_LOS_SAMPLE_STEP,
  type PlainVec3,
} from './bot-ai';

const LINE_OF_SIGHT_CACHE_TTL_MS = 180;
const LINE_OF_SIGHT_CACHE_MAX_ENTRIES = 1500;
const LINE_OF_SIGHT_CACHE_EVICT_BATCH = 150;

type BlockedPositionPredicate = (position: PlainVec3) => boolean;

// FNV-style integer hash over the quantized endpoints. Collisions are handled
// by verifying the stored quantized components before trusting an entry, so a
// hash clash only costs a recompute — never a wrong answer.
function hashLineOfSightKey(
  collisionRevision: number,
  qsx: number,
  qsy: number,
  qsz: number,
  qex: number,
  qey: number,
  qez: number
): number {
  let hash = 0x811c9dc5 | 0;
  hash = Math.imul(hash ^ collisionRevision, 0x01000193);
  hash = Math.imul(hash ^ qsx, 0x01000193);
  hash = Math.imul(hash ^ qsy, 0x01000193);
  hash = Math.imul(hash ^ qsz, 0x01000193);
  hash = Math.imul(hash ^ qex, 0x01000193);
  hash = Math.imul(hash ^ qey, 0x01000193);
  hash = Math.imul(hash ^ qez, 0x01000193);
  return hash | 0;
}

interface CachedLineOfSightResult {
  result: boolean;
  expiresAt: number;
  collisionRevision: number;
  qsx: number;
  qsy: number;
  qsz: number;
  qex: number;
  qey: number;
  qez: number;
}

export class LineOfSightCache {
  private readonly cache = new Map<number, CachedLineOfSightResult>();
  private readonly samplePoint: PlainVec3 = { x: 0, y: 0, z: 0 };

  traceLineOfSight(
    start: PlainVec3,
    end: PlainVec3,
    isBlockedAtPosition: BlockedPositionPredicate
  ): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(distance / BOT_LOS_SAMPLE_STEP));

    const samplePoint = this.samplePoint;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      samplePoint.x = start.x + dx * t;
      samplePoint.y = start.y + dy * t;
      samplePoint.z = start.z + dz * t;
      if (isBlockedAtPosition(samplePoint)) return false;
    }
    return true;
  }

  private pruneCache(now: number): void {
    if (this.cache.size < LINE_OF_SIGHT_CACHE_MAX_ENTRIES) return;
    const targetSize = Math.max(0, LINE_OF_SIGHT_CACHE_MAX_ENTRIES - LINE_OF_SIGHT_CACHE_EVICT_BATCH);

    for (const [key, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size <= targetSize) return;

    for (const key of this.cache.keys()) {
      this.cache.delete(key);
      if (this.cache.size <= targetSize) break;
    }
  }

  hasLineOfSight(
    start: PlainVec3,
    end: PlainVec3,
    now: number,
    collisionRevision: number,
    isBlockedAtPosition: BlockedPositionPredicate
  ): boolean {
    const qsx = Math.round(start.x * 2);
    const qsy = Math.round(start.y * 2);
    const qsz = Math.round(start.z * 2);
    const qex = Math.round(end.x * 2);
    const qey = Math.round(end.y * 2);
    const qez = Math.round(end.z * 2);
    const cacheKey = hashLineOfSightKey(collisionRevision, qsx, qsy, qsz, qex, qey, qez);
    const cached = this.cache.get(cacheKey);
    const cachedMatches =
      cached !== undefined &&
      cached.collisionRevision === collisionRevision &&
      cached.qsx === qsx && cached.qsy === qsy && cached.qsz === qsz &&
      cached.qex === qex && cached.qey === qey && cached.qez === qez;
    if (cached && cachedMatches && cached.expiresAt > now) {
      return cached.result;
    }

    const result = this.traceLineOfSight(start, end, isBlockedAtPosition);

    this.pruneCache(now);
    if (cached) {
      cached.result = result;
      cached.expiresAt = now + LINE_OF_SIGHT_CACHE_TTL_MS;
      cached.collisionRevision = collisionRevision;
      cached.qsx = qsx;
      cached.qsy = qsy;
      cached.qsz = qsz;
      cached.qex = qex;
      cached.qey = qey;
      cached.qez = qez;
    } else {
      this.cache.set(cacheKey, {
        result,
        expiresAt: now + LINE_OF_SIGHT_CACHE_TTL_MS,
        collisionRevision,
        qsx,
        qsy,
        qsz,
        qex,
        qey,
        qez,
      });
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
