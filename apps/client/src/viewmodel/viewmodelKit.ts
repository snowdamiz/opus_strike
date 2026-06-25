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
  const scale = new THREE.Vector3(1, 1, 1);

  return writeViewmodelPoseDraftFromMatrix({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  }, scale, matrix, timestampMs);
}

export function writeViewmodelPoseDraftFromMatrix(
  out: ViewmodelSocketPoseDraft,
  scaleScratch: THREE.Vector3,
  matrix: THREE.Matrix4,
  timestampMs: number
): ViewmodelSocketPoseDraft {
  matrix.decompose(out.position, out.quaternion, scaleScratch);
  out.timestampMs = timestampMs;
  return out;
}
