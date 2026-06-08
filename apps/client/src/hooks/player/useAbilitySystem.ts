/**
 * Ability System Hook
 * 
 * Manages ability cooldowns, charges, and activation states.
 */

import { useRef, useCallback } from 'react';
import { ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import type { AbilityActiveState } from './types';

export interface UseAbilitySystemReturn {
  // Refs
  abilityPressedRef: React.MutableRefObject<{ ability1: boolean; ability2: boolean; ultimate: boolean }>;
  clientCooldownsRef: React.MutableRefObject<Record<string, number>>;
  clientChargesRef: React.MutableRefObject<Record<string, number>>;
  abilityActiveRef: React.MutableRefObject<Record<string, AbilityActiveState>>;
  
  // Methods
  getClientCharges: (abilityId: string) => number;
  useAbilityCharge: (abilityId: string) => boolean;
  startClientCooldown: (abilityId: string) => void;
  canUseAbility: (abilityId: string, isUltimate: boolean, isTargetingActive?: boolean) => boolean;
  isAbilityActive: (abilityId: string) => boolean;
  setAbilityActive: (abilityId: string, active: boolean) => void;
  updateActiveAbilities: (dt: number) => { speedMultiplier: number };
}

export function useAbilitySystem(): UseAbilitySystemReturn {
  // Store actions
  const setClientCooldown = useGameStore(state => state.setClientCooldown);
  const setClientCharges = useGameStore(state => state.setClientCharges);

  // Refs
  const abilityPressedRef = useRef({ ability1: false, ability2: false, ultimate: false });
  const clientCooldownsRef = useRef<Record<string, number>>({});
  const clientChargesRef = useRef<Record<string, number>>({});
  const abilityActiveRef = useRef<Record<string, AbilityActiveState>>({});

  // Get current charges for an ability (initializes to max if not set)
  const getClientCharges = useCallback((abilityId: string): number => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) return 1;

    const maxCharges = abilityDef.charges || 1;

    // Initialize charges if not set
    if (clientChargesRef.current[abilityId] === undefined) {
      clientChargesRef.current[abilityId] = maxCharges;
      setClientCharges(abilityId, maxCharges);
    }

    return clientChargesRef.current[abilityId];
  }, [setClientCharges]);

  // Use a charge of an ability (returns true if successful)
  const useAbilityCharge = useCallback((abilityId: string): boolean => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) return false;

    const maxCharges = abilityDef.charges || 1;
    // Force 10s cooldown for blink
    const cooldownSeconds = abilityId === 'phantom_blink' ? 10 : (abilityDef.cooldown || 10);
    const now = Date.now();

    // Check if on cooldown (charges depleted)
    const cooldownEnd = clientCooldownsRef.current[abilityId];
    if (cooldownEnd && now < cooldownEnd) {
      return false;
    }

    // Get current charges
    let currentCharges = clientChargesRef.current[abilityId];

    // If charges undefined or cooldown just ended, reset to max
    if (currentCharges === undefined || (cooldownEnd && now >= cooldownEnd && currentCharges === 0)) {
      currentCharges = maxCharges;
      clientChargesRef.current[abilityId] = maxCharges;
      setClientCharges(abilityId, maxCharges);
      clientCooldownsRef.current[abilityId] = 0;
      setClientCooldown(abilityId, 0);
    }

    if (currentCharges <= 0) {
      return false;
    }

    // Consume a charge
    const newCharges = currentCharges - 1;
    clientChargesRef.current[abilityId] = newCharges;
    setClientCharges(abilityId, newCharges);

    // If no charges left, start cooldown to restore ALL charges
    if (newCharges === 0) {
      const cooldownMs = cooldownSeconds * 1000;
      const endTime = now + cooldownMs;
      clientCooldownsRef.current[abilityId] = endTime;
      setClientCooldown(abilityId, endTime);
    }

    return true;
  }, [setClientCharges, setClientCooldown]);

  // Start a client-side cooldown for an ability (for non-charge abilities)
  const startClientCooldown = useCallback((abilityId: string) => {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (abilityDef) {
      const cooldownMs = abilityDef.cooldown * 1000;
      const endTime = Date.now() + cooldownMs;
      clientCooldownsRef.current[abilityId] = endTime;
      setClientCooldown(abilityId, endTime);
    }
  }, [setClientCooldown]);

  // Check if ability can be used
  const canUseAbility = useCallback((
    abilityId: string, 
    isUltimate: boolean, 
    isTargetingActive: boolean = false
  ): boolean => {
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) return false;

    // Don't allow using abilities while targeting mode is active
    if (isTargetingActive && abilityId !== 'hookshot_grapple_trap') {
      return false;
    }

    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    const maxCharges = abilityDef?.charges || 1;
    const hasCharges = maxCharges > 1;

    // Check client-side cooldown
    const clientCooldownEnd = clientCooldownsRef.current[abilityId];
    const now = Date.now();

    if (clientCooldownEnd && clientCooldownEnd > 0 && now < clientCooldownEnd) {
      return false;
    }

    // For multi-charge abilities
    if (hasCharges) {
      const clientCharges = clientChargesRef.current[abilityId];

      // If cooldown ended, ability is available
      if (clientCooldownEnd === 0 || (clientCooldownEnd && now >= clientCooldownEnd)) {
        if (clientCharges === 0) return true;
      }

      if (clientCharges !== undefined) {
        if (clientCharges > 0) return true;
        return false;
      }

      return true;
    }

    // For non-charge abilities, check server state as fallback
    const abilityState = localPlayer.abilities?.[abilityId];
    if (abilityState) {
      if (abilityState.cooldownRemaining > 0) return false;
    }

    // Check ultimate charge
    if (isUltimate && (localPlayer.ultimateCharge ?? 0) < 100) {
      return false;
    }

    return true;
  }, []);

  // Check if an ability is currently active
  const isAbilityActive = useCallback((abilityId: string): boolean => {
    const state = abilityActiveRef.current[abilityId];
    if (!state?.active) return false;

    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    const duration = (abilityDef?.duration ?? 0) * 1000;
    
    return (Date.now() - state.startTime) < duration;
  }, []);

  // Set ability active state
  const setAbilityActive = useCallback((abilityId: string, active: boolean) => {
    abilityActiveRef.current[abilityId] = {
      active,
      startTime: active ? Date.now() : 0,
    };
  }, []);

  // Update active abilities and return speed multiplier
  const updateActiveAbilities = useCallback((_dt: number): { speedMultiplier: number } => {
    const now = Date.now();
    let speedMultiplier = 1;

    const activeAbilities = abilityActiveRef.current;
    for (const abilityId in activeAbilities) {
      const state = activeAbilities[abilityId];
      if (!state.active) continue;

      const abilityDef = ABILITY_DEFINITIONS[abilityId];
      const duration = (abilityDef?.duration ?? 0) * 1000;

      // Check if ability has expired
      if (now - state.startTime >= duration) {
        state.active = false;
        continue;
      }

      // Apply speed boosts for active abilities
      if (abilityId === 'phantom_veil') speedMultiplier *= 1.3;
      if (abilityId === 'pulse_speedboost') speedMultiplier *= 1.3;
      if (abilityId === 'pulse_haste') speedMultiplier *= 1.5;
      if (abilityId === 'glacier_iceslide') speedMultiplier *= 1.5;
    }

    return { speedMultiplier };
  }, []);

  return {
    abilityPressedRef,
    clientCooldownsRef,
    clientChargesRef,
    abilityActiveRef,
    getClientCharges,
    useAbilityCharge,
    startClientCooldown,
    canUseAbility,
    isAbilityActive,
    setAbilityActive,
    updateActiveAbilities,
  };
}
