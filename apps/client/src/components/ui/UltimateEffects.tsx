import { useState, useEffect, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';

/**
 * UltimateEffects - Full-screen visual effects for ultimate abilities
 * Currently supports:
 * - phantom_veil: Ethereal void/ghost visual with swirling shadows and particles
 */
export function UltimateEffects() {
  const { ultimateEffectActive, ultimateEffectType, ultimateEffectEndTime, localPlayer } = useGameStore();
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [particles, setParticles] = useState<Array<{
    id: number;
    x: number;
    y: number;
    size: number;
    duration: number;
    delay: number;
    direction: 'up' | 'down' | 'left' | 'right';
    opacity: number;
  }>>([]);

  const isPhantomVeil = ultimateEffectActive && ultimateEffectType === 'phantom_veil';

  // Generate floating void particles
  useEffect(() => {
    if (!isPhantomVeil) {
      setParticles([]);
      return;
    }

    const generateParticles = () => {
      const newParticles = [];
      for (let i = 0; i < 50; i++) {
        const edge = Math.floor(Math.random() * 4);
        let x = 0, y = 0, direction: 'up' | 'down' | 'left' | 'right' = 'up';
        
        switch (edge) {
          case 0:
            x = Math.random() * 100;
            y = -5;
            direction = 'down';
            break;
          case 1:
            x = 105;
            y = Math.random() * 100;
            direction = 'left';
            break;
          case 2:
            x = Math.random() * 100;
            y = 105;
            direction = 'up';
            break;
          case 3:
            x = -5;
            y = Math.random() * 100;
            direction = 'right';
            break;
        }
        
        newParticles.push({
          id: i,
          x,
          y,
          size: Math.random() * 8 + 3,
          duration: Math.random() * 4 + 3,
          delay: Math.random() * 3,
          direction,
          opacity: Math.random() * 0.5 + 0.3,
        });
      }
      setParticles(newParticles);
    };

    generateParticles();
    const interval = setInterval(generateParticles, 5000);
    
    return () => clearInterval(interval);
  }, [isPhantomVeil]);
  
  // Update time remaining
  useEffect(() => {
    if (!ultimateEffectActive) {
      setFadeOut(false);
      return;
    }
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, ultimateEffectEndTime - now);
      setTimeRemaining(remaining);
      
      if (remaining < 500 && remaining > 0) {
        setFadeOut(true);
      }
      
      if (remaining <= 0) {
        useGameStore.getState().setUltimateEffect(false);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => clearInterval(interval);
  }, [ultimateEffectActive, ultimateEffectEndTime]);
  
  if (!ultimateEffectActive) return null;
  
  // Enhanced Phantom Veil effect
  if (ultimateEffectType === 'phantom_veil') {
    const progress = Math.max(0, Math.min(1, timeRemaining / 6000));
    
    return (
      <div 
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{
          opacity: fadeOut ? 0 : 1,
          transition: 'opacity 0.5s ease-out',
          zIndex: 100,
        }}
      >
        {/* Base desaturation layer */}
        <div 
          className="absolute inset-0"
          style={{
            backdropFilter: 'saturate(30%) brightness(0.9) contrast(1.1)',
            WebkitBackdropFilter: 'saturate(30%) brightness(0.9) contrast(1.1)',
          }}
        />
        
        {/* Main vignette - dark purple edges that pulse */}
        <div 
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, 
              transparent 25%, 
              rgba(88, 28, 135, 0.12) 40%, 
              rgba(59, 7, 100, 0.28) 60%, 
              rgba(30, 0, 50, 0.45) 80%, 
              rgba(10, 0, 20, 0.65) 100%)`,
            animation: 'veilPulse 2s ease-in-out infinite',
          }}
        />

        {/* Swirling shadow overlay - animated rotation */}
        <div 
          className="absolute inset-0"
          style={{
            background: `
              conic-gradient(from 0deg at 50% 50%, 
                transparent 0deg,
                rgba(147, 51, 234, 0.04) 30deg,
                transparent 60deg,
                rgba(168, 85, 247, 0.06) 90deg,
                transparent 120deg,
                rgba(139, 92, 246, 0.04) 150deg,
                transparent 180deg,
                rgba(192, 132, 252, 0.06) 210deg,
                transparent 240deg,
                rgba(147, 51, 234, 0.04) 270deg,
                transparent 300deg,
                rgba(168, 85, 247, 0.05) 330deg,
                transparent 360deg
              )`,
            animation: 'veilSpin 25s linear infinite',
          }}
        />
        
        {/* Second rotating layer (opposite direction) */}
        <div 
          className="absolute inset-0"
          style={{
            background: `
              conic-gradient(from 180deg at 50% 50%, 
                transparent 0deg,
                rgba(88, 28, 135, 0.03) 45deg,
                transparent 90deg,
                rgba(124, 58, 237, 0.05) 135deg,
                transparent 180deg,
                rgba(88, 28, 135, 0.03) 225deg,
                transparent 270deg,
                rgba(124, 58, 237, 0.05) 315deg,
                transparent 360deg
              )`,
            animation: 'veilSpinReverse 18s linear infinite',
          }}
        />

        {/* Corner shadow tendrils */}
        <div className="absolute top-0 left-0 w-2/5 h-2/5">
          <div 
            className="w-full h-full"
            style={{
              background: 'radial-gradient(ellipse at 0% 0%, rgba(88, 28, 135, 0.4) 0%, transparent 70%)',
              animation: 'tendrilPulse 3s ease-in-out infinite',
            }}
          />
        </div>
        <div className="absolute top-0 right-0 w-2/5 h-2/5">
          <div 
            className="w-full h-full"
            style={{
              background: 'radial-gradient(ellipse at 100% 0%, rgba(88, 28, 135, 0.4) 0%, transparent 70%)',
              animation: 'tendrilPulse 3s ease-in-out infinite 0.75s',
            }}
          />
        </div>
        <div className="absolute bottom-0 left-0 w-2/5 h-2/5">
          <div 
            className="w-full h-full"
            style={{
              background: 'radial-gradient(ellipse at 0% 100%, rgba(88, 28, 135, 0.4) 0%, transparent 70%)',
              animation: 'tendrilPulse 3s ease-in-out infinite 1.5s',
            }}
          />
        </div>
        <div className="absolute bottom-0 right-0 w-2/5 h-2/5">
          <div 
            className="w-full h-full"
            style={{
              background: 'radial-gradient(ellipse at 100% 100%, rgba(88, 28, 135, 0.4) 0%, transparent 70%)',
              animation: 'tendrilPulse 3s ease-in-out infinite 2.25s',
            }}
          />
        </div>

        {/* Edge blur effect */}
        <div 
          className="absolute inset-0"
          style={{
            maskImage: 'radial-gradient(ellipse 55% 55% at center, transparent 30%, black 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 55% 55% at center, transparent 30%, black 80%)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        />

        {/* Floating void particles */}
        {particles.map(particle => (
          <div
            key={particle.id}
            className="absolute rounded-full"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: particle.size,
              height: particle.size,
              background: `radial-gradient(circle, 
                rgba(192, 132, 252, ${particle.opacity}) 0%, 
                rgba(147, 51, 234, ${particle.opacity * 0.5}) 50%, 
                transparent 100%)`,
              boxShadow: `0 0 ${particle.size * 2}px rgba(147, 51, 234, ${particle.opacity * 0.7})`,
              animation: `voidParticle${particle.direction} ${particle.duration}s ease-in-out ${particle.delay}s infinite`,
            }}
          />
        ))}

        {/* Edge glow strips */}
        <div 
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{
            background: 'linear-gradient(180deg, rgba(147, 51, 234, 0.5) 0%, transparent 100%)',
            boxShadow: '0 0 15px rgba(147, 51, 234, 0.4)',
          }}
        />
        <div 
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{
            background: 'linear-gradient(0deg, rgba(147, 51, 234, 0.5) 0%, transparent 100%)',
            boxShadow: '0 0 15px rgba(147, 51, 234, 0.4)',
          }}
        />
        <div 
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{
            background: 'linear-gradient(90deg, rgba(147, 51, 234, 0.5) 0%, transparent 100%)',
            boxShadow: '0 0 15px rgba(147, 51, 234, 0.4)',
          }}
        />
        <div 
          className="absolute right-0 top-0 bottom-0 w-0.5"
          style={{
            background: 'linear-gradient(270deg, rgba(147, 51, 234, 0.5) 0%, transparent 100%)',
            boxShadow: '0 0 15px rgba(147, 51, 234, 0.4)',
          }}
        />

        {/* Status indicator */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <div 
            className="relative px-6 py-2.5 rounded-full backdrop-blur-sm"
            style={{
              background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.7) 0%, rgba(59, 7, 100, 0.85) 100%)',
              border: '1px solid rgba(192, 132, 252, 0.4)',
              boxShadow: '0 0 25px rgba(147, 51, 234, 0.35), inset 0 0 15px rgba(192, 132, 252, 0.1)',
            }}
          >
            <div className="flex items-center gap-3">
              {/* Ghost icon */}
              <svg 
                className="w-5 h-5 text-purple-300"
                viewBox="0 0 24 24" 
                fill="currentColor"
                style={{ animation: 'ghostFloat 2s ease-in-out infinite' }}
              >
                <path d="M12 2C6.48 2 2 6.48 2 12v8c0 1.1.9 2 2 2h2v-4H4v-2h2v-2H4v-2c0-4.42 3.58-8 8-8s8 3.58 8 8v2h-2v2h2v2h-2v4h2c1.1 0 2-.9 2-2v-8c0-5.52-4.48-10-10-10zm-2 12c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
              </svg>
              
              <span 
                className="font-display text-sm tracking-[0.2em] text-purple-200"
                style={{ textShadow: '0 0 10px rgba(192, 132, 252, 0.8)' }}
              >
                PHANTOM VEIL
              </span>
              
              {/* Timer */}
              <span 
                className="font-mono text-lg font-bold text-purple-100 tabular-nums min-w-[52px] text-center"
                style={{ textShadow: '0 0 10px rgba(192, 132, 252, 0.8)' }}
              >
                {(timeRemaining / 1000).toFixed(1)}s
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="absolute -bottom-1 left-3 right-3 h-0.5 bg-purple-900/50 rounded-full overflow-hidden">
              <div 
                className="h-full transition-all duration-100"
                style={{
                  width: `${progress * 100}%`,
                  background: 'linear-gradient(90deg, #c084fc, #a855f7)',
                  boxShadow: '0 0 8px rgba(192, 132, 252, 0.8)',
                }}
              />
            </div>
          </div>
          
          {/* Speed boost indicator */}
          <div 
            className="flex items-center gap-2 px-3 py-1 rounded-full"
            style={{
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              boxShadow: '0 0 10px rgba(34, 197, 94, 0.15)',
            }}
          >
            <div 
              className="w-1.5 h-1.5 rounded-full bg-green-400"
              style={{ boxShadow: '0 0 6px rgba(34, 197, 94, 0.8)' }}
            />
            <span className="text-[10px] font-display text-green-300 tracking-wider">+30% SPEED</span>
          </div>
        </div>

        {/* Subtle scanlines */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(192, 132, 252, 0.3) 2px, rgba(192, 132, 252, 0.3) 4px)',
            animation: 'scanlines 0.1s linear infinite',
          }}
        />

        {/* Keyframe animations */}
        <style>{`
          @keyframes veilPulse {
            0%, 100% { opacity: 0.85; }
            50% { opacity: 1; }
          }
          
          @keyframes veilSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          
          @keyframes veilSpinReverse {
            from { transform: rotate(360deg); }
            to { transform: rotate(0deg); }
          }
          
          @keyframes tendrilPulse {
            0%, 100% { opacity: 0.5; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.08); }
          }
          
          @keyframes voidParticleup {
            0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
            15% { opacity: 0.9; }
            85% { opacity: 0.9; }
            100% { transform: translateY(-120px) translateX(25px) scale(0.2); opacity: 0; }
          }
          
          @keyframes voidParticledown {
            0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
            15% { opacity: 0.9; }
            85% { opacity: 0.9; }
            100% { transform: translateY(120px) translateX(-25px) scale(0.2); opacity: 0; }
          }
          
          @keyframes voidParticleleft {
            0% { transform: translateX(0) translateY(0) scale(1); opacity: 0; }
            15% { opacity: 0.9; }
            85% { opacity: 0.9; }
            100% { transform: translateX(-120px) translateY(25px) scale(0.2); opacity: 0; }
          }
          
          @keyframes voidParticleright {
            0% { transform: translateX(0) translateY(0) scale(1); opacity: 0; }
            15% { opacity: 0.9; }
            85% { opacity: 0.9; }
            100% { transform: translateX(120px) translateY(-25px) scale(0.2); opacity: 0; }
          }
          
          @keyframes scanlines {
            0% { transform: translateY(0); }
            100% { transform: translateY(4px); }
          }
          
          @keyframes ghostFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
      </div>
    );
  }
  
  // Other ultimate effects can be added here
  return null;
}
