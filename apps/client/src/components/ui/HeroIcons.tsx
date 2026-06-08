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
  | 'direball'
  | 'voidray'
  | 'blink'
  | 'shadowstep'
  | 'veil'
  | 'chainhooks'
  | 'draghook'
  | 'grapple'
  | 'anchorwall'
  | 'grappletrap'
  | 'swing'
  | 'zipline'
  | 'flamethrower'
  | 'rocket'
  | 'bomb'
  | 'rocketjump'
  | 'airstrike'
  | 'icemallet'
  | 'iceshield'
  | 'icewallrush'
  | 'iceslide'
  | 'froststorm'
  | 'wallclimb'
  | 'frostshield'
  | 'fortress'
  | 'pulseburst'
  | 'dashhit'
  | 'speedboost'
  | 'dash'
  | 'haste'
  | 'sentinelbolt'
  | 'barrierbash'
  | 'fortify'
  | 'barrier'
  | 'dome'
  | 'ultimate';

export function AbilityIcon({ type, size = 24, color = 'currentColor', className = '' }: IconProps & { type: AbilityIconType }) {
  switch (type) {
    case 'direball':
      return <DireBallIcon size={size} color={color} className={className} />;
    case 'voidray':
      return <VoidRayIcon size={size} color={color} className={className} />;
    case 'blink':
      return <BlinkIcon size={size} color={color} className={className} />;
    case 'shadowstep':
      return <ShadowstepIcon size={size} color={color} className={className} />;
    case 'veil':
      return <VeilIcon size={size} color={color} className={className} />;
    case 'chainhooks':
      return <ChainHooksIcon size={size} color={color} className={className} />;
    case 'draghook':
    case 'zipline':
      return <DragHookIcon size={size} color={color} className={className} />;
    case 'grapple':
      return <GrappleIcon size={size} color={color} className={className} />;
    case 'anchorwall':
    case 'barrier':
      return <BarrierIcon size={size} color={color} className={className} />;
    case 'grappletrap':
      return <GrappleTrapIcon size={size} color={color} className={className} />;
    case 'swing':
      return <SwingLineIcon size={size} color={color} className={className} />;
    case 'flamethrower':
      return <FlamethrowerIcon size={size} color={color} className={className} />;
    case 'rocket':
      return <RocketIcon size={size} color={color} className={className} />;
    case 'bomb':
      return <BombIcon size={size} color={color} className={className} />;
    case 'rocketjump':
      return <RocketjumpIcon size={size} color={color} className={className} />;
    case 'airstrike':
      return <AirstrikeIcon size={size} color={color} className={className} />;
    case 'icemallet':
      return <IceMalletIcon size={size} color={color} className={className} />;
    case 'iceshield':
    case 'frostshield':
      return <IceShieldIcon size={size} color={color} className={className} />;
    case 'icewallrush':
    case 'wallclimb':
      return <IceWallRushIcon size={size} color={color} className={className} />;
    case 'iceslide':
      return <IceSlideIcon size={size} color={color} className={className} />;
    case 'froststorm':
      return <FrostStormIcon size={size} color={color} className={className} />;
    case 'fortress':
      return <FortressIcon size={size} color={color} className={className} />;
    case 'pulseburst':
      return <PulseBurstIcon size={size} color={color} className={className} />;
    case 'dashhit':
      return <DashHitIcon size={size} color={color} className={className} />;
    case 'speedboost':
      return <SpeedboostIcon size={size} color={color} className={className} />;
    case 'dash':
      return <DashIcon size={size} color={color} className={className} />;
    case 'haste':
      return <HasteIcon size={size} color={color} className={className} />;
    case 'sentinelbolt':
      return <SentinelBoltIcon size={size} color={color} className={className} />;
    case 'barrierbash':
      return <BarrierBashIcon size={size} color={color} className={className} />;
    case 'fortify':
      return <FortifyIcon size={size} color={color} className={className} />;
    case 'dome':
      return <DomeIcon size={size} color={color} className={className} />;
    case 'ultimate':
      return <UltimateIcon size={size} color={color} className={className} />;
    case 'passive':
    default:
      return <PassiveIcon size={size} color={color} className={className} />;
  }
}

