import type { HeroId } from '@voxel-strike/shared';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

// ============= HERO ICONS =============

export function HeroIcon({ heroId, size = 24, color = 'currentColor', className = '' }: IconProps & { heroId: HeroId }) {
  switch (heroId) {
    case 'phantom':
      return <PhantomIcon size={size} color={color} className={className} />;
    case 'hookshot':
      return <HookshotIcon size={size} color={color} className={className} />;
    case 'blaze':
      return <BlazeIcon size={size} color={color} className={className} />;
    case 'glacier':
      return <GlacierIcon size={size} color={color} className={className} />;
    case 'pulse':
      return <PulseIcon size={size} color={color} className={className} />;
    case 'sentinel':
      return <SentinelIcon size={size} color={color} className={className} />;
    default:
      return null;
  }
}

// Phantom - Ghost/Stealth
function PhantomIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Ghost body */}
      <path 
        d="M12 2C8.13 2 5 5.13 5 9v8c0 0.5 0.5 1 1 0.5l1.5-1.5 1.5 1.5c0.5 0.5 1 0.5 1.5 0l1.5-1.5 1.5 1.5c0.5 0.5 1 0.5 1.5 0l1.5-1.5 1.5 1.5c0.5 0.5 1 0 1-0.5V9c0-3.87-3.13-7-7-7z" 
        fill={color}
        opacity="0.9"
      />
      {/* Eyes */}
      <circle cx="9" cy="10" r="1.5" fill="#0a0a0f" />
      <circle cx="15" cy="10" r="1.5" fill="#0a0a0f" />
      {/* Glow effect */}
      <path 
        d="M12 2C8.13 2 5 5.13 5 9v8c0 0.5 0.5 1 1 0.5l1.5-1.5 1.5 1.5c0.5 0.5 1 0.5 1.5 0l1.5-1.5 1.5 1.5c0.5 0.5 1 0.5 1.5 0l1.5-1.5 1.5 1.5c0.5 0.5 1 0 1-0.5V9c0-3.87-3.13-7-7-7z" 
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.5"
      />
    </svg>
  );
}

// Hookshot - Grappling Hook
function HookshotIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Hook */}
      <path 
        d="M4 4L8 8" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      <path 
        d="M8 8L12 4L16 8L12 12L8 8Z" 
        fill={color}
      />
      {/* Cable */}
      <path 
        d="M12 12L20 20" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round"
        strokeDasharray="3,2"
      />
      {/* Hook prongs */}
      <path 
        d="M6 2L4 4L6 6" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path 
        d="M2 6L4 4L2 2" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// Blaze - Flame
function BlazeIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Main flame */}
      <path 
        d="M12 2C12 2 8 6 8 11C8 14 9.5 16 12 18C14.5 16 16 14 16 11C16 6 12 2 12 2Z" 
        fill={color}
      />
      {/* Inner flame */}
      <path 
        d="M12 8C12 8 10 10 10 12.5C10 14 11 15 12 16C13 15 14 14 14 12.5C14 10 12 8 12 8Z" 
        fill="#fef3c7"
        opacity="0.9"
      />
      {/* Side flames */}
      <path 
        d="M7 14C7 14 5 12 5 10C5 8 6 7 6 7C6 7 6 9 7 11C8 13 7 14 7 14Z" 
        fill={color}
        opacity="0.7"
      />
      <path 
        d="M17 14C17 14 19 12 19 10C19 8 18 7 18 7C18 7 18 9 17 11C16 13 17 14 17 14Z" 
        fill={color}
        opacity="0.7"
      />
      {/* Sparks */}
      <circle cx="6" cy="18" r="1" fill={color} opacity="0.6" />
      <circle cx="18" cy="19" r="0.8" fill={color} opacity="0.5" />
      <circle cx="9" cy="20" r="0.6" fill={color} opacity="0.4" />
      <circle cx="15" cy="21" r="0.7" fill={color} opacity="0.5" />
    </svg>
  );
}

