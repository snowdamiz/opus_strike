import { ABILITY_DEFINITIONS } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';

const PHANTOM_VEIL_ABILITY_ID = 'phantom_veil';
const PHANTOM_VEIL_DURATION_MS = (ABILITY_DEFINITIONS[PHANTOM_VEIL_ABILITY_ID]?.duration ?? 6) * 1000;

export const PHANTOM_VEIL_EFFECT_FADE_IN_MS = 150;
export const PHANTOM_VEIL_EFFECT_FADE_OUT_MS = 950;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function getTimedVeilIntensity(startTimeMs: number, nowMs: number): number {
  if (!Number.isFinite(startTimeMs) || startTimeMs <= 0) return 0;

  const elapsedMs = nowMs - startTimeMs;
  if (elapsedMs < 0 || elapsedMs > PHANTOM_VEIL_DURATION_MS + PHANTOM_VEIL_EFFECT_FADE_OUT_MS) return 0;

  const fadeIn = smoothstep01(elapsedMs / PHANTOM_VEIL_EFFECT_FADE_IN_MS);
  const fadeOut = elapsedMs <= PHANTOM_VEIL_DURATION_MS
    ? 1
    : 1 - smoothstep01((elapsedMs - PHANTOM_VEIL_DURATION_MS) / PHANTOM_VEIL_EFFECT_FADE_OUT_MS);
  return clamp01(fadeIn * fadeOut);
}

export function getPhantomVeilSkyIntensity(nowMs = Date.now()): number {
  const store = useGameStore.getState();
  let intensity = 0;

  if (
    store.ultimateEffectActive &&
    store.ultimateEffectType === PHANTOM_VEIL_ABILITY_ID &&
    store.ultimateEffectEndTime > 0
  ) {
    intensity = Math.max(
      intensity,
      getTimedVeilIntensity(store.ultimateEffectEndTime - PHANTOM_VEIL_DURATION_MS, nowMs)
    );
  }

  const visitPlayer = (player: typeof store.localPlayer): void => {
    if (!player || player.heroId !== 'phantom') return;
    const veil = player.abilities?.[PHANTOM_VEIL_ABILITY_ID];
    if (!veil) return;

    const activatedAt = veil.activatedAt ?? 0;
    if (Number.isFinite(activatedAt) && activatedAt > 0) {
      intensity = Math.max(intensity, getTimedVeilIntensity(activatedAt, nowMs));
      return;
    }

    if (veil.isActive) {
      intensity = 1;
    }
  };

  visitPlayer(store.localPlayer);
  store.players.forEach(visitPlayer);

  return clamp01(intensity);
}
