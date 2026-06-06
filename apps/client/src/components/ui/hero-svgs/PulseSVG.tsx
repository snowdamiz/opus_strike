import type { HeroSVGInternalProps } from './types';

const PULSE_DASH_PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  r: 2 + ((i * 5) % 2),
}));

export function PulseSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-pulse ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        <filter id="pulse-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.7" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <linearGradient id="pulse-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        
        <linearGradient id="pulse-energy" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="50%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} stopOpacity="0.3" />
        </linearGradient>
      </defs>
      
      {/* Speed lines/motion blur */}
      <g className="pulse-speed-lines" opacity="0.6">
        {[...Array(8)].map((_, i) => (
          <line
            key={i}
            x1={-20 + i * 10}
            y1={80 + i * 20}
            x2={40 + i * 10}
            y2={80 + i * 20}
            stroke={colors.primary}
            strokeWidth="3"
            strokeLinecap="round"
            className="speed-line"
            style={{ animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </g>
      
      {/* Energy rings - pulsing outward */}
      <g className="pulse-rings" filter="url(#pulse-glow)">
        <circle cx="100" cy="150" r="60" fill="none" stroke={colors.primary} strokeWidth="2" opacity="0.3" className="ring-1" />
        <circle cx="100" cy="150" r="80" fill="none" stroke={colors.primary} strokeWidth="1.5" opacity="0.2" className="ring-2" />
        <circle cx="100" cy="150" r="100" fill="none" stroke={colors.primary} strokeWidth="1" opacity="0.1" className="ring-3" />
      </g>
      
      {/* Character body - lean and agile */}
      <g className="pulse-body">
        {/* Energy core in chest */}
        <circle cx="100" cy="120" r="16" fill="url(#pulse-energy)" className="energy-core" />
        <circle cx="100" cy="120" r="10" fill="#ffffff" opacity="0.9" />
        
        {/* Torso - slim athletic build */}
        <path 
          d="M80 90 L120 90 L115 160 L85 160 Z" 
          fill="url(#pulse-body)"
        />
        
        {/* Energy lines on suit */}
        <path d="M90 95 L90 155" stroke={colors.primary} strokeWidth="2" opacity="0.8" />
        <path d="M100 95 L100 155" stroke="#ffffff" strokeWidth="1" opacity="0.6" />
        <path d="M110 95 L110 155" stroke={colors.primary} strokeWidth="2" opacity="0.8" />
        
        {/* Head - streamlined */}
        <ellipse cx="100" cy="65" rx="22" ry="28" fill={colors.secondary} />
        <ellipse cx="100" cy="68" rx="18" ry="22" fill={colors.primary} />
        
        {/* Visor - wraparound */}
        <path 
          d="M78 60 Q100 52 122 60 Q125 70 100 75 Q75 70 78 60" 
          fill="#0f172a"
        />
        {/* Energy eyes */}
        <ellipse cx="90" cy="62" rx="6" ry="4" fill="#ffffff" className="pulse-eye-left" opacity="0.9" />
        <ellipse cx="110" cy="62" rx="6" ry="4" fill="#ffffff" className="pulse-eye-right" opacity="0.9" />
        
        {/* Arms - running pose */}
        <g className="pulse-arms">
          {/* Left arm back */}
          <path 
            d="M80 95 Q50 110 35 90" 
            stroke={colors.secondary}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            className="arm-left"
          />
          {/* Right arm forward */}
          <path 
            d="M120 95 Q150 85 165 110" 
            stroke={colors.secondary}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            className="arm-right"
          />
          {/* Hands */}
          <circle cx="35" cy="90" r="7" fill={colors.primary} />
          <circle cx="165" cy="110" r="7" fill={colors.primary} />
          {/* Energy trails from hands */}
          <path d="M35 90 Q20 95 5 90" stroke={colors.primary} strokeWidth="3" opacity="0.5" className="hand-trail-left" />
          <path d="M165 110 Q180 105 195 110" stroke={colors.primary} strokeWidth="3" opacity="0.5" className="hand-trail-right" />
        </g>
        
        {/* Legs - sprinting */}
        <g className="pulse-legs">
          <path 
            d="M88 160 Q60 190 45 230" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            className="leg-left"
          />
          <path 
            d="M112 160 Q140 200 155 250" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            className="leg-right"
          />
          {/* Energy boots */}
          <ellipse cx="45" cy="235" rx="10" ry="8" fill={colors.primary} className="boot-left" />
          <ellipse cx="155" cy="255" rx="10" ry="8" fill={colors.primary} className="boot-right" />
          
          {/* Speed trails from feet */}
          <path d="M45 235 L20 235" stroke={colors.primary} strokeWidth="4" opacity="0.6" strokeLinecap="round" className="foot-trail-left" />
          <path d="M155 255 L130 250" stroke={colors.primary} strokeWidth="4" opacity="0.6" strokeLinecap="round" className="foot-trail-right" />
        </g>
      </g>
      
      {/* Dash particles */}
      <g className="pulse-particles">
        {PULSE_DASH_PARTICLES.map((particle, i) => (
          <circle
            key={i}
            cx={20 + i * 8}
            cy={140 + Math.sin(i) * 30}
            r={particle.r}
            fill={colors.primary}
            className="dash-particle"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </g>
      
      {/* Ground speed effect */}
      <ellipse 
        cx="100" 
        cy="275" 
        rx="60" 
        ry="8" 
        fill="none" 
        stroke={colors.primary}
        strokeWidth="3"
        opacity="0.4"
        strokeDasharray="15,10"
        className="ground-speed"
      />
    </svg>
  );
}
