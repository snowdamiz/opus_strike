import { useEffect, useRef, type CSSProperties } from 'react';
import { visualStore } from '../../store/visualStore';

const SLIDE_SPEED_LINES = [
  { left: '6%', top: '18%', delay: '-0.62s', alpha: 0.55, scale: 0.95, rotate: '-18deg', width: '3px' },
  { left: '13%', top: '68%', delay: '-0.14s', alpha: 0.78, scale: 1.18, rotate: '-14deg', width: '4px' },
  { left: '21%', top: '36%', delay: '-0.48s', alpha: 0.5, scale: 0.86, rotate: '-10deg', width: '2px' },
  { left: '31%', top: '82%', delay: '-0.32s', alpha: 0.45, scale: 1.08, rotate: '-6deg', width: '2px' },
  { left: '43%', top: '12%', delay: '-0.76s', alpha: 0.32, scale: 0.82, rotate: '-3deg', width: '2px' },
  { left: '55%', top: '54%', delay: '-0.2s', alpha: 0.34, scale: 0.9, rotate: '3deg', width: '2px' },
  { left: '67%', top: '25%', delay: '-0.68s', alpha: 0.5, scale: 1.08, rotate: '7deg', width: '3px' },
  { left: '77%', top: '76%', delay: '-0.38s', alpha: 0.72, scale: 1.22, rotate: '12deg', width: '4px' },
  { left: '88%', top: '42%', delay: '-0.06s', alpha: 0.58, scale: 0.98, rotate: '16deg', width: '3px' },
  { left: '96%', top: '88%', delay: '-0.54s', alpha: 0.42, scale: 0.88, rotate: '20deg', width: '2px' },
] as const;

const SLIDE_DIRECTION_EPSILON = 0.001;
const SLIDE_FLOW_START_VMAX = 28;
const SLIDE_FLOW_END_VMAX = 128;
const DEFAULT_SLIDE_FLOW = Object.freeze({ x: 0, y: 1, angleDeg: 0 });

export interface SlideScreenFlow {
  x: number;
  y: number;
  angleDeg: number;
}

export function resolveSlideScreenFlow(
  velocity: { x: number; z: number },
  viewYaw: number
): SlideScreenFlow | null {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < SLIDE_DIRECTION_EPSILON) return null;

  const forwardX = -Math.sin(viewYaw);
  const forwardZ = -Math.cos(viewYaw);
  const rightX = Math.cos(viewYaw);
  const rightZ = -Math.sin(viewYaw);
  const slideRight = (velocity.x * rightX + velocity.z * rightZ) / speed;
  const slideForward = (velocity.x * forwardX + velocity.z * forwardZ) / speed;
  const screenLength = Math.hypot(slideRight, slideForward);
  if (screenLength < SLIDE_DIRECTION_EPSILON) return null;

  const x = slideRight / screenLength;
  const y = slideForward / screenLength;
  return {
    x,
    y,
    angleDeg: -Math.atan2(x, y) * (180 / Math.PI),
  };
}

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

function applySlideFlow(element: HTMLDivElement | null, flow: SlideScreenFlow): void {
  if (!element) return;

  element.style.setProperty('--slide-flow-start-x', `${(-flow.x * SLIDE_FLOW_START_VMAX).toFixed(2)}vmax`);
  element.style.setProperty('--slide-flow-start-y', `${(-flow.y * SLIDE_FLOW_START_VMAX).toFixed(2)}vmax`);
  element.style.setProperty('--slide-flow-end-x', `${(flow.x * SLIDE_FLOW_END_VMAX).toFixed(2)}vmax`);
  element.style.setProperty('--slide-flow-end-y', `${(flow.y * SLIDE_FLOW_END_VMAX).toFixed(2)}vmax`);
  element.style.setProperty('--slide-flow-rotate', `${flow.angleDeg.toFixed(2)}deg`);
}

export function SlideEffects() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastFlowRef = useRef<SlideScreenFlow>(DEFAULT_SLIDE_FLOW);

  useEffect(() => {
    let animationFrame = 0;
    let lastIntensity = -1;
    let lastFlowSignature = '';

    const update = () => {
      const visualState = visualStore.getState();
      const intensity = visualState.slideIntensity;
      const resolvedFlow = resolveSlideScreenFlow(visualState.localSlideVelocity, visualState.localViewYaw);
      const flow = resolvedFlow ?? lastFlowRef.current;
      if (resolvedFlow) {
        lastFlowRef.current = resolvedFlow;
      }

      if (intensity !== lastIntensity) {
        lastIntensity = intensity;
        applySlideIntensity(overlayRef.current, intensity);
      }
      const flowSignature = `${flow.x.toFixed(3)}:${flow.y.toFixed(3)}:${flow.angleDeg.toFixed(1)}`;
      if (flowSignature !== lastFlowSignature) {
        lastFlowSignature = flowSignature;
        applySlideFlow(overlayRef.current, flow);
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
              '--line-top': line.top,
              '--line-delay': line.delay,
              '--line-alpha': String(line.alpha),
              '--line-scale': String(line.scale),
              '--line-rotate': line.rotate,
              '--line-width': line.width,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
