import { useEffect, useRef, type CSSProperties } from 'react';
import { visualStore } from '../../store/visualStore';

const SLIDE_SPEED_LINES = [
  { left: '6%', delay: '-0.62s', alpha: 0.55, scale: 0.95, rotate: '-18deg', drift: '8vw', width: '3px' },
  { left: '13%', delay: '-0.14s', alpha: 0.78, scale: 1.18, rotate: '-14deg', drift: '6vw', width: '4px' },
  { left: '21%', delay: '-0.48s', alpha: 0.5, scale: 0.86, rotate: '-10deg', drift: '4vw', width: '2px' },
  { left: '31%', delay: '-0.32s', alpha: 0.45, scale: 1.08, rotate: '-6deg', drift: '2vw', width: '2px' },
  { left: '43%', delay: '-0.76s', alpha: 0.32, scale: 0.82, rotate: '-3deg', drift: '1vw', width: '2px' },
  { left: '55%', delay: '-0.2s', alpha: 0.34, scale: 0.9, rotate: '3deg', drift: '-1vw', width: '2px' },
  { left: '67%', delay: '-0.68s', alpha: 0.5, scale: 1.08, rotate: '7deg', drift: '-2vw', width: '3px' },
  { left: '77%', delay: '-0.38s', alpha: 0.72, scale: 1.22, rotate: '12deg', drift: '-5vw', width: '4px' },
  { left: '88%', delay: '-0.06s', alpha: 0.58, scale: 0.98, rotate: '16deg', drift: '-7vw', width: '3px' },
  { left: '96%', delay: '-0.54s', alpha: 0.42, scale: 0.88, rotate: '20deg', drift: '-9vw', width: '2px' },
] as const;

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
  element.style.setProperty('--slide-line-opacity', String(0.46 + intensity * 0.48));
  element.style.setProperty('--slide-line-duration', `${820 - intensity * 360}ms`);
}

export function SlideEffects() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let animationFrame = 0;
    let lastIntensity = -1;

    const update = () => {
      const intensity = visualStore.getState().slideIntensity;
      if (intensity !== lastIntensity) {
        lastIntensity = intensity;
        applySlideIntensity(overlayRef.current, intensity);
      }
      animationFrame = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(animationFrame);
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
      <div className="slide-speed-line-layer">
        {SLIDE_SPEED_LINES.map((line, index) => (
          <span
            key={index}
            className="slide-speed-line"
            style={{
              '--line-left': line.left,
              '--line-delay': line.delay,
              '--line-alpha': String(line.alpha),
              '--line-scale': String(line.scale),
              '--line-rotate': line.rotate,
              '--line-drift': line.drift,
              '--line-width': line.width,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
