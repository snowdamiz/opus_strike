import { useCallback, useRef } from 'react';
import type { AbilityContext } from '../types';

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

  const executeLifelineConduit = useCallback((
    _ctx: AbilityContext,
    _useAbilityCharge: (abilityId: string) => boolean
  ): boolean => true, []);

  const executeTimebreak = useCallback((
    _ctx: AbilityContext,
    _startClientCooldown: (abilityId: string) => void
  ): boolean => true, []);

  const fireVerdantPulse = useCallback((_ctx: AbilityContext): void => {
    // Server broadcasts chronos_verdant_pulse when the shot is accepted.
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
