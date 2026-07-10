import {
  PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS,
  getDistanceToBlazeAfterburnerTrail,
  isPlayerAliveOrDowned,
  type Team,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';
import type { VoidZone } from './abilityHandlers';

export interface PendingAreaDamageInstance {
  id: string;
  ownerId: string;
  center: PlainVec3;
  radius: number;
  damage: number;
  damageType: string;
  resolveAt: number;
}

export class PendingAreaDamageQueue {
  private readonly queue: PendingAreaDamageInstance[] = [];

  get size(): number {
    return this.queue.length;
  }

  enqueue(instance: PendingAreaDamageInstance): void {
    this.queue.push(instance);
  }

  drainReadyInto(now: number, ready: PendingAreaDamageInstance[]): PendingAreaDamageInstance[] {
    ready.length = 0;
    if (this.queue.length === 0) return ready;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.queue.length; readIndex++) {
      const instance = this.queue[readIndex];
      if (now < instance.resolveAt) {
        this.queue[writeIndex++] = instance;
      } else {
        ready.push(instance);
      }
    }
    this.queue.length = writeIndex;
    return ready;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

export interface BlazeLingeringAreaInstance {
  id: string;
  ownerId: string;
  ownerTeam: Team;
  position: PlainVec3;
  radius: number;
  damage: number;
  damageIntervalMs: number;
  damageType: string;
  abilityId: string;
  falloffScale: number;
  startTime: number;
  endTime: number;
  lastDamageTick: Map<string, number>;
}

export interface BlazeLingeringAreaTarget {
  id: string;
  state: string;
  position: PlainVec3;
}

export class BlazeLingeringAreaTracker {
  private readonly areas: BlazeLingeringAreaInstance[] = [];

  get size(): number {
    return this.areas.length;
  }

  add(input: Omit<BlazeLingeringAreaInstance, 'lastDamageTick'>): void {
    this.areas.push({
      ...input,
      position: { ...input.position },
      lastDamageTick: new Map(),
    });
  }

  clear(): void {
    this.areas.length = 0;
  }

  update<TTarget extends BlazeLingeringAreaTarget>(
    now: number,
    options: {
      hasOwner: (ownerId: string) => boolean;
      getTargets: (area: BlazeLingeringAreaInstance) => Iterable<TTarget>;
      applyDamage: (
        area: BlazeLingeringAreaInstance,
        target: TTarget,
        distance: number
      ) => void;
    }
  ): void {
    if (this.areas.length === 0) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.areas.length; readIndex++) {
      const area = this.areas[readIndex];
      if (now >= area.endTime) continue;
      if (now < area.startTime) {
        this.areas[writeIndex++] = area;
        continue;
      }

      if (!options.hasOwner(area.ownerId)) {
        this.areas[writeIndex++] = area;
        continue;
      }

      const radiusSq = area.radius * area.radius;
      for (const target of options.getTargets(area)) {
        if (!isPlayerAliveOrDowned(target)) continue;

        const dx = target.position.x - area.position.x;
        const dy = target.position.y - area.position.y;
        const dz = target.position.z - area.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > radiusSq) continue;

        const lastDamage = area.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < area.damageIntervalMs) continue;
        area.lastDamageTick.set(target.id, now);

        options.applyDamage(area, target, Math.sqrt(distSq));
      }

      this.areas[writeIndex++] = area;
    }
    this.areas.length = writeIndex;
  }
}

export interface BlazeAfterburnerTrailInstance {
  id: string;
  ownerId: string;
  ownerTeam: Team;
  points: PlainVec3[];
  radius: number;
  damage: number;
  damageIntervalMs: number;
  startTime: number;
  endTime: number;
  lastDamageTick: Map<string, number>;
}

export class BlazeAfterburnerTrailTracker {
  private readonly trails: BlazeAfterburnerTrailInstance[] = [];

  get size(): number {
    return this.trails.length;
  }

