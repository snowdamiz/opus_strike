import { useEffect, useRef } from 'react';
import { visualStore } from '../../store/visualStore';
import { gameplayFrameScheduler } from '../game/systems/gameplayFrameScheduler';

const SLIDE_LINE_COUNT = 8;
const SLIDE_LINE_INDICES = Array.from({ length: SLIDE_LINE_COUNT }, (_, index) => index);

function getSlideDirection(value: number, velocity: { x: number; z: number }, viewYaw: number): number {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 0.01 || value < 0.01) return 0;

  const rightX = Math.cos(viewYaw);
  const rightZ = -Math.sin(viewYaw);
  const lateralVelocity = (velocity.x * rightX + velocity.z * rightZ) / speed;

  return Math.max(-1, Math.min(1, lateralVelocity));
}

function applySlideIntensity(
  element: HTMLDivElement | null,
  value: number,
  direction: number
): void {
  if (!element) return;

  const intensity = Math.min(1, Math.max(0, value));
  if (intensity < 0.01) {
    element.style.opacity = '0';
    element.style.visibility = 'hidden';
    element.style.setProperty('--slide-line-opacity', '0');
    element.style.setProperty('--slide-line-play-state', 'paused');
    return;
  }

  element.style.visibility = 'visible';
  element.style.opacity = String(0.22 + intensity * 0.46);
  element.style.setProperty('--slide-edge-opacity', String(0.38 + intensity * 0.5));
  element.style.setProperty('--slide-haze-opacity', String(0.025 + intensity * 0.055));
  element.style.setProperty('--slide-haze-side-opacity', String((0.025 + intensity * 0.055) * 0.72));
  element.style.setProperty('--slide-line-opacity', String(0.12 + intensity * 0.34));
  element.style.setProperty('--slide-line-play-state', 'running');
  element.style.setProperty('--slide-line-drift', `${34 + intensity * 48}px`);
  element.style.setProperty('--slide-line-angle', `${direction * 12}deg`);
  element.style.setProperty('--slide-line-skew', `${direction * -8}deg`);
}

export function SlideEffects() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lastIntensity = -1;
    let lastDirection = Number.NaN;

    return gameplayFrameScheduler.register({
      system: 'slideEffects',
      label: 'frame.ui.slideEffects',
      priority: 100,
      callback: () => {
        const visualState = visualStore.getState();
        const intensity = visualState.slideIntensity;
        const direction = getSlideDirection(
          intensity,
          visualState.localSlideVelocity,
          visualState.localViewYaw
        );

        if (intensity !== lastIntensity || Math.abs(direction - lastDirection) > 0.02) {
          lastIntensity = intensity;
          lastDirection = direction;
          applySlideIntensity(overlayRef.current, intensity, direction);
        }
      },
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
      <div className="slide-speed-lines">
        {SLIDE_LINE_INDICES.map((index) => (
          <i key={index} />
        ))}
      </div>
    </div>
  );
}
