import type {
  ChronosAegisDamagedEvent,
  PhantomShieldBrokenEvent,
  PlayerDamagedEvent,
  PlayerDeathEvent,
  PlayerHealedEvent,
  PowerupCollectedMessage,
  GamePhase,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';

export interface PlayerEventVisibility {
  isParticipant: boolean;
  canKnowTarget: boolean;
  canKnowSource: boolean;
}

export function buildPlayerDamagedPayload(
  payload: PlayerDamagedEvent,
  visibility: PlayerEventVisibility
): PlayerDamagedEvent | null {
  if (!visibility.isParticipant && !visibility.canKnowTarget && !visibility.canKnowSource) {
    return null;
  }

  if (
    visibility.isParticipant
    || (visibility.canKnowTarget && visibility.canKnowSource)
  ) {
    return payload;
  }

  return {
    ...payload,
    newHealth: visibility.canKnowTarget || visibility.isParticipant ? payload.newHealth : undefined,
    newDownedHealth: visibility.canKnowTarget || visibility.isParticipant ? payload.newDownedHealth : undefined,
    sourcePosition: visibility.canKnowSource || visibility.isParticipant ? payload.sourcePosition : undefined,
    sourceDirection: visibility.canKnowSource || visibility.isParticipant ? payload.sourceDirection : undefined,
    targetPosition: visibility.canKnowTarget || visibility.isParticipant ? payload.targetPosition : undefined,
    sourceHeroId: visibility.canKnowSource || visibility.isParticipant ? payload.sourceHeroId : null,
    targetHeroId: visibility.canKnowTarget || visibility.isParticipant ? payload.targetHeroId : null,
  };
}

export function buildChronosAegisDamagedPayload(
  payload: ChronosAegisDamagedEvent,
  visibility: {
    isParticipant: boolean;
    canKnowBlocker: boolean;
    canKnowSource: boolean;
  }
): ChronosAegisDamagedEvent | null {
  if (!visibility.isParticipant && !visibility.canKnowBlocker) {
    return null;
  }

  if (
    visibility.isParticipant
    || (visibility.canKnowBlocker && visibility.canKnowSource)
  ) {
    return payload;
  }

  return {
    ...payload,
    sourceId: visibility.canKnowSource || visibility.isParticipant ? payload.sourceId : null,
  };
}

export function buildPhantomShieldBrokenPayload(
  payload: PhantomShieldBrokenEvent,
  visibility: {
    isParticipant: boolean;
    canKnowTarget: boolean;
  }
): PhantomShieldBrokenEvent | null {
  return visibility.isParticipant || visibility.canKnowTarget ? payload : null;
}

export function buildPlayerHealedPayload(
  payload: PlayerHealedEvent,
  visibleTargetIds: ReadonlySet<string>
): PlayerHealedEvent | null {
  let visibleCount = 0;
  for (const targetPayload of payload.targets) {
    if (visibleTargetIds.has(targetPayload.targetId)) visibleCount++;
  }
  if (visibleCount === 0) return null;
  if (visibleCount === payload.targets.length) return payload;

  const visibleTargets: PlayerHealedEvent['targets'] = [];
  for (const targetPayload of payload.targets) {
    if (visibleTargetIds.has(targetPayload.targetId)) visibleTargets.push(targetPayload);
  }
  return {
    ...payload,
    targets: visibleTargets,
  };
}

export function buildPowerupCollectedPayload(
  payload: PowerupCollectedMessage,
  canKnowCollector: boolean
): PowerupCollectedMessage {
  const visibleCollectorId = canKnowCollector ? payload.playerId : null;
  return {
    ...payload,
    playerId: visibleCollectorId,
    expiresAt: visibleCollectorId ? payload.expiresAt : null,
    healthRestored: visibleCollectorId ? payload.healthRestored : undefined,
  };
}

export function buildPlayerKilledPayload(
  payload: PlayerDeathEvent,
  visibility: PlayerEventVisibility,
  coarsePosition: PlainVec3
): PlayerDeathEvent {
  if (
    visibility.isParticipant
    || (visibility.canKnowTarget && visibility.canKnowSource)
  ) {
    return payload;
  }

  return {
    ...payload,
    position: visibility.canKnowTarget ? payload.position : coarsePosition,
    velocity: visibility.canKnowTarget ? payload.velocity : undefined,
    sourcePosition: visibility.canKnowSource ? payload.sourcePosition : undefined,
    sourceDirection: visibility.canKnowSource ? payload.sourceDirection : undefined,
    respawnTime: null,
  };
}

export function shouldIncludePlayerJoinPosition(input: {
  recipientId?: string | null;
  recipientTeam?: string | null;
  targetId: string;
  targetTeam: string;
  phase: GamePhase;
}): boolean {
  if (!input.recipientId) return true;
  if (input.recipientId === input.targetId) return true;
  if (input.recipientTeam === input.targetTeam) return true;
  return input.phase !== 'playing' && input.phase !== 'countdown';
}
