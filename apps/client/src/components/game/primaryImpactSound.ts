import type { HeroId, Vec3 } from '@voxel-strike/shared';
import { playSharedSound } from '../../hooks/useAudio';

type PrimaryImpactHeroId = Extract<HeroId, 'blaze' | 'chronos' | 'phantom'>;

const PRIMARY_IMPACT_CLIP_MS = 350;
const PRIMARY_IMPACT_FADE_OUT_MS = 36;
const PRIMARY_IMPACT_VOLUME = 0.78;
const PRIMARY_IMPACT_PITCH: Record<PrimaryImpactHeroId, number> = {
  blaze: 0.82,
  chronos: 1.18,
  phantom: 1,
};

export function playPrimaryImpactSound(
  heroId: PrimaryImpactHeroId,
  position: Vec3,
  options: { supercharged?: boolean } = {}
): void {
  void playSharedSound('chronosSuperchargedImpact', {
    position,
    durationMs: PRIMARY_IMPACT_CLIP_MS,
    fadeOutMs: PRIMARY_IMPACT_FADE_OUT_MS,
    pitch: PRIMARY_IMPACT_PITCH[heroId],
    volume: heroId === 'chronos' && options.supercharged ? 1 : PRIMARY_IMPACT_VOLUME,
  });
}
