import { useCallback, useRef } from 'react';
import {
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  CHRONOS_PRIMARY_ORB_SOCKET,
  calculateLookDirection,
  calculatePlayerSocketPosition,
} from '../constants';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import {
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  triggerChronosTimebreakPose,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../../viewmodel/chronosPose';
import {
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import type { AbilityContext } from '../types';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';

export interface UseChronosAbilitiesReturn {
  lastPulseTimeRef: React.MutableRefObject<number>;
  pulseIdRef: React.MutableRefObject<number>;
  timebreakIdRef: React.MutableRefObject<number>;
  executeLifelineConduit: (ctx: AbilityContext, useAbilityCharge: (abilityId: string) => boolean) => boolean;
  executeTimebreak: (
    ctx: AbilityContext,
    startClientCooldown: (abilityId: string) => void
  ) => boolean;
  fireVerdantPulse: (ctx: AbilityContext) => void;
}

/**
 * Chronos casts are server-authoritative. PlayerController still calls this hook
 * to preserve the input flow, but world effects, healing, cooldowns, and pulses
 * are created from server messages in gameMessageHandlers.
 */
export function useChronosAbilities(): UseChronosAbilitiesReturn {
  const lastPulseTimeRef = useRef(0);
  const pulseIdRef = useRef(0);
  const timebreakIdRef = useRef(0);
  const primaryHoldStartedAtRef = useRef(0);

  function sampleChronosPrimarySpawn(ctx: AbilityContext, now: number): ViewmodelSocketPose | null {
    if (!ctx.camera) return null;
    return sampleViewmodelPose<ChronosPrimaryOrbPoseSampleContext>(
      CHRONOS_PRIMARY_ORB_SOCKET_NAME,
      {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        timestampMs: ctx.viewmodelNowMs ?? now,
      }
    );
  }

  const executeLifelineConduit = useCallback((
    ctx: AbilityContext,
    _useAbilityCharge: (abilityId: string) => boolean
  ): boolean => {
    const now = Date.now();
    triggerChronosLifelineConduitPose(now);
    markPredictedLocalAbilityVisual('chronos_lifeline_conduit', ctx.localPlayer.id, `predicted_chronos_lifeline_${ctx.localPlayer.id}_${now}`, {
      now,
    });
    return true;
  }, []);

  const executeTimebreak = useCallback((
    ctx: AbilityContext,
    _startClientCooldown: (abilityId: string) => void
  ): boolean => {
    const now = Date.now();
    timebreakIdRef.current += 1;
    triggerChronosTimebreakPose(now);
    markPredictedLocalAbilityVisual('chronos_timebreak', ctx.localPlayer.id, `predicted_chronos_timebreak_${ctx.localPlayer.id}_${timebreakIdRef.current}`, {
      now,
    });
    return true;
  }, []);

  const fireVerdantPulse = useCallback((ctx: AbilityContext): void => {
    const now = Date.now();
    if (!ctx.inputState.primaryFire) {
      primaryHoldStartedAtRef.current = 0;
      return;
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (primaryHoldStartedAtRef.current <= 0) {
      primaryHoldStartedAtRef.current = now;
    }
    if (now - primaryHoldStartedAtRef.current < CHRONOS_VERDANT_PULSE_FIRE_READY_MS / tempoMultiplier) return;
    if (now - lastPulseTimeRef.current < CHRONOS_VERDANT_PULSE_COOLDOWN_MS / tempoMultiplier) return;

    lastPulseTimeRef.current = now;
    pulseIdRef.current += 1;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const sampledSpawn = sampleChronosPrimarySpawn(ctx, now);
    const startPosition = sampledSpawn
      ? {
        x: sampledSpawn.position.x,
        y: sampledSpawn.position.y,
        z: sampledSpawn.position.z,
      }
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, CHRONOS_PRIMARY_ORB_SOCKET);
    const visualId = `predicted_chronos_pulse_${ctx.localPlayer.id}_${pulseIdRef.current}`;

    triggerChronosPrimaryShotGlow(now);
    useGameStore.getState().addChronosPulse({
      id: visualId,
      position: startPosition,
      velocity: {
        x: direction.x * CHRONOS_VERDANT_PULSE_SPEED,
        y: direction.y * CHRONOS_VERDANT_PULSE_SPEED,
        z: direction.z * CHRONOS_VERDANT_PULSE_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });
    markPredictedLocalAbilityVisual('chronos_verdant_pulse', ctx.localPlayer.id, visualId, { now });
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
