import * as THREE from 'three';
import {
  CHRONOS_LIFELINE_BEAM_DURATION_MS,
  CHRONOS_LIFELINE_SOURCE_HEIGHT,
  CHRONOS_LIFELINE_TARGET_HEIGHT,
} from '@voxel-strike/shared';
import { addEffects } from '../Effects';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ChronosLifelineEffectTarget {
  position: Vec3Like;
}

interface ChronosLifelineEffectOptions {
  sourceIsExact?: boolean;
  sourceAbilityId?: string;
  sourcePlayerId?: string;
}

export function addChronosLifelineEffects(
  sourcePosition: Vec3Like,
  targets: readonly ChronosLifelineEffectTarget[],
  durationMs = CHRONOS_LIFELINE_BEAM_DURATION_MS,
  options: ChronosLifelineEffectOptions = {}
): void {
  const source = new THREE.Vector3(
    sourcePosition.x,
    sourcePosition.y + (options.sourceIsExact ? 0 : CHRONOS_LIFELINE_SOURCE_HEIGHT),
    sourcePosition.z
  );
  const effects: Array<Parameters<typeof addEffects>[0][number]> = [];

  for (const target of targets) {
    const lifelineEnd = new THREE.Vector3(
      target.position.x,
      target.position.y + CHRONOS_LIFELINE_TARGET_HEIGHT,
      target.position.z
    );

    effects.push({
      type: 'lifeline',
      position: source,
      endPosition: lifelineEnd,
      sourceAbilityId: options.sourceAbilityId,
      sourcePlayerId: options.sourcePlayerId,
      duration: durationMs,
    });
    effects.push({
      type: 'heal',
      position: lifelineEnd,
      duration: durationMs + 160,
    });
  }

  addEffects(effects);
}

export function addChronosSelfHealPulseEffect(
  sourcePosition: Vec3Like,
  targetPosition: Vec3Like,
  durationMs = CHRONOS_LIFELINE_BEAM_DURATION_MS,
  options: ChronosLifelineEffectOptions = {}
): void {
  const source = new THREE.Vector3(
    sourcePosition.x,
    sourcePosition.y + (options.sourceIsExact ? 0 : CHRONOS_LIFELINE_SOURCE_HEIGHT),
    sourcePosition.z
  );
  const target = new THREE.Vector3(
    targetPosition.x,
    targetPosition.y + CHRONOS_LIFELINE_TARGET_HEIGHT,
    targetPosition.z
  );

  addEffects([
    {
      type: 'chronosSelfHealPulse',
      position: source,
      sourceAbilityId: options.sourceAbilityId,
      sourcePlayerId: options.sourcePlayerId,
      duration: durationMs + 140,
    },
    {
      type: 'heal',
      position: target,
      duration: durationMs + 160,
    },
  ]);
}
