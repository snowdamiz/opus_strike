import {
  POWERUP_BUFF_DURATION_MS,
  POWERUP_HEALTH_RESTORE_RATIO,
  type PowerupCollectedMessage,
  type PowerupStateMessage,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';
import type { Player } from './schema/Player';
import { vec3SchemaToPlain } from './roomMath';

interface PowerupPickupRuntimeState {
  availableAt: number;
}

export type MapPowerupPickup = NonNullable<VoxelMapManifest['gameplay']['powerups']>[number];

export interface PowerupPickupHealing {
  amount: number;
  newHealth: number;
  position: PlainVec3;
}

export interface AppliedPowerupPickup {
  message: PowerupCollectedMessage;
  healing?: PowerupPickupHealing;
}

export class PowerupBoostTracker {
  private readonly boostUntil = new Map<string, number>();

  clear(playerId: string): boolean {
    return this.boostUntil.delete(playerId);
  }

  clearAll(): void {
    this.boostUntil.clear();
  }

  getUntil(playerId: string, now: number): number | null {
    const expiresAt = this.boostUntil.get(playerId) ?? 0;
    if (expiresAt <= now) {
      this.boostUntil.delete(playerId);
      return null;
    }
    return expiresAt;
  }

  has(playerId: string, now: number): boolean {
    return this.getUntil(playerId, now) !== null;
  }

  setUntil(playerId: string, expiresAt: number): void {
    this.boostUntil.set(playerId, expiresAt);
  }
}

function getMapPowerups(mapManifest: VoxelMapManifest | null | undefined): readonly MapPowerupPickup[] {
  return mapManifest?.gameplay.powerups ?? [];
}

export class PowerupPickupTracker {
  private readonly pickupStates = new Map<string, PowerupPickupRuntimeState>();

  reset(mapManifest: VoxelMapManifest | null | undefined, availableAt = 0): void {
    this.pickupStates.clear();
    for (const pickup of getMapPowerups(mapManifest)) {
      this.pickupStates.set(pickup.id, { availableAt });
    }
  }

  getAvailableAt(pickupId: string): number {
    return this.getOrCreateState(pickupId).availableAt;
  }

  setAvailableAt(pickupId: string, availableAt: number): void {
    this.getOrCreateState(pickupId).availableAt = availableAt;
  }

  buildStateMessage(
    serverTime: number,
    mapManifest: VoxelMapManifest | null | undefined
  ): PowerupStateMessage {
    return {
      serverTime,
      pickups: getMapPowerups(mapManifest).map((pickup) => ({
        pickupId: pickup.id,
        availableAt: this.getAvailableAt(pickup.id),
      })),
    };
  }

  private getOrCreateState(pickupId: string): PowerupPickupRuntimeState {
    let state = this.pickupStates.get(pickupId);
    if (!state) {
      state = { availableAt: 0 };
      this.pickupStates.set(pickupId, state);
    }
    return state;
  }
}

export function applyPowerupPickup(input: {
  player: Player;
  pickup: MapPowerupPickup;
  now: number;
  powerupPickups: PowerupPickupTracker;
  powerupBoosts: PowerupBoostTracker;
}): AppliedPowerupPickup | null {
  const { player, pickup, now, powerupPickups, powerupBoosts } = input;
  let healthRestored: number | undefined;
  let healing: PowerupPickupHealing | undefined;
  let expiresAt: number | null = null;

  if (pickup.kind === 'health_pack') {
    const missingHealth = Math.max(0, player.maxHealth - player.health);
    if (missingHealth <= 0) return null;

    const healAmount = Math.max(1, Math.round(player.maxHealth * POWERUP_HEALTH_RESTORE_RATIO));
    healthRestored = Math.min(missingHealth, healAmount);
    player.health = Math.min(player.maxHealth, player.health + healthRestored);
    healing = {
      amount: healthRestored,
      newHealth: player.health,
      position: vec3SchemaToPlain(player.position),
    };
  } else {
    expiresAt = now + POWERUP_BUFF_DURATION_MS;
    powerupBoosts.setUntil(player.id, expiresAt);
  }

  const availableAt = now + Math.max(0, pickup.respawnSeconds * 1000);
  powerupPickups.setAvailableAt(pickup.id, availableAt);

  return {
    message: {
      pickupId: pickup.id,
      kind: pickup.kind,
      playerId: player.id,
      position: pickup.position,
      availableAt,
      expiresAt,
      healthRestored,
      serverTime: now,
    },
    healing,
  };
}
