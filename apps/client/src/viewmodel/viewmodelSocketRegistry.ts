import * as THREE from 'three';
import { loggers } from '../utils/logger';

export interface ViewmodelSocketPose {
  socketName: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  timestampMs: number;
  revision: number;
}

export interface ViewmodelSocketPoseDraft {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  timestampMs?: number;
}

export type ViewmodelPoseSampler<TContext = unknown> = (
  context: TContext
) => ViewmodelSocketPoseDraft | null;

interface RegisteredSocket {
  object: THREE.Object3D;
  registeredAtMs: number;
  revision: number;
}

interface RegisteredSampler {
  sampler: ViewmodelPoseSampler;
  registeredAtMs: number;
  revision: number;
}

const registeredSockets = new Map<string, RegisteredSocket>();
const registeredSamplers = new Map<string, RegisteredSampler>();
let registryRevision = 0;

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function nextRevision(): number {
  registryRevision += 1;
  return registryRevision;
}

export function registerViewmodelSocket(
  socketName: string,
  object: THREE.Object3D
): () => void {
  const revision = nextRevision();
  registeredSockets.set(socketName, {
    object,
    registeredAtMs: nowMs(),
    revision,
  });

  return () => {
    const entry = registeredSockets.get(socketName);
    if (entry?.object === object && entry.revision === revision) {
      registeredSockets.delete(socketName);
      nextRevision();
    }
  };
}

export function readViewmodelSocket(socketName: string): ViewmodelSocketPose | null {
  const entry = registeredSockets.get(socketName);
  if (!entry) return null;

  entry.object.updateWorldMatrix(true, false);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  entry.object.getWorldPosition(position);
  entry.object.getWorldQuaternion(quaternion);

  return {
    socketName,
    position,
    quaternion,
    timestampMs: nowMs(),
    revision: nextRevision(),
  };
}

export function registerViewmodelPoseSampler<TContext>(
  socketName: string,
  sampler: ViewmodelPoseSampler<TContext>
): () => void {
  const revision = nextRevision();
  registeredSamplers.set(socketName, {
    sampler: sampler as ViewmodelPoseSampler,
    registeredAtMs: nowMs(),
    revision,
  });

  return () => {
    const entry = registeredSamplers.get(socketName);
    if (entry?.sampler === sampler && entry.revision === revision) {
      registeredSamplers.delete(socketName);
      nextRevision();
    }
  };
}

export function sampleViewmodelPose<TContext>(
  socketName: string,
  context: TContext
): ViewmodelSocketPose | null {
  const entry = registeredSamplers.get(socketName);
  if (!entry) return null;

  const draft = entry.sampler(context);
  if (!draft) return null;

  return {
    socketName,
    position: draft.position.clone(),
    quaternion: draft.quaternion.clone(),
    timestampMs: draft.timestampMs ?? nowMs(),
    revision: nextRevision(),
  };
}

export function assertViewmodelLaunchMatchesPose({
  eventId,
  launchPosition,
  pose,
  epsilon = 0.00001,
}: {
  eventId: string;
  launchPosition: { x: number; y: number; z: number };
  pose: ViewmodelSocketPose | null;
  epsilon?: number;
}): void {
  if (!import.meta.env.DEV || !pose) return;

  const dx = launchPosition.x - pose.position.x;
  const dy = launchPosition.y - pose.position.y;
  const dz = launchPosition.z - pose.position.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;

  if (distanceSq <= epsilon * epsilon) return;

  loggers.viewmodel.warn('projectile launch did not match sampled socket pose', {
    eventId,
    socketName: pose.socketName,
    distance: Math.sqrt(distanceSq),
    launchPosition,
    socketPosition: {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
    },
    revision: pose.revision,
    timestampMs: pose.timestampMs,
  });
}

