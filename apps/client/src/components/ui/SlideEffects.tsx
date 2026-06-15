import { useEffect, useRef } from 'react';
import { visualStore } from '../../store/visualStore';

const SLIDE_INTENSITY_STYLE_STEP = 0.05;
const SLIDE_EFFECTS_POLL_INTERVAL_MS = 50;

export function quantizeSlideIntensityForStyle(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped < 0.01) return 0;
  const quantized = Math.min(1, Math.max(0, Math.round(clamped / SLIDE_INTENSITY_STYLE_STEP) * SLIDE_INTENSITY_STYLE_STEP));
  return Math.round(quantized * 100) / 100;
}

function applySlideIntensity(element: HTMLDivElement | null, value: number): void {
  if (!element) return;

  const intensity = quantizeSlideIntensityForStyle(value);
  if (intensity < 0.01) {
    element.style.opacity = '0';
    element.style.visibility = 'hidden';
    return;
  }

  element.style.visibility = 'visible';
  element.style.opacity = String(0.22 + intensity * 0.46);
  element.style.setProperty('--slide-edge-opacity', String(0.3 + intensity * 0.45));
  element.style.setProperty('--slide-haze-opacity', String(0.025 + intensity * 0.055));
  element.style.setProperty('--slide-haze-side-opacity', String((0.025 + intensity * 0.055) * 0.72));
}

export function SlideEffects() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lastIntensity = -1;

    const update = () => {
      const visualState = visualStore.getState();
      const intensity = quantizeSlideIntensityForStyle(visualState.slideIntensity);

      if (intensity !== lastIntensity) {
        lastIntensity = intensity;
        applySlideIntensity(overlayRef.current, intensity);
      }
    };

    update();
    const intervalId = window.setInterval(update, SLIDE_EFFECTS_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
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