  add(input: Omit<BlazeAfterburnerTrailInstance, 'lastDamageTick'>): void {
    this.trails.push({
      ...input,
      points: input.points.map((point) => ({ ...point })),
      lastDamageTick: new Map(),
    });
  }

  appendPoint(trailId: string, point: PlainVec3): boolean {
    const trail = this.trails.find((candidate) => candidate.id === trailId);
    if (!trail) return false;
    trail.points.push({ ...point });
    return true;
  }

  clear(): void {
    this.trails.length = 0;
  }

  update<TTarget extends BlazeLingeringAreaTarget>(
    now: number,
    options: {
      hasOwner: (ownerId: string) => boolean;
      getTargets: (trail: BlazeAfterburnerTrailInstance) => Iterable<TTarget>;
      applyDamage: (
        trail: BlazeAfterburnerTrailInstance,
        target: TTarget,
        distance: number
      ) => void;
    }
  ): void {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.trails.length; readIndex++) {
      const trail = this.trails[readIndex];
      if (now >= trail.endTime) continue;
      if (now < trail.startTime || !options.hasOwner(trail.ownerId)) {
        this.trails[writeIndex++] = trail;
        continue;
      }

      for (const target of options.getTargets(trail)) {
        if (!isPlayerAliveOrDowned(target)) continue;
        let distance = Number.POSITIVE_INFINITY;
        for (let pointIndex = 1; pointIndex < trail.points.length; pointIndex++) {
          distance = Math.min(
            distance,
            getDistanceToBlazeAfterburnerTrail(
              target.position,
              trail.points[pointIndex - 1],
              trail.points[pointIndex]
            )
          );
        }
        if (trail.points.length === 1) {
          distance = getDistanceToBlazeAfterburnerTrail(
            target.position,
            trail.points[0],
            trail.points[0]
          );
        }
        if (distance > trail.radius) continue;

        const lastDamage = trail.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < trail.damageIntervalMs) continue;
        trail.lastDamageTick.set(target.id, now);
        options.applyDamage(trail, target, distance);
      }

      this.trails[writeIndex++] = trail;
    }
    this.trails.length = writeIndex;
  }
}

export interface VoidZoneTarget {
  id: string;
  position: PlainVec3;
  spawnProtectionUntil?: number;
}

export class VoidZoneTracker {
  private readonly zones: VoidZone[] = [];

  get size(): number {
    return this.zones.length;
  }

  add(input: Omit<VoidZone, 'lastDamageTick'>): VoidZone {
    const zone: VoidZone = {
      ...input,
      position: { ...input.position },
      lastDamageTick: new Map(),
    };
    this.zones.push(zone);
    return zone;
  }

  clear(): void {
    this.zones.length = 0;
  }

  update<TTarget extends VoidZoneTarget>(
    now: number,
    options: {
      onExpired: (zone: VoidZone) => void;
      getTargets: (zone: VoidZone) => Iterable<TTarget>;
      applyDamage: (zone: VoidZone, target: TTarget) => void;
    }
  ): void {
    if (this.zones.length === 0) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.zones.length; readIndex++) {
      const zone = this.zones[readIndex];
      const elapsedSeconds = (now - zone.startTime) / 1000;
      if (elapsedSeconds >= zone.duration) {
        options.onExpired(zone);
        continue;
      }

      this.zones[writeIndex++] = zone;
    }
    this.zones.length = writeIndex;

    for (const zone of this.zones) {
      if (now - zone.startTime < PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS) continue;

      const radiusSq = zone.radius * zone.radius;
      for (const target of options.getTargets(zone)) {
        if (target.id === zone.ownerId) continue;
        if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) continue;

        const dx = target.position.x - zone.position.x;
        const dz = target.position.z - zone.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > radiusSq) continue;

        const lastDamage = zone.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS) continue;

        zone.lastDamageTick.set(target.id, now);
        options.applyDamage(zone, target);
      }
    }
  }
}
