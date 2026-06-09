import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_LIFELINE_HEAL,
  CHRONOS_LIFELINE_MAX_TARGETS,
  CHRONOS_LIFELINE_RADIUS,
  CHRONOS_TIMEBREAK_RADIUS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  type Player,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { isPhysicsReady, raycastDirection } from '../../usePhysics';
import {
  CHRONOS_PRIMARY_FIRE_INTERVAL,
  CHRONOS_PRIMARY_ORB_SOCKET,
  CHRONOS_PRIMARY_PULSE_SPEED,
  EYE_HEIGHT,
  calculateLookDirection,
  calculatePlayerSocketPosition,
} from '../constants';
import {
  CHRONOS_LIFELINE_RELEASE_DELAY_MS,
  CHRONOS_PRIMARY_FIRE_READY_BLEND,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  getChronosPrimaryHeldBlend,
  triggerChronosTimebreakPose,
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../../viewmodel/chronosPose';
import {
  assertViewmodelLaunchMatchesPose,
  readViewmodelSocket,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import { addChronosLifelineEffects } from '../../../components/game/chronos/lifeline';
import { addChronosTimebreakEffect } from '../../../components/game/chronos/timebreak';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import type { AbilityContext } from '../types';

export interface UseChronosAbilitiesReturn {
  lastPulseTimeRef: React.MutableRefObject<number>;
  pulseIdRef: React.MutableRefObject<number>;
  timebreakIdRef: React.MutableRefObject<number>;
  executeLifelineConduit: (ctx: AbilityContext, useAbilityCharge: (abilityId: string) => boolean) => boolean;
  executeTimebreak: (
    ctx: AbilityContext,
    setAbilityActive: (
      abilityId: string,
      active: boolean,
      options?: { startTime?: number; startCooldownOnEnd?: boolean }
    ) => void,
    updateLocalPlayer: (data: Partial<Player>) => void
  ) => boolean;
  fireVerdantPulse: (ctx: AbilityContext) => void;
}

const CHRONOS_PRIMARY_AIM_DISTANCE = 120;
const CHRONOS_PRIMARY_PULSE_SPAWN_FORWARD_OFFSET = 0.82;
const CHRONOS_LIFELINE_ABILITY_ID = 'chronos_lifeline_conduit';
const CHRONOS_TIMEBREAK_ABILITY_ID = 'chronos_timebreak';
const CHRONOS_TIMEBREAK_FALLBACK_SOURCE_HEIGHT = 1.18;

interface LifelineTargetCandidate {
  player: Player;
  distanceSq: number;
  healthScore: number;
}

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function offsetPositionAlongDirection(
  position: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  distance: number
): { x: number; y: number; z: number } {
  return {
    x: position.x + direction.x * distance,
    y: position.y + direction.y * distance,
    z: position.z + direction.z * distance,
  };
}

function sampleChronosPrimaryOrbPose(
  ctx: AbilityContext,
  nowMs: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  const socketPose = readViewmodelSocket(CHRONOS_PRIMARY_ORB_SOCKET_NAME);
  if (socketPose) return socketPose;

  return sampleViewmodelPose<ChronosPrimaryOrbPoseSampleContext>(
    CHRONOS_PRIMARY_ORB_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    }
  );
}

function calculateChronosPulseLaunch(
  ctx: AbilityContext,
  spawnOverride?: { x: number; y: number; z: number }
) {
  const lookDirection = calculateLookDirection(ctx.yaw, ctx.pitch);
  const fallbackSpawnPos = calculatePlayerSocketPosition(
    ctx.position,
    ctx.yaw,
    CHRONOS_PRIMARY_ORB_SOCKET
  );
  const spawnPos = spawnOverride ?? fallbackSpawnPos;
  const aimOrigin = {
    x: ctx.position.x,
    y: ctx.position.y + EYE_HEIGHT,
    z: ctx.position.z,
  };
  const aimPoint = {
    x: aimOrigin.x + lookDirection.x * CHRONOS_PRIMARY_AIM_DISTANCE,
    y: aimOrigin.y + lookDirection.y * CHRONOS_PRIMARY_AIM_DISTANCE,
    z: aimOrigin.z + lookDirection.z * CHRONOS_PRIMARY_AIM_DISTANCE,
  };

  if (isPhysicsReady()) {
    const hit = raycastDirection(
      aimOrigin.x,
      aimOrigin.y,
      aimOrigin.z,
      lookDirection.x,
      lookDirection.y,
      lookDirection.z,
      CHRONOS_PRIMARY_AIM_DISTANCE
    );

    if (hit?.hit) {
      aimPoint.x = hit.point.x;
      aimPoint.y = hit.point.y;
      aimPoint.z = hit.point.z;
    }
  }

  const aimDelta = {
    x: aimPoint.x - spawnPos.x,
    y: aimPoint.y - spawnPos.y,
    z: aimPoint.z - spawnPos.z,
  };
  const aimLength = Math.sqrt(aimDelta.x ** 2 + aimDelta.y ** 2 + aimDelta.z ** 2) || 1;

  return {
    spawnPos,
    direction: {
      x: aimDelta.x / aimLength,
      y: aimDelta.y / aimLength,
      z: aimDelta.z / aimLength,
    },
  };
}

function collectChronosLifelineTargets(ctx: AbilityContext): Player[] {
  const store = useGameStore.getState();
  const sourcePosition = ctx.position;
  const sourceTeam = ctx.localPlayer.team;
  if (!sourceTeam) return [];

  const radiusSq = CHRONOS_LIFELINE_RADIUS * CHRONOS_LIFELINE_RADIUS;
  const seenIds = new Set<string>();
  const candidates: LifelineTargetCandidate[] = [];

  const addCandidate = (player: Player | null | undefined) => {
    if (!player || seenIds.has(player.id)) return;
    seenIds.add(player.id);

    if (player.id === ctx.localPlayer.id) return;
    if (player.state !== 'alive') return;
    if (player.team !== sourceTeam) return;

    const dx = player.position.x - sourcePosition.x;
    const dy = player.position.y - sourcePosition.y;
    const dz = player.position.z - sourcePosition.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > radiusSq) return;

    candidates.push({
      player,
      distanceSq,
      healthScore: player.health / Math.max(1, player.maxHealth),
    });
  };

  store.players.forEach(addCandidate);
  addCandidate(store.localPlayer);

  candidates.sort((a, b) => (
    a.healthScore === b.healthScore
      ? a.distanceSq - b.distanceSq
      : a.healthScore - b.healthScore
  ));

  return candidates.slice(0, CHRONOS_LIFELINE_MAX_TARGETS).map((candidate) => candidate.player);
}

