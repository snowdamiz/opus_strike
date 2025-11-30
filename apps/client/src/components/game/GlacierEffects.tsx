import { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { cleanupExpiredIceWallColliders } from '../../hooks/usePhysics';
import { ICE_WALL_DURATION } from '@voxel-strike/shared';
import {
  IceMalletSwing,
  IdleMallet,
  IceShield,
  ICE_SHIELD_LOWER_DURATION,
  IceWallRush,
  FrostStormEffect,
} from './glacier';

// Re-export colors for external use
export { GLACIER_COLORS } from './glacier';

// ============================================================================
// GLACIER EFFECTS MANAGER
// ============================================================================

export function GlacierEffectsManager() {
  const iceMalletSwings = useGameStore(state => state.iceMalletSwings);
  const iceWallRushes = useGameStore(state => state.iceWallRushes);
  const iceWallRushActive = useGameStore(state => state.iceWallRushActive);
  const localPlayer = useGameStore(state => state.localPlayer);
  const gamePhase = useGameStore(state => state.gamePhase);
  const glacierSwingHeld = useGameStore(state => state.glacierSwingHeld);
  const glacierShieldActive = useGameStore(state => state.glacierShieldActive);
  const frostStormActive = useGameStore(state => state.frostStormActive);
  
  const wasShieldActiveRef = useRef(false);
  const shieldLoweringRef = useRef(false);
  const [shieldVisible, setShieldVisible] = useState(false);
  const [isLowering, setIsLowering] = useState(false);
  const [lowerStartTime, setLowerStartTime] = useState(0);
  
  const isGlacier = localPlayer?.heroId === 'glacier';
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  const hasActiveSwings = iceMalletSwings.some(swing => swing.ownerId === localPlayer?.id);
  const isSwinging = hasActiveSwings || glacierSwingHeld;
  
  useEffect(() => {
    if (glacierShieldActive && !wasShieldActiveRef.current) {
      setShieldVisible(true);
      setIsLowering(false);
      shieldLoweringRef.current = false;
    } else if (!glacierShieldActive && wasShieldActiveRef.current) {
      setIsLowering(true);
      setLowerStartTime(Date.now());
      shieldLoweringRef.current = true;
      setTimeout(() => {
        if (shieldLoweringRef.current) {
          setShieldVisible(false);
          setIsLowering(false);
          shieldLoweringRef.current = false;
        }
      }, ICE_SHIELD_LOWER_DURATION * 1000);
    }
    wasShieldActiveRef.current = glacierShieldActive;
  }, [glacierShieldActive]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredIceMalletSwings();
      useGameStore.getState().clearExpiredIceWallRushes();
      // Cleanup expired ice wall colliders (matches ICE_WALL_DURATION)
      cleanupExpiredIceWallColliders(ICE_WALL_DURATION * 1000);
    }, 100);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {isGlacier && isPlaying && !isSwinging && !shieldVisible && !iceWallRushActive && <IdleMallet />}
      {isGlacier && isPlaying && shieldVisible && <IceShield isLowering={isLowering} lowerStartTime={lowerStartTime} />}
      {isGlacier && isPlaying && frostStormActive && <FrostStormEffect />}
      {iceMalletSwings.map(swing => <IceMalletSwing key={swing.id} swing={swing} />)}
      {iceWallRushes.map(rush => <IceWallRush key={rush.id} rush={rush} />)}
    </group>
  );
}
