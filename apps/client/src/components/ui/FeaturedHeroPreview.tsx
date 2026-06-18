import { useEffect, useState, type CSSProperties } from 'react';
import { HERO_DEFINITIONS } from '@voxel-strike/shared';
import type { HeroId } from '@voxel-strike/shared';
import { HeroPreviewCanvas, type HeroPreviewAnimationMode, type HeroPreviewRank } from './HeroPreviewCanvas';

type FeaturedHeroPreviewScale = 'default' | 'large';

const FEATURED_IDLE_PREVIEW_CLASS_BY_SCALE: Record<FeaturedHeroPreviewScale, string> = {
  default: 'relative -mt-[clamp(1.6rem,5vh,4rem)] h-[clamp(16rem,40vh,29rem)] w-[clamp(14.5rem,29vw,27rem)]',
  large: 'relative -mt-[clamp(2rem,5.6vh,4.5rem)] h-[clamp(18rem,44vh,31.5rem)] w-[clamp(16rem,32vw,29.5rem)]',
};

function getFeaturedHeroPreviewClassName(
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

export function FeaturedHeroPreview({
  heroId,
  accentColor,
  initialYaw,
  animationMode,
  scale = 'default',
  className,
  rank,
}: {
  heroId: HeroId;
  accentColor: string;
  initialYaw: number;
  animationMode: HeroPreviewAnimationMode;
  scale?: FeaturedHeroPreviewScale;
  className?: string;
  rank?: HeroPreviewRank | null;
}) {
  const [shouldMountPreview, setShouldMountPreview] = useState(false);
  const previewClassName = className ?? getFeaturedHeroPreviewClassName(animationMode, scale);

  useEffect(() => {
    setShouldMountPreview(false);

    let secondFrame = 0;
    let thirdFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        thirdFrame = window.requestAnimationFrame(() => {
          setShouldMountPreview(true);
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.cancelAnimationFrame(thirdFrame);
    };
  }, [animationMode, heroId]);

  const preview = shouldMountPreview ? (
    <HeroPreviewCanvas
      heroId={heroId}
      accentColor={accentColor}
      size="featured"
      initialYaw={initialYaw}
      animationMode={animationMode}
      platformRank={rank}
      className={previewClassName}
    />
  ) : (
    <div
      className={`hero-preview-shell relative overflow-hidden select-none ${previewClassName}`}
      data-ready="false"
      data-size="featured"
      style={{ '--hero-preview-accent': accentColor } as CSSProperties}
      aria-label={`Loading ${HERO_DEFINITIONS[heroId].name} voxel preview`}
      aria-busy
    >
      <div className="hero-preview-loading pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="hero-preview-loader-ring" />
      </div>
    </div>
  );

  return (
    <div className="play-hero-preview-wrap relative">
      {preview}
    </div>
  );
}
