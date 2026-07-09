import type { CSSProperties } from 'react';
import type { HeroPreviewAnimationMode } from './HeroPreviewCanvas';
import { BLAZE_UI_COLORS } from '../../styles/colorTokens';

export type FeaturedHeroPreviewScale = 'default' | 'large';

const FEATURED_IDLE_PREVIEW_CLASS_BY_SCALE: Record<FeaturedHeroPreviewScale, string> = {
  default: 'relative -mt-[clamp(1.6rem,5vh,4rem)] h-[clamp(16rem,40vh,29rem)] w-[clamp(14.5rem,29vw,27rem)]',
  large: 'relative -mt-[clamp(2rem,5.6vh,4.5rem)] h-[clamp(18rem,44vh,31.5rem)] w-[clamp(16rem,32vw,29.5rem)]',
};

export function getFeaturedHeroPreviewClassName(
  animationMode: HeroPreviewAnimationMode,
  scale: FeaturedHeroPreviewScale
): string {
  if (animationMode === 'idle') {
    return FEATURED_IDLE_PREVIEW_CLASS_BY_SCALE[scale];
  }

  if (animationMode === 'jump') {
    return 'relative -mt-[clamp(4rem,11vh,8rem)] h-[clamp(17.5rem,45vh,32rem)] w-[clamp(12rem,26vw,24rem)]';
  }

  if (animationMode === 'slide') {
    return 'relative h-[clamp(14.5rem,35vh,26rem)] w-[clamp(14.5rem,29vw,27rem)]';
  }

  return 'relative h-[clamp(13.5rem,34vh,24rem)] w-[clamp(12rem,26vw,24rem)]';
}

// Suspense fallback for the lazy-loaded preview: same footprint as the real
// canvas so screens don't shift when the chunk resolves. Lives outside
// FeaturedHeroPreview.tsx so importing it never pulls three.js eagerly.
export function FeaturedHeroPreviewFallback({
  animationMode = 'idle',
  scale = 'default',
  className,
}: {
  animationMode?: HeroPreviewAnimationMode;
  scale?: FeaturedHeroPreviewScale;
  className?: string;
}) {
  const previewClassName = className ?? getFeaturedHeroPreviewClassName(animationMode, scale);
  return (
    <div className="play-hero-preview-wrap relative">
      <div
        className={`hero-preview-shell relative overflow-hidden select-none ${previewClassName}`}
        data-ready="false"
        data-size="featured"
        style={{ '--hero-preview-accent': BLAZE_UI_COLORS.primary } as CSSProperties}
        aria-hidden
      >
        <div className="hero-preview-loading pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="hero-preview-loader-ring" />
        </div>
      </div>
    </div>
  );
}
