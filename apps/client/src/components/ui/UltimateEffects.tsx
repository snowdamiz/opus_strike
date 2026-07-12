import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import { PHANTOM_NIGHTREIGN_DURATION_SECONDS } from '@voxel-strike/shared';
import {
  PHANTOM_VEIL_EFFECT_FADE_IN_MS,
  PHANTOM_VEIL_EFFECT_FADE_OUT_MS,
} from '../game/phantom/veilAtmosphere';

/**
 * UltimateEffects - Full-screen visual effects for active local ultimates.
 */
export function UltimateEffects() {
  const {
    ultimateEffectActive,
    ultimateEffectType,
    ultimateEffectEndTime,
    nightreignActive,
    nightreignActivatedAt,
  } = useGameStore(
    useShallow((state) => ({
      ultimateEffectActive: state.ultimateEffectActive,
      ultimateEffectType: state.ultimateEffectType,
      ultimateEffectEndTime: state.ultimateEffectEndTime,
      nightreignActive: state.localPlayer?.abilities?.phantom_nightreign?.isActive === true,
      nightreignActivatedAt: state.localPlayer?.abilities?.phantom_nightreign?.activatedAt ?? 0,
    }))
  );
  const effectActive = ultimateEffectActive || nightreignActive;
  const effectType = nightreignActive ? 'phantom_nightreign' : ultimateEffectType;
  const effectEndTime = nightreignActive
    ? nightreignActivatedAt + PHANTOM_NIGHTREIGN_DURATION_SECONDS * 1000
    : ultimateEffectEndTime;
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!effectActive) {
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
      const remaining = effectEndTime - now;
      const isPhantomUltimate = effectType === 'phantom_veil' || effectType === 'phantom_nightreign';
      setFadeOut(isPhantomUltimate && remaining <= 0);

      if (remaining <= (isPhantomUltimate ? -PHANTOM_VEIL_EFFECT_FADE_OUT_MS : 0)) {
        useGameStore.getState().setUltimateEffect(false);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => {
      window.cancelAnimationFrame(fadeInFrame);
      clearInterval(interval);
    };
  }, [effectActive, effectEndTime, effectType]);

  if (!effectActive) return null;

  if (effectType === 'phantom_veil') {
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

  if (effectType === 'phantom_nightreign') {
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
            background: 'radial-gradient(circle at center, rgba(67, 22, 104, 0.03) 20%, rgba(20, 3, 35, 0.24) 72%, rgba(4, 0, 12, 0.55) 100%)',
            boxShadow: 'inset 0 0 8rem rgba(139, 36, 190, 0.22)',
            backdropFilter: 'saturate(78%) contrast(1.08)',
            WebkitBackdropFilter: 'saturate(78%) contrast(1.08)',
          }}
        />
      </div>
    );
  }

  return null;
}
