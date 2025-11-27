import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';

type TeleportType = 'blink' | 'shadowstep' | null;

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
export const triggerTeleportEffect = (type: 'blink' | 'shadowstep') => {
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
    const inDelay = type === 'blink' ? 80 : 150;
    setTimeout(() => {
      setEffect(prev => ({ ...prev, phase: 'in' }));
    }, inDelay);
    
    // End effect
    const endDelay = type === 'blink' ? 250 : 400;
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

  if (effect.type === 'shadowstep') {
    return <ShadowStepEffect phase={effect.phase} />;
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

// ===== SHADOW STEP EFFECT (Q) - Dark ethereal transition =====
function ShadowStepEffect({ phase }: { phase: 'out' | 'in' | null }) {
  return (
    <div className="fixed inset-0 pointer-events-none z-[200]">
      {/* Dark vignette - heavy during 'out', fading during 'in' */}
      <div 
        className="absolute inset-0 transition-all"
        style={{
          transitionDuration: phase === 'out' ? '100ms' : '250ms',
          background: phase === 'out'
            ? 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7) 0%, rgba(30, 10, 50, 0.85) 60%, rgba(60, 20, 80, 0.95) 100%)'
            : phase === 'in'
            ? 'radial-gradient(ellipse at center, transparent 0%, rgba(30, 10, 50, 0.3) 70%, rgba(60, 20, 80, 0.4) 100%)'
            : 'transparent',
        }}
      />

      {/* Purple particle effect overlay */}
      <div 
        className={`absolute inset-0 transition-opacity ${
          phase === 'out' ? 'duration-100 opacity-100' : 'duration-200 opacity-0'
        }`}
      >
        {/* Floating particles */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: `rgba(${168 + Math.random() * 50}, ${85 + Math.random() * 30}, 247, ${0.5 + Math.random() * 0.5})`,
              boxShadow: '0 0 6px 2px rgba(168, 85, 247, 0.6)',
              animation: `shadowParticle ${0.2 + Math.random() * 0.3}s ease-out forwards`,
              animationDelay: `${Math.random() * 0.1}s`,
            }}
          />
        ))}
      </div>

      {/* Central void effect */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all"
        style={{
          transitionDuration: phase === 'out' ? '100ms' : '300ms',
          width: phase === 'out' ? '150vmax' : '0',
          height: phase === 'out' ? '150vmax' : '0',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(88, 28, 135, 0.8) 0%, rgba(30, 10, 50, 0.6) 40%, transparent 70%)',
        }}
      />

      {/* Ethereal wisps around edges */}
      <div 
        className={`absolute inset-0 transition-opacity ${
          phase === 'out' ? 'duration-100 opacity-100' : 'duration-300 opacity-0'
        }`}
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 10% 50%, rgba(139, 92, 246, 0.4), transparent 50%),
            radial-gradient(ellipse 80% 50% at 90% 50%, rgba(139, 92, 246, 0.4), transparent 50%),
            radial-gradient(ellipse 50% 80% at 50% 10%, rgba(168, 85, 247, 0.3), transparent 50%),
            radial-gradient(ellipse 50% 80% at 50% 90%, rgba(168, 85, 247, 0.3), transparent 50%)
          `,
        }}
      />

      {/* Arrival flash */}
      {phase === 'in' && (
        <div 
          className="absolute inset-0 animate-pulse-fast"
          style={{
            background: 'radial-gradient(circle at center, rgba(168, 85, 247, 0.3) 0%, transparent 50%)',
            animation: 'arrivalFlash 0.3s ease-out forwards',
          }}
        />
      )}

      <style>{`
        @keyframes shadowParticle {
          0% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
          100% {
            transform: scale(0) translateY(-30px);
            opacity: 0;
          }
        }
        
        @keyframes arrivalFlash {
          0% {
            opacity: 0.8;
            transform: scale(0.5);
          }
          50% {
            opacity: 0.4;
          }
          100% {
            opacity: 0;
            transform: scale(2);
          }
        }
      `}</style>
    </div>
  );
}

