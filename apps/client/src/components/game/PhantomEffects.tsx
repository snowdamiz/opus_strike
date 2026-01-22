import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
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
  // Use refs for effect arrays to avoid setState in useFrame (prevents 60fps re-renders)
  const activeBlinkEffectsRef = useRef<BlinkEffectData[]>([]);
  const activeShadowArrivalsRef = useRef<ShadowArrivalData[]>([]);

  // Version counters to trigger re-renders only when effect counts change
  const [blinkVersion, setBlinkVersion] = useState(0);
  const [shadowVersion, setShadowVersion] = useState(0);

  const { localPlayer, ultimateEffectActive, ultimateEffectType } = useGameStore(
    useShallow(state => ({
      localPlayer: state.localPlayer,
      ultimateEffectActive: state.ultimateEffectActive,
      ultimateEffectType: state.ultimateEffectType,
    }))
  );

  useFrame(() => {
    const now = Date.now();

    // Clean up expired blink effects
    const activeBlinks = blinkEffects.filter(e => now - e.startTime < BLINK_EFFECT_DURATION);
    blinkEffects.length = 0;
    blinkEffects.push(...activeBlinks);

    // Update ref directly (no re-render triggered)
    activeBlinkEffectsRef.current = activeBlinks;

    // Only trigger re-render if count changed
    if (activeBlinks.length !== blinkVersion) {
      setBlinkVersion(activeBlinks.length);
    }

    // Clean up expired shadow arrivals
    const activeArrivals = shadowArrivals.filter(e => now - e.startTime < SHADOW_ARRIVAL_DURATION);
    shadowArrivals.length = 0;
    shadowArrivals.push(...activeArrivals);

    // Update ref directly (no re-render triggered)
    activeShadowArrivalsRef.current = activeArrivals;

    // Only trigger re-render if count changed
    if (activeArrivals.length !== shadowVersion) {
      setShadowVersion(activeArrivals.length);
    }
  });
  
  const showVeilEffect = ultimateEffectActive && ultimateEffectType === 'phantom_veil' && localPlayer;
  
  return (
    <group>
      {/* Blink teleport effects */}
      {activeBlinkEffectsRef.current.map(effect => (
        <BlinkTeleportEffect
          key={`${effect.id}_${blinkVersion}`}
          startPosition={effect.startPosition}
          endPosition={effect.endPosition}
          startTime={effect.startTime}
        />
      ))}

      {/* Shadow Step arrival effects */}
      {activeShadowArrivalsRef.current.map(effect => (
        <ShadowStepArrivalEffect
          key={`${effect.id}_${shadowVersion}`}
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