function applyOptimisticLifelineHeal(targets: readonly Player[]): void {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;

  for (const target of targets) {
    const nextHealth = Math.min(target.maxHealth, target.health + CHRONOS_LIFELINE_HEAL);
    if (nextHealth <= target.health) continue;

    if (target.id === localPlayerId) {
      store.updateLocalPlayer({ health: nextHealth });
    } else {
      store.updatePlayer(target.id, {
        ...target,
        health: nextHealth,
      });
    }
  }
}

function emitLifelineConduitBeam(ctx: AbilityContext, targets: readonly Player[]): void {
  if (targets.length === 0) return;

  const now = Date.now();
  const sourcePose = sampleChronosPrimaryOrbPose(ctx, now);
  const sourcePosition = sourcePose
    ? vectorToPlainPosition(sourcePose.position)
    : {
      x: ctx.position.x,
      y: ctx.position.y,
      z: ctx.position.z,
    };

  addChronosLifelineEffects(
    sourcePosition,
    targets.map((target) => ({
      position: target.position,
    })),
    undefined,
    {
      sourceIsExact: Boolean(sourcePose),
      sourceSocketName: sourcePose ? CHRONOS_PRIMARY_ORB_SOCKET_NAME : undefined,
    }
  );
}

export function useChronosAbilities(): UseChronosAbilitiesReturn {
  const lastPulseTimeRef = useRef(0);
  const pulseIdRef = useRef(0);
  const timebreakIdRef = useRef(0);

  const executeLifelineConduit = useCallback((
    ctx: AbilityContext,
    useAbilityCharge: (abilityId: string) => boolean
  ): boolean => {
    if (!useAbilityCharge(CHRONOS_LIFELINE_ABILITY_ID)) return false;

    const now = Date.now();
    const targets = collectChronosLifelineTargets(ctx);
    triggerChronosLifelineConduitPose(now);

    window.setTimeout(() => {
      emitLifelineConduitBeam(ctx, targets);
      applyOptimisticLifelineHeal(targets);
    }, CHRONOS_LIFELINE_RELEASE_DELAY_MS);

    return true;
  }, []);

  const fireVerdantPulse = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    const poseTimestampMs = ctx.viewmodelNowMs ?? now;
    const holdBlend = getChronosPrimaryHeldBlend(poseTimestampMs);
    if (holdBlend < CHRONOS_PRIMARY_FIRE_READY_BLEND) return;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastPulseTimeRef.current < CHRONOS_PRIMARY_FIRE_INTERVAL / tempoMultiplier) return;

    lastPulseTimeRef.current = now;
    pulseIdRef.current++;
    const pulseId = `chronos_pulse_${ctx.localPlayer.id}_${pulseIdRef.current}`;
    const launchPose = sampleChronosPrimaryOrbPose(ctx, now);
    const spawnOverride = launchPose ? vectorToPlainPosition(launchPose.position) : undefined;
    const { spawnPos, direction } = calculateChronosPulseLaunch(ctx, spawnOverride);
    assertViewmodelLaunchMatchesPose({
      eventId: pulseId,
      launchPosition: spawnPos,
      pose: launchPose,
    });
    const projectileSpawnPos = offsetPositionAlongDirection(
      spawnPos,
      direction,
      CHRONOS_PRIMARY_PULSE_SPAWN_FORWARD_OFFSET
    );
    triggerChronosPrimaryShotGlow(now);

    useGameStore.getState().addChronosPulse({
      id: pulseId,
      position: projectileSpawnPos,
      velocity: {
        x: direction.x * CHRONOS_PRIMARY_PULSE_SPEED,
        y: direction.y * CHRONOS_PRIMARY_PULSE_SPEED,
        z: direction.z * CHRONOS_PRIMARY_PULSE_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });
  }, []);

  const executeTimebreak = useCallback((
    ctx: AbilityContext,
    setAbilityActive: (
      abilityId: string,
      active: boolean,
      options?: { startTime?: number; startCooldownOnEnd?: boolean }
    ) => void,
    updateLocalPlayer: (data: Partial<Player>) => void
  ): boolean => {
    const now = Date.now();
    const releaseAt = now + CHRONOS_TIMEBREAK_RELEASE_DELAY_MS;
    const duration = ABILITY_DEFINITIONS[CHRONOS_TIMEBREAK_ABILITY_ID]?.duration ?? 5;

    timebreakIdRef.current++;
    const timebreakId = `chronos_timebreak_${ctx.localPlayer.id}_${timebreakIdRef.current}`;

    const currentAbilities = useGameStore.getState().localPlayer?.abilities ?? {};
    setAbilityActive(CHRONOS_TIMEBREAK_ABILITY_ID, true, {
      startTime: releaseAt,
      startCooldownOnEnd: true,
    });
    updateLocalPlayer({
      abilities: {
        ...currentAbilities,
        [CHRONOS_TIMEBREAK_ABILITY_ID]: {
          abilityId: CHRONOS_TIMEBREAK_ABILITY_ID,
          cooldownRemaining: 0,
          charges: 1,
          isActive: true,
          activatedAt: releaseAt,
        },
      },
    });
    triggerChronosTimebreakPose(now);

    window.setTimeout(() => {
      const releasedAt = Date.now();
      const sourcePose = sampleChronosPrimaryOrbPose(ctx, releasedAt);
      const sourcePosition = sourcePose
        ? vectorToPlainPosition(sourcePose.position)
        : {
          x: ctx.position.x,
          y: ctx.position.y + CHRONOS_TIMEBREAK_FALLBACK_SOURCE_HEIGHT,
          z: ctx.position.z,
        };

      addChronosTimebreakEffect({
        id: timebreakId,
        position: sourcePosition,
        ownerId: ctx.localPlayer.id,
        ownerTeam: ctx.localPlayer.team as 'red' | 'blue' | undefined,
        startTime: now,
        releaseTime: releasedAt,
        duration,
        radius: CHRONOS_TIMEBREAK_RADIUS,
      });
    }, CHRONOS_TIMEBREAK_RELEASE_DELAY_MS);

    return true;
  }, []);

  return {
    lastPulseTimeRef,
    pulseIdRef,
    timebreakIdRef,
    executeLifelineConduit,
    executeTimebreak,
    fireVerdantPulse,
  };
}
