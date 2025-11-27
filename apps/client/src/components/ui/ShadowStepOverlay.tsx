import { useGameStore } from '../../store/gameStore';

export function ShadowStepOverlay() {
  const { shadowStepTargeting, shadowStepValid } = useGameStore();

  if (!shadowStepTargeting) return null;

  return (
    <div 
      className="fixed inset-0 pointer-events-none z-[100]"
    >
      {/* Screen edge vignette */}
      <div 
        className="absolute inset-0 animate-pulse-soft"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(168, 85, 247, 0.15) 100%)',
        }}
      />
      
      {/* Top instruction bar */}
      <div 
        className="absolute top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <div 
          className="px-6 py-3 rounded-lg backdrop-blur-md"
          style={{
            background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.3) 0%, rgba(139, 92, 246, 0.2) 100%)',
            border: '1px solid rgba(168, 85, 247, 0.5)',
          }}
        >
          <span className="font-display text-lg tracking-widest text-purple-300">
            SHADOW STEP
          </span>
        </div>
        
        <div className="flex gap-4 text-xs font-body text-white/70">
          <span>
            <kbd className="px-2 py-0.5 bg-white/10 rounded mr-1">CLICK</kbd>
            or
            <kbd className="px-2 py-0.5 bg-white/10 rounded ml-1">Q</kbd>
            {' '}to teleport
          </span>
          <span className="text-white/40">|</span>
          <span>
            <kbd className="px-2 py-0.5 bg-white/10 rounded mr-1">RMB</kbd>
            to cancel
          </span>
        </div>
      </div>

      {/* Targeting crosshair replacement */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="animate-spin-slow">
          {/* Outer ring */}
          <circle 
            cx="24" 
            cy="24" 
            r="20" 
            stroke={shadowStepValid ? "#a855f7" : "#ef4444"} 
            strokeWidth="2" 
            fill="none"
            strokeDasharray="8 4"
          />
        </svg>
        <svg 
          width="48" 
          height="48" 
          viewBox="0 0 48 48" 
          fill="none" 
          className="absolute inset-0"
        >
          {/* Inner ring */}
          <circle 
            cx="24" 
            cy="24" 
            r="12" 
            stroke={shadowStepValid ? "#c4b5fd" : "#fca5a5"} 
            strokeWidth="1.5" 
            fill="none"
          />
          {/* Center dot */}
          <circle 
            cx="24" 
            cy="24" 
            r="3" 
            fill={shadowStepValid ? "#a855f7" : "#ef4444"}
          />
          {/* Directional indicators */}
          <path 
            d="M24 8 L24 4" 
            stroke={shadowStepValid ? "#a855f7" : "#ef4444"} 
            strokeWidth="2" 
            strokeLinecap="round"
          />
          <path 
            d="M24 44 L24 40" 
            stroke={shadowStepValid ? "#a855f7" : "#ef4444"} 
            strokeWidth="2" 
            strokeLinecap="round"
          />
          <path 
            d="M8 24 L4 24" 
            stroke={shadowStepValid ? "#a855f7" : "#ef4444"} 
            strokeWidth="2" 
            strokeLinecap="round"
          />
          <path 
            d="M44 24 L40 24" 
            stroke={shadowStepValid ? "#a855f7" : "#ef4444"} 
            strokeWidth="2" 
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Status indicator at bottom */}
      <div
        className="absolute bottom-28 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full backdrop-blur-sm"
        style={{
          background: shadowStepValid 
            ? 'rgba(34, 197, 94, 0.2)' 
            : 'rgba(239, 68, 68, 0.2)',
          border: `1px solid ${shadowStepValid ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'}`,
        }}
      >
        <span
          className="font-body text-sm font-semibold tracking-wide"
          style={{ color: shadowStepValid ? '#86efac' : '#fca5a5' }}
        >
          {shadowStepValid ? '● VALID LOCATION' : '○ INVALID LOCATION'}
        </span>
      </div>
    </div>
  );
}

