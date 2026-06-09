import { useCallback, useRef } from 'react';
import * as THREE from 'three';
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
  CHRONOS_PRIMARY_FIRE_READY_BLEND,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  getChronosPrimaryHeldBlend,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../../viewmodel/chronosPose';
import {
  assertViewmodelLaunchMatchesPose,
  readViewmodelSocket,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import type { AbilityContext } from '../types';

export interface UseChronosAbilitiesReturn {
  lastPulseTimeRef: React.MutableRefObject<number>;
  pulseIdRef: React.MutableRefObject<number>;
  fireVerdantPulse: (ctx: AbilityContext) => void;
}

const CHRONOS_PRIMARY_AIM_DISTANCE = 120;
const CHRONOS_PRIMARY_PULSE_SPAWN_FORWARD_OFFSET = 0.82;

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

export function useChronosAbilities(): UseChronosAbilitiesReturn {
  const lastPulseTimeRef = useRef(0);
  const pulseIdRef = useRef(0);

  const fireVerdantPulse = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    const poseTimestampMs = ctx.viewmodelNowMs ?? now;
    const holdBlend = getChronosPrimaryHeldBlend(poseTimestampMs);
    if (holdBlend < CHRONOS_PRIMARY_FIRE_READY_BLEND) return;
    if (now - lastPulseTimeRef.current < CHRONOS_PRIMARY_FIRE_INTERVAL) return;

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

  return {
    lastPulseTimeRef,
    pulseIdRef,
    fireVerdantPulse,
  };
}
