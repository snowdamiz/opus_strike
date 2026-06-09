/**
 * Phantom Hero Abilities Hook
 * 
 * Handles Phantom-specific abilities:
 * - Dire Ball (primary fire)
 * - Void Ray (secondary fire - charged)
 * - Blink (E ability)
 * - Shadow Bubble (Q ability - personal shield)
 * - Phantom Veil (Ultimate)
 */

import { useRef, useCallback } from 'react';
import {
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import type { AbilityContext, PlayerSounds } from '../types';

export interface UsePhantomAbilitiesReturn {
  // State refs
  lastFireTimeRef: React.MutableRefObject<number>;
  direBallIdRef: React.MutableRefObject<number>;
  phantomPrimaryAmmoRef: React.MutableRefObject<number>;
  phantomPrimaryReloadingRef: React.MutableRefObject<boolean>;
  phantomPrimaryReloadStartRef: React.MutableRefObject<number>;
  voidRayChargingRef: React.MutableRefObject<boolean>;
  voidRayChargeStartRef: React.MutableRefObject<number>;
  voidRayIdRef: React.MutableRefObject<number>;

  // Methods
  updatePhantomPrimaryReload: (now?: number) => void;
  reloadPhantomPrimary: (now?: number) => boolean;
  resetPhantomPrimaryMagazine: () => void;
  fireDireBall: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  handleVoidRay: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  executeBlink: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    useAbilityCharge: (id: string) => boolean
  ) => boolean;
  executePersonalShield: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setAbilityActive: (id: string, active: boolean) => void,
    startClientCooldown: (id: string) => void,
    updateLocalPlayer: (data: any) => void
  ) => boolean;
  executePhantomVeil: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void,
    setAbilityActive: (id: string, active: boolean) => void
  ) => void;
}

export function usePhantomAbilities(): UsePhantomAbilitiesReturn {
  // Fire state
  const lastFireTimeRef = useRef(0);
  const direBallIdRef = useRef(0);
  const phantomPrimaryAmmoRef = useRef(PHANTOM_PRIMARY_MAGAZINE_SIZE);
  const phantomPrimaryReloadingRef = useRef(false);
  const phantomPrimaryReloadStartRef = useRef(0);

  // Void Ray state
  const voidRayChargingRef = useRef(false);
  const voidRayChargeStartRef = useRef(0);
  const voidRayIdRef = useRef(0);
  const voidRayAwaitingReleaseRef = useRef(false);

  const completePhantomPrimaryReload = useCallback(() => {
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;

    const store = useGameStore.getState();
    store.setPhantomPrimaryAmmo(PHANTOM_PRIMARY_MAGAZINE_SIZE);
    store.setPhantomPrimaryReload(false, 0, 0);
  }, []);

  const updatePhantomPrimaryReload = useCallback((now = Date.now()) => {
    const store = useGameStore.getState();
    phantomPrimaryAmmoRef.current = store.phantomPrimaryAmmo;
    phantomPrimaryReloadingRef.current = store.phantomPrimaryReloading;
    phantomPrimaryReloadStartRef.current = store.phantomPrimaryReloadStart;

    if (!phantomPrimaryReloadingRef.current) return;
    const reloadEnd = store.phantomPrimaryReloadEnd;
    if (reloadEnd > 0 && now < reloadEnd) return;

    completePhantomPrimaryReload();
  }, [completePhantomPrimaryReload]);

  const reloadPhantomPrimary = useCallback((now = Date.now()): boolean => {
    updatePhantomPrimaryReload(now);
    const store = useGameStore.getState();
    if (store.phantomPrimaryReloading) return false;
    if (store.phantomPrimaryAmmo >= PHANTOM_PRIMARY_MAGAZINE_SIZE) return false;
    return true;
  }, [updatePhantomPrimaryReload]);

  const resetPhantomPrimaryMagazine = useCallback(() => {
    lastFireTimeRef.current = 0;
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    useGameStore.getState().resetPhantomPrimaryMagazine();
  }, []);

  // Fire Dire Ball (primary fire)
  const fireDireBall = useCallback((_ctx: AbilityContext, _sounds: PlayerSounds) => {
    const now = Date.now();
    updatePhantomPrimaryReload(now);
    if (phantomPrimaryReloadingRef.current) return;
    if (phantomPrimaryAmmoRef.current <= 0) return;
  }, [updatePhantomPrimaryReload]);

  // Void Ray charge/release is confirmed by server abilityUsed messages.
  const handleVoidRay = useCallback((_ctx: AbilityContext, _sounds: PlayerSounds) => {
    const store = useGameStore.getState();
    voidRayChargingRef.current = store.voidRayCharging;
    voidRayChargeStartRef.current = store.voidRayChargeStart;
    if (!store.voidRayCharging) {
      voidRayAwaitingReleaseRef.current = false;
    }
  }, []);

  // Phantom Q is requested through input and confirmed by the server.
  const executePersonalShield = useCallback((
    _ctx: AbilityContext,
    _sounds: PlayerSounds,
    _setAbilityActive: (id: string, active: boolean) => void,
    _startClientCooldown: (id: string) => void,
    _updateLocalPlayer: (data: any) => void
  ): boolean => {
    return true;
  }, []);

  // Phantom Blink is requested through input and confirmed by the server.
  const executeBlink = useCallback((
    _ctx: AbilityContext,
    _sounds: PlayerSounds,
    _useAbilityCharge: (id: string) => boolean
  ): boolean => {
    return true;
  }, []);

  // Phantom Veil is requested through input and confirmed by the server.
  const executePhantomVeil = useCallback((
    _ctx: AbilityContext,
    _sounds: PlayerSounds,
    _updateLocalPlayer: (data: any) => void,
    _setAbilityActive: (id: string, active: boolean) => void
  ) => {
    return undefined;
  }, []);

  return {
    lastFireTimeRef,
    direBallIdRef,
    phantomPrimaryAmmoRef,
    phantomPrimaryReloadingRef,
    phantomPrimaryReloadStartRef,
    voidRayChargingRef,
    voidRayChargeStartRef,
    voidRayIdRef,
    updatePhantomPrimaryReload,
    reloadPhantomPrimary,
    resetPhantomPrimaryMagazine,
    fireDireBall,
    handleVoidRay,
    executeBlink,
    executePersonalShield,
    executePhantomVeil,
  };
}