// Glacier - Snowflake/Ice Crystal
function GlacierIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Main crystal arms */}
      <path 
        d="M12 2V22M2 12H22M4.93 4.93L19.07 19.07M19.07 4.93L4.93 19.07" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      {/* Crystal branches */}
      <path 
        d="M12 2L10 5M12 2L14 5" 
        stroke={color} 
        strokeWidth="1.5" 
        strokeLinecap="round"
      />
      <path 
        d="M12 22L10 19M12 22L14 19" 
        stroke={color} 
        strokeWidth="1.5" 
        strokeLinecap="round"
      />
      <path 
        d="M2 12L5 10M2 12L5 14" 
        stroke={color} 
        strokeWidth="1.5" 
        strokeLinecap="round"
      />
      <path 
        d="M22 12L19 10M22 12L19 14" 
        stroke={color} 
        strokeWidth="1.5" 
        strokeLinecap="round"
      />
      {/* Center crystal */}
      <circle cx="12" cy="12" r="3" fill={color} opacity="0.3" />
      <circle cx="12" cy="12" r="1.5" fill={color} />
    </svg>
  );
}

// Pulse - Lightning/Energy
function PulseIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Main lightning bolt */}
      <path 
        d="M13 2L4 14H11L10 22L20 9H13L13 2Z" 
        fill={color}
      />
      {/* Inner highlight */}
      <path 
        d="M12 5L7 12H10L9 18L16 11H13L12 5Z" 
        fill="#ffffff"
        opacity="0.4"
      />
      {/* Energy sparks */}
      <circle cx="3" cy="8" r="1" fill={color} opacity="0.5" />
      <circle cx="21" cy="16" r="0.8" fill={color} opacity="0.4" />
    </svg>
  );
}

// Sentinel - Shield
function SentinelIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Shield body */}
      <path 
        d="M12 2L4 5V11C4 16.5 7.5 21 12 22C16.5 21 20 16.5 20 11V5L12 2Z" 
        fill={color}
      />
      {/* Shield inner */}
      <path 
        d="M12 4L6 6.5V11C6 15.5 9 19 12 20C15 19 18 15.5 18 11V6.5L12 4Z" 
        fill="#0a0a0f"
        opacity="0.3"
      />
      {/* Shield emblem - star */}
      <path 
        d="M12 8L13 11H16L13.5 13L14.5 16L12 14L9.5 16L10.5 13L8 11H11L12 8Z" 
        fill={color}
      />
    </svg>
  );
}


// ============= ABILITY ICONS =============

export type AbilityIconType = 
  | 'passive' 
  | 'blink' 
  | 'shadowstep' 
  | 'veil'
  | 'grapple' 
  | 'swing' 
  | 'zipline'
  | 'flamethrower'
  | 'rocketjump' 
  | 'airstrike'
  | 'iceslide' 
  | 'wallclimb' 
  | 'frostshield'
  | 'fortress'
  | 'speedboost' 
  | 'dash' 
  | 'haste'
  | 'fortify' 
  | 'barrier' 
  | 'dome'
  | 'ultimate';

export function AbilityIcon({ type, size = 24, color = 'currentColor', className = '' }: IconProps & { type: AbilityIconType }) {
  switch (type) {
    case 'passive':
      return <PassiveIcon size={size} color={color} className={className} />;
    case 'blink':
      return <BlinkIcon size={size} color={color} className={className} />;
    case 'shadowstep':
      return <ShadowstepIcon size={size} color={color} className={className} />;
    case 'veil':
      return <VeilIcon size={size} color={color} className={className} />;
    case 'grapple':
      return <GrappleIcon size={size} color={color} className={className} />;
    case 'swing':
      return <SwingIcon size={size} color={color} className={className} />;
    case 'zipline':
      return <ZiplineIcon size={size} color={color} className={className} />;
    case 'flamethrower':
      return <FlamethrowerIcon size={size} color={color} className={className} />;
    case 'rocketjump':
      return <RocketjumpIcon size={size} color={color} className={className} />;
    case 'airstrike':
      return <AirstrikeIcon size={size} color={color} className={className} />;
    case 'iceslide':
      return <IceslideIcon size={size} color={color} className={className} />;
    case 'wallclimb':
      return <WallclimbIcon size={size} color={color} className={className} />;
    case 'frostshield':
      return <FrostshieldIcon size={size} color={color} className={className} />;
    case 'fortress':
      return <FortressIcon size={size} color={color} className={className} />;
    case 'speedboost':
      return <SpeedboostIcon size={size} color={color} className={className} />;
    case 'dash':
      return <DashIcon size={size} color={color} className={className} />;
    case 'haste':
      return <HasteIcon size={size} color={color} className={className} />;
    case 'fortify':
      return <FortifyIcon size={size} color={color} className={className} />;
    case 'barrier':
      return <BarrierIcon size={size} color={color} className={className} />;
    case 'dome':
      return <DomeIcon size={size} color={color} className={className} />;
    case 'ultimate':
      return <UltimateIcon size={size} color={color} className={className} />;
    default:
      return <PassiveIcon size={size} color={color} className={className} />;
  }
}

