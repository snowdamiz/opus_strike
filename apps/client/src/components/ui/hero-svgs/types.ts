import type { HeroId } from '@voxel-strike/shared';

export interface HeroSVGInternalProps {
  colors: { primary: string; secondary: string; glow: string };
  className: string;
  size: number;
  animated?: boolean;
}

export interface HeroSVGProps {
  heroId: HeroId;
  className?: string;
  size?: number;
  animated?: boolean;
}

export const HERO_COLORS: Record<HeroId, { primary: string; secondary: string; glow: string }> = {
  phantom: { primary: '#a855f7', secondary: '#7c3aed', glow: 'rgba(168, 85, 247, 0.6)' },
  hookshot: { primary: '#06b6d4', secondary: '#0891b2', glow: 'rgba(6, 182, 212, 0.6)' },
  blaze: { primary: '#f97316', secondary: '#ea580c', glow: 'rgba(249, 115, 22, 0.6)' },
  glacier: { primary: '#3b82f6', secondary: '#1d4ed8', glow: 'rgba(59, 130, 246, 0.6)' },
  pulse: { primary: '#22c55e', secondary: '#16a34a', glow: 'rgba(34, 197, 94, 0.6)' },
  sentinel: { primary: '#eab308', secondary: '#ca8a04', glow: 'rgba(234, 179, 8, 0.6)' },
};
