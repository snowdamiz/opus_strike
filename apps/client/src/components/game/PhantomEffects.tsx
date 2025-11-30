import { useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import {
  BlinkTeleportEffect,
  ShadowStepArrivalEffect,
  PhantomVeil3DEffect,
  BLINK_EFFECT_DURATION,
  SHADOW_ARRIVAL_DURATION,
  blinkEffects,
  shadowArrivals,
  type BlinkEffectData,
  type ShadowArrivalData,
} from './phantom';

// Re-export trigger functions for external use
export { triggerBlinkEffect, triggerShadowArrival } from './phantom';

// ============================================================================
// PHANTOM EFFECTS MANAGER
// Tracks and renders active phantom effects
// ============================================================================

export function PhantomEffectsManager() {
  const [activeBlinkEffects, setActiveBlinkEffects] = useState<BlinkEffectData[]>([]);
  const [activeShadowArrivals, setActiveShadowArrivals] = useState<ShadowArrivalData[]>([]);
  const { localPlayer, ultimateEffectActive, ultimateEffectType } = useGameStore();
  
  useFrame(() => {
    const now = Date.now();
    
    // Clean up expired blink effects
    const activeBlinks = blinkEffects.filter(e => now - e.startTime < BLINK_EFFECT_DURATION);
    blinkEffects.length = 0;
    blinkEffects.push(...activeBlinks);
    
    if (activeBlinks.length !== activeBlinkEffects.length) {
      setActiveBlinkEffects([...activeBlinks]);
    }
    
    // Clean up expired shadow arrivals
    const activeArrivals = shadowArrivals.filter(e => now - e.startTime < SHADOW_ARRIVAL_DURATION);
    shadowArrivals.length = 0;
    shadowArrivals.push(...activeArrivals);
    
    if (activeArrivals.length !== activeShadowArrivals.length) {
      setActiveShadowArrivals([...activeArrivals]);
    }
  });
  
  const showVeilEffect = ultimateEffectActive && ultimateEffectType === 'phantom_veil' && localPlayer;
  
  return (
    <group>
      {/* Blink teleport effects */}
      {activeBlinkEffects.map(effect => (
        <BlinkTeleportEffect
          key={effect.id}
          startPosition={effect.startPosition}
          endPosition={effect.endPosition}
          startTime={effect.startTime}
        />
      ))}
      
      {/* Shadow Step arrival effects */}
      {activeShadowArrivals.map(effect => (
        <ShadowStepArrivalEffect
          key={effect.id}
          position={effect.position}
          startTime={effect.startTime}
        />
      ))}
      
      {/* Phantom Veil 3D effect */}
      {showVeilEffect && localPlayer && (
        <PhantomVeil3DEffect
          isActive={true}
          playerPosition={localPlayer.position}
        />
      )}
    </group>
  );
}