// Map ability IDs to icon types
export function getAbilityIconType(abilityId: string): AbilityIconType {
  const mapping: Record<string, AbilityIconType> = {
    'phantom_blink': 'blink',
    'phantom_shadowstep': 'shadowstep',
    'phantom_veil': 'veil',
    'hookshot_grapple': 'grapple',
    'hookshot_swing': 'swing',
    'hookshot_grapple_trap': 'grapple', // Uses grapple icon for trap ultimate
    'blaze_flamethrower': 'flamethrower',
    'blaze_rocketjump': 'rocketjump',
    'blaze_airstrike': 'airstrike',
    'glacier_iceslide': 'iceslide',
    'glacier_frostshield': 'frostshield',
    'glacier_fortress': 'fortress',
    'pulse_speedboost': 'speedboost',
    'pulse_dash': 'dash',
    'pulse_haste': 'haste',
    'sentinel_fortify': 'fortify',
    'sentinel_barrier': 'barrier',
    'sentinel_dome': 'dome',
  };
  return mapping[abilityId] || 'passive';
}

// Passive - Circle with dot
function PassiveIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="3" fill={color} />
    </svg>
  );
}

// Blink - Teleport symbol
function BlinkIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12H2M8 12C8 9.79 9.79 8 12 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="2,2" />
      <circle cx="17" cy="12" r="5" fill={color} />
      <path d="M15 12L17 10L19 12L17 14L15 12Z" fill="#0a0a0f" />
    </svg>
  );
}

// Shadowstep - Footprint fade
function ShadowstepIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <ellipse cx="8" cy="16" rx="3" ry="4" fill={color} opacity="0.3" />
      <ellipse cx="16" cy="8" rx="3" ry="4" fill={color} />
      <path d="M8 16L16 8" stroke={color} strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
    </svg>
  );
}

// Veil - Cloak/invisibility
function VeilIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3C8 3 5 6 5 10V18C5 18 8 20 12 20C16 20 19 18 19 18V10C19 6 16 3 12 3Z" fill={color} opacity="0.3" />
      <path d="M12 3C8 3 5 6 5 10V18C5 18 8 20 12 20C16 20 19 18 19 18V10C19 6 16 3 12 3Z" stroke={color} strokeWidth="2" fill="none" />
      <circle cx="9" cy="10" r="1" fill={color} />
      <circle cx="15" cy="10" r="1" fill={color} />
    </svg>
  );
}

// Grapple - Hook
function GrappleIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 4L8 8M4 8L8 4" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="6" r="3" stroke={color} strokeWidth="2" fill="none" />
      <path d="M8 8L20 20" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Swing - Arc motion
function SwingIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 4Q20 4 20 20" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="20" r="3" fill={color} />
      <path d="M4 4L6 6M4 4L6 2M4 4L2 6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Zipline - Line with nodes
function ZiplineIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 6L20 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="4" cy="6" r="2" fill={color} />
      <circle cx="20" cy="18" r="2" fill={color} />
      <circle cx="12" cy="12" r="3" fill={color} stroke="#0a0a0f" strokeWidth="1" />
    </svg>
  );
}

// Flamethrower - Forward flame stream
function FlamethrowerIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 13L8 10V14L3 16V13Z" fill={color} opacity="0.75" />
      <rect x="6" y="9" width="7" height="6" rx="2" fill={color} />
      <path d="M12 12C14 7 19 5 21 5C20 7 21 9 18 11C21 12 21 15 20 17C18 15 14 16 12 12Z" fill={color} />
      <path d="M14 12C15.5 9.5 18 8.5 19.5 8.5C18.8 10 19 11 17.2 12C19 13 19 14.3 18.5 15C17 14 15.3 14.2 14 12Z" fill="#fef3c7" opacity="0.9" />
      <circle cx="4" cy="10" r="1" fill={color} opacity="0.5" />
    </svg>
  );
}

// Rocketjump - Explosion upward
function RocketjumpIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3L10 8H14L12 3Z" fill={color} />
      <path d="M12 8V14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18" r="4" fill={color} opacity="0.5" />
      <circle cx="12" cy="18" r="2" fill={color} />
      <path d="M8 20L6 22M16 20L18 22M10 21L9 23M14 21L15 23" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// Airstrike - Bombs falling
function AirstrikeIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 4L6 12L4 14L6 14L8 12L8 4L6 4Z" fill={color} />
      <path d="M11 6L11 14L9 16L11 16L13 14L13 6L11 6Z" fill={color} opacity="0.8" />
      <path d="M16 4L16 12L14 14L16 14L18 12L18 4L16 4Z" fill={color} opacity="0.6" />
      <circle cx="6" cy="18" r="2" fill={color} opacity="0.5" />
      <circle cx="12" cy="20" r="2" fill={color} opacity="0.4" />
      <circle cx="17" cy="18" r="2" fill={color} opacity="0.3" />
    </svg>
  );
}

// Iceslide - Sliding motion
function IceslideIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 16Q12 12 20 16" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M6 14L4 12L6 10" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="16" cy="14" r="3" fill={color} />
      <path d="M4 18L8 18M10 18L14 18M16 18L20 18" stroke={color} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

// Wallclimb - Climbing
function WallclimbIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="4" y="2" width="4" height="20" fill={color} opacity="0.3" />
      <circle cx="14" cy="8" r="3" fill={color} />
      <path d="M14 11V16" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M11 13L8 10" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M17 13L20 10" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16L10 20M16 16L18 20" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Frostshield - Ice shield with snowflake
function FrostshieldIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Shield outline */}
      <path d="M12 2L4 6V12C4 16.4 7.5 20.5 12 22C16.5 20.5 20 16.4 20 12V6L12 2Z" stroke={color} strokeWidth="2" fill={color} fillOpacity="0.2" />
      {/* Snowflake center */}
      <circle cx="12" cy="11" r="1.5" fill={color} />
      {/* Snowflake arms */}
      <path d="M12 7V15M9 9L15 13M15 9L9 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {/* Small crystals */}
      <path d="M12 7L11 8M12 7L13 8" stroke={color} strokeWidth="1" strokeLinecap="round" />
      <path d="M12 15L11 14M12 15L13 14" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// Fortress - Ice wall
function FortressIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 20V8L8 4L12 8L16 4L20 8V20H4Z" fill={color} opacity="0.3" />
      <path d="M4 20V8L8 4L12 8L16 4L20 8V20" stroke={color} strokeWidth="2" fill="none" />
      <path d="M8 20V14H11V20M13 20V14H16V20" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// Speedboost - Speed lines
function SpeedboostIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 8H12M4 12H14M4 16H12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M16 6L22 12L16 18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Dash - Quick movement
function DashIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="18" cy="12" r="4" fill={color} />
      <path d="M2 12H10M4 8H8M4 16H8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Haste - Multiple speed arrows
function HasteIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12L10 6V10H20V14H10V18L4 12Z" fill={color} />
      <path d="M6 6L12 2V4H18V8H12V10L6 6Z" fill={color} opacity="0.5" />
      <path d="M6 18L12 14V16H18V20H12V22L6 18Z" fill={color} opacity="0.5" />
    </svg>
  );
}

// Fortify - Anchor/plant
function FortifyIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8" r="4" stroke={color} strokeWidth="2" fill="none" />
      <path d="M12 12V18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M8 18H16" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M6 20H18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.5" fill={color} />
    </svg>
  );
}

// Barrier - Wall
function BarrierIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="6" width="18" height="12" rx="2" fill={color} opacity="0.3" />
      <rect x="3" y="6" width="18" height="12" rx="2" stroke={color} strokeWidth="2" fill="none" />
      <path d="M8 6V18M12 6V18M16 6V18" stroke={color} strokeWidth="1" opacity="0.5" />
      <path d="M3 10H21M3 14H21" stroke={color} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

// Dome - Protective dome
function DomeIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 18C4 18 4 8 12 8C20 8 20 18 20 18" fill={color} opacity="0.2" />
      <path d="M4 18C4 18 4 8 12 8C20 8 20 18 20 18" stroke={color} strokeWidth="2" fill="none" />
      <path d="M6 18C6 18 6 10 12 10C18 10 18 18 18 18" stroke={color} strokeWidth="1" fill="none" opacity="0.5" />
      <path d="M2 18H22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="14" r="2" fill={color} />
    </svg>
  );
}

// Ultimate - Star burst
function UltimateIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L14 9H21L15.5 13.5L17.5 21L12 16.5L6.5 21L8.5 13.5L3 9H10L12 2Z" fill={color} />
      <path d="M12 6L13 10H17L13.5 12.5L14.5 17L12 14.5L9.5 17L10.5 12.5L7 10H11L12 6Z" fill="#ffffff" opacity="0.3" />
    </svg>
  );
}
