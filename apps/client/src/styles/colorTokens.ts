import type { HeroId } from '@voxel-strike/shared';

type Rgb = readonly [number, number, number];

function rgba([red, green, blue]: Rgb, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const palette = {
  red: { hex: '#ef4444', rgb: [239, 68, 68] as const },
  redDeep: { hex: '#b91c1c', rgb: [185, 28, 28] as const },
  orange: { hex: '#f97316', rgb: [249, 115, 22] as const },
  orangeDeep: { hex: '#ea580c', rgb: [234, 88, 12] as const },
  amber: { hex: '#fbbf24', rgb: [251, 191, 36] as const },
  cyan: { hex: '#06b6d4', rgb: [6, 182, 212] as const },
  purple: { hex: '#8b5cf6', rgb: [139, 92, 246] as const },
  phantom: { hex: '#a855f7', rgb: [168, 85, 247] as const },
  phantomDeep: { hex: '#7c3aed', rgb: [124, 58, 237] as const },
  hookshotDeep: { hex: '#0891b2', rgb: [8, 145, 178] as const },
  chronos: { hex: '#22c55e', rgb: [34, 197, 94] as const },
  chronosDeep: { hex: '#b91c1c', rgb: [185, 28, 28] as const },
} as const;

export const HERO_COLORS = {
  phantom: palette.phantom.hex,
  hookshot: palette.cyan.hex,
  blaze: palette.orange.hex,
  chronos: palette.chronos.hex,
} satisfies Record<HeroId, string>;

export const HERO_COLOR_SCHEMES = {
  phantom: { primary: palette.phantom.hex, secondary: palette.phantomDeep.hex, glow: rgba(palette.phantom.rgb, 0.6) },
  hookshot: { primary: palette.cyan.hex, secondary: palette.hookshotDeep.hex, glow: rgba(palette.cyan.rgb, 0.6) },
  blaze: { primary: palette.orange.hex, secondary: palette.orangeDeep.hex, glow: rgba(palette.orange.rgb, 0.6) },
  chronos: { primary: palette.chronos.hex, secondary: palette.chronosDeep.hex, glow: rgba(palette.chronos.rgb, 0.62) },
} satisfies Record<HeroId, { primary: string; secondary: string; glow: string }>;

export const HERO_PREVIEW_COLORS = {
  neutralShadow: '#05070a',
  platformBase: '#151922',
  platformDeck: '#222936',
} as const;

export const HUD_HERO_COLORS = {
  phantom: { primary: palette.phantom.hex, glow: rgba(palette.phantom.rgb, 0.4), bg: rgba(palette.phantom.rgb, 0.15) },
  hookshot: { primary: palette.cyan.hex, glow: rgba(palette.cyan.rgb, 0.4), bg: rgba(palette.cyan.rgb, 0.15) },
  blaze: { primary: palette.orange.hex, glow: rgba(palette.orange.rgb, 0.5), bg: rgba(palette.orange.rgb, 0.15) },
  chronos: { primary: palette.chronos.hex, glow: rgba(palette.chronos.rgb, 0.42), bg: rgba(palette.chronos.rgb, 0.15) },
} satisfies Record<HeroId, { primary: string; glow: string; bg: string }>;

export const FACTIONS = {
  red: {
    id: 'red',
    name: 'SOLAR',
    fullName: 'SOLAR VANGUARD',
    tagline: 'Warriors of Light',
    primaryColor: palette.red.hex,
    secondaryColor: palette.redDeep.hex,
    glowColor: rgba(palette.red.rgb, 0.4),
    hudGlowColor: rgba(palette.red.rgb, 0.5),
    bgGradient: rgba(palette.red.rgb, 0.08),
    bgColor: rgba(palette.red.rgb, 0.1),
    borderColor: rgba(palette.red.rgb, 0.15),
    strongBorderColor: rgba(palette.red.rgb, 0.3),
    gradient: `linear-gradient(180deg, ${rgba(palette.red.rgb, 0.52)} 0%, ${rgba(palette.redDeep.rgb, 0.68)} 100%)`,
  },
  blue: {
    id: 'blue',
    name: 'VOID',
    fullName: 'VOID LEGION',
    tagline: 'Masters of Shadow',
    primaryColor: palette.cyan.hex,
    secondaryColor: palette.purple.hex,
    glowColor: rgba(palette.cyan.rgb, 0.4),
    hudGlowColor: rgba(palette.cyan.rgb, 0.5),
    bgGradient: rgba(palette.cyan.rgb, 0.08),
    bgColor: rgba(palette.cyan.rgb, 0.1),
    borderColor: rgba(palette.cyan.rgb, 0.15),
    strongBorderColor: rgba(palette.cyan.rgb, 0.3),
    gradient: `linear-gradient(180deg, ${rgba(palette.cyan.rgb, 0.5)} 0%, ${rgba(palette.purple.rgb, 0.5)} 100%)`,
  },
} as const;

export const TEAM_FALLBACK_COLORS = {
  primaryColor: 'rgb(var(--color-text-primary))',
  secondaryColor: 'rgb(var(--color-text-strong))',
  glowColor: 'rgb(255 255 255 / 0.32)',
  bgColor: 'rgb(255 255 255 / 0.08)',
} as const;

export const MAP_VOTE_COLORS = {
  blueprintBackground: 'rgb(8 16 22)',
  blueprintGradient: `radial-gradient(circle at 50% 48%, ${rgba(palette.orange.rgb, 0.22)}, transparent 34%), linear-gradient(135deg, ${rgba(palette.hookshotDeep.rgb, 0.22)}, rgba(17,24,39,0.9) 52%, ${rgba(palette.redDeep.rgb, 0.18)})`,
  landmarkFill: rgba(palette.orange.rgb, 0.28),
  landmarkStroke: 'rgba(253, 186, 116, 0.78)',
  spawnFallback: 'rgb(var(--color-text-strong))',
} as const;

export const SCOREBOARD_COLORS = {
  battleRoyalHeaderBackground: 'linear-gradient(90deg, rgb(var(--color-accent-primary) / 0.16), rgb(var(--color-strike-elevated) / 0.88), rgb(var(--color-accent-primary) / 0.14))',
} as const;

export const WALLET_AUTH_COLORS = {
  gradient: 'linear-gradient(135deg, rgb(var(--color-accent-primary)) 0%, rgb(var(--color-accent-primary-deep)) 100%)',
  glow: '0 0 40px rgb(var(--color-accent-primary) / 0.3), inset 0 1px 0 rgb(255 255 255 / 0.2)',
  subtleGlow: '0 0 30px rgb(var(--color-accent-primary) / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.2)',
  shimmer: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
} as const;

export const DISCORD_AUTH_COLORS = {
  base: '#5865F2',
  hover: '#4752C4',
  icon: '#B9C0FF',
  border: 'rgba(255, 255, 255, 0.18)',
  panelBg: 'rgba(88, 101, 242, 0.1)',
  panelBorder: 'rgba(88, 101, 242, 0.25)',
  glow: '0 0 34px rgba(88, 101, 242, 0.34), inset 0 1px 0 rgb(255 255 255 / 0.18)',
  shimmer: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
} as const;

export const ABILITY_COLORS = {
  ultimate: '#f59e0b',
  ultimateDeep: '#d97706',
  ultimateDarker: '#b45309',
  ultimateText: '#fbbf24',
  ultimateLight: '#fde047',
  ultimateBorder: 'rgba(245,158,11,0.62)',
  ultimateBadgeBg: 'rgba(245, 158, 11, 0.3)',
  ultimateMetaBg: 'rgba(245, 158, 11, 0.2)',
  ultimatePanelStart: 'rgba(180, 83, 9, 0.2)',
  ultimateGlow: 'rgba(245,158,11,0.12)',
  ultimateIconGlow: '0 4px 20px rgba(245, 158, 11, 0.4)',
} as const;

export const RANK_BADGE_COLORS = {
  divisionMarkShadow: '#020617',
} as const;

export const MINIMAP_COLORS = {
  frame: {
    shadow: '0 12px 28px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 24px rgba(34, 211, 238, 0.03)',
    overlay: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 28%, transparent 72%, rgba(6,182,212,0.07))',
  },
  live: {
    practiceTeam: '#e5e7eb',
    teammateFlagRing: 'rgba(250, 204, 21, 0.88)',
    teammateOutline: 'rgba(255, 255, 255, 0.72)',
    localFlagRing: 'rgba(250, 204, 21, 0.92)',
    localFill: 'rgba(248, 250, 252, 0.98)',
    dropPath: 'rgba(226, 242, 255, 0.42)',
    dropPathShadow: 'rgba(125, 211, 252, 0.42)',
    dropSegment: 'rgba(103, 232, 249, 0.96)',
    dropSegmentShadow: 'rgba(34, 211, 238, 0.76)',
    dropShipFill: 'rgba(251, 146, 60, 0.98)',
    dropShipStroke: 'rgba(255, 247, 237, 0.92)',
  },
  team: {
    red: '#fb7185',
    blue: '#67e8f9',
  },
  spawn: {
    red: '#f43f5e',
    blue: '#06b6d4',
  },
  static: {
    background: 'rgba(2, 6, 12, 0.5)',
    boundaryStroke: 'rgba(226, 242, 255, 0.62)',
    boundaryShadow: 'rgba(125, 211, 252, 0.34)',
    bridgeRoute: 'rgba(226, 242, 255, 0.22)',
    route: 'rgba(148, 163, 184, 0.13)',
    moduleFill: 'rgba(203, 213, 225, 0.16)',
    moduleStroke: 'rgba(226, 242, 255, 0.22)',
    objectiveOutline: 'rgba(255, 255, 255, 0.78)',
    scanGrid: 'rgba(148, 163, 184, 0.08)',
  },
  safeZone: {
    warningStroke: 'rgba(250, 204, 21, 0.92)',
    stableStroke: 'rgba(125, 211, 252, 0.92)',
    warningFill: 'rgba(250, 204, 21, 0.07)',
    stableFill: 'rgba(56, 189, 248, 0.06)',
    warningShadow: 'rgba(250, 204, 21, 0.7)',
    stableShadow: 'rgba(56, 189, 248, 0.7)',
  },
  surface: {
    barrier: 'rgba(184, 197, 213, 0.66)',
    hazard: 'rgba(251, 113, 71, 0.78)',
    flag: 'rgba(250, 204, 21, 0.72)',
    spawnRed: 'rgba(244, 63, 94, 0.84)',
    spawnBlue: 'rgba(6, 182, 212, 0.84)',
    accentRed: 'rgba(248, 113, 113, 0.82)',
    accentBlue: 'rgba(103, 232, 249, 0.82)',
    structure: (heightRatio: number) => rgba([
      Math.round(104 + heightRatio * 54),
      Math.round(119 + heightRatio * 62),
      Math.round(137 + heightRatio * 70),
    ] as const, 0.72),
    terrain: (heightRatio: number) => rgba([
      Math.round(26 + heightRatio * 48),
      Math.round(60 + heightRatio * 42),
      Math.round(54 + heightRatio * 38),
    ] as const, 0.82),
    void: 'rgba(5, 10, 16, 0.4)',
  },
} as const;
