import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';

function applySlideIntensity(element: HTMLDivElement | null, value: number): void {
  if (!element) return;

  const intensity = Math.min(1, Math.max(0, value));
  if (intensity < 0.01) {
    element.style.opacity = '0';
    element.style.visibility = 'hidden';
    return;
  }

  element.style.visibility = 'visible';
  element.style.opacity = String(0.22 + intensity * 0.46);
  element.style.setProperty('--slide-blur', `${2 + intensity * 5}px`);
  element.style.setProperty('--slide-edge-opacity', String(0.3 + intensity * 0.45));
  element.style.setProperty('--slide-haze-opacity', String(0.025 + intensity * 0.055));
  element.style.setProperty('--slide-haze-side-opacity', String((0.025 + intensity * 0.055) * 0.72));
}

export function SlideEffects() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applySlideIntensity(overlayRef.current, useGameStore.getState().slideIntensity);

    return useGameStore.subscribe((state, previousState) => {
      if (state.slideIntensity === previousState.slideIntensity) return;
      applySlideIntensity(overlayRef.current, state.slideIntensity);
    });
  }, []);

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="slide-effects-overlay fixed inset-0 pointer-events-none z-50 overflow-hidden"
    >
      <div className="slide-edge-blur slide-edge-blur-left" />
      <div className="slide-edge-blur slide-edge-blur-right" />
      <div className="slide-edge-blur slide-edge-blur-top" />
      <div className="slide-edge-blur slide-edge-blur-bottom" />
      <div className="slide-motion-haze" />
    </div>
  );
}
