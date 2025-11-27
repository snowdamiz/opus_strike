import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';

/**
 * Ultimate Effects - Full-screen visual effects for ultimate abilities
 * Currently supports:
 * - phantom_veil: Monochrome (black & white) with blurred edges
 */
export function UltimateEffects() {
  const { ultimateEffectActive, ultimateEffectType, ultimateEffectEndTime } = useGameStore();
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  
  useEffect(() => {
    if (!ultimateEffectActive) {
      setFadeOut(false);
      return;
    }
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, ultimateEffectEndTime - now);
      setTimeRemaining(remaining);
      
      // Start fade out in last 500ms
      if (remaining < 500 && remaining > 0) {
        setFadeOut(true);
      }
      
      // Auto-deactivate when time is up
      if (remaining <= 0) {
        useGameStore.getState().setUltimateEffect(false);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => clearInterval(interval);
  }, [ultimateEffectActive, ultimateEffectEndTime]);
  
  if (!ultimateEffectActive) return null;
  
  // Phantom Veil effect - monochrome with blurred edges
  if (ultimateEffectType === 'phantom_veil') {
    return (
      <div 
        className="ultimate-effect phantom-veil"
        style={{
          opacity: fadeOut ? 0 : 1,
          transition: 'opacity 0.5s ease-out',
        }}
      >
        {/* Monochrome filter overlay */}
        <div className="phantom-veil-mono" />
        
        {/* Blurred edge vignette */}
        <div className="phantom-veil-blur" />
        
        {/* Subtle purple tint at edges */}
        <div className="phantom-veil-tint" />
        
        {/* Timer display */}
        <div className="phantom-veil-timer">
          <span className="timer-value">{(timeRemaining / 1000).toFixed(1)}s</span>
          <span className="timer-label">PHANTOM VEIL</span>
        </div>
        
        {/* Particle effects */}
        <div className="phantom-veil-particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <div 
              key={i} 
              className="phantom-particle"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
        
        <style>{`
          .ultimate-effect {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 100;
          }
          
          .phantom-veil-mono {
            position: absolute;
            inset: 0;
            backdrop-filter: grayscale(100%) contrast(1.1);
            -webkit-backdrop-filter: grayscale(100%) contrast(1.1);
          }
          
          .phantom-veil-blur {
            position: absolute;
            inset: 0;
            /* Radial blur effect - clear center, blurred edges */
            mask-image: radial-gradient(
              ellipse 70% 70% at center,
              transparent 30%,
              black 100%
            );
            -webkit-mask-image: radial-gradient(
              ellipse 70% 70% at center,
              transparent 30%,
              black 100%
            );
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }
          
          .phantom-veil-tint {
            position: absolute;
            inset: 0;
            background: radial-gradient(
              ellipse 80% 80% at center,
              transparent 40%,
              rgba(138, 43, 226, 0.15) 70%,
              rgba(75, 0, 130, 0.25) 100%
            );
            animation: veil-pulse 2s ease-in-out infinite;
          }
          
          @keyframes veil-pulse {
            0%, 100% { opacity: 0.8; }
            50% { opacity: 1; }
          }
          
          .phantom-veil-timer {
            position: absolute;
            bottom: 150px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
          }
          
          .timer-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 28px;
            font-weight: bold;
            color: #e0e0e0;
            text-shadow: 0 0 10px rgba(138, 43, 226, 0.8), 0 0 20px rgba(138, 43, 226, 0.5);
          }
          
          .timer-label {
            font-family: 'Rajdhani', sans-serif;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 3px;
            color: rgba(200, 180, 255, 0.8);
            text-transform: uppercase;
          }
          
          .phantom-veil-particles {
            position: absolute;
            inset: 0;
            overflow: hidden;
          }
          
          .phantom-particle {
            position: absolute;
            width: 3px;
            height: 3px;
            background: rgba(200, 180, 255, 0.6);
            border-radius: 50%;
            animation: phantom-float 3s ease-in-out infinite;
            box-shadow: 0 0 6px rgba(138, 43, 226, 0.8);
          }
          
          @keyframes phantom-float {
            0% {
              transform: translateY(0) scale(1);
              opacity: 0;
            }
            20% {
              opacity: 0.8;
            }
            80% {
              opacity: 0.8;
            }
            100% {
              transform: translateY(-100px) scale(0.5);
              opacity: 0;
            }
          }
        `}</style>
      </div>
    );
  }
  
  // Other ultimate effects can be added here
  return null;
}

