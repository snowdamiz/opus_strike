import type { HeroId } from '@voxel-strike/shared';

// Hero colors for glow and accent effects
const HERO_COLORS: Record<HeroId, { primary: string; secondary: string; glow: string }> = {
  phantom: { primary: '#a855f7', secondary: '#7c3aed', glow: 'rgba(168, 85, 247, 0.6)' },
  hookshot: { primary: '#06b6d4', secondary: '#0891b2', glow: 'rgba(6, 182, 212, 0.6)' },
  blaze: { primary: '#f97316', secondary: '#ea580c', glow: 'rgba(249, 115, 22, 0.6)' },
  glacier: { primary: '#3b82f6', secondary: '#1d4ed8', glow: 'rgba(59, 130, 246, 0.6)' },
  pulse: { primary: '#22c55e', secondary: '#16a34a', glow: 'rgba(34, 197, 94, 0.6)' },
  sentinel: { primary: '#eab308', secondary: '#ca8a04', glow: 'rgba(234, 179, 8, 0.6)' },
};

interface HeroSVGProps {
  heroId: HeroId;
  className?: string;
  size?: number;
}

export function HeroSVG({ heroId, className = '', size = 400 }: HeroSVGProps) {
  const colors = HERO_COLORS[heroId];
  
  switch (heroId) {
    case 'phantom':
      return <PhantomSVG colors={colors} className={className} size={size} />;
    case 'hookshot':
      return <HookshotSVG colors={colors} className={className} size={size} />;
    case 'blaze':
      return <BlazeSVG colors={colors} className={className} size={size} />;
    case 'glacier':
      return <GlacierSVG colors={colors} className={className} size={size} />;
    case 'pulse':
      return <PulseSVG colors={colors} className={className} size={size} />;
    case 'sentinel':
      return <SentinelSVG colors={colors} className={className} size={size} />;
    default:
      return null;
  }
}

interface HeroSVGInternalProps {
  colors: { primary: string; secondary: string; glow: string };
  className: string;
  size: number;
}

// ============= PHANTOM - Ghostly Blink Assassin =============
function PhantomSVG({ colors, className, size }: HeroSVGInternalProps) {
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

// ============= HOOKSHOT - Grappling Swinger =============
function HookshotSVG({ colors, className, size }: HeroSVGInternalProps) {
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

// ============= BLAZE - Jetpack Fire Assault =============
function BlazeSVG({ colors, className, size }: HeroSVGInternalProps) {
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

// ============= GLACIER - Ice Tank =============
function GlacierSVG({ colors, className, size }: HeroSVGInternalProps) {
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
          <circle cx="90" cy="50" r="5" fill="#ffffff">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="110" cy="50" r="5" fill="#ffffff">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
          </circle>
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
          <circle cx="15" cy="165" r="18" fill={colors.secondary}>
            <animate attributeName="r" values="18;20;18" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle cx="185" cy="165" r="18" fill={colors.secondary}>
            <animate attributeName="r" values="18;20;18" dur="3s" repeatCount="indefinite" />
          </circle>
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
        <ellipse cx="100" cy="70" rx="20" ry="8" fill={colors.primary} className="breath-cloud">
          <animate attributeName="rx" values="20;25;20" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.6;0.4" dur="3s" repeatCount="indefinite" />
        </ellipse>
      </g>
    </svg>
  );
}

// ============= PULSE - Speed Support =============
function PulseSVG({ colors, className, size }: HeroSVGInternalProps) {
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
        <circle cx="100" cy="120" r="15" fill="url(#pulse-energy)" className="energy-core">
          <animate attributeName="r" values="15;18;15" dur="1s" repeatCount="indefinite" />
        </circle>
        <circle cx="100" cy="120" r="10" fill="#ffffff" opacity="0.8">
          <animate attributeName="opacity" values="0.8;1;0.8" dur="0.5s" repeatCount="indefinite" />
        </circle>
        
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
        <ellipse cx="90" cy="62" rx="6" ry="4" fill="#ffffff" className="pulse-eye-left">
          <animate attributeName="opacity" values="1;0.5;1" dur="0.3s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="110" cy="62" rx="6" ry="4" fill="#ffffff" className="pulse-eye-right">
          <animate attributeName="opacity" values="1;0.5;1" dur="0.3s" repeatCount="indefinite" />
        </ellipse>
        
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
        {[...Array(10)].map((_, i) => (
          <circle
            key={i}
            cx={20 + i * 8}
            cy={140 + Math.sin(i) * 30}
            r={2 + Math.random() * 2}
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

// ============= SENTINEL - Shield Defender =============
function SentinelSVG({ colors, className, size }: HeroSVGInternalProps) {
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

