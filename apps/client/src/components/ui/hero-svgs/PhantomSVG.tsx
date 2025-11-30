import type { HeroSVGInternalProps } from './types';

export function PhantomSVG({ colors, className, size }: HeroSVGInternalProps) {
  return (
    <svg 
      viewBox="-40 -10 280 320" 
      className={`hero-svg hero-svg-phantom ${className}`}
      style={{ width: size, height: size * 1.14, overflow: 'visible' }}
    >
      <defs>
        {/* Phantom glow filter */}
        <filter id="phantom-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor={colors.primary} floodOpacity="0.8" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        {/* Phase effect gradient */}
        <linearGradient id="phantom-fade" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colors.primary} stopOpacity="0" />
          <stop offset="50%" stopColor={colors.primary} stopOpacity="0.8" />
          <stop offset="100%" stopColor={colors.primary} stopOpacity="0" />
        </linearGradient>
        
        <linearGradient id="phantom-body" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="60%" stopColor={colors.secondary} />
          <stop offset="100%" stopColor="#1a1a2e" stopOpacity="0.3" />
        </linearGradient>

        {/* Mask for dissolve effect */}
        <mask id="phantom-dissolve">
          <rect x="0" y="0" width="200" height="300" fill="white" />
          <g className="phantom-particles">
            {[...Array(20)].map((_, i) => (
              <circle
                key={i}
                cx={70 + Math.random() * 60}
                cy={50 + Math.random() * 200}
                r={3 + Math.random() * 5}
                fill="black"
                className="phantom-particle"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </g>
        </mask>
      </defs>
      
      {/* Background energy swirl */}
      <g className="phantom-energy" filter="url(#phantom-glow)">
        <ellipse cx="100" cy="150" rx="60" ry="120" fill="none" stroke={colors.primary} strokeWidth="1" opacity="0.3" />
        <ellipse cx="100" cy="150" rx="45" ry="90" fill="none" stroke={colors.primary} strokeWidth="1" opacity="0.5" />
      </g>
      
      {/* Ghostly trails (afterimages) */}
      <g className="phantom-trails" opacity="0.4">
        <path 
          d="M85 60 Q75 100 80 140 Q75 180 85 220 Q95 260 100 280" 
          stroke={colors.primary} 
          strokeWidth="2" 
          fill="none"
          className="phantom-trail-1"
        />
        <path 
          d="M115 60 Q125 100 120 140 Q125 180 115 220 Q105 260 100 280" 
          stroke={colors.primary} 
          strokeWidth="2" 
          fill="none"
          className="phantom-trail-2"
        />
      </g>
      
      {/* Main body */}
      <g mask="url(#phantom-dissolve)" className="phantom-body">
        {/* Hood */}
        <path 
          d="M100 30 
             Q125 35 135 55
             Q140 75 130 90
             Q115 100 100 100
             Q85 100 70 90
             Q60 75 65 55
             Q75 35 100 30"
          fill={colors.secondary}
        />
        
        {/* Face void */}
        <ellipse cx="100" cy="65" rx="18" ry="22" fill="#0a0a0f" />
        
        {/* Eyes */}
        <g className="phantom-eyes">
          <ellipse cx="92" cy="62" rx="4" ry="6" fill={colors.primary} className="phantom-eye-left" />
          <ellipse cx="108" cy="62" rx="4" ry="6" fill={colors.primary} className="phantom-eye-right" />
        </g>
        
        {/* Torso */}
        <path 
          d="M75 95 L125 95 L130 160 L70 160 Z"
          fill={colors.secondary}
          className="phantom-main-body"
        />
        
        {/* Chest detail */}
        <path 
          d="M85 100 L100 95 L115 100 L115 140 L100 145 L85 140 Z"
          fill={colors.primary}
          opacity="0.4"
        />
        
        {/* Arms - ethereal, slightly transparent */}
        <g className="phantom-arms" opacity="0.85">
          {/* Left arm */}
          <path 
            d="M75 100 Q50 115 40 145" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
          />
          {/* Right arm */}
          <path 
            d="M125 100 Q150 115 160 145" 
            stroke={colors.secondary}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
          />
          {/* Ghostly hands */}
          <circle cx="40" cy="150" r="8" fill={colors.primary} opacity="0.7" />
          <circle cx="160" cy="150" r="8" fill={colors.primary} opacity="0.7" />
        </g>
        
        {/* Legs - phasing/ethereal effect */}
        <g className="phantom-legs">
          {/* Left leg */}
          <path 
            d="M85 160 Q80 200 75 250" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="phantom-leg-left"
          />
          {/* Right leg */}
          <path 
            d="M115 160 Q120 200 125 250" 
            stroke={colors.secondary}
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
            className="phantom-leg-right"
          />
          
          {/* Ghostly feet that fade out */}
          <ellipse cx="73" cy="255" rx="10" ry="6" fill={colors.primary} opacity="0.6" className="phantom-foot-left" />
          <ellipse cx="127" cy="255" rx="10" ry="6" fill={colors.primary} opacity="0.6" className="phantom-foot-right" />
          
          {/* Phase trails from legs */}
          <path 
            d="M75 250 Q70 265 65 280" 
            stroke={colors.primary}
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
            opacity="0.3"
            className="leg-trail-left"
          />
          <path 
            d="M125 250 Q130 265 135 280" 
            stroke={colors.primary}
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
            opacity="0.3"
            className="leg-trail-right"
          />
        </g>
        
        {/* Cloak wisps flowing from body */}
        <g className="phantom-wisps" opacity="0.5">
          <path 
            d="M70 160 Q55 180 50 210 Q45 240 55 270" 
            stroke={colors.primary}
            strokeWidth="3"
            fill="none"
            className="wisp-left"
          />
          <path 
            d="M130 160 Q145 180 150 210 Q155 240 145 270" 
            stroke={colors.primary}
            strokeWidth="3"
            fill="none"
            className="wisp-right"
          />
        </g>
      </g>
      
      {/* Floating particles around */}
      <g className="phantom-float-particles">
        {[...Array(8)].map((_, i) => (
          <circle
            key={i}
            cx={60 + (i % 4) * 25}
            cy={80 + Math.floor(i / 4) * 100}
            r="3"
            fill={colors.primary}
            className="float-particle"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        ))}
      </g>
      
      {/* Blink effect ring */}
      <circle 
        cx="100" 
        cy="150" 
        r="80" 
        fill="none" 
        stroke={colors.primary} 
        strokeWidth="2" 
        opacity="0.6"
        className="phantom-blink-ring"
      />
    </svg>
  );
}

