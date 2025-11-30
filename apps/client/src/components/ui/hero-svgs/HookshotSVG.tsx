import type { HeroSVGInternalProps } from './types';

export function HookshotSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-hookshot ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        <filter id="hookshot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.7" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <linearGradient id="hookshot-body" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        
        <linearGradient id="hookshot-cable" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={colors.primary} />
        </linearGradient>
      </defs>
      
      {/* Motion blur background */}
      <g className="hookshot-motion-blur" opacity="0.3">
        {[...Array(5)].map((_, i) => (
          <line
            key={i}
            x1={60 + i * 20}
            y1={100 + i * 20}
            x2={80 + i * 20}
            y2={200 + i * 20}
            stroke={colors.primary}
            strokeWidth="8"
            strokeLinecap="round"
            opacity={0.2 + i * 0.1}
            className="motion-line"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </g>
      
      {/* Grapple cable - animated */}
      <g className="hookshot-cable" filter="url(#hookshot-glow)">
        <path 
          d="M100 100 Q60 50 30 20" 
          stroke="url(#hookshot-cable)" 
          strokeWidth="3" 
          fill="none"
          strokeDasharray="8,4"
          className="cable-main"
        />
        {/* Cable pulse */}
        <circle cx="30" cy="20" r="6" fill={colors.primary} className="cable-anchor">
          <animate attributeName="r" values="6;8;6" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </g>
      
      {/* Hook at the end */}
      <g className="hookshot-hook" transform="translate(15, 5)">
        <path 
          d="M15 15 L25 10 L20 20 L25 25 L15 20 Z" 
          fill={colors.primary}
          stroke={colors.secondary}
          strokeWidth="1"
        />
      </g>
      
      {/* Character body - dynamic swinging pose */}
      <g className="hookshot-body">
        {/* Torso */}
        <path 
          d="M85 90 L115 90 L120 160 L80 160 Z" 
          fill="url(#hookshot-body)"
          className="hookshot-torso"
        />
        
        {/* Head */}
        <circle cx="100" cy="70" r="22" fill={colors.primary} />
        <circle cx="100" cy="70" r="18" fill={colors.secondary} />
        
        {/* Visor */}
        <path 
          d="M82 65 Q100 60 118 65 Q118 75 100 78 Q82 75 82 65" 
          fill={colors.primary}
          className="hookshot-visor"
        />
        <ellipse cx="100" cy="68" rx="14" ry="6" fill="#ffffff" opacity="0.8">
          <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
        </ellipse>
        
        {/* Arms - reaching for grapple */}
        <g className="hookshot-arms">
          {/* Left arm reaching up */}
          <path 
            d="M85 100 Q60 80 50 55" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            className="arm-left"
          />
          {/* Right arm extended */}
          <path 
            d="M115 100 Q130 85 145 95" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            className="arm-right"
          />
          {/* Hands */}
          <circle cx="50" cy="55" r="8" fill={colors.primary} />
          <circle cx="145" cy="95" r="8" fill={colors.primary} />
        </g>
        
        {/* Legs - swinging */}
        <g className="hookshot-legs">
          <path 
            d="M90 160 Q80 200 75 250" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="leg-left"
          />
          <path 
            d="M110 160 Q130 200 140 240" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="leg-right"
          />
          {/* Feet */}
          <ellipse cx="75" cy="255" rx="10" ry="6" fill={colors.primary} className="foot-left" />
          <ellipse cx="140" cy="245" rx="10" ry="6" fill={colors.primary} className="foot-right" />
        </g>
      </g>
      
      {/* Speed lines */}
      <g className="hookshot-speed-lines" opacity="0.5">
        {[...Array(6)].map((_, i) => (
          <line
            key={i}
            x1={140 + i * 8}
            y1={100 + i * 15}
            x2={160 + i * 8}
            y2={120 + i * 15}
            stroke={colors.primary}
            strokeWidth="2"
            strokeLinecap="round"
            className="speed-line"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </g>
      
      {/* Arc trail showing swing path */}
      <path 
        d="M30 30 Q100 80 170 150" 
        stroke={colors.primary}
        strokeWidth="2"
        fill="none"
        strokeDasharray="10,5"
        opacity="0.4"
        className="swing-arc"
      />
    </svg>
  );
}

