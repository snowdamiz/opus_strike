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
  animated?: boolean;
}

export function HeroSVG({ heroId, className = '', size = 400, animated = true }: HeroSVGProps) {
  const colors = HERO_COLORS[heroId];
  const animationClassName = animated ? className : `${className} hero-svg-static`;
  
  switch (heroId) {
    case 'phantom':
      return <PhantomSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    case 'hookshot':
      return <HookshotSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    case 'blaze':
      return <BlazeSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    case 'glacier':
      return <GlacierSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    case 'pulse':
      return <PulseSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    case 'sentinel':
      return <SentinelSVG colors={colors} className={animationClassName} size={size} animated={animated} />;
    default:
      return null;
  }
}
