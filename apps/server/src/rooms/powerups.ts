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

export interface PowerupPickupRuntimeState {
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

function getMapPowerups(mapManifest: VoxelMapManifest | null | undefined): readonly MapPowerupPickup[] {
  return mapManifest?.gameplay.powerups ?? [];
}

export function resetPowerupPickupStates(
  pickupStates: Map<string, PowerupPickupRuntimeState>,
  mapManifest: VoxelMapManifest | null | undefined,
  availableAt = 0
): void {
  pickupStates.clear();
  for (const pickup of getMapPowerups(mapManifest)) {
    pickupStates.set(pickup.id, { availableAt });
  }
}

export function getPowerupPickupState(
  pickupStates: Map<string, PowerupPickupRuntimeState>,
  pickupId: string
): PowerupPickupRuntimeState {
  let state = pickupStates.get(pickupId);
  if (!state) {
    state = { availableAt: 0 };
    pickupStates.set(pickupId, state);
  }
  return state;
}

export function buildPowerupStateMessage(
  serverTime: number,
  mapManifest: VoxelMapManifest | null | undefined,
  pickupStates: Map<string, PowerupPickupRuntimeState>
): PowerupStateMessage {
  return {
    serverTime,
    pickups: getMapPowerups(mapManifest).map((pickup) => ({
      pickupId: pickup.id,
      availableAt: getPowerupPickupState(pickupStates, pickup.id).availableAt,
    })),
  };
}

export function getPowerupBoostUntil(
  powerupBoostUntil: Map<string, number>,
  playerId: string,
  now: number
): number | null {
  const expiresAt = powerupBoostUntil.get(playerId) ?? 0;
  if (expiresAt <= now) {
    powerupBoostUntil.delete(playerId);
    return null;
  }
  return expiresAt;
}

export function hasPowerupBoost(
  powerupBoostUntil: Map<string, number>,
  player: Player,
  now: number
): boolean {
  return getPowerupBoostUntil(powerupBoostUntil, player.id, now) !== null;
}

export function applyPowerupPickup(input: {
  player: Player;
  pickup: MapPowerupPickup;
  now: number;
  pickupStates: Map<string, PowerupPickupRuntimeState>;
  powerupBoostUntil: Map<string, number>;
}): AppliedPowerupPickup | null {
  const { player, pickup, now, pickupStates, powerupBoostUntil } = input;
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
    powerupBoostUntil.set(player.id, expiresAt);
  }

  const state = getPowerupPickupState(pickupStates, pickup.id);
  state.availableAt = now + Math.max(0, pickup.respawnSeconds * 1000);

  return {
    message: {
      pickupId: pickup.id,
      kind: pickup.kind,
      playerId: player.id,
      position: pickup.position,
      availableAt: state.availableAt,
      expiresAt,
      healthRestored,
      serverTime: now,
    },
    healing,
  };
}
