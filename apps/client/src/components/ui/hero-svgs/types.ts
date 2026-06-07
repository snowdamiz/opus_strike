import type { HeroId } from '@voxel-strike/shared';
import { HERO_COLOR_SCHEMES } from '../../../styles/colorTokens';

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

export const HERO_COLORS: Record<HeroId, { primary: string; secondary: string; glow: string }> = HERO_COLOR_SCHEMES;
