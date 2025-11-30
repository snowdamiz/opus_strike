import type { HeroId } from '@voxel-strike/shared';
import {
  PhantomSVG,
  HookshotSVG,
  BlazeSVG,
  GlacierSVG,
  PulseSVG,
  SentinelSVG,
  HERO_COLORS,
} from './hero-svgs';

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
