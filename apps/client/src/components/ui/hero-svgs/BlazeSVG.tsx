import type { HeroSVGInternalProps } from './types';

export function BlazeSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-blaze ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        <filter id="blaze-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.8" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <linearGradient id="blaze-fire" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="30%" stopColor={colors.primary} />
          <stop offset="70%" stopColor={colors.secondary} />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0.5" />
        </linearGradient>
        
        <linearGradient id="blaze-body" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="100%" stopColor="#7c2d12" />
        </linearGradient>

        <filter id="fire-turbulence">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" result="noise">
            <animate attributeName="baseFrequency" values="0.03;0.05;0.03" dur="2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
        </filter>
      </defs>
      
      {/* Heat distortion background */}
      <g className="blaze-heat-waves" opacity="0.3">
        {[...Array(3)].map((_, i) => (
          <ellipse
            key={i}
            cx="100"
            cy={240 + i * 20}
            rx={40 + i * 20}
            ry="10"
            fill="none"
            stroke={colors.primary}
            strokeWidth="1"
            className="heat-wave"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        ))}
      </g>
      
      {/* Main jetpack flames */}
      <g className="blaze-flames" filter="url(#blaze-glow)">
        {/* Left thruster flame */}
        <g className="flame-left" transform="translate(65, 200)">
          <path 
            d="M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z" 
            fill="url(#blaze-fire)"
            className="flame-main"
          >
            <animate attributeName="d" 
              values="M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z;
                      M0 0 Q-10 35 -8 65 Q0 95 5 105 Q15 90 18 65 Q15 35 10 0 Z;
                      M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z" 
              dur="0.3s" repeatCount="indefinite" />
          </path>
          {/* Inner flame */}
          <path 
            d="M2 5 Q-5 25 0 50 Q5 40 8 25 Q10 15 8 5 Z" 
            fill="#fef3c7"
            className="flame-inner"
          />
        </g>
        
        {/* Right thruster flame */}
        <g className="flame-right" transform="translate(125, 200)">
          <path 
            d="M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z" 
            fill="url(#blaze-fire)"
            className="flame-main"
          >
            <animate attributeName="d" 
              values="M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z;
                      M0 0 Q-20 35 -10 70 Q-2 100 5 110 Q12 95 20 70 Q18 40 10 0 Z;
                      M0 0 Q-15 30 -5 60 Q5 90 0 100 Q10 85 15 60 Q20 30 10 0 Z" 
              dur="0.25s" repeatCount="indefinite" />
          </path>
          <path 
            d="M2 5 Q-5 25 0 50 Q5 40 8 25 Q10 15 8 5 Z" 
            fill="#fef3c7"
          />
        </g>
      </g>
      
      {/* Fire sparks */}
      <g className="blaze-sparks">
        {[...Array(12)].map((_, i) => (
          <circle
            key={i}
            cx={60 + (i % 4) * 25}
            cy={220 + (i % 3) * 25}
            r={2 + Math.random() * 3}
            fill={i % 2 === 0 ? colors.primary : '#fcd34d'}
            className="spark"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </g>
      
      {/* Character body - hovering pose */}
      <g className="blaze-body">
        {/* Jetpack */}
        <rect x="70" y="100" width="60" height="80" rx="10" fill="#4a4a5a" />
        <rect x="75" y="105" width="50" height="70" rx="8" fill={colors.secondary} />
        <rect x="60" y="170" width="20" height="35" rx="5" fill="#4a4a5a" />
        <rect x="120" y="170" width="20" height="35" rx="5" fill="#4a4a5a" />
        
        {/* Torso */}
        <path 
          d="M80 80 L120 80 L125 150 L75 150 Z" 
          fill="url(#blaze-body)"
        />
        
        {/* Head - helmet */}
        <circle cx="100" cy="55" r="28" fill={colors.secondary} />
        <circle cx="100" cy="55" r="24" fill={colors.primary} />
        
        {/* Visor */}
        <path 
          d="M76 50 Q100 42 124 50 Q124 65 100 70 Q76 65 76 50" 
          fill="#0f172a"
        />
        {/* Visor glow */}
        <ellipse cx="100" cy="52" rx="16" ry="8" fill={colors.primary} opacity="0.6">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
        </ellipse>
        
        {/* Arms */}
        <g className="blaze-arms">
          <path 
            d="M80 85 Q55 100 40 130" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          <path 
            d="M120 85 Q145 100 160 130" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          {/* Gloves */}
          <circle cx="40" cy="135" r="10" fill={colors.primary} />
          <circle cx="160" cy="135" r="10" fill={colors.primary} />
        </g>
        
        {/* Legs - dangling */}
        <g className="blaze-legs">
          <path 
            d="M90 150 Q85 185 80 210" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="leg-left"
          />
          <path 
            d="M110 150 Q115 185 120 210" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="leg-right"
          />
          {/* Boots */}
          <ellipse cx="78" cy="215" rx="12" ry="8" fill={colors.primary} />
          <ellipse cx="122" cy="215" rx="12" ry="8" fill={colors.primary} />
        </g>
      </g>
      
      {/* Hover glow ring */}
      <ellipse 
        cx="100" 
        cy="290" 
        rx="50" 
        ry="8" 
        fill="none" 
        stroke={colors.primary}
        strokeWidth="2"
        opacity="0.5"
        className="hover-ring"
      />
    </svg>
  );
}