export function getAbilityIconType(abilityId: string): AbilityIconType {
  const mapping: Record<string, AbilityIconType> = {
    phantom_blink: 'blink',
    phantom_shadowstep: 'shadowstep',
    phantom_personal_shield: 'frostshield',
    phantom_veil: 'veil',
    hookshot_grapple: 'grapple',
    hookshot_anchor_wall: 'anchorwall',
    hookshot_swing: 'swing',
    hookshot_grapple_trap: 'grappletrap',
    blaze_flamethrower: 'flamethrower',
    blaze_rocketjump: 'rocketjump',
    blaze_airstrike: 'airstrike',
    glacier_iceslide: 'icewallrush',
    glacier_frostshield: 'froststorm',
    glacier_fortress: 'fortress',
    pulse_speedboost: 'speedboost',
    pulse_dash: 'dash',
    pulse_haste: 'haste',
    sentinel_fortify: 'fortify',
    sentinel_barrier: 'barrier',
    sentinel_dome: 'dome',
  };
  return mapping[abilityId] || 'passive';
}

function PassiveIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="7" stroke={color} strokeWidth="2" opacity="0.88" />
      <circle cx="12" cy="12" r="2.6" fill={color} />
      <path d="M12 2.8V5.2M12 18.8V21.2M2.8 12H5.2M18.8 12H21.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DireBallIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="9" cy="14" r="3.5" fill={color} />
      <circle cx="16.5" cy="8" r="2.3" fill={color} opacity="0.68" />
      <path d="M3.5 18.5C7.7 13.2 12.2 9.8 20 5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="1.5 3" opacity="0.74" />
      <path d="M7.4 14.4L10.6 13.2M15.6 8.2L17.6 7.4" stroke="#0a0a0f" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function VoidRayIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 12H14" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <path d="M13 12H21" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.68" />
      <circle cx="8" cy="12" r="4.5" stroke={color} strokeWidth="1.7" />
      <circle cx="8" cy="12" r="1.8" fill={color} />
      <path d="M16 8.5L21 12L16 15.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BlinkIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="8" width="5" height="8" rx="1.5" fill={color} opacity="0.35" />
      <rect x="16" y="7" width="5" height="10" rx="1.5" fill={color} />
      <path d="M8.5 12H14.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="1.5 2.5" />
      <path d="M14 9.5L16.5 12L14 14.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.2 10.2H20.2M18.2 13.8H20.2" stroke="#0a0a0f" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function ShadowstepIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 17.5C7.8 15.2 10.3 12.9 13 9.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 2.8" opacity="0.68" />
      <path d="M15 4.5L20 7.2V12.8L15 15.5L10 12.8V7.2L15 4.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.2 10L15 8.2L16.8 10L15 11.8L13.2 10Z" fill={color} />
      <ellipse cx="7.2" cy="17" rx="3.2" ry="1.7" fill={color} opacity="0.42" />
      <ellipse cx="4.4" cy="19.5" rx="1.4" ry="0.8" fill={color} opacity="0.28" />
    </svg>
  );
}

function VeilIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3.2C8.2 3.2 5.4 6.1 5.4 10.2V19.2C7.2 18.1 9.3 17.6 12 17.6C14.7 17.6 16.8 18.1 18.6 19.2V10.2C18.6 6.1 15.8 3.2 12 3.2Z" fill={color} opacity="0.32" />
      <path d="M5.4 19.2V10.2C5.4 6.1 8.2 3.2 12 3.2C15.8 3.2 18.6 6.1 18.6 10.2V19.2" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M8.3 12.2C10.2 10.8 13.8 10.8 15.7 12.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 20.5C8 18.7 16 18.7 20 20.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function ChainHooksIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 7L10 13M20 7L14 13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M7 4L4 7L7 10M17 4L20 7L17 10" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13L8 18M14 13L16 18" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 2" opacity="0.75" />
      <rect x="8" y="17" width="3.8" height="2.5" rx="1" fill={color} />
      <rect x="12.2" y="17" width="3.8" height="2.5" rx="1" fill={color} opacity="0.72" />
    </svg>
  );
}

function DragHookIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 5L15 16" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="2.5 2.2" />
      <path d="M15 16C18.2 19.2 22 16.9 21 12.9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M16.5 11.5L21 12.9L19.5 17.3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5.2" cy="5.8" r="2" fill={color} opacity="0.45" />
      <path d="M8 9L4.5 12.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

function GrappleIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="6" cy="6" r="2.8" stroke={color} strokeWidth="2" />
      <path d="M8.2 8.2L18 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M15.2 17.8C17.4 20 20.5 18.5 20.5 15.3" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M17.8 13.8L20.5 15.3L19 18" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GrappleTrapIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="4" fill={color} opacity="0.28" />
      <circle cx="12" cy="12" r="2.2" fill={color} />
      <path d="M12 3V8M12 16V21M3 12H8M16 12H21" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="1.8 2.2" />
      <path d="M7.2 4.8L9 7M16.8 4.8L15 7M7.2 19.2L9 17M16.8 19.2L15 17" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SwingLineIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="6" cy="5" r="2" fill={color} />
      <path d="M6 5C7 13.5 12.2 18.5 20 19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="19" r="2.6" fill={color} opacity="0.45" />
      <path d="M15.8 15.4L19.8 19.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BarrierIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 8L12 5L19 8V18H5V8Z" fill={color} opacity="0.25" />
      <path d="M5 8L12 5L19 8V18H5V8Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M8.5 7V18M15.5 7V18M5 12H19" stroke={color} strokeWidth="1.4" opacity="0.62" />
      <path d="M3 19.5H21" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FlamethrowerIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 14L8 11V16L3 18V14Z" fill={color} opacity="0.76" />
      <rect x="7" y="10" width="6.5" height="6" rx="1.5" fill={color} />
      <path d="M13 13C15.1 7.8 19.1 6.2 21.5 5.8C20.2 8.3 21.1 9.9 18.3 12C21 13.2 20.5 16.1 19.5 18.1C17.9 15.9 15.3 16.2 13 13Z" fill={color} />
      <path d="M15.1 13C16 10.9 17.8 9.8 19.2 9.3C18.6 10.7 18.9 11.5 17.5 12.7C18.8 13.4 18.8 14.6 18.3 15.6C17.2 14.5 16 14.7 15.1 13Z" fill="#fff7d6" opacity="0.9" />
    </svg>
  );
}

function RocketIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M15.8 3.2C18.4 4.3 20.1 6 20.8 8.6L13.6 15.8L8.2 10.4L15.8 3.2Z" fill={color} />
      <path d="M8.2 10.4L4.7 11.2L7.1 13.6L4.5 19.5L10.4 16.9L12.8 19.3L13.6 15.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16.5" cy="7.5" r="1.3" fill="#0a0a0f" opacity="0.62" />
      <path d="M6.8 16.8L3.2 20.4" stroke={color} strokeWidth="1.7" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function BombIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M14 4H18L16.7 7.2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.8 7.3C12.8 5.8 16.2 8.2 16.2 11.8V15.5L12 20L7.8 15.5V11.8C7.8 9.8 8.6 8 9.8 7.3Z" fill={color} />
      <path d="M10.2 13H13.8M12 11.2V14.8" stroke="#0a0a0f" strokeWidth="1.5" strokeLinecap="round" opacity="0.58" />
      <path d="M5 19.5C8.8 18.2 15.2 18.2 19 19.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function RocketjumpIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3L9.5 8H14.5L12 3Z" fill={color} />
      <path d="M12 8V14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M7 18L9.5 15.5L12 18L14.5 15.5L17 18L14.8 21H9.2L7 18Z" fill={color} opacity="0.55" />
      <path d="M4 21L7 18M20 21L17 18M12 18V22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AirstrikeIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6.5 3V11L4.8 13H8.2L6.5 11V3ZM12 5V13L10.3 15H13.7L12 13V5ZM17.5 3V11L15.8 13H19.2L17.5 11V3Z" fill={color} />
      <circle cx="12" cy="19" r="3" stroke={color} strokeWidth="1.7" />
      <path d="M8 19H16M12 15V23" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

function IceMalletIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6L9 3L15 9L12 12L6 6Z" fill={color} />
      <path d="M4.5 7.5L7.5 4.5M13.5 10.5L16.5 7.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12L20 20" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M5 17C8.1 18.5 11.4 18.7 15 17.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" opacity="0.68" />
      <path d="M9 3L11.2 5.2M6 6L8.2 8.2" stroke="#0a0a0f" strokeWidth="1.2" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function IceShieldIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2.8L4.8 6.2V11.5C4.8 16 7.9 20 12 21.4C16.1 20 19.2 16 19.2 11.5V6.2L12 2.8Z" fill={color} opacity="0.25" />
      <path d="M12 2.8L4.8 6.2V11.5C4.8 16 7.9 20 12 21.4C16.1 20 19.2 16 19.2 11.5V6.2L12 2.8Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 7V16M8.6 9L15.4 14M15.4 9L8.6 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="11.5" r="1.5" fill={color} />
    </svg>
  );
}

function IceWallRushIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 17V10L7 7L10 10V17H4ZM10 17V8L13 5L16 8V17H10ZM16 17V11L19 8L21 10V17H16Z" fill={color} opacity="0.35" />
      <path d="M4 17V10L7 7L10 10V17M10 17V8L13 5L16 8V17M16 17V11L19 8L21 10V17" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3 20H16M17 20L21 20" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 5H10M3 7.5H7" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function IceSlideIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 16C8.5 12.8 13.8 12.6 20 15.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 12L5.2 14.6L8 17.2" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10.2L15.2 13.3L18.5 12.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 19H8M10 19H14M16 19H20" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.62" />
    </svg>
  );
}

function FrostStormIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M18.5 8.5C16.3 5.1 11.2 4.3 8 7.1M5.5 15.5C7.7 18.9 12.8 19.7 16 16.9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M16.4 5.2L18.8 8.8L14.6 9.5M7.6 18.8L5.2 15.2L9.4 14.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.1" fill={color} />
      <path d="M12 8.2V15.8M8.8 10.1L15.2 13.9M15.2 10.1L8.8 13.9" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function FortressIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 20V8L7 5L10 8L13 5L16 8L19 5L21 8V20H4Z" fill={color} opacity="0.3" />
      <path d="M4 20V8L7 5L10 8L13 5L16 8L19 5L21 8V20" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M8 20V15H11V20M14 20V15H17V20M4 12H21" stroke={color} strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}

function PulseBurstIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 12H7L9 7L13 17L16 9L18 12H21" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="12" r="2.2" fill={color} opacity="0.35" />
      <circle cx="18" cy="12" r="2.2" fill={color} />
      <path d="M14 5L18 2M15.5 19L20 22" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function DashHitIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 12H12" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="2 2" />
      <path d="M11 7L17 12L11 17V7Z" fill={color} />
      <path d="M17 12L21 8M17 12L21 12M17 12L21 16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="12" r="2.2" fill={color} opacity="0.34" />
    </svg>
  );
}

function SpeedboostIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="4.2" fill={color} opacity="0.34" />
      <circle cx="12" cy="12" r="2" fill={color} />
      <path d="M12 4V2M12 22V20M4 12H2M22 12H20" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5.5 8H10M5.5 16H10M14 8H18.5M14 16H18.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function DashIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12H13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 2" />
      <path d="M12 6L20 12L12 18V14H7V10H12V6Z" fill={color} />
    </svg>
  );
}

function HasteIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12L10 6V10H20V14H10V18L4 12Z" fill={color} />
      <path d="M6 5.5L11 2V4.5H17V8H11V10L6 5.5Z" fill={color} opacity="0.48" />
      <path d="M6 18.5L11 14V16H17V19.5H11V22L6 18.5Z" fill={color} opacity="0.48" />
    </svg>
  );
}

function SentinelBoltIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12H15" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M15 7L21 12L15 17V7Z" fill={color} />
      <path d="M6 8L8 12L6 16L3.5 12L6 8Z" fill={color} opacity="0.5" />
      <path d="M12 9.5H16M12 14.5H16" stroke="#0a0a0f" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function BarrierBashIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 6.5L11 4V20L5 17.5V6.5Z" fill={color} opacity="0.42" />
      <path d="M5 6.5L11 4V20L5 17.5V6.5Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12.5 12H20M17 8.5L21 12L17 15.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6L18 3M15 18L18 21" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.62" />
    </svg>
  );
}

function FortifyIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3L6 6V11.5C6 15.4 8.4 18.7 12 20.4C15.6 18.7 18 15.4 18 11.5V6L12 3Z" fill={color} opacity="0.28" />
      <path d="M12 3L6 6V11.5C6 15.4 8.4 18.7 12 20.4C15.6 18.7 18 15.4 18 11.5V6L12 3Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 8V17M8.5 17H15.5M7 20H17" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DomeIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 18C4 11.4 7.3 7 12 7C16.7 7 20 11.4 20 18" fill={color} opacity="0.24" />
      <path d="M4 18C4 11.4 7.3 7 12 7C16.7 7 20 11.4 20 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M7 18C7 13.3 9 10.2 12 10.2C15 10.2 17 13.3 17 18" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.65" />
      <path d="M2.5 18H21.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.8" fill={color} />
    </svg>
  );
}

function UltimateIcon({ size, color, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2.5L14.2 8.8H21L15.5 12.8L17.8 21.2L12 16.4L6.2 21.2L8.5 12.8L3 8.8H9.8L12 2.5Z" fill={color} />
      <path d="M12 7.2L13 10.2H16.1L13.5 12L14.6 15.7L12 13.6L9.4 15.7L10.5 12L7.9 10.2H11L12 7.2Z" fill="#ffffff" opacity="0.35" />
    </svg>
  );
}
