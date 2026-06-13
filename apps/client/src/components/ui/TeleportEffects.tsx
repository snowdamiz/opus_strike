import { useState, useEffect, useCallback } from 'react';

type TeleportType = 'blink' | null;

interface TeleportEffectsState {
  active: boolean;
  type: TeleportType;
  phase: 'out' | 'in' | null;
}

// Global event system for triggering effects
const teleportEvents = {
  listeners: [] as ((type: TeleportType) => void)[],
  trigger: (type: TeleportType) => {
    teleportEvents.listeners.forEach(fn => fn(type));
  },
  subscribe: (fn: (type: TeleportType) => void) => {
    teleportEvents.listeners.push(fn);
    return () => {
      teleportEvents.listeners = teleportEvents.listeners.filter(l => l !== fn);
    };
  }
};

// Export for PlayerController to trigger
export const triggerTeleportEffect = (type: 'blink') => {
  teleportEvents.trigger(type);
};

export function TeleportEffects() {
  const [effect, setEffect] = useState<TeleportEffectsState>({
    active: false,
    type: null,
    phase: null,
  });

  const triggerEffect = useCallback((type: TeleportType) => {
    if (!type) return;
    
    // Start with "out" phase (leaving current position)
    setEffect({ active: true, type, phase: 'out' });
    
    // Transition to "in" phase (arriving at new position)
    const inDelay = 80;
    setTimeout(() => {
      setEffect(prev => ({ ...prev, phase: 'in' }));
    }, inDelay);
    
    // End effect
    const endDelay = 250;
    setTimeout(() => {
      setEffect({ active: false, type: null, phase: null });
    }, endDelay);
  }, []);

  useEffect(() => {
    return teleportEvents.subscribe(triggerEffect);
  }, [triggerEffect]);

  if (!effect.active) return null;

  // Different effects for each ability type
  if (effect.type === 'blink') {
    return <BlinkEffect phase={effect.phase} />;
  }

  return null;
}

// ===== BLINK EFFECT (E) - Quick dash with motion blur =====
function BlinkEffect({ phase }: { phase: 'out' | 'in' | null }) {
  return (
    <div className="fixed inset-0 pointer-events-none z-[200]">
      {/* Speed lines / motion blur */}
      <div 
        className={`absolute inset-0 transition-opacity duration-75 ${
          phase === 'out' ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: `
            repeating-linear-gradient(
              90deg,
              transparent 0px,
              transparent 20px,
              rgba(168, 85, 247, 0.15) 20px,
              rgba(168, 85, 247, 0.15) 22px
            )
          `,
          animation: phase === 'out' ? 'blinkStreak 0.1s ease-out' : 'none',
        }}
      />
      
      {/* Purple flash */}
      <div 
        className={`absolute inset-0 transition-all ${
          phase === 'out' ? 'duration-50' : 'duration-150'
        }`}
        style={{
          background: phase === 'out'
            ? 'radial-gradient(circle at center, rgba(168, 85, 247, 0.4) 0%, rgba(139, 92, 246, 0.2) 50%, transparent 70%)'
            : 'transparent',
        }}
      />
      
      {/* Edge vignette flash */}
      <div 
        className={`absolute inset-0 transition-opacity ${
          phase === 'out' ? 'duration-50 opacity-100' : 'duration-150 opacity-0'
        }`}
        style={{
          boxShadow: 'inset 0 0 100px 30px rgba(168, 85, 247, 0.5)',
        }}
      />

      {/* Chromatic aberration simulation */}
      <div 
        className={`absolute inset-0 transition-opacity duration-100 ${
          phase === 'out' ? 'opacity-60' : 'opacity-0'
        }`}
        style={{
          background: `
            linear-gradient(90deg, 
              rgba(255, 0, 128, 0.1) 0%, 
              transparent 30%, 
              transparent 70%, 
              rgba(0, 200, 255, 0.1) 100%
            )
          `,
        }}
      />

      <style>{`
        @keyframes blinkStreak {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
