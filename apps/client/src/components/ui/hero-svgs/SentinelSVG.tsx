import type { HeroSVGInternalProps } from './types';

export function SentinelSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-sentinel ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        <filter id="sentinel-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.6" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <linearGradient id="sentinel-armor" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="50%" stopColor={colors.secondary} />
          <stop offset="100%" stopColor="#78350f" />
        </linearGradient>
        
        <linearGradient id="sentinel-shield" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="30%" stopColor={colors.primary} />
          <stop offset="70%" stopColor={colors.secondary} />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        
        <linearGradient id="sentinel-energy" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={colors.primary} />
        </linearGradient>
      </defs>
      
      {/* Defensive aura hexagon pattern */}
      <g className="sentinel-aura" opacity="0.3">
        {[...Array(6)].map((_, i) => (
          <polygon
            key={i}
            points="100,80 130,100 130,140 100,160 70,140 70,100"
            fill="none"
            stroke={colors.primary}
            strokeWidth="1"
            transform={`translate(0, ${i * 30}) scale(${1 + i * 0.15})`}
            style={{ transformOrigin: '100px 120px' }}
            className="hex-ring"
          />
        ))}
      </g>
      
      {/* Large energy shield - main feature */}
      <g className="sentinel-shield" filter="url(#sentinel-glow)">
        {/* Shield outer */}
        <path 
          d="M25 80 
             L25 180 
             Q25 220 100 260 
             Q175 220 175 180 
             L175 80 
             Q100 60 25 80"
          fill="url(#sentinel-shield)"
          stroke={colors.primary}
          strokeWidth="3"
          className="shield-main"
        />
        
        {/* Shield inner pattern */}
        <path 
          d="M40 90 
             L40 175 
             Q40 210 100 245 
             Q160 210 160 175 
             L160 90 
             Q100 75 40 90"
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="2"
        />
        
        {/* Shield emblem - star/badge */}
        <g transform="translate(100, 150)">
          <polygon 
            points="0,-30 8,-10 30,-10 13,5 20,28 0,15 -20,28 -13,5 -30,-10 -8,-10" 
            fill={colors.primary}
            stroke="#fef3c7"
            strokeWidth="2"
          />
          <circle cx="0" cy="0" r="12" fill={colors.secondary} />
          <circle cx="0" cy="0" r="8" fill="#ffffff" opacity="0.8">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
          </circle>
        </g>
        
        {/* Shield energy ripples */}
        <ellipse cx="100" cy="160" rx="60" ry="80" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" className="shield-ripple-1" />
        <ellipse cx="100" cy="160" rx="45" ry="60" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" className="shield-ripple-2" />
      </g>
      
      {/* Character body - behind shield */}
      <g className="sentinel-body">
        {/* Heavy pauldrons */}
        <ellipse cx="55" cy="95" rx="20" ry="15" fill={colors.secondary} />
        <ellipse cx="145" cy="95" rx="20" ry="15" fill={colors.secondary} />
        
        {/* Torso - armored */}
        <path 
          d="M65 85 L135 85 L140 165 L60 165 Z" 
          fill="url(#sentinel-armor)"
        />
        
        {/* Chest plate detail */}
        <path 
          d="M80 95 L100 85 L120 95 L120 130 L100 140 L80 130 Z" 
          fill={colors.primary}
          opacity="0.6"
        />
        
        {/* Head - heavy helmet */}
        <rect x="70" y="45" width="60" height="45" rx="10" fill={colors.secondary} />
        <rect x="75" y="50" width="50" height="35" rx="8" fill={colors.primary} />
        
        {/* Visor slit */}
        <rect x="80" y="60" width="40" height="8" rx="2" fill="#0f172a" />
        <rect x="85" y="62" width="30" height="4" rx="1" fill={colors.primary} opacity="0.8">
          <animate attributeName="opacity" values="0.8;1;0.8" dur="1.5s" repeatCount="indefinite" />
        </rect>
        
        {/* Helmet crest */}
        <polygon points="100,35 95,50 105,50" fill={colors.primary} />
        
        {/* Left arm - holding shield */}
        <path 
          d="M55 95 Q30 110 25 140" 
          stroke={colors.secondary}
          strokeWidth="16"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="25" cy="145" r="10" fill={colors.primary} />
        
        {/* Right arm - at ready */}
        <path 
          d="M145 95 Q170 110 180 130" 
          stroke={colors.secondary}
          strokeWidth="16"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="180" cy="135" r="10" fill={colors.primary} />
        
        {/* Legs - planted stance */}
        <g className="sentinel-legs">
          <path 
            d="M85 165 L75 250" 
            stroke={colors.secondary}
            strokeWidth="16"
            strokeLinecap="round"
            fill="none"
          />
          <path 
            d="M115 165 L125 250" 
            stroke={colors.secondary}
            strokeWidth="16"
            strokeLinecap="round"
            fill="none"
          />
          {/* Heavy boots */}
          <rect x="58" y="250" width="35" height="18" rx="5" fill={colors.primary} />
          <rect x="108" y="250" width="35" height="18" rx="5" fill={colors.primary} />
        </g>
      </g>
      
      {/* Ground fortification effect */}
      <g className="sentinel-fortify">
        <rect x="40" y="275" width="120" height="6" rx="3" fill={colors.primary} opacity="0.5" />
        <rect x="30" y="282" width="140" height="4" rx="2" fill={colors.secondary} opacity="0.3" />
        
        {/* Energy pillars rising */}
        <rect x="45" y="260" width="4" height="20" fill="url(#sentinel-energy)" opacity="0.6" className="pillar-1" />
        <rect x="75" y="265" width="4" height="15" fill="url(#sentinel-energy)" opacity="0.5" className="pillar-2" />
        <rect x="120" y="265" width="4" height="15" fill="url(#sentinel-energy)" opacity="0.5" className="pillar-3" />
        <rect x="150" y="260" width="4" height="20" fill="url(#sentinel-energy)" opacity="0.6" className="pillar-4" />
      </g>
      
      {/* Protective dome outline (faint) */}
      <ellipse 
        cx="100" 
        cy="180" 
        rx="90" 
        ry="110" 
        fill="none" 
        stroke={colors.primary}
        strokeWidth="1"
        strokeDasharray="10,10"
        opacity="0.2"
        className="dome-outline"
      />
    </svg>
  );
}

