import { useGameStore } from '../../store/gameStore';

export function SlideEffects() {
  const slideIntensity = useGameStore(state => state.slideIntensity);

  if (slideIntensity < 0.01) return null;

  return (
    <div 
      className="fixed inset-0 pointer-events-none z-50"
      style={{ opacity: slideIntensity }}
    >
      {/* Simple dark vignette - no colors */}
      <div 
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, 
            transparent 0%, 
            transparent 50%, 
            rgba(0, 0, 0, 0.2) 75%, 
            rgba(0, 0, 0, 0.4) 100%
          )`,
        }}
      />
    </div>
  );
}
