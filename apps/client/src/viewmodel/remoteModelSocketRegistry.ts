import * as THREE from 'three';

export type RemoteModelSocketSource = 'fullBody';

export interface RemoteModelSocketPose {
  playerId: string;
  socketName: string;
  source: RemoteModelSocketSource;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  timestampMs: number;
  revision: number;
}

interface RegisteredRemoteSocket {
  object: THREE.Object3D;
  playerId: string;
  socketName: string;
  source: RemoteModelSocketSource;
  registeredAtMs: number;
  revision: number;
}

const registeredSockets = new Map<string, RegisteredRemoteSocket>();
let registryRevision = 0;

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function nextRevision(): number {
  registryRevision += 1;
  return registryRevision;
}

function socketKey(playerId: string, socketName: string): string {
  return `${playerId}:${socketName}`;
}

export function registerRemoteModelSocket(
  playerId: string,
  socketName: string,
  object: THREE.Object3D,
  source: RemoteModelSocketSource
): () => void {
  const revision = nextRevision();
  const key = socketKey(playerId, socketName);
  registeredSockets.set(key, {
    object,
    playerId,
    socketName,
    source,
    registeredAtMs: nowMs(),
    revision,
  });

  return () => {
    const entry = registeredSockets.get(key);
    if (entry?.object === object && entry.revision === revision) {
      registeredSockets.delete(key);
      nextRevision();
    }
  };
}

export function readRemoteModelSocket(
  playerId: string,
  socketName: string
): RemoteModelSocketPose | null {
  const entry = registeredSockets.get(socketKey(playerId, socketName));
  if (!entry) return null;

  entry.object.updateWorldMatrix(true, false);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  entry.object.getWorldPosition(position);
  entry.object.getWorldQuaternion(quaternion);

  return {
    playerId,
    socketName,
    source: entry.source,
    position,
    quaternion,
    timestampMs: nowMs(),
    revision: nextRevision(),
  };
}

export function readRemoteModelSocketAny(
  playerId: string,
  socketNames: readonly string[]
): RemoteModelSocketPose | null {
  for (const socketName of socketNames) {
    const pose = readRemoteModelSocket(playerId, socketName);
    if (pose) return pose;
  }

  return null;
}

export function writeRemoteModelSocketPosition(
  out: { x: number; y: number; z: number },
  playerId: string,
  socketNames: string | readonly string[]
): boolean {
  const pose = typeof socketNames === 'string'
    ? readRemoteModelSocket(playerId, socketNames)
    : readRemoteModelSocketAny(playerId, socketNames);
  if (!pose) return false;

  out.x = pose.position.x;
  out.y = pose.position.y;
  out.z = pose.position.z;
  return true;
}
