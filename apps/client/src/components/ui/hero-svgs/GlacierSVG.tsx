import type { HeroSVGInternalProps } from './types';

export function GlacierSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-glacier ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        <filter id="glacier-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.6" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <linearGradient id="glacier-ice" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="40%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        
        <linearGradient id="glacier-crystal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="50%" stopColor={colors.primary} stopOpacity="0.7" />
          <stop offset="100%" stopColor={colors.secondary} stopOpacity="0.5" />
        </linearGradient>

        <pattern id="ice-pattern" patternUnits="userSpaceOnUse" width="20" height="20">
          <polygon points="10,0 20,10 10,20 0,10" fill="none" stroke="#ffffff" strokeWidth="0.5" opacity="0.3" />
        </pattern>
      </defs>
      
      {/* Frost particles floating */}
      <g className="glacier-frost-particles">
        {[...Array(15)].map((_, i) => (
          <g key={i} className="frost-particle" style={{ animationDelay: `${i * 0.2}s` }}>
            <polygon 
              points={`${50 + (i % 5) * 25},${40 + Math.floor(i / 5) * 80} 
                       ${55 + (i % 5) * 25},${35 + Math.floor(i / 5) * 80} 
                       ${60 + (i % 5) * 25},${40 + Math.floor(i / 5) * 80} 
                       ${55 + (i % 5) * 25},${45 + Math.floor(i / 5) * 80}`}
              fill="#e0f2fe"
              opacity="0.6"
            />
          </g>
        ))}
      </g>
      
      {/* Ice crystals growing from ground */}
      <g className="glacier-crystals" filter="url(#glacier-glow)">
        <polygon points="30,280 45,230 60,280" fill="url(#glacier-crystal)" className="crystal-1" />
        <polygon points="50,285 60,250 70,285" fill="url(#glacier-crystal)" className="crystal-2" />
        <polygon points="140,280 155,235 170,280" fill="url(#glacier-crystal)" className="crystal-3" />
        <polygon points="125,285 135,260 145,285" fill="url(#glacier-crystal)" className="crystal-4" />
      </g>
      
      {/* Character body - bulky tank */}
      <g className="glacier-body">
        {/* Massive shoulders/armor */}
        <ellipse cx="55" cy="100" rx="30" ry="25" fill={colors.secondary} />
        <ellipse cx="145" cy="100" rx="30" ry="25" fill={colors.secondary} />
        
        {/* Main torso - broad */}
        <path 
          d="M50 85 L150 85 L160 180 L40 180 Z" 
          fill="url(#glacier-ice)"
        />
        <rect x="40" y="85" width="120" height="95" rx="5" fill="url(#ice-pattern)" opacity="0.5" />
        
        {/* Ice armor plates */}
        <polygon points="60,100 80,90 100,100 80,110" fill={colors.primary} opacity="0.6" />
        <polygon points="100,100 120,90 140,100 120,110" fill={colors.primary} opacity="0.6" />
        <polygon points="80,130 100,120 120,130 100,140" fill={colors.primary} opacity="0.8" />
        
        {/* Head - helmet */}
        <path 
          d="M70 60 L130 60 L140 85 L60 85 Z" 
          fill={colors.secondary}
        />
        <circle cx="100" cy="50" r="30" fill={colors.primary} />
        
        {/* Face plate */}
        <rect x="80" y="40" width="40" height="30" rx="5" fill={colors.secondary} />
        
        {/* Glowing eyes */}
        <g className="glacier-eyes">
          <circle cx="90" cy="50" r="5" fill="#ffffff" opacity="0.9" />
          <circle cx="110" cy="50" r="5" fill="#ffffff" opacity="0.9" />
          <circle cx="90" cy="50" r="3" fill={colors.primary} />
          <circle cx="110" cy="50" r="3" fill={colors.primary} />
        </g>
        
        {/* Arms - massive */}
        <g className="glacier-arms">
          <path 
            d="M50 100 Q20 120 15 160" 
            stroke={colors.primary}
            strokeWidth="24"
            strokeLinecap="round"
            fill="none"
          />
          <path 
            d="M150 100 Q180 120 185 160" 
            stroke={colors.primary}
            strokeWidth="24"
            strokeLinecap="round"
            fill="none"
          />
          {/* Ice fists */}
          <circle cx="15" cy="165" r="19" fill={colors.secondary} />
          <circle cx="185" cy="165" r="19" fill={colors.secondary} />
          {/* Ice spikes on fists */}
          <polygon points="5,150 0,140 10,145" fill="#e0f2fe" />
          <polygon points="195,150 200,140 190,145" fill="#e0f2fe" />
        </g>
        
        {/* Legs - sturdy */}
        <g className="glacier-legs">
          <path 
            d="M80 180 L75 250" 
            stroke={colors.primary}
            strokeWidth="22"
            strokeLinecap="round"
            fill="none"
          />
          <path 
            d="M120 180 L125 250" 
            stroke={colors.primary}
            strokeWidth="22"
            strokeLinecap="round"
            fill="none"
          />
          {/* Boots */}
          <rect x="55" y="250" width="40" height="20" rx="5" fill={colors.secondary} />
          <rect x="105" y="250" width="40" height="20" rx="5" fill={colors.secondary} />
        </g>
      </g>
      
      {/* Cold aura ring */}
      <ellipse 
        cx="100" 
        cy="270" 
        rx="70" 
        ry="12" 
        fill="none" 
        stroke={colors.primary}
        strokeWidth="2"
        strokeDasharray="5,5"
        opacity="0.5"
        className="cold-aura"
      />
      
      {/* Breath frost */}
      <g className="glacier-breath" opacity="0.4">
        <ellipse cx="100" cy="70" rx="22" ry="8" fill={colors.primary} className="breath-cloud" />
      </g>
    </svg>
  );
}
