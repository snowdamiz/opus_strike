import * as THREE from 'three';
import {
  CHRONOS_LIFELINE_BEAM_DURATION_MS,
  CHRONOS_LIFELINE_SOURCE_HEIGHT,
  CHRONOS_LIFELINE_TARGET_HEIGHT,
} from '@voxel-strike/shared';
import { addEffect } from '../Effects';

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

  for (const target of targets) {
    const end = new THREE.Vector3(
      target.position.x,
      target.position.y + CHRONOS_LIFELINE_TARGET_HEIGHT,
      target.position.z
    );

    addEffect({
      type: 'lifeline',
      position: source.clone(),
      endPosition: end.clone(),
      sourceAbilityId: options.sourceAbilityId,
      sourcePlayerId: options.sourcePlayerId,
      duration: durationMs,
    });
    addEffect({
      type: 'heal',
      position: end,
      duration: durationMs + 160,
    });
  }
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

  addEffect({
    type: 'chronosSelfHealPulse',
    position: source,
    sourceAbilityId: options.sourceAbilityId,
    sourcePlayerId: options.sourcePlayerId,
    duration: durationMs + 140,
  });
  addEffect({
    type: 'heal',
    position: target,
    duration: durationMs + 160,
  });
}
