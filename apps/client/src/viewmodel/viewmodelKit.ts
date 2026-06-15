import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import {
  registerViewmodelPoseSampler,
  registerViewmodelSocket,
  type ViewmodelPoseSampler,
  type ViewmodelSocketPoseDraft,
} from './viewmodelSocketRegistry';

export type { ViewmodelPoseSampler, ViewmodelSocketPoseDraft };

export function useRegisteredViewmodelSocket<TObject extends THREE.Object3D>(
  socketName: string,
  objectRef: RefObject<TObject | null>,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled || !objectRef.current) return undefined;
    return registerViewmodelSocket(socketName, objectRef.current);
  }, [enabled, objectRef, socketName]);
}

export interface ViewmodelPoseSamplerRegistration {
  socketName: string;
  sampler: ViewmodelPoseSampler<never>;
}

export function registerViewmodelPoseSamplers(
  registrations: readonly ViewmodelPoseSamplerRegistration[]
): () => void {
  const unregister = registrations.map(({ socketName, sampler }) => (
    registerViewmodelPoseSampler(socketName, sampler)
  ));

  return () => {
    for (let i = unregister.length - 1; i >= 0; i -= 1) {
      unregister[i]();
    }
  };
}

export function viewmodelPoseDraftFromMatrix(
  matrix: THREE.Matrix4,
  timestampMs: number
): ViewmodelSocketPoseDraft {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  matrix.decompose(position, quaternion, scale);

  return {
    position,
    quaternion,
    timestampMs,
  };
}
