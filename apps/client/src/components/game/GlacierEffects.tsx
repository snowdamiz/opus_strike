import { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
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
  const {
    iceMalletSwings,
    iceWallRushes,
    iceWallRushActive,
    localPlayer,
    gamePhase,
    glacierSwingHeld,
    glacierShieldActive,
    frostStormActive,
  } = useGameStore(useShallow(state => ({
    iceMalletSwings: state.iceMalletSwings,
    iceWallRushes: state.iceWallRushes,
    iceWallRushActive: state.iceWallRushActive,
    localPlayer: state.localPlayer,
    gamePhase: state.gamePhase,
    glacierSwingHeld: state.glacierSwingHeld,
    glacierShieldActive: state.glacierShieldActive,
    frostStormActive: state.frostStormActive,
  })));
  
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
