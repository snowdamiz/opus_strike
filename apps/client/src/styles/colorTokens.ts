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

export const WALLET_AUTH_COLORS = {
  gradient: 'linear-gradient(135deg, #9945FF 0%, #7B3FE4 50%, #5B2CC9 100%)',
  glow: '0 0 40px rgba(153, 69, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
  subtleGlow: '0 0 30px rgba(153, 69, 255, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)',
  shimmer: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
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
