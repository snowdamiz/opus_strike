import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import {
  PHANTOM_VEIL_EFFECT_FADE_IN_MS,
  PHANTOM_VEIL_EFFECT_FADE_OUT_MS,
} from '../game/phantom/veilAtmosphere';

/**
 * UltimateEffects - Full-screen visual effects for active local ultimates.
 */
export function UltimateEffects() {
  const { ultimateEffectActive, ultimateEffectType, ultimateEffectEndTime } = useGameStore(
    useShallow((state) => ({
      ultimateEffectActive: state.ultimateEffectActive,
      ultimateEffectType: state.ultimateEffectType,
      ultimateEffectEndTime: state.ultimateEffectEndTime,
    }))
  );
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ultimateEffectActive) {
      setFadeOut(false);
      setVisible(false);
      return;
    }

    setFadeOut(false);
    setVisible(false);
    const fadeInFrame = window.requestAnimationFrame(() => {
      setVisible(true);
    });

    const updateTimer = () => {
      const now = Date.now();
      const remaining = ultimateEffectEndTime - now;
      const isPhantomVeil = ultimateEffectType === 'phantom_veil';
      setFadeOut(isPhantomVeil && remaining <= 0);

      if (remaining <= (isPhantomVeil ? -PHANTOM_VEIL_EFFECT_FADE_OUT_MS : 0)) {
        useGameStore.getState().setUltimateEffect(false);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => {
      window.cancelAnimationFrame(fadeInFrame);
      clearInterval(interval);
    };
  }, [ultimateEffectActive, ultimateEffectEndTime, ultimateEffectType]);

  if (!ultimateEffectActive) return null;

  if (ultimateEffectType === 'phantom_veil') {
    return (
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          opacity: visible && !fadeOut ? 1 : 0,
          transition: `opacity ${fadeOut ? PHANTOM_VEIL_EFFECT_FADE_OUT_MS : PHANTOM_VEIL_EFFECT_FADE_IN_MS}ms ${fadeOut ? 'ease-in' : 'ease-out'}`,
          zIndex: 100,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.001)',
            backdropFilter: 'grayscale(1) saturate(0%) contrast(0.82) brightness(1.28)',
            WebkitBackdropFilter: 'grayscale(1) saturate(0%) contrast(0.82) brightness(1.28)',
          }}
        />
      </div>
    );
  }

  return null;
}
