import {
  BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
  PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS,
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

export interface BlazeGearstormInstance {
  id: string;
  ownerId: string;
  ownerTeam: Team;
  position: PlainVec3;
  radius: number;
  damage: number;
  startTime: number;
  endTime: number;
  lastDamageTick: Map<string, number>;
}

export interface BlazeGearstormTarget {
  id: string;
  state: string;
  position: PlainVec3;
}

export class BlazeGearstormTracker {
  private readonly storms: BlazeGearstormInstance[] = [];

  get size(): number {
    return this.storms.length;
  }

  add(input: Omit<BlazeGearstormInstance, 'lastDamageTick'>): void {
    this.storms.push({
      ...input,
      position: { ...input.position },
      lastDamageTick: new Map(),
    });
  }

  clear(): void {
    this.storms.length = 0;
  }

  update<TTarget extends BlazeGearstormTarget>(
    now: number,
    options: {
      hasOwner: (ownerId: string) => boolean;
      getTargets: (storm: BlazeGearstormInstance) => Iterable<TTarget>;
      applyDamage: (
        storm: BlazeGearstormInstance,
        target: TTarget,
        distance: number
      ) => void;
    }
  ): void {
    if (this.storms.length === 0) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.storms.length; readIndex++) {
      const storm = this.storms[readIndex];
      if (now >= storm.endTime) continue;

      if (!options.hasOwner(storm.ownerId)) {
        this.storms[writeIndex++] = storm;
        continue;
      }

      const radiusSq = storm.radius * storm.radius;
      for (const target of options.getTargets(storm)) {
        if (!isPlayerAliveOrDowned(target)) continue;

        const dx = target.position.x - storm.position.x;
        const dy = target.position.y - storm.position.y;
        const dz = target.position.z - storm.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > radiusSq) continue;

        const lastDamage = storm.lastDamageTick.get(target.id) || 0;
        if (now - lastDamage < BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS) continue;
        storm.lastDamageTick.set(target.id, now);

        options.applyDamage(storm, target, Math.sqrt(distSq));
      }

      this.storms[writeIndex++] = storm;
    }
    this.storms.length = writeIndex;
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
